// 사용: node driver.mjs <plan.json> <out.json>
// plan: { name, command, args, env?, calls: [{tool, input}], repeat? }
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const outPath = process.argv[3];
const logPath = join(here, `.${plan.name}.log`);
if (existsSync(logPath)) unlinkSync(logPath);
const repeat = plan.repeat ?? 3;

const env = { ...process.env, ...(plan.env ?? {}), PERF_LOG: logPath,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${join(here, "preload.mjs")}`.trim() };
const tSpawn = performance.now();
const transport = new StdioClientTransport({ command: plan.command, args: plan.args ?? [], env, stderr: "pipe" });
const client = new Client({ name: "perf-probe", version: "0" });
await client.connect(transport);
const coldStartMs = performance.now() - tSpawn;
const toolsFull = (await client.listTools()).tools; const tools = toolsFull.map((t) => t.name);

const calls = [];
for (const c of plan.calls) {
  for (let i = 0; i < repeat; i++) {
    const t0 = performance.timeOrigin + performance.now();
    let res, err = null;
    try { res = await client.callTool({ name: c.tool, arguments: c.input }); } catch (e) { err = String(e).slice(0, 300); }
    const t1 = performance.timeOrigin + performance.now();
    const size = res ? Buffer.byteLength(JSON.stringify(res)) : 0;
    calls.push({ tool: c.tool, input: c.input, iter: i, t0, t1, ms: t1 - t0, snippet: res ? JSON.stringify(res.content ?? res).slice(0, 300) : null, isError: res?.isError ?? null, err, resultBytes: size });
    await new Promise((r) => setTimeout(r, 150));
  }
}
await client.close();
// 프리로드 시계와 드라이버 시계는 프로세스가 달라 원점이 다르다. 상대 위치로 버킷팅하기 위해
// 로그의 t0 를 벽시계로 쓰지 않고, 호출 순서 + 겹침으로 배정한다: 각 호출의 [t0,t1] 길이와
// 외부 요청 순서를 맞추기 위해 Date.now 대신 performance.timeOrigin 보정을 쓴다.
const log = existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
writeFileSync(outPath, JSON.stringify({ name: plan.name, coldStartMs, tools, toolsFull, calls, external: log }, null, 2));
console.log(plan.name, "tools", tools.length, "calls", calls.length, "external", log.length, "cold", Math.round(coldStartMs));

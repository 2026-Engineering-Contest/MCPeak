// runner 드라이버. 사용: node rdriver.mjs <spec.json> <out.json>
// spec: { name, command, args, tool, input, repeat, gapMs, harnessPreload: bool }
// out 은 하네스 analyze.mjs 가 읽는 형식(external=하네스 프리로드 로그) + marks(runner 프리로드 로그).
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { Client } from "/private/tmp/claude-501/-Users-doo---hyun-Study-Project-OhMyMCP/52038bbb-2b89-4660-bcca-e6924ac607f2/scratchpad/perf-probe/runner/../harness/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "/private/tmp/claude-501/-Users-doo---hyun-Study-Project-OhMyMCP/52038bbb-2b89-4660-bcca-e6924ac607f2/scratchpad/perf-probe/runner/../harness/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
const spec = JSON.parse(readFileSync(process.argv[2], "utf8")); const outPath = process.argv[3];
const hlog = outPath + ".hlog", mlog = outPath + ".mlog";
for (const f of [hlog, mlog]) if (existsSync(f)) unlinkSync(f);
const imports = ["--import=/private/tmp/claude-501/-Users-doo---hyun-Study-Project-OhMyMCP/52038bbb-2b89-4660-bcca-e6924ac607f2/scratchpad/perf-probe/runner/mark.mjs"]; if (spec.harnessPreload) imports.push("--import=/private/tmp/claude-501/-Users-doo---hyun-Study-Project-OhMyMCP/52038bbb-2b89-4660-bcca-e6924ac607f2/scratchpad/perf-probe/runner/../harness/preload.mjs");
const env = { ...process.env, ...(spec.env ?? {}), PERF_LOG: hlog, MARK_LOG: mlog, NODE_OPTIONS: [spec.env?.NODE_OPTIONS ?? "", ...imports].join(" ").trim() };
const ts = performance.now();
const transport = new StdioClientTransport({ command: spec.command, args: spec.args ?? [], env, stderr: "pipe", cwd: spec.cwd });
const client = new Client({ name: "runner", version: "0" }); await client.connect(transport);
const coldStartMs = performance.now() - ts;
const calls = [];
for (let i = 0; i < (spec.repeat ?? 5); i++) {
  const t0 = performance.timeOrigin + performance.now(); let res, err = null;
  try { res = await client.callTool({ name: spec.tool, arguments: spec.input }, undefined, { timeout: 120000 }); } catch (e) { err = String(e).slice(0, 300); }
  const t1 = performance.timeOrigin + performance.now();
  calls.push({ tool: spec.tool, input: spec.input, iter: i, t0, t1, ms: t1 - t0, isError: res?.isError ?? null, err, resultBytes: res ? Buffer.byteLength(JSON.stringify(res)) : 0, snippet: res ? JSON.stringify(res.content).slice(0, 200) : null, full: res ? JSON.stringify(res.content) : null });
  await new Promise((r) => setTimeout(r, spec.gapMs ?? 150));
}
await client.close();
const rd = (f) => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
writeFileSync(outPath, JSON.stringify({ name: spec.name, coldStartMs, tools: [spec.tool], calls, external: rd(hlog), marks: rd(mlog) }, null, 2));
console.log(spec.name, "calls", calls.length, "errs", calls.filter((c) => c.err || c.isError).length, "ms", calls.map((c) => Math.round(c.ms)).join(","));

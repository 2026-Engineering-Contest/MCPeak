// 게이트 B 가 낸 호출을 실제 서버에 넣어, 원본 조건과 안전 조건의 응답을 비교한다.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
const SB = process.cwd() + "/sandbox";
const SERVERS = {
  filesystem: { cmd: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp/notes"], reset: () => { rmSync("/tmp/notes", { recursive: true, force: true }); mkdirSync("/tmp/notes", { recursive: true }); writeFileSync("/tmp/notes/todo.md", "- 할 일\n"); } },
  memory: { cmd: ["npx", "-y", "@modelcontextprotocol/server-memory"], env: { MEMORY_FILE_PATH: SB + "/memory.jsonl" }, reset: () => { rmSync(SB + "/memory.jsonl", { force: true }); } },
  everything: { cmd: ["npx", "-y", "@modelcontextprotocol/server-everything"], reset: () => {} },
  "git-cyan": { cmd: ["npx", "-y", "@cyanheads/git-mcp-server"], env: { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "a@b.c", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "a@b.c" }, reset: () => { rmSync(SB + "/repo", { recursive: true, force: true }); mkdirSync(SB + "/repo/src", { recursive: true }); writeFileSync(SB + "/repo/src/app.ts", "export const a=1\n"); execSync("git init -q && git add -A && git -c user.email=a@b.c -c user.name=t commit -qm init && echo 'export const a=2' > src/app.ts", { cwd: SB + "/repo" }); }, rewrite: (s) => s.replaceAll("/Users/me/project", SB + "/repo") },
  "mastra-docs": { cmd: ["npx", "-y", "@mastra/mcp-docs-server"], reset: () => {} },
};
const norm = (r) => JSON.stringify(r).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<ts>").replace(/[0-9a-f]{40}/g, "<sha>").replace(/\b\d{10,13}\b/g, "<num>").replace(new RegExp(SB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<sb>");
async function run(name, calls) {
  const S = SERVERS[name]; S.reset();
  const t = new StdioClientTransport({ command: S.cmd[0], args: S.cmd.slice(1), env: { ...process.env, ...(S.env ?? {}) }, stderr: "pipe" });
  const c = new Client({ name: "exec", version: "0" }); c.onerror = () => {}; try { await c.connect(t); } catch (e) { return calls.map((x) => ({ n: x.n, tool: x.tool, threw: "connect: " + String(e.message).slice(0, 100) })); }
  const out = [];
  for (const call of calls) {
    if (!call.tool) { out.push({ n: call.n, skipped: true }); continue; }
    const args = S.rewrite ? JSON.parse(S.rewrite(JSON.stringify(call.args ?? {}))) : (call.args ?? {});
    try { const r = await Promise.race([c.callTool({ name: call.tool, arguments: args }), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 30000))]); out.push({ n: call.n, tool: call.tool, isError: !!r.isError, body: norm(r.content ?? r) }); }
    catch (e) { out.push({ n: call.n, tool: call.tool, threw: String(e.message ?? e).slice(0, 200) }); }
  }
  try { await c.close(); } catch {} return out;
}
process.on('uncaughtException', (e) => console.error('uncaught', String(e.message).slice(0,100)));
const rows = [];
for (const name of process.argv.slice(2)) {
  const a = JSON.parse(readFileSync(`gateB/answer3-${name}-orig-a.json`, "utf8")), s = JSON.parse(readFileSync(`gateB/answer3-${name}-safe.json`, "utf8"));
  const ra = await run(name, a), rs = await run(name, s);
  let same = 0, sameOutcome = 0; const diffs = [];
  for (let i = 0; i < ra.length; i++) {
    const x = ra[i], y = rs[i];
    if (JSON.stringify(x) === JSON.stringify(y)) { same++; sameOutcome++; continue; }
    if (x.isError === y.isError && !!x.threw === !!y.threw) sameOutcome++;
    diffs.push({ n: x.n, orig: (x.body ?? x.threw ?? "skip").slice(0, 90), safe: (y.body ?? y.threw ?? "skip").slice(0, 90) });
  }
  rows.push({ server: name, calls: ra.length, "응답 동일": same, "성공/실패 결과 동일": sameOutcome, "원본 오류 수": ra.filter((x) => x.isError || x.threw).length });
  if (diffs.length) console.log(name, "차이:", diffs);
  writeFileSync(`out/exec-${name}.json`, JSON.stringify({ orig: ra, safe: rs }, null, 2));
}
console.table(rows); process.exit(0);

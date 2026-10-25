import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [name, cmd, ...args] = process.argv.slice(2);
const env = { ...process.env };
for (const kv of (process.env.EXTRA_ENV ?? "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=");
  env[k] = v;
}
const t = new StdioClientTransport({ command: cmd, args, env, stderr: "pipe" });
const c = new Client({ name: "dump", version: "0" });
const timer = setTimeout(() => {
  console.error(name, "TIMEOUT");
  process.exit(2);
}, 90000);
try {
  await c.connect(t);
  const info = c.getServerVersion();
  const instr = c.getInstructions();
  let tools = [],
    cursor;
  do {
    const r = await c.listTools(cursor ? { cursor } : {});
    tools.push(...r.tools);
    cursor = r.nextCursor;
  } while (cursor);
  writeFileSync(
    `lists/${name}.json`,
    JSON.stringify({ name, server: info, instructions: instr ?? null, tools }, null, 2),
  );
  console.log(name, "tools:", tools.length);
} catch (e) {
  console.error(name, "FAIL", String(e).slice(0, 200));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  try {
    await c.close();
  } catch {}
  process.exit();
}

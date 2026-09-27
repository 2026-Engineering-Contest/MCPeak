import { readFileSync, writeFileSync } from "node:fs";
const req = JSON.parse(readFileSync("gateB/requests3.json", "utf8"));
for (const n of Object.keys(req)) for (const stage of ["orig", "safe"]) {
  const d = stage === "orig" ? JSON.parse(readFileSync(`lists/${n}.json`, "utf8")) : JSON.parse(readFileSync(`out/${n}.safe.json`, "utf8"));
  const tools = d.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  const p = `You are an AI assistant with access to the MCP tools below. For EACH numbered user request, decide which single tool you would call and with what arguments. Do not explain. Output ONLY a JSON array, one object per request, in order: {"n":<number>,"tool":"<tool name or null>","args":{...}}. Arguments must be valid for the tool's input_schema. Use placeholder values exactly as given in the request.\n\n${d.instructions ? `SERVER INSTRUCTIONS:\n${d.instructions}\n\n` : ""}TOOLS (JSON):\n${JSON.stringify(tools)}\n\nUSER REQUESTS:\n${req[n].map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
  writeFileSync(`gateB/prompt3-${n}-${stage}.txt`, p);
}
console.log(Object.keys(req).length, "servers");

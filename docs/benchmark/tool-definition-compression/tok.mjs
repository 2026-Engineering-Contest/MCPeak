import { readdirSync, readFileSync } from "node:fs";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
export const toks = (v) => encode(typeof v === "string" ? v : JSON.stringify(v)).length;
export const toolToks = (t) =>
  toks({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema });
if ((process.argv[1] ?? "").endsWith("tok.mjs")) {
  const rows = [];
  for (const f of readdirSync("lists")) {
    const d = JSON.parse(readFileSync(`lists/${f}`, "utf8"));
    const total = d.tools.reduce((a, t) => a + toolToks(t), 0);
    const desc = d.tools.reduce((a, t) => a + toks(t.description ?? ""), 0);
    const schema = d.tools.reduce((a, t) => a + toks(t.inputSchema), 0);
    rows.push({
      server: d.name,
      tools: d.tools.length,
      total,
      desc,
      schema,
      instr: d.instructions ? toks(d.instructions) : 0,
      outSchema: d.tools.filter((t) => t.outputSchema).length,
    });
  }
  rows.sort((a, b) => b.total - a.total);
  console.table(rows);
}

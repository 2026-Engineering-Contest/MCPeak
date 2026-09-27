import { readFileSync, writeFileSync } from "node:fs";
import { toks, toolToks } from "./tok.mjs";

const rows = [];
for (const n of ["notion", "mongodb", "firecrawl", "desktop-commander", "chrome-devtools"]) {
  const base = JSON.parse(readFileSync(`lists/${n}.json`, "utf8"));
  const bi = toks(base.instructions ?? "");
  const d = JSON.parse(readFileSync(`out/${n}.stage2.json`, "utf8"));
  // 같은 (파라미터 이름, 설명) 쌍이 3개 이상 도구에서 반복되면 공통 파라미터 사전으로 승격
  const seen = new Map();
  for (const t of d.tools)
    for (const [k, v] of Object.entries(t.inputSchema?.properties ?? {}))
      if (typeof v?.description === "string" && v.description.length >= 20) {
        const key = k + "\u0000" + v.description;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
  const common = new Map([...seen].filter(([, c]) => c >= 3).map(([k]) => k.split("\u0000")));
  const tools = d.tools.map((t) => {
    const s = JSON.parse(JSON.stringify(t.inputSchema));
    for (const [k, v] of Object.entries(s?.properties ?? {}))
      if (common.get(k) === v?.description) delete v.description;
    return { ...t, inputSchema: s };
  });
  const glossary = common.size
    ? "공통 파라미터:\n" + [...common].map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "";
  const instructions = [d.instructions ?? "", glossary].filter(Boolean).join("\n\n");
  writeFileSync(`out/${n}.stage2b.json`, JSON.stringify({ ...d, instructions, tools }, null, 2));
  const b = base.tools.reduce((a, t) => a + toolToks(t), 0);
  const s2 = d.tools.reduce((a, t) => a + toolToks(t), 0) + toks(d.instructions ?? "") - bi;
  const s2b = tools.reduce((a, t) => a + toolToks(t), 0) + toks(instructions) - bi;
  rows.push({
    server: n,
    원본: b,
    "2단계": `${s2} (${((1 - s2 / b) * 100).toFixed(1)}%)`,
    "2b 공통 파라미터 승격": `${s2b} (${((1 - s2b / b) * 100).toFixed(1)}%)`,
    "승격된 파라미터": common.size,
  });
}
console.table(rows);

import { readFileSync } from "node:fs";
import { toks, toolToks } from "./tok.mjs";

const rows = [];
for (const n of ["notion", "mongodb", "firecrawl", "desktop-commander", "chrome-devtools"]) {
  const base = JSON.parse(readFileSync(`lists/${n}.json`, "utf8"));
  const bi = toks(base.instructions ?? "");
  const sum = (d, withInstr) =>
    d.tools.reduce((a, t) => a + toolToks(t), 0) +
    (withInstr ? toks(d.instructions ?? "") - bi : 0);
  const b = sum(base, false),
    s1 = sum(JSON.parse(readFileSync(`out/${n}.stage1.json`, "utf8")), false),
    s2 = sum(JSON.parse(readFileSync(`out/${n}.stage2.json`, "utf8")), true),
    s3 = sum(JSON.parse(readFileSync(`out/${n}.stage3.json`, "utf8")), true);
  const pct = (x) => ((1 - x / b) * 100).toFixed(1) + "%";
  rows.push({
    server: n,
    tools: base.tools.length,
    원본: b,
    "1단계 무손실": `${s1} (${pct(s1)})`,
    "2단계 규칙재작성": `${s2} (${pct(s2)})`,
    "3단계 손실(스키마설명 제거)": `${s3} (${pct(s3)})`,
  });
}
console.table(rows);

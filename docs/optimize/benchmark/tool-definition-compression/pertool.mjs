import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { toks, toolToks } from "./tok.mjs";

const S1 = ["notion", "mongodb", "firecrawl", "desktop-commander", "chrome-devtools"];
const S2 = [
  "azure",
  "paypal",
  "hubspot",
  "sentry",
  "kubernetes",
  "apify",
  "supabase",
  "playwright",
  "github-legacy",
  "playwright-ea",
];
const rows = [
  [
    "server",
    "tool",
    "orig_tokens",
    "orig_desc_tokens",
    "orig_schema_tokens",
    "safe_tokens",
    "safe_pct",
    "stage3_tokens",
    "stage3_pct",
  ],
];
for (const n of [...S1, ...S2]) {
  const orig = JSON.parse(readFileSync(`lists/${n}.json`, "utf8")).tools;
  // 1차 서버는 안전 프로필 결과가 없으므로 지금 만든다
  const safeFile = `out/${n}.safe.json`;
  const safe = JSON.parse(readFileSync(safeFile, "utf8")).tools;
  const s3 = existsSync(`out/${n}.stage3.json`)
    ? JSON.parse(readFileSync(`out/${n}.stage3.json`, "utf8")).tools
    : null;
  orig.forEach((t, i) => {
    const o = toolToks(t),
      s = toolToks(safe[i]),
      t3 = s3 ? toolToks(s3[i]) : "";
    rows.push([
      n,
      t.name,
      o,
      toks(t.description ?? ""),
      toks(t.inputSchema),
      s,
      ((1 - s / o) * 100).toFixed(1),
      t3,
      s3 ? ((1 - t3 / o) * 100).toFixed(1) : "",
    ]);
  });
}
writeFileSync("out/per-tool.csv", rows.map((r) => r.join(",")).join("\n"));
console.log(rows.length - 1, "rows");

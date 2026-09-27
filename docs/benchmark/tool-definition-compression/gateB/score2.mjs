import { readFileSync } from "node:fs";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SERVERS = [
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
const compile = (s) => {
  for (const A of [Ajv, Ajv2020]) {
    try {
      const a = new A({ strict: false, validateFormats: true, logger: false });
      addFormats(a);
      return a.compile(s);
    } catch {}
  }
  return null;
};
const load = (n, st) => {
  try {
    return JSON.parse(readFileSync(`gateB/answer2-${n}-${st}.json`, "utf8"));
  } catch {
    return null;
  }
};
const rows = [],
  details = [];
for (const n of SERVERS) {
  const orig = JSON.parse(readFileSync(`lists/${n}.json`, "utf8")).tools;
  const validators = Object.fromEntries(orig.map((t) => [t.name, compile(t.inputSchema)]));
  const base = load(n, "orig"),
    ans = load(n, "safe");
  if (!base || !ans) {
    rows.push({ server: n, note: `${!base ? "orig" : ""} ${!ans ? "safe" : ""} 답 없음` });
    continue;
  }
  let sameTool = 0,
    validO = 0,
    validS = 0,
    sameArgs = 0;
  for (const b of base) {
    const a = ans.find((x) => x.n === b.n);
    if (!a) continue;
    if (a.tool === b.tool) sameTool++;
    else details.push({ server: n, n: b.n, orig: b.tool, safe: a.tool });
    const vo = validators[b.tool];
    if (vo && vo(b.args ?? {})) validO++;
    const vs = validators[a.tool];
    if (vs && vs(a.args ?? {})) validS++;
    if (a.tool === b.tool && JSON.stringify(a.args) === JSON.stringify(b.args)) sameArgs++;
  }
  rows.push({
    server: n,
    "같은 도구": `${sameTool}/${base.length}`,
    "유효 인자(원본)": `${validO}/${base.length}`,
    "유효 인자(안전)": `${validS}/${base.length}`,
    "인자까지 동일": `${sameArgs}/${base.length}`,
  });
}
console.table(rows);
if (details.length) console.table(details);

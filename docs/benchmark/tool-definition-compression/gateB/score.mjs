import { readdirSync, readFileSync } from "node:fs";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SERVERS = ["notion", "mongodb", "firecrawl", "desktop-commander", "chrome-devtools"];
const compile = (s) => {
  for (const A of [Ajv, Ajv2020]) {
    try {
      const a = new A({ strict: false, validateFormats: true });
      addFormats(a);
      return a.compile(s);
    } catch {}
  }
  return null;
};
const load = (n, st) => {
  try {
    return JSON.parse(readFileSync(`gateB/answer-${n}-${st}.json`, "utf8"));
  } catch {
    return null;
  }
};
const rows = [],
  details = [];
for (const n of SERVERS) {
  const orig = JSON.parse(readFileSync(`lists/${n}.json`, "utf8")).tools;
  const validators = Object.fromEntries(orig.map((t) => [t.name, compile(t.inputSchema)]));
  const base = load(n, "orig");
  if (!base) {
    rows.push({ server: n, note: "orig 답 없음" });
    continue;
  }
  for (const st of ["orig", "stage2", "stage3"]) {
    const ans = load(n, st);
    if (!ans) {
      rows.push({ server: n, stage: st, note: "답 없음" });
      continue;
    }
    let sameTool = 0,
      validArgs = 0,
      sameArgs = 0;
    for (const b of base) {
      const a = ans.find((x) => x.n === b.n);
      if (!a) continue;
      if (a.tool === b.tool) sameTool++;
      const v = validators[a.tool];
      if (v && v(a.args ?? {})) validArgs++;
      if (a.tool === b.tool && JSON.stringify(a.args) === JSON.stringify(b.args)) sameArgs++;
      if (st !== "orig" && a.tool !== b.tool)
        details.push({ server: n, stage: st, n: b.n, orig: b.tool, got: a.tool });
    }
    rows.push({
      server: n,
      stage: st,
      "같은 도구": `${sameTool}/${base.length}`,
      "원본 스키마에 유효한 인자": `${validArgs}/${base.length}`,
      "인자까지 동일": `${sameArgs}/${base.length}`,
    });
  }
}
console.table(rows);
if (details.length) console.table(details);

import { readFileSync } from "node:fs";
import Ajv from "ajv"; import Ajv2020 from "ajv/dist/2020.js"; import addFormats from "ajv-formats";
const SERVERS = ["postman","browserstack","git-cyan","antv-chart","astra","airtable","filesystem","circleci","mastra-docs","everything","browsermcp","line","hyperbrowser","shadcn","pinecone","netlify","browserbase","memory","slack-legacy","google-maps"];
const compile = (s) => { for (const A of [Ajv, Ajv2020]) { try { const a = new A({ strict: false, validateFormats: true, logger: false }); addFormats(a); return a.compile(s); } catch {} } return null; };
const load = (n, st) => { try { return JSON.parse(readFileSync(`gateB/answer3-${n}-${st}.json`, "utf8")); } catch { return null; } };
const rows = [], details = []; let T = { n: 0, ab: 0, as: 0, abArgs: 0, asArgs: 0, sValid: 0, aValid: 0 };
for (const n of SERVERS) {
  const orig = JSON.parse(readFileSync(`lists/${n}.json`, "utf8")).tools;
  const V = Object.fromEntries(orig.map((t) => [t.name, compile(t.inputSchema)]));
  const a = load(n, "orig-a"), b = load(n, "orig-b"), s = load(n, "safe");
  if (!a || !b || !s) { rows.push({ server: n, note: `없음: ${!a ? "a " : ""}${!b ? "b " : ""}${!s ? "safe" : ""}` }); continue; }
  let ab = 0, as = 0, abArgs = 0, asArgs = 0, sValid = 0, aValid = 0;
  for (const x of a) {
    const y = b.find((q) => q.n === x.n), z = s.find((q) => q.n === x.n); if (!y || !z) continue;
    if (x.tool === y.tool) ab++; if (x.tool === z.tool) as++; else details.push({ server: n, n: x.n, "orig-a": x.tool, "orig-b": y.tool, safe: z.tool });
    if (x.tool === y.tool && JSON.stringify(x.args) === JSON.stringify(y.args)) abArgs++;
    if (x.tool === z.tool && JSON.stringify(x.args) === JSON.stringify(z.args)) asArgs++;
    if (V[x.tool]?.(x.args ?? {})) aValid++; if (V[z.tool]?.(z.args ?? {})) sValid++;
  }
  rows.push({ server: n, "원본a=원본b 도구": `${ab}/${a.length}`, "원본a=안전 도구": `${as}/${a.length}`, "a=b 인자": `${abArgs}/${a.length}`, "a=안전 인자": `${asArgs}/${a.length}`, "유효 인자 a/안전": `${aValid}/${sValid}` });
  T.n += a.length; T.ab += ab; T.as += as; T.abArgs += abArgs; T.asArgs += asArgs; T.aValid += aValid; T.sValid += sValid;
}
console.table(rows); if (details.length) console.table(details);
console.log("합계", T);

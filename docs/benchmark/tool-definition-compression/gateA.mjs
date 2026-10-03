import { readFileSync } from "node:fs";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { generateSync } from "json-schema-faker";

const SERVERS = ["notion", "mongodb", "firecrawl", "desktop-commander", "chrome-devtools"];
const mkAjv = () => {
  const a = new Ajv({ strict: false, allErrors: false, validateFormats: true });
  addFormats(a);
  return a;
};
const mk2020 = () => {
  const a = new Ajv2020({ strict: false, allErrors: false, validateFormats: true });
  addFormats(a);
  return a;
};
function compile(schema) {
  try {
    return mkAjv().compile(schema);
  } catch (e) {
    try {
      return mk2020().compile(schema);
    } catch (e2) {
      return null;
    }
  }
}
function mutate(sample, schema) {
  const out = [];
  if (sample && typeof sample === "object" && !Array.isArray(sample)) {
    for (const k of Object.keys(sample)) {
      const c = { ...sample };
      delete c[k];
      out.push(c);
    } // 필드 제거
    for (const k of Object.keys(sample)) {
      const c = { ...sample };
      c[k] = typeof c[k] === "string" ? 12345 : "wrong-type";
      out.push(c);
    } // 타입 바꿈
    out.push({ ...sample, __extra_prop__: 1 }); // 여분 필드
  }
  out.push(null, 42, "str", []);
  return out;
}
const summary = [];
for (const n of SERVERS) {
  const orig = JSON.parse(readFileSync(`lists/${n}.json`, "utf8")).tools;
  for (const stage of ["stage1", "stage2", "stage3"]) {
    const comp = JSON.parse(readFileSync(`out/${n}.${stage}.json`, "utf8")).tools;
    let samples = 0,
      disagreements = 0,
      uncompilable = 0;
    const bad = [];
    for (let i = 0; i < orig.length; i++) {
      const vo = compile(orig[i].inputSchema),
        vc = compile(comp[i].inputSchema);
      if (!vo || !vc) {
        uncompilable++;
        continue;
      }
      const pool = [];
      for (let k = 0; k < 6; k++) {
        try {
          pool.push(
            generateSync(orig[i].inputSchema, {
              alwaysFakeOptionals: true,
              failOnInvalidTypes: false,
              failOnInvalidFormat: false,
              useDefaultValue: false,
            }),
          );
        } catch {}
      }
      const all = [...pool, ...pool.flatMap((s) => mutate(s, orig[i].inputSchema))];
      for (const s of all) {
        samples++;
        const a = vo(s),
          b = vc(s);
        if (a !== b) {
          disagreements++;
          if (bad.length < 3)
            bad.push({
              tool: orig[i].name,
              orig: a,
              comp: b,
              sample: JSON.stringify(s).slice(0, 80),
            });
        }
      }
    }
    summary.push({ server: n, stage, samples, disagreements, uncompilable });
    if (bad.length) console.log(n, stage, "예시 불일치:", bad);
  }
}
console.table(summary);

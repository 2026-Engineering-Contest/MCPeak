import { readFileSync, writeFileSync } from "node:fs";

const strip = (s, keys) =>
  Array.isArray(s)
    ? s.map((x) => strip(x, keys))
    : s && typeof s === "object"
      ? Object.fromEntries(
          Object.entries(s)
            .filter(([k]) => !keys.has(k))
            .map(([k, v]) => [k, strip(v, keys)]),
        )
      : s;
for (const n of ["notion", "mongodb", "firecrawl", "desktop-commander", "chrome-devtools"]) {
  const d = JSON.parse(readFileSync(`out/${n}.stage2.json`, "utf8"));
  d.tools = d.tools.map((t) => ({
    ...t,
    inputSchema: strip(t.inputSchema, new Set(["additionalProperties", "description", "default"])),
  }));
  writeFileSync(`out/${n}.stage3.json`, JSON.stringify(d, null, 2));
}
for (const n of ["notion", "mongodb", "firecrawl", "desktop-commander", "chrome-devtools"]) {
  const d = JSON.parse(readFileSync(`lists/${n}.json`, "utf8"));
  console.log(`\n== ${n}: ` + d.tools.map((t) => t.name).join(", "));
}

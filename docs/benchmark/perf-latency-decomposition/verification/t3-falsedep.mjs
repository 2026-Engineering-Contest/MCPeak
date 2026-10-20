// analyze.mjs 의 seqDep 판정 반례: 서로 독립인 두 요청이 같은 입력값(id)을 URL 에 넣고,
// 첫 응답이 그 id 를 그대로 되돌려주면(echo) '의존' 으로 판정된다.
import { writeFileSync } from "node:fs";
const t = 1e12;
const call = { tool: "get_item", input: { id: "38760315" }, iter: 0, t0: t, t1: t + 400, ms: 400, resultBytes: 10 };
const ext = [
  { via: "fetch", method: "GET", url: "https://api.example/summary?id=38760315", reqBody: null, resBody: JSON.stringify({ id: "38760315", title: "x" }), t0: t + 5, t1: t + 200 },
  { via: "fetch", method: "GET", url: "https://api.example/citations?id=38760315", reqBody: null, resBody: JSON.stringify({ n: 3 }), t0: t + 201, t1: t + 395 },
];
writeFileSync("out/synthetic-echo.json", JSON.stringify({ name: "synthetic-echo", coldStartMs: 0, calls: [call], external: ext }));

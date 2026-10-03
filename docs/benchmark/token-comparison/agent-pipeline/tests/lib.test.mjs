import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildClassifyPrompt,
  buildFixtures,
  classifyDeterministic,
  parseClassifyResponse,
  summarize,
  writeReport,
} from "../lib.mjs";

const report = JSON.parse(
  readFileSync(new URL("./fixtures/s3-first-run.json", import.meta.url), "utf8"),
);
const byId = (id) => report.cases.find((c) => c.spec.id === id);

test("Output validation 오류는 LLM 없이 defect", () => {
  const r = classifyDeterministic(byId("convert-units-success"));
  assert.equal(r.kind, "defect");
  assert.match(r.reason, /outputSchema/);
});

test("정상 케이스가 서버 거절 메시지로 실패하면 ask", () => {
  const r = classifyDeterministic(byId("evaluate-expression-success"));
  assert.equal(r.kind, "ask");
  assert.match(r.notes, /example/);
});

test("통과 케이스는 pass", () => {
  assert.equal(classifyDeterministic(byId("add-note-success")).kind, "pass");
});

test("거절 케이스 실패는 LLM 없이 defect", () => {
  const c = structuredClone(byId("summarize-text-missing-text"));
  c.status = "failed";
  c.assertions[0].status = "failed";
  assert.equal(classifyDeterministic(c).kind, "defect");
});

test("LLM 응답 파싱: placeholder / defect / 깨진 형식", () => {
  assert.deepEqual(
    parseClassifyResponse('{"kind":"placeholder","field":"expression","value":"(2 + 3) * 4 / 5"}'),
    { kind: "placeholder", field: "expression", value: "(2 + 3) * 4 / 5" },
  );
  assert.equal(parseClassifyResponse('앞말 {"kind":"defect","reason":"x"} 뒷말').kind, "defect");
  assert.equal(parseClassifyResponse("모르겠다").kind, "defect");
  assert.equal(parseClassifyResponse('{"kind":"placeholder"}').kind, "defect");
});

test("픽스처 파일 형식", () => {
  assert.deepEqual(
    buildFixtures([{ tool: "evaluate_expression", field: "expression", value: "1+1" }]),
    { schemaVersion: 1, tools: { evaluate_expression: { expression: "1+1" } } },
  );
});

test("프롬프트에는 툴·입력·오류만 들어간다", () => {
  const p = buildClassifyPrompt({ tool: "t", input: { a: 1 }, notes: "오류" });
  assert.match(p, /도구: t/);
  assert.match(p, /"a":1/);
  assert.doesNotMatch(p, /inputSchema/);
});

test("보고서: convert_units 5건이 결함 표에, 픽스처로 해결된 것은 없음", () => {
  const classified = new Map(report.cases.map((c) => [c.spec.id, classifyDeterministic(c)]));
  // evaluate_expression 은 픽스처로 풀렸다고 가정: 통과로 바꾼다
  const fixed = structuredClone(report);
  const e = fixed.cases.find((c) => c.spec.id === "evaluate-expression-success");
  e.status = "passed";
  for (const a of e.assertions) {
    a.status = "passed";
    delete a.diagnostic;
  }
  fixed.summary.passed++;
  fixed.summary.failed--;
  const cls2 = new Map(fixed.cases.map((c) => [c.spec.id, classifyDeterministic(c)]));
  const md = writeReport({
    report: fixed,
    classified: cls2,
    warnings: ["enum 값 7개 중 3개만 실행"],
    fixtures: buildFixtures([{ tool: "evaluate_expression", field: "expression", value: "1+1" }]),
    suitePath: "server.suite.json",
  });
  const defectRows = md
    .split("## 결함")[1]
    .split("## 검증하지")[0]
    .match(/^\| \d+ \|/gm);
  assert.equal(defectRows.length, 5);
  assert.doesNotMatch(md.split("## 결함")[1], /evaluate_expression/);
  assert.match(md, /^\| 도구 \| 케이스 \| 입력 \| 기대 \| 실제 \| 판정 \|$/m);
  assert.match(md, /enum 값 7개/);
  assert.equal(classified.get("evaluate-expression-success").kind, "ask");
});

test("요약에 결함 수와 LLM 회계가 들어간다", () => {
  const classified = new Map(report.cases.map((c) => [c.spec.id, classifyDeterministic(c)]));
  const s = summarize({
    report,
    classified,
    fixtures: null,
    llm: { calls: 1, input_tokens: 800, output_tokens: 40, cost: 0.003 },
  });
  assert.match(s, /결함 5건/);
  assert.match(s, /LLM 호출 1회/);
});

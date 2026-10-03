import assert from "node:assert/strict";
import { test } from "node:test";
import { judgeRepair } from "../src/lib/judge.ts";

const S = ["a", "b", "target"];

test("목표 통과, 회귀 없음이면 success", () => {
  const r = judgeRepair({ baselinePassing: S, target: "target", table: { a: "pass", b: "pass", target: "pass" } });
  assert.deepEqual(r, { verdict: "success", regressed: [], passCount: 3 });
});

test("목표가 여전히 실패면 targetStillFailing", () => {
  const r = judgeRepair({ baselinePassing: S, target: "target", table: { a: "pass", b: "pass", target: "fail" } });
  assert.deepEqual(r, { verdict: "targetStillFailing", regressed: [], passCount: 2 });
});

test("목표를 고쳤어도 다른 시나리오를 깨면 regressed", () => {
  const r = judgeRepair({ baselinePassing: S, target: "target", table: { a: "fail", b: "pass", target: "pass" } });
  assert.deepEqual(r, { verdict: "regressed", regressed: ["a"], passCount: 2 });
});

test("목표도 못 고치고 회귀도 있으면 regressed 가 우선", () => {
  const r = judgeRepair({ baselinePassing: S, target: "target", table: { a: "fail", b: "pass", target: "fail" } });
  assert.deepEqual(r, { verdict: "regressed", regressed: ["a"], passCount: 1 });
});

test("표에 없는 시나리오는 실패로 센다", () => {
  const r = judgeRepair({ baselinePassing: S, target: "target", table: { target: "pass" } });
  assert.deepEqual(r, { verdict: "regressed", regressed: ["a", "b"], passCount: 1 });
});

test("서버가 안 뜨면 serverDown, 통과 0", () => {
  const r = judgeRepair({ baselinePassing: S, target: "target", table: null });
  assert.deepEqual(r, { verdict: "serverDown", regressed: [], passCount: 0 });
});

test("S 밖 시나리오의 결과는 무시한다", () => {
  const r = judgeRepair({ baselinePassing: S, target: "target", table: { a: "pass", b: "pass", target: "pass", extra: "fail" } });
  assert.equal(r.verdict, "success");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregate, type RunRecord } from "../src/lib/aggregate.ts";

const rec = (faultId: RunRecord["faultId"], condition: RunRecord["condition"], attempt: number, ok: boolean, passCount: number): RunRecord => ({
  faultId, condition, attempt, verdict: ok ? "success" : "targetStillFailing", passCount, regressed: [],
  inputTokens: null, outputTokens: null, durationMs: null,
});

test("변형 × 조건별 성공 수와 평균 통과 수", () => {
  const out = aggregate([
    rec("F1", "plain", 1, true, 10), rec("F1", "plain", 2, false, 9),
    rec("F1", "diagnosed", 1, true, 10), rec("F1", "diagnosed", 2, true, 10),
  ]);
  assert.deepEqual(out.rows, [
    { faultId: "F1", condition: "plain", runs: 2, successes: 1, meanPassCount: 9.5 },
    { faultId: "F1", condition: "diagnosed", runs: 2, successes: 2, meanPassCount: 10 },
  ]);
});

test("도구와 대조를 나눠 합산한다", () => {
  const out = aggregate([
    rec("F1", "plain", 1, false, 9), rec("F2", "diagnosed", 1, true, 10),
    rec("C1", "plain", 1, true, 10), rec("C1", "diagnosed", 1, false, 9),
  ]);
  assert.deepEqual(out.tool.plain, { successes: 0, runs: 1 });
  assert.deepEqual(out.tool.diagnosed, { successes: 1, runs: 1 });
  assert.deepEqual(out.control.plain, { successes: 1, runs: 1 });
  assert.deepEqual(out.control.diagnosed, { successes: 0, runs: 1 });
});

test("행 순서는 입력 순서와 무관하게 FAULTS 순, defect → plain → diagnosed 순", () => {
  const out = aggregate([
    rec("C2", "diagnosed", 1, true, 1), rec("F1", "plain", 1, true, 1), rec("F1", "defect", 1, false, 1),
  ]);
  assert.deepEqual(out.rows.map((r) => `${r.faultId}/${r.condition}`), ["F1/defect", "F1/plain", "C2/diagnosed"]);
});

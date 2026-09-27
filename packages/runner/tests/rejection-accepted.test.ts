import { describe, expect, it } from "vitest";
import type { RunnerDiagnostic, TestCaseResult, TestCaseSpec } from "../src/index.js";
import { rejectionAccepted } from "../src/index.js";

const rejectingCase: TestCaseSpec = {
  id: "missing-b",
  name: "missing-b",
  operation: { type: "callTool", tool: "add", input: { a: 1 } },
  assertions: [{ type: "isError", expected: true }],
};

const mismatch = (expected: boolean, actual: boolean): RunnerDiagnostic => ({
  code: "IS_ERROR_MISMATCH",
  message: "",
  expected,
  actual,
  hint: "",
});

/** isError 단언 하나가 주어진 상태로 끝난 케이스. */
const resultOf = (
  status: TestCaseResult["status"],
  assertion: TestCaseResult["assertions"][number],
  operation: TestCaseResult["operation"] = { status: "completed" },
): TestCaseResult => ({
  spec: rejectingCase,
  status,
  operation,
  assertions: [assertion],
  rejectionBasis: "notApplicable",
});

describe("rejectionAccepted (설계 §3.2)", () => {
  const isErrorSpec = { type: "isError", expected: true } as const;

  it("거절 기대에 정상 응답이면 참", () => {
    expect(
      rejectionAccepted(
        resultOf("failed", {
          spec: isErrorSpec,
          status: "failed",
          diagnostic: mismatch(true, false),
        }),
      ),
    ).toBe(true);
  });

  it("정상 기대에 오류 응답이면 거짓", () => {
    expect(
      rejectionAccepted(
        resultOf("failed", {
          spec: { type: "isError", expected: false },
          status: "failed",
          diagnostic: mismatch(false, true),
        }),
      ),
    ).toBe(false);
  });

  it("호출이 던졌거나 시간 초과면 거짓", () => {
    expect(
      rejectionAccepted(
        resultOf(
          "timedOut",
          { spec: isErrorSpec, status: "skipped" },
          { status: "timedOut", timeoutMs: 10_000 },
        ),
      ),
    ).toBe(false);
    expect(
      rejectionAccepted(
        resultOf("failed", { spec: isErrorSpec, status: "skipped" }, { status: "failed" }),
      ),
    ).toBe(false);
  });

  it("통과한 케이스는 거짓", () => {
    expect(rejectionAccepted(resultOf("passed", { spec: isErrorSpec, status: "passed" }))).toBe(
      false,
    );
  });

  it("다른 단언의 진단은 보지 않는다", () => {
    expect(
      rejectionAccepted(
        resultOf("failed", {
          spec: { type: "bodyMatchesSchema", schema: {} } as never,
          status: "failed",
          diagnostic: mismatch(true, false),
        }),
      ),
    ).toBe(false);
  });
});

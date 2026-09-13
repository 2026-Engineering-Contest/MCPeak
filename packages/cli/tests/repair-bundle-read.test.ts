import { describe, expect, it } from "vitest";
import {
  describeRepairBundleInvalid,
  REPAIR_BUNDLE_VERSION,
  type RepairBundleInvalidReason,
  readRepairBundle,
} from "../src/repair-bundle.js";

const FAILURE = {
  caseId: "get-weather-unknown-city",
  caseName: "없는 도시는 거절한다",
  status: "failed",
  tool: "get_weather",
  input: { city: "toString" },
  assertions: [{ type: "isError", status: "failed" }],
  diagnostics: [
    {
      code: "IS_ERROR_MISMATCH",
      message: "isError: true 를 기대했지만 false 를 받았습니다.",
      expected: true,
      actual: false,
    },
  ],
};

const bundle = (overrides: Record<string, unknown> = {}) => ({
  bundleVersion: REPAIR_BUNDLE_VERSION,
  generatedBy: "mcpeak 0.7.0",
  spec: {
    suiteId: "weather",
    suiteName: "날씨 서버 계약",
    approval: "matched",
    runHistory: "present",
    fingerprint: "a".repeat(64),
  },
  failures: [FAILURE],
  tools: [{ name: "get_weather", inputSchema: { type: "object" } }],
  target: { transport: "stdio" },
  ...overrides,
});
const text = (value: unknown) => JSON.stringify(value);

const REASONS: readonly RepairBundleInvalidReason[] = [
  "notJson",
  "notObject",
  "versionMismatch",
  "missingField",
  "emptyFailures",
];

describe("readRepairBundle", () => {
  it("정상 번들이 ok 로 읽힌다", () => {
    const result = readRepairBundle(text(bundle()));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("정상 번들이 아니다");
    expect(result.bundle.failures[0]?.caseId).toBe("get-weather-unknown-city");
    expect(result.bundle.spec.suiteId).toBe("weather");
  });

  it("깨진 JSON 이 notJson 이다", () => {
    for (const broken of ["{", "", '{ "bundleVersion": 1, }'])
      expect(readRepairBundle(broken)).toEqual({ status: "invalid", reason: "notJson" });
  });

  it("배열이나 문자열 최상위가 notObject 다", () => {
    for (const value of [[], [bundle()], "문자열", 1, null])
      expect(readRepairBundle(text(value))).toEqual({ status: "invalid", reason: "notObject" });
  });

  it("bundleVersion 이 1 이면 versionMismatch 다", () => {
    expect(readRepairBundle(text(bundle({ bundleVersion: 1 })))).toEqual({
      status: "invalid",
      reason: "versionMismatch",
    });
  });

  it("버전 2 번들은 versionMismatch 로 거절한다", () => {
    // 낡은 번들이 근거 절반만 실은 채 조용히 통과하면 사용자는 진단이 왜 약한지 모른다.
    // 숫자를 그대로 둔다. 상수로 바꾸면 무엇을 거절하는지가 코드에서 사라진다.
    expect(readRepairBundle(text(bundle({ bundleVersion: 2 })))).toEqual({
      status: "invalid",
      reason: "versionMismatch",
    });
  });

  it("새 필드가 없는 번들은 missingField 다", () => {
    // #393 이 더한 tools · assertions · target 셋이다. 선택 필드로 얹지 않았다.
    const withoutTools = bundle();
    const { tools: _tools, ...noTools } = withoutTools;
    expect(readRepairBundle(text(noTools))).toEqual({
      status: "invalid",
      reason: "missingField",
    });

    const withoutTarget = bundle();
    const { target: _target, ...noTarget } = withoutTarget;
    expect(readRepairBundle(text(noTarget))).toEqual({
      status: "invalid",
      reason: "missingField",
    });

    const { assertions: _assertions, ...failureWithoutAssertions } = FAILURE;
    expect(readRepairBundle(text(bundle({ failures: [failureWithoutAssertions] })))).toEqual({
      status: "invalid",
      reason: "missingField",
    });
  });

  it("단언 상태가 목록 밖이면 missingField 다", () => {
    // 케이스 상태의 값(timedOut)은 단언 상태가 아니다. 두 유니온을 섞으면 여기서 걸린다.
    expect(
      readRepairBundle(
        text(
          bundle({
            failures: [{ ...FAILURE, assertions: [{ type: "isError", status: "timedOut" }] }],
          }),
        ),
      ),
    ).toEqual({ status: "invalid", reason: "missingField" });
  });

  it("도구의 name 이나 inputSchema 가 형식과 다르면 missingField 다", () => {
    for (const tool of [
      { name: "", inputSchema: {} },
      { name: "t" },
      { name: "t", inputSchema: 1 },
    ])
      expect(readRepairBundle(text(bundle({ tools: [tool] })))).toEqual({
        status: "invalid",
        reason: "missingField",
      });
  });

  it("tools 가 빈 배열이어도 읽힌다", () => {
    // listTools 케이스만 실패한 실행이 그렇다. 부른 도구가 없는 것이 정상이다.
    expect(readRepairBundle(text(bundle({ tools: [] }))).status).toBe("ok");
  });

  it("process 가 있는데 scope 가 없으면 missingField 다", () => {
    expect(
      readRepairBundle(
        text(
          bundle({
            process: { stderr: "boom", stderrTruncated: false, exitCode: 1, signal: null },
          }),
        ),
      ),
    ).toEqual({ status: "invalid", reason: "missingField" });
    expect(
      readRepairBundle(
        text(
          bundle({
            process: {
              scope: "suite",
              stderr: "boom",
              stderrTruncated: false,
              exitCode: 1,
              signal: null,
            },
          }),
        ),
      ).status,
    ).toBe("ok");
  });

  it("spec.runHistory 가 없으면 missingField 다", () => {
    const target = bundle();
    const { runHistory: _dropped, ...spec } = target.spec;
    expect(readRepairBundle(text({ ...target, spec }))).toEqual({
      status: "invalid",
      reason: "missingField",
    });
  });

  it("spec.runHistory 가 목록 밖 값이면 missingField 다", () => {
    const target = bundle();
    expect(
      readRepairBundle(text({ ...target, spec: { ...target.spec, runHistory: "unknown" } })),
    ).toEqual({ status: "invalid", reason: "missingField" });
  });

  it("bundleVersion 이 없으면 versionMismatch 다", () => {
    const { bundleVersion: _dropped, ...rest } = bundle();
    expect(readRepairBundle(text(rest))).toEqual({
      status: "invalid",
      reason: "versionMismatch",
    });
  });

  it("failures 누락·비배열·항목 필드 누락이 missingField 다", () => {
    const { failures: _dropped, ...withoutFailures } = bundle();
    const { spec: _spec, ...withoutSpec } = bundle();
    const { caseId: _caseId, ...failureWithoutCaseId } = FAILURE;
    const { diagnostics: _diagnostics, ...failureWithoutDiagnostics } = FAILURE;
    for (const value of [
      withoutFailures,
      withoutSpec,
      bundle({ failures: "실패 목록" }),
      bundle({ failures: [failureWithoutCaseId] }),
      bundle({ failures: [failureWithoutDiagnostics] }),
      bundle({ failures: [{ ...FAILURE, diagnostics: "진단" }] }),
      bundle({ failures: ["문자열 항목"] }),
    ])
      expect(readRepairBundle(text(value))).toEqual({ status: "invalid", reason: "missingField" });
  });

  it("소비하는 spec 필드가 빠지면 missingField 다", () => {
    for (const key of ["suiteId", "suiteName", "approval", "fingerprint"]) {
      const spec: Record<string, unknown> = {
        suiteId: "weather",
        suiteName: "날씨 서버 계약",
        approval: "matched",
        fingerprint: "a".repeat(64),
      };
      delete spec[key];
      expect(readRepairBundle(text(bundle({ spec })))).toEqual({
        status: "invalid",
        reason: "missingField",
      });
    }
  });

  it("spec.approval 이 아는 값이 아니면 missingField 다", () => {
    const spec = {
      suiteId: "weather",
      suiteName: "날씨 서버 계약",
      approval: "unknown-state",
      fingerprint: "a".repeat(64),
    };
    expect(readRepairBundle(text(bundle({ spec })))).toEqual({
      status: "invalid",
      reason: "missingField",
    });
  });

  it("소비하는 failure 필드가 빠지면 missingField 다", () => {
    for (const key of ["caseId", "caseName", "status", "diagnostics"]) {
      const failure: Record<string, unknown> = { ...FAILURE };
      delete failure[key];
      expect(readRepairBundle(text(bundle({ failures: [failure] })))).toEqual({
        status: "invalid",
        reason: "missingField",
      });
    }
  });

  it("failure.status 나 approvedAs 가 아는 값이 아니면 missingField 다", () => {
    for (const failure of [
      { ...FAILURE, status: "exploded" },
      { ...FAILURE, approvedAs: "maybe" },
    ]) {
      expect(readRepairBundle(text(bundle({ failures: [failure] })))).toEqual({
        status: "invalid",
        reason: "missingField",
      });
    }
  });

  it("진단의 code 나 message 가 빠지면 missingField 다", () => {
    for (const diagnostic of [{ message: "메시지만 있다" }, { code: "CODE_ONLY" }]) {
      const failure = { ...FAILURE, diagnostics: [diagnostic] };
      expect(readRepairBundle(text(bundle({ failures: [failure] })))).toEqual({
        status: "invalid",
        reason: "missingField",
      });
    }
  });

  it("failures 가 빈 배열이면 emptyFailures 다", () => {
    expect(readRepairBundle(text(bundle({ failures: [] })))).toEqual({
      status: "invalid",
      reason: "emptyFailures",
    });
  });

  it("사유마다 안내 문장이 서로 다르다", () => {
    const messages = REASONS.map((reason) => describeRepairBundleInvalid(reason));
    expect(new Set(messages).size).toBe(REASONS.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(10);
    expect(describeRepairBundleInvalid("versionMismatch")).toContain(
      "최신 `mcpeak test --repair-bundle` 로 다시 만드세요",
    );
    expect(describeRepairBundleInvalid("emptyFailures")).toContain("provider 를 부르지 않습니다");
  });
});

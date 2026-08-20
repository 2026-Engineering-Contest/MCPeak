import type { McpStdioConnection } from "@mcpeak/core";
import type { RunnerExecution, RunnerReport, TestCaseResult, TestSuiteSpec } from "@mcpeak/runner";
import { suiteFingerprint } from "@mcpeak/runner";
import { describe, expect, it, vi } from "vitest";
import {
  buildRepairBundle,
  REPAIR_BUNDLE_VERSION,
  serializeRepairBundle,
} from "../src/repair-bundle.js";
import { runCli, type TestCommandDependencies } from "../src/test-command.js";

const CALL_TOOL_CASE = {
  id: "get-weather-unknown-city",
  name: "없는 도시는 거절한다",
  operation: { type: "callTool" as const, tool: "get_weather", input: { city: "toString" } },
  assertions: [{ type: "isError" as const, expected: true }],
};
const LIST_TOOLS_CASE = {
  id: "tools-exist",
  name: "툴이 선언돼 있다",
  operation: { type: "listTools" as const },
  assertions: [{ type: "toolExists" as const, tool: "get_weather" }],
};

const suite = (approval?: TestSuiteSpec["approval"]): TestSuiteSpec => ({
  schemaVersion: 1,
  id: "weather",
  name: "날씨 서버 계약",
  cases: [CALL_TOOL_CASE, LIST_TOOLS_CASE],
  ...(approval === undefined ? {} : { approval }),
});

function caseResult(overrides: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    spec: CALL_TOOL_CASE,
    status: "failed",
    operation: { status: "completed" },
    assertions: [
      {
        spec: { type: "isError", expected: true },
        status: "failed",
        diagnostic: {
          code: "IS_ERROR_MISMATCH",
          message: "isError: true 를 기대했지만 false 를 받았습니다.",
          expected: true,
          actual: false,
          hint: "서버의 오류 처리 분기를 확인하세요.",
        },
      },
    ],
    ...overrides,
  } as TestCaseResult;
}

function report(cases: readonly TestCaseResult[]): RunnerReport {
  return {
    schemaVersion: 1,
    suite: { id: "weather", name: "날씨 서버 계약" },
    status: cases.some((item) => item.status !== "passed") ? "failed" : "passed",
    cases: [...cases],
    summary: {
      total: cases.length,
      passed: cases.filter((item) => item.status === "passed").length,
      failed: cases.filter((item) => item.status === "failed").length,
      timedOut: cases.filter((item) => item.status === "timedOut").length,
      cancelled: cases.filter((item) => item.status === "cancelled").length,
      notRun: cases.filter((item) => item.status === "notRun").length,
      rejectionUnverified: cases.filter((item) => item.rejectionBasis === "unverified").length,
    },
  };
}

const approvalOf = (target: TestSuiteSpec) => ({
  state: "absent" as const,
  fingerprint: suiteFingerprint(target),
});

const build = (cases: readonly TestCaseResult[], target = suite()) =>
  buildRepairBundle({ report: report(cases), suite: target, specApproval: approvalOf(target) });

describe("buildRepairBundle", () => {
  it("실패가 있으면 번들이 만들어지고 실패 케이스만 담긴다", () => {
    const passed = caseResult({ spec: LIST_TOOLS_CASE, status: "passed", assertions: [] });
    const bundle = build([caseResult(), passed]);
    expect(bundle?.bundleVersion).toBe(REPAIR_BUNDLE_VERSION);
    expect(bundle?.failures.map((item) => item.caseId)).toEqual(["get-weather-unknown-city"]);
    expect(bundle?.spec).toMatchObject({ suiteId: "weather", suiteName: "날씨 서버 계약" });
  });

  it("통과만 있으면 buildRepairBundle 이 undefined 를 돌려준다", () => {
    const passed = caseResult({ status: "passed", assertions: [] });
    expect(build([passed])).toBeUndefined();
  });

  it("timedOut·cancelled·notRun 도 담긴다", () => {
    const bundle = build([
      caseResult({ status: "timedOut", assertions: [] }),
      caseResult({ spec: LIST_TOOLS_CASE, status: "cancelled", assertions: [] }),
      caseResult({ status: "notRun", assertions: [] }),
    ]);
    expect(bundle?.failures.map((item) => item.status)).toEqual([
      "timedOut",
      "cancelled",
      "notRun",
    ]);
  });

  it("케이스 하나의 진단이 여럿이면 전부 배열로 담긴다", () => {
    const bundle = build([
      caseResult({
        operation: {
          status: "failed",
          diagnostic: { code: "OPERATION_FAILED", message: "호출이 실패했습니다.", hint: "h" },
        },
        assertions: [
          {
            spec: { type: "isError", expected: true },
            status: "failed",
            diagnostic: { code: "IS_ERROR_MISMATCH", message: "첫 번째 단언", hint: "h" },
          },
          {
            spec: { type: "isError", expected: true },
            status: "failed",
            diagnostic: { code: "BODY_SCHEMA_MISMATCH", message: "두 번째 단언", hint: "h" },
          },
        ],
      }),
    ]);
    expect(bundle?.failures[0]?.diagnostics.map((item) => item.code)).toEqual([
      "OPERATION_FAILED",
      "IS_ERROR_MISMATCH",
      "BODY_SCHEMA_MISMATCH",
    ]);
  });

  it("ADR-0027 의 notes 가 담긴다", () => {
    const bundle = build([
      caseResult({
        assertions: [
          {
            spec: { type: "isError", expected: true },
            status: "failed",
            diagnostic: {
              code: "IS_ERROR_MISMATCH",
              message: "isError 가 다릅니다.",
              hint: "h",
              notes: ["서버 응답: {}"],
            },
          },
        ],
      }),
    ]);
    expect(bundle?.failures[0]?.diagnostics[0]?.notes).toEqual(["서버 응답: {}"]);
  });

  it("approvedAs 가 approval.cases 에서 실려 온다", () => {
    const target = suite({
      fingerprint: "a".repeat(64),
      cases: [{ id: "get-weather-unknown-city", status: "serverDefect" }],
    });
    const bundle = build([caseResult()], target);
    expect(bundle?.failures[0]?.approvedAs).toBe("serverDefect");
  });

  it("approval.cases 가 없으면 approvedAs 키가 없다", () => {
    const bundle = build([caseResult()]);
    const failure = bundle?.failures[0];
    expect(failure).toBeDefined();
    expect("approvedAs" in (failure as object)).toBe(false);
  });

  it("진단 내용이 없으면 process 키가 없다", () => {
    const target = suite();
    const empty = buildRepairBundle({
      report: report([caseResult()]),
      suite: target,
      specApproval: approvalOf(target),
      // stderr 가 비어 있고 정상 종료다. 화면에도 안 뜨는 내용이다.
      processDiagnostics: { stderr: "", stderrTruncated: false, exitCode: 0, signal: null },
    });
    expect("process" in (empty as object)).toBe(false);
    const filled = buildRepairBundle({
      report: report([caseResult()]),
      suite: target,
      specApproval: approvalOf(target),
      processDiagnostics: {
        stderr: "TypeError: boom",
        stderrTruncated: false,
        exitCode: 1,
        signal: null,
      },
    });
    expect(filled?.process?.stderr).toBe("TypeError: boom");
  });

  it("callTool 이 아닌 케이스는 tool·input 키가 없다", () => {
    const bundle = build([caseResult({ spec: LIST_TOOLS_CASE, assertions: [] })]);
    const failure = bundle?.failures[0] as object;
    expect("tool" in failure).toBe(false);
    expect("input" in failure).toBe(false);
  });
});

/** 쓰기 경로용 최소 의존성. 실제 서버도 파일 시스템도 건드리지 않는다. */
function deps(overrides: Partial<TestCommandDependencies> = {}) {
  const writes = { out: [] as string[], err: [] as string[] };
  const connection: McpStdioConnection = {
    client: {
      listTools: async () => [],
      callTool: async () => ({ content: [], isError: false, raw: null }),
      close: async () => {},
    },
    getDiagnostics: () => ({
      state: "open",
      pid: null,
      exitCode: 0,
      signal: null,
      stderr: "",
      stderrTruncated: false,
    }),
    close: vi.fn(async () => {}),
    forceClose: vi.fn(async () => {}),
  };
  const execution: RunnerExecution = {
    report: Promise.resolve(report([])),
    drain: Promise.resolve({ status: "settled" }),
  };
  const value: TestCommandDependencies = {
    readFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify(suite()))),
    validateSuite: vi.fn(() => ({ valid: true as const, value: suite() })),
    connect: vi.fn(async () => connection),
    startRunner: vi.fn(() => execution),
    finalize: vi.fn(async () => report([])),
    renderReport: vi.fn(() => "렌더링 결과\n"),
    renderJUnit: vi.fn(() => "<testsuites/>\n"),
    writeFile: vi.fn(async () => {}),
    colorEnabled: false,
    writeStdout: (text) => writes.out.push(text),
    writeStderr: (text) => writes.err.push(text),
    ...overrides,
  };
  return { value, writes };
}

describe("--repair-bundle 쓰기", () => {
  it("쓰기 실패 시 전부 통과여도 종료 코드가 0이 아니고 REPAIR_BUNDLE_WRITE_FAILED 가 뜬다", async () => {
    const failing = report([caseResult()]);
    const d = deps({
      finalize: vi.fn(async () => failing),
      writeFile: vi.fn(async () => {
        throw new Error("EACCES");
      }),
    });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--repair-bundle", "bundle.json"],
      d.value,
    );
    expect(code).toBe(1);
    expect(d.writes.err.join("")).toContain("REPAIR_BUNDLE_WRITE_FAILED");
  });

  it("실패가 있으면 번들 파일이 만들어지고 실패 케이스만 담긴다", async () => {
    const failing = report([caseResult()]);
    const d = deps({ finalize: vi.fn(async () => failing) });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--repair-bundle", "bundle.json"],
      d.value,
    );
    expect(code).toBe(1);
    const write = (d.value.writeFile as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === "bundle.json",
    );
    expect(write).toBeDefined();
    const parsed = JSON.parse(write?.[1] as string);
    expect(parsed.bundleVersion).toBe(REPAIR_BUNDLE_VERSION);
    expect(parsed.failures).toHaveLength(1);
    expect(serializeRepairBundle(parsed).endsWith("\n")).toBe(true);
  });

  it("--repair-bundle 없이 돌린 실행의 stdout·stderr·종료 코드가 옵션 도입 전과 같다", async () => {
    const failing = report([caseResult()]);
    const withOption = deps({ finalize: vi.fn(async () => failing) });
    const withoutOption = deps({ finalize: vi.fn(async () => failing) });
    const optionCode = await runCli(
      ["test", "suite.json", "--command", "node", "--repair-bundle", "bundle.json"],
      withOption.value,
    );
    const plainCode = await runCli(
      ["test", "suite.json", "--command", "node"],
      withoutOption.value,
    );
    expect(plainCode).toBe(optionCode);
    // 번들을 쓰는 경로가 화면을 건드리지 않는다. 두 실행의 출력이 바이트 단위로 같다.
    expect(withoutOption.writes.out.join("")).toBe(withOption.writes.out.join(""));
    expect(withoutOption.writes.err.join("")).toBe(withOption.writes.err.join(""));
    // 옵션이 없으면 파일도 안 쓴다.
    expect((withoutOption.value.writeFile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("실패가 없으면 파일을 안 만들고 한 줄만 알린다", async () => {
    const d = deps();
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--repair-bundle", "bundle.json"],
      d.value,
    );
    expect(code).toBe(0);
    expect((d.value.writeFile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(d.writes.out.join("")).toContain("실패한 케이스가 없어 파일을 만들지 않았습니다.");
  });
});

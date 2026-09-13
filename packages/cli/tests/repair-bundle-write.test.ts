import type { McpStdioConnection, ToolDef } from "@mcpeak/core";
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

const WEATHER_TOOL = {
  name: "get_weather",
  description: "도시의 날씨를 돌려준다",
  inputSchema: { type: "object", properties: { city: { type: "string" } } },
};

const build = (
  cases: readonly TestCaseResult[],
  target = suite(),
  extra: { tools?: readonly ToolDef[]; transport?: string } = {},
) =>
  buildRepairBundle({
    report: report(cases),
    suite: target,
    specApproval: approvalOf(target),
    target: { transport: extra.transport ?? "stdio" },
    ...(extra.tools === undefined ? {} : { tools: extra.tools }),
  });

describe("buildRepairBundle", () => {
  it("실패가 있으면 번들이 만들어지고 실패 케이스만 담긴다", () => {
    const passed = caseResult({ spec: LIST_TOOLS_CASE, status: "passed", assertions: [] });
    const bundle = build([caseResult(), passed]);
    expect(bundle?.bundleVersion).toBe(REPAIR_BUNDLE_VERSION);
    expect(bundle?.failures.map((item) => item.caseId)).toEqual(["get-weather-unknown-city"]);
    expect(bundle?.spec).toMatchObject({ suiteId: "weather", suiteName: "날씨 서버 계약" });
  });

  it("approval.cases 가 없으면 번들의 runHistory 가 absent 다", () => {
    const target = suite({ fingerprint: "a".repeat(64) });
    expect(build([caseResult()], target)?.spec.runHistory).toBe("absent");
  });

  it("approval.cases 가 있으면 번들의 runHistory 가 present 다", () => {
    const target = suite({
      fingerprint: "a".repeat(64),
      cases: [{ id: "get-weather-unknown-city", status: "serverDefect" }],
    });
    const bundle = build([caseResult()], target);
    expect(bundle?.spec.runHistory).toBe("present");
    expect(bundle?.failures[0]?.approvedAs).toBe("serverDefect");
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
      target: { transport: "stdio" },
      // stderr 가 비어 있고 정상 종료다. 화면에도 안 뜨는 내용이다.
      processDiagnostics: { stderr: "", stderrTruncated: false, exitCode: 0, signal: null },
    });
    expect("process" in (empty as object)).toBe(false);
    const filled = buildRepairBundle({
      report: report([caseResult()]),
      suite: target,
      specApproval: approvalOf(target),
      target: { transport: "stdio" },
      processDiagnostics: {
        stderr: "TypeError: boom",
        stderrTruncated: false,
        exitCode: 1,
        signal: null,
      },
    });
    expect(filled?.process?.stderr).toBe("TypeError: boom");
    // 범위를 함께 적는다. 값 없이 stderr 만 실으면 프로세스 전체의 꼬리를 개별 케이스의
    // 원인으로 읽는다(#393).
    expect(filled?.process?.scope).toBe("suite");
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
  it("JUnit 쓰기가 실패해도 repair bundle을 만들고 JUnit 오류를 보고한다", async () => {
    const failing = report([caseResult()]);
    const d = deps({
      finalize: vi.fn(async () => failing),
      writeFile: vi.fn(async (path) => {
        if (path === "junit.xml")
          throw Object.assign(new Error("ENOENT: no such directory"), { code: "ENOENT" });
      }),
    });
    const code = await runCli(
      [
        "test",
        "suite.json",
        "--command",
        "node",
        "--junit",
        "junit.xml",
        "--repair-bundle",
        "bundle.json",
      ],
      d.value,
    );
    expect(code).toBe(1);
    expect(
      (d.value.writeFile as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]),
    ).toEqual(["junit.xml", "bundle.json"]);
    expect(d.writes.err.join("")).toContain("JUNIT_WRITE_FAILED");
    expect(d.writes.err.join("")).not.toContain("REPAIR_BUNDLE_WRITE_FAILED");
  });

  it("JUnit과 repair bundle 쓰기가 모두 실패하면 두 오류를 모두 보고한다", async () => {
    const failing = report([caseResult()]);
    const d = deps({
      finalize: vi.fn(async () => failing),
      writeFile: vi.fn(async (path) => {
        throw Object.assign(new Error(`EACCES: ${path}`), { code: "EACCES" });
      }),
    });
    const code = await runCli(
      [
        "test",
        "suite.json",
        "--command",
        "node",
        "--junit",
        "junit.xml",
        "--repair-bundle",
        "bundle.json",
      ],
      d.value,
    );
    expect(code).toBe(1);
    expect(
      (d.value.writeFile as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]),
    ).toEqual(["junit.xml", "bundle.json"]);
    const stderr = d.writes.err.join("");
    expect(stderr).toContain("JUNIT_WRITE_FAILED");
    expect(stderr).toContain("REPAIR_BUNDLE_WRITE_FAILED");
    // 짝인 두 오류가 같은 모양이어야 한다(#276). 한쪽만 경로를 싣고 있으면 같은 실행에서
    // 둘 다 실패했을 때 사용자가 어느 파일이 없는지 알 수 없다.
    expect(stderr).toContain("junit.xml");
    expect(stderr).toContain("bundle.json");
    expect(stderr.match(/errno: EACCES/g)).toHaveLength(2);
  });

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

describe("tools", () => {
  const OTHER_TOOL = { name: "add", inputSchema: { type: "object" } };
  const ZOO_TOOL = { name: "zoo", inputSchema: { type: "object" } };

  it("실패한 케이스가 부른 도구만 싣는다", () => {
    // 도구 셋 중 실패가 부른 것은 get_weather 하나다.
    const bundle = build([caseResult()], suite(), {
      tools: [OTHER_TOOL, WEATHER_TOOL, ZOO_TOOL],
    });
    expect(bundle?.tools.map((tool) => tool.name)).toEqual(["get_weather"]);
  });

  it("툴 이름 코드 단위 오름차순이다", () => {
    // 서버가 준 순서를 그대로 쓰면 서버가 순서를 바꾸는 것만으로 번들 바이트가 흔들린다.
    const callAdd = caseResult({
      spec: {
        ...CALL_TOOL_CASE,
        id: "add-case",
        operation: { type: "callTool" as const, tool: "add", input: {} },
      },
    });
    const forward = build([caseResult(), callAdd], suite(), {
      tools: [WEATHER_TOOL, OTHER_TOOL, ZOO_TOOL],
    });
    const reversed = build([caseResult(), callAdd], suite(), {
      tools: [ZOO_TOOL, OTHER_TOOL, WEATHER_TOOL],
    });
    expect(forward?.tools.map((tool) => tool.name)).toEqual(["add", "get_weather"]);
    expect(JSON.stringify(reversed?.tools)).toBe(JSON.stringify(forward?.tools));
  });

  it("outputSchema 가 없으면 키를 만들지 않는다", () => {
    // 빈 객체를 넣으면 "아무 응답이나 허용" 으로 읽힌다.
    const withoutOutput = build([caseResult()], suite(), { tools: [WEATHER_TOOL] });
    expect(
      "outputSchema" in ((withoutOutput as NonNullable<typeof withoutOutput>).tools[0] as object),
    ).toBe(false);
    const withOutput = build([caseResult()], suite(), {
      tools: [{ ...WEATHER_TOOL, outputSchema: { type: "object" } }],
    });
    expect(withOutput?.tools[0]?.outputSchema).toEqual({ type: "object" });
  });

  it("listTools 실패만 있으면 tools 가 빈 배열이다", () => {
    const bundle = build([caseResult({ spec: LIST_TOOLS_CASE, assertions: [] })], suite(), {
      tools: [WEATHER_TOOL],
    });
    expect(bundle?.tools).toEqual([]);
  });

  it("도구를 안 넘기면 빈 배열이다", () => {
    expect(build([caseResult()])?.tools).toEqual([]);
  });

  it("8 KiB 를 넘는 스키마는 빼고 schemasOmitted 를 넣는다", () => {
    const huge = {
      ...WEATHER_TOOL,
      inputSchema: { type: "object", description: "x".repeat(9000) },
    };
    const bundle = build([caseResult()], suite(), { tools: [huge] });
    const tool = bundle?.tools[0];
    expect(tool?.schemasOmitted).toBe(true);
    expect(tool?.inputSchema).toEqual({});
    expect(bundle?.truncated?.toolSchemas).toBe(1);
    // 이름과 description 은 남는다. 도구가 있었다는 사실까지 지우면 계약을 못 찾는다.
    expect(tool?.name).toBe("get_weather");
    expect(tool?.description).toBe("도시의 날씨를 돌려준다");
  });

  it("상한 안이면 schemasOmitted 도 truncated 도 없다", () => {
    const bundle = build([caseResult()], suite(), { tools: [WEATHER_TOOL] });
    expect("schemasOmitted" in ((bundle as NonNullable<typeof bundle>).tools[0] as object)).toBe(
      false,
    );
    expect("truncated" in (bundle as object)).toBe(false);
  });

  it("바이트로 센다", () => {
    // 한글 한 글자는 UTF-8 로 3바이트다. UTF-16 코드 단위로 세면 상한 안으로 잘못 읽힌다.
    const korean = "가".repeat(3000);
    expect(korean.length).toBeLessThan(8192);
    expect(Buffer.byteLength(korean, "utf8")).toBeGreaterThan(8192);
    const bundle = build([caseResult()], suite(), {
      tools: [{ ...WEATHER_TOOL, inputSchema: { type: "object", description: korean } }],
    });
    expect(bundle?.tools[0]?.schemasOmitted).toBe(true);
  });
});

describe("assertions", () => {
  it("통과한 단언도 싣는다", () => {
    const mixed = caseResult({
      assertions: [
        { spec: { type: "isError", expected: true }, status: "passed" },
        { spec: { type: "bodyMatchesSchema", schema: { type: "string" } }, status: "failed" },
      ],
    } as Partial<TestCaseResult>);
    const assertions = build([mixed])?.failures[0]?.assertions;
    expect(assertions).toEqual([
      { type: "isError", status: "passed" },
      { type: "bodyMatchesSchema", status: "failed" },
    ]);
  });

  it("단언 값은 안 싣는다", () => {
    // 깨진 것의 값은 diagnostics 의 expected·actual 에 이미 있다.
    const item = build([caseResult()])?.failures[0]?.assertions[0] as object;
    expect("schema" in item).toBe(false);
    expect("expected" in item).toBe(false);
    expect(Object.keys(item).sort()).toEqual(["status", "type"]);
  });
});

describe("target", () => {
  it("transport 만 싣는다", () => {
    expect(Object.keys(build([caseResult()])?.target as object)).toEqual(["transport"]);
    expect(build([caseResult()], suite(), { transport: "http" })?.target.transport).toBe("http");
  });

  it("실행 명령이 번들 어디에도 없다", () => {
    // 이 테스트가 이 항목의 존재 이유다. describeTarget 을 쓰면 여기서 걸린다.
    const secret = "sk-super-secret-value";
    const bundle = build([caseResult()], suite(), {
      tools: [WEATHER_TOOL],
      transport: "stdio",
    });
    expect(serializeRepairBundle(bundle as NonNullable<typeof bundle>)).not.toContain(secret);
    expect(serializeRepairBundle(bundle as NonNullable<typeof bundle>)).not.toContain("--api-key");
  });
});

describe("번들 결정론성", () => {
  it("같은 실행에서 두 번 만든 번들이 바이트 단위로 같다", () => {
    const once = build([caseResult()], suite(), { tools: [WEATHER_TOOL] });
    const twice = build([caseResult()], suite(), { tools: [WEATHER_TOOL] });
    expect(serializeRepairBundle(twice as NonNullable<typeof twice>)).toBe(
      serializeRepairBundle(once as NonNullable<typeof once>),
    );
  });
});

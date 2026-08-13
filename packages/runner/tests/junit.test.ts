import { describe, expect, it } from "vitest";
import type { AssertionResult } from "../src/assertions.js";
import type { RunnerDiagnostic } from "../src/diagnostics.js";
import type { RunnerReport, RunnerSummary, TestCaseResult } from "../src/executor.js";
import { renderJUnit } from "../src/junit.js";
import type { TestCaseSpec } from "../src/spec/types.js";

const listToolsCase = (id: string, name: string): TestCaseSpec => ({
  id,
  name,
  operation: { type: "listTools" },
  assertions: [{ type: "toolExists", tool: "get_weather" }],
});

const callToolCase = (id: string, name: string): TestCaseSpec => ({
  id,
  name,
  operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
  assertions: [{ type: "isError", expected: false }],
});

const passedAssertions = (spec: TestCaseSpec): AssertionResult[] =>
  spec.assertions.map((assertion) => ({ spec: assertion, status: "passed" }) as AssertionResult);

const passed = (spec: TestCaseSpec): TestCaseResult => ({
  spec,
  status: "passed",
  operation: { status: "completed" },
  assertions: passedAssertions(spec),
});

/** 작업은 끝났고 단언이 틀린 케이스. JUnit 의 <failure> 에 해당한다. */
const assertionFailed = (spec: TestCaseSpec, diagnostic: RunnerDiagnostic): TestCaseResult => ({
  spec,
  status: "failed",
  operation: { status: "completed" },
  assertions: [{ spec: spec.assertions[0] as never, status: "failed", diagnostic }],
});

/** 작업 자체가 실패한 케이스. JUnit 의 <error> 에 해당한다. */
const operationFailed = (spec: TestCaseSpec, diagnostic: RunnerDiagnostic): TestCaseResult => ({
  spec,
  status: "failed",
  operation: { status: "failed", diagnostic },
  assertions: [{ spec: spec.assertions[0] as never, status: "notRun" }],
});

const timedOut = (spec: TestCaseSpec): TestCaseResult => ({
  spec,
  status: "timedOut",
  operation: {
    status: "timedOut",
    timeoutMs: 10_000,
    diagnostic: {
      code: "CASE_TIMEOUT",
      message: "케이스가 제한 시간 안에 끝나지 않았습니다.",
      hint: "timeoutMs 를 늘리거나 서버 응답 지연을 확인하세요.",
    },
  },
  assertions: [{ spec: spec.assertions[0] as never, status: "notRun" }],
});

const withStatus = (spec: TestCaseSpec, status: TestCaseResult["status"]): TestCaseResult => ({
  spec,
  status,
  operation: { status: status as never },
  assertions: [{ spec: spec.assertions[0] as never, status: "notRun" }],
});

function buildReport(cases: TestCaseResult[], overrides?: Partial<RunnerReport>): RunnerReport {
  const summary: RunnerSummary = {
    total: cases.length,
    passed: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    notRun: 0,
  };
  for (const result of cases) summary[result.status] += 1;
  return {
    schemaVersion: 1,
    suite: { id: "weather", name: "날씨 서버" },
    status: cases.every((result) => result.status === "passed") ? "passed" : "failed",
    cases,
    summary,
    ...overrides,
  };
}

const toolNotFound: RunnerDiagnostic = {
  code: "TOOL_NOT_FOUND",
  message: "툴 'get_weather'를 찾을 수 없습니다.",
  expected: "get_weather",
  actual: ["get_forecast"],
  hint: "서버의 tools/list 응답과 테스트 명세를 확인하세요.",
};

const operationBroke: RunnerDiagnostic = {
  code: "OPERATION_FAILED",
  message: "MCP 툴 목록 조회 중 오류가 발생했습니다.",
  hint: "MCP 서버 프로세스와 연결 상태를 확인하세요.",
};

describe("renderJUnit", () => {
  it("XML 선언과 testsuites·testsuite 를 낸다", () => {
    const xml = renderJUnit(buildReport([passed(listToolsCase("c1", "툴이 있다"))]));

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain("<testsuites ");
    expect(xml).toContain("<testsuite ");
    expect(xml.endsWith("</testsuites>\n")).toBe(true);
  });

  it("전부 통과하면 testcase 에 자식 요소가 없고 집계가 0이다", () => {
    const xml = renderJUnit(
      buildReport([passed(listToolsCase("c1", "툴이 있다")), passed(callToolCase("c2", "정상"))]),
    );

    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="0"');
    expect(xml).toContain('errors="0"');
    expect(xml).toContain('skipped="0"');
    expect(xml).toContain('<testcase name="툴이 있다" classname="weather" time="0"/>');
    expect(xml).not.toContain("<failure");
    expect(xml).not.toContain("<error");
    expect(xml).not.toContain("<skipped");
  });

  it("단언 실패는 <failure> 로, 작업 실패는 <error> 로 구분한다", () => {
    const xml = renderJUnit(
      buildReport([
        assertionFailed(listToolsCase("c1", "툴이 있다"), toolNotFound),
        operationFailed(callToolCase("c2", "정상"), operationBroke),
      ]),
    );

    expect(xml).toContain('failures="1"');
    expect(xml).toContain('errors="1"');
    expect(xml).toContain("<failure message=\"툴 'get_weather'를 찾을 수 없습니다.\"");
    expect(xml).toContain('type="TOOL_NOT_FOUND"');
    expect(xml).toContain('<error message="MCP 툴 목록 조회 중 오류가 발생했습니다."');
    expect(xml).toContain('type="OPERATION_FAILED"');
  });

  it('timedOut 은 <error type="CASE_TIMEOUT"> 이다', () => {
    const xml = renderJUnit(buildReport([timedOut(callToolCase("c1", "느린 툴"))]));

    expect(xml).toContain('errors="1"');
    expect(xml).toContain('type="CASE_TIMEOUT"');
    expect(xml).toContain("케이스가 제한 시간 안에 끝나지 않았습니다.");
  });

  it("cancelled 와 notRun 은 <skipped/> 이다", () => {
    const xml = renderJUnit(
      buildReport([
        withStatus(callToolCase("c1", "취소됨"), "cancelled"),
        withStatus(callToolCase("c2", "미실행"), "notRun"),
      ]),
    );

    expect(xml).toContain('skipped="2"');
    expect(xml).toContain('failures="0"');
    expect(xml).toContain('errors="0"');
    expect(xml.match(/<skipped\/>/g)).toHaveLength(2);
  });

  it("진단의 expected·actual·hint 를 본문에 담는다", () => {
    const xml = renderJUnit(
      buildReport([assertionFailed(listToolsCase("c1", "툴이 있다"), toolNotFound)]),
    );

    expect(xml).toContain('expected: "get_weather"');
    expect(xml).toContain('actual:   ["get_forecast"]');
    expect(xml).toContain("→ 서버의 tools/list 응답과 테스트 명세를 확인하세요.");
  });

  it("스키마 위반 문장을 전부 본문에 펼친다", () => {
    const diagnostic: RunnerDiagnostic = {
      code: "BODY_SCHEMA_MISMATCH",
      message: "응답이 기대 스키마와 다릅니다. 위반 2건.",
      hint: "스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.",
      totalViolations: 2,
      violations: [
        {
          code: "REQUIRED_MISSING",
          path: "$.temperature",
          expected: "temperature",
          actual: null,
          message: "$.temperature: 필수 필드가 없습니다. 발견된 필드: city, temp",
        },
        {
          code: "TYPE_MISMATCH",
          path: "$.humidity",
          expected: "number",
          actual: "60",
          message: "$.humidity: number 를 기대했지만 string 입니다.",
        },
      ],
    };

    const xml = renderJUnit(buildReport([assertionFailed(callToolCase("c1", "본문"), diagnostic)]));

    expect(xml).toContain("$.temperature: 필수 필드가 없습니다. 발견된 필드: city, temp");
    expect(xml).toContain("$.humidity: number 를 기대했지만 string 입니다.");
  });

  it("XML 특수문자를 이스케이프한다", () => {
    const diagnostic: RunnerDiagnostic = {
      code: "IS_ERROR_MISMATCH",
      message: '<script> & "따옴표" 가 든 메시지',
      hint: "a < b && c > d",
      actual: '<tag attr="v">',
    };
    const spec = callToolCase("c1", "<위험한 & 이름>");
    const xml = renderJUnit(buildReport([assertionFailed(spec, diagnostic)]));

    expect(xml).toContain("&lt;위험한 &amp; 이름&gt;");
    expect(xml).toContain("&quot;따옴표&quot;");
    expect(xml).toContain("a &lt; b &amp;&amp; c &gt; d");
    // 원문 그대로는 절대 나오면 안 된다. 하나만 새도 XML 이 깨진다.
    expect(xml).not.toContain("<script>");
    expect(xml).not.toContain('<tag attr="v">');
  });

  it("XML 1.0 이 허용하지 않는 제어문자를 제거한다", () => {
    const diagnostic: RunnerDiagnostic = {
      // U+0000 과 U+000B 는 수치 참조로도 XML 1.0 에 담을 수 없다. 제거가 유일한 방법이다.
      // U+001B 는 ANSI 이스케이프의 시작 문자다.
      code: "IS_ERROR_MISMATCH",
      message: "널\u0000문자와 \u001b[31m색상\u001b[0m",
      hint: "정상\u000b수직탭",
    };
    const xml = renderJUnit(buildReport([assertionFailed(callToolCase("c1", "제어"), diagnostic)]));

    expect(xml).not.toContain("\u0000");
    expect(xml).not.toContain("\u001b");
    expect(xml).not.toContain("\u000b");
    expect(xml).toContain("널문자와 [31m색상[0m");
    expect(xml).toContain("정상수직탭");
  });

  it("서로게이트 페어는 보존하고 짝 없는 서로게이트만 제거한다", () => {
    const diagnostic: RunnerDiagnostic = {
      code: "IS_ERROR_MISMATCH",
      message: "이모지 \u{1f324} 와 깨진 \ud800 서로게이트",
      hint: "확인하세요",
    };
    const xml = renderJUnit(
      buildReport([assertionFailed(callToolCase("c1", "유니코드"), diagnostic)]),
    );

    expect(xml).toContain("\u{1f324}");
    expect(xml).not.toContain("\ud800");
  });

  it("message 속성의 줄바꿈을 공백으로 접는다", () => {
    const diagnostic: RunnerDiagnostic = {
      code: "IS_ERROR_MISMATCH",
      message: "첫 줄\n둘째 줄\r\n셋째 줄",
      hint: "확인하세요",
    };
    const xml = renderJUnit(
      buildReport([assertionFailed(callToolCase("c1", "여러 줄"), diagnostic)]),
    );

    expect(xml).toContain('message="첫 줄 둘째 줄 셋째 줄"');
  });

  it("time 은 항상 0 이다. RunnerReport 가 시간 정보를 갖지 않는다 (ADR)", () => {
    const xml = renderJUnit(
      buildReport([passed(listToolsCase("c1", "툴")), timedOut(callToolCase("c2", "느림"))]),
    );

    for (const match of xml.matchAll(/time="([^"]*)"/g)) expect(match[1]).toBe("0");
    // testsuites · testsuite · testcase 2개
    expect([...xml.matchAll(/time="/g)]).toHaveLength(4);
  });

  it("집계가 RunnerSummary 와 어긋나지 않는다", () => {
    const report = buildReport([
      passed(listToolsCase("c1", "통과")),
      assertionFailed(callToolCase("c2", "단언실패"), toolNotFound),
      operationFailed(callToolCase("c3", "작업실패"), operationBroke),
      timedOut(callToolCase("c4", "시간초과")),
      withStatus(callToolCase("c5", "취소"), "cancelled"),
    ]);
    const xml = renderJUnit(report);

    expect(xml).toContain(`tests="${report.summary.total}"`);
    expect(xml).toContain('failures="1"'); // 단언 실패만
    expect(xml).toContain('errors="2"'); // 작업 실패 + 시간 초과
    expect(xml).toContain('skipped="1"'); // 취소
  });

  it("같은 보고서를 두 번 렌더하면 바이트가 같다", () => {
    const report = buildReport([
      passed(listToolsCase("c1", "통과")),
      assertionFailed(callToolCase("c2", "실패"), toolNotFound),
      withStatus(callToolCase("c3", "취소"), "cancelled"),
    ]);

    expect(renderJUnit(report)).toBe(renderJUnit(report));
  });

  it("suiteName 옵션이 있으면 그것을 쓰고 없으면 보고서의 이름을 쓴다", () => {
    const report = buildReport([passed(listToolsCase("c1", "툴"))]);

    expect(renderJUnit(report)).toContain('<testsuite name="날씨 서버"');
    expect(renderJUnit(report, { suiteName: "CI 실행" })).toContain('<testsuite name="CI 실행"');
  });

  it("stopReason 이 있으면 testsuite 의 system-out 에 남긴다", () => {
    const report = buildReport([withStatus(callToolCase("c1", "미실행"), "notRun")], {
      status: "aborted",
      stopReason: { type: "timeout", caseId: "c1" },
    });
    const xml = renderJUnit(report);

    expect(xml).toContain("<system-out>");
    expect(xml).toContain("c1");
  });

  it("진단이 없는 실패도 무엇을 하라는 문장을 남긴다", () => {
    const report = buildReport([
      {
        spec: callToolCase("c1", "진단없음"),
        status: "failed",
        operation: { status: "completed" },
        assertions: [{ spec: { type: "isError", expected: false }, status: "failed" }],
      },
    ]);
    const xml = renderJUnit(report);

    expect(xml).toContain("<failure");
    expect(xml).toContain("--json");
  });
});

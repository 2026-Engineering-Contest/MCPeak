import { describe, expect, it } from "vitest";
import type {
  AssertionResult,
  RunnerDiagnostic,
  RunnerReport,
  RunnerSummary,
  TestCaseResult,
} from "../src/index.js";
import { renderReport } from "../src/index.js";

// 이 테스트는 진단 문안을 단언하지 않는다. 문안은 diagnostics.ts 소유이고
// body-diagnostics.test.ts 가 이미 고정한다. 여기서 쓰는 message 와 hint 는 임의 문자열이며,
// 렌더러가 그것을 어디에 놓는지만 본다.

const ESC = "\u001b";
const ESCAPED_ESC = "\\u001b";

type AssertionType = AssertionResult["spec"]["type"];

const assertionSpec = (type: AssertionType): AssertionResult["spec"] =>
  type === "toolExists"
    ? { type: "toolExists", tool: "get_weather" }
    : type === "isError"
      ? { type: "isError", expected: false }
      : { type: "bodyMatchesSchema", schema: { type: "object" } };

const diagnostic = (
  message: string,
  hint: string,
  violationMessages?: readonly string[],
): RunnerDiagnostic => ({
  code: "BODY_SCHEMA_MISMATCH",
  message,
  hint,
  ...(violationMessages === undefined
    ? {}
    : {
        violations: violationMessages.map((text) => ({
          code: "REQUIRED_MISSING" as const,
          path: "$",
          expected: null,
          actual: null,
          message: text,
        })),
      }),
});

const assertion = (
  type: AssertionType,
  status: AssertionResult["status"],
  diagnosticValue?: RunnerDiagnostic,
): AssertionResult => ({
  spec: assertionSpec(type),
  status,
  ...(diagnosticValue === undefined ? {} : { diagnostic: diagnosticValue }),
});

interface CaseInput {
  id: string;
  name: string;
  status: TestCaseResult["status"];
  operationDiagnostic?: RunnerDiagnostic;
  assertions?: readonly AssertionResult[];
  /** 거절 근거 확인(#89). 안 주면 판정 대상이 아닌 케이스다. */
  rejectionBasis?: TestCaseResult["rejectionBasis"];
}

const testCase = (input: CaseInput): TestCaseResult => ({
  spec: {
    id: input.id,
    name: input.name,
    operation: { type: "listTools" },
    assertions: [{ type: "toolExists", tool: "get_weather" }],
  },
  status: input.status,
  operation: {
    status: input.status === "passed" ? "completed" : input.status,
    ...(input.operationDiagnostic === undefined ? {} : { diagnostic: input.operationDiagnostic }),
  },
  assertions: [...(input.assertions ?? [])],
  rejectionBasis: input.rejectionBasis ?? "notApplicable",
});

const summarize = (cases: readonly TestCaseResult[]): RunnerSummary => ({
  total: cases.length,
  passed: cases.filter((item) => item.status === "passed").length,
  failed: cases.filter((item) => item.status === "failed").length,
  timedOut: cases.filter((item) => item.status === "timedOut").length,
  cancelled: cases.filter((item) => item.status === "cancelled").length,
  notRun: cases.filter((item) => item.status === "notRun").length,
  rejectionUnverified: cases.filter((item) => item.rejectionBasis === "unverified").length,
});

const makeReport = (
  cases: readonly TestCaseResult[],
  options?: { suiteName?: string; stopReason?: RunnerReport["stopReason"] },
): RunnerReport => ({
  schemaVersion: 1,
  suite: { id: "weather", name: options?.suiteName ?? "날씨 스위트" },
  status: "failed",
  ...(options?.stopReason === undefined ? {} : { stopReason: options.stopReason }),
  cases: [...cases],
  summary: summarize(cases),
});

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

const lineWith = (text: string, needle: string): string => {
  const found = text.split("\n").find((line) => line.includes(needle));
  if (found === undefined) throw new Error(`'${needle}' 를 담은 줄이 없습니다.`);
  return found;
};

describe("renderReport", () => {
  it("전부 통과한 보고서를 그린다", () => {
    const report = makeReport([
      testCase({ id: "a", name: "첫 번째", status: "passed" }),
      testCase({ id: "long-id", name: "두 번째", status: "passed" }),
    ]);

    expect(renderReport(report)).toBe(
      [
        "날씨 스위트  (2 cases)",
        "",
        "✓ a        첫 번째",
        "✓ long-id  두 번째",
        "",
        "2 passed  (2 total)",
        "",
      ].join("\n"),
    );
  });

  it("실패 케이스의 진단과 힌트를 그린다", () => {
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "failed",
        assertions: [assertion("isError", "failed", diagnostic("진단 메시지", "진단 힌트"))],
      }),
    ]);

    expect(renderReport(report)).toBe(
      [
        "날씨 스위트  (1 case)",
        "",
        "✗ weather  날씨를 조회한다",
        "    isError  진단 메시지",
        "    해결: 진단 힌트",
        "",
        "1 failed  (1 total)",
        "",
      ].join("\n"),
    );
  });

  it("위반 목록을 화살표 줄로 그린다", () => {
    const violations = ["위반 1", "위반 2", "위반 3"];
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "failed",
        assertions: [
          assertion(
            "bodyMatchesSchema",
            "failed",
            diagnostic("본문이 스키마와 다릅니다", "스키마를 확인하세요", violations),
          ),
        ],
      }),
    ]);

    const arrowLines = renderReport(report)
      .split("\n")
      .filter((line) => line.startsWith("    → "));
    expect(arrowLines.length).toBe(violations.length);
  });

  it("notes를 위반 줄과 같은 화살표 줄로 그린다", () => {
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "failed",
        assertions: [
          assertion("isError", "failed", {
            code: "IS_ERROR_MISMATCH",
            message: "진단 메시지",
            hint: "진단 힌트",
            notes: ["알 수 없는 도시: example"],
          }),
        ],
      }),
    ]);

    const lines = renderReport(report).split("\n");
    const noteIndex = lines.indexOf("    → 알 수 없는 도시: example");

    expect(noteIndex).toBeGreaterThan(-1);
    // 단언 줄 다음, hint 줄 앞이다.
    expect(lines[noteIndex - 1]).toContain("진단 메시지");
    expect(lines[noteIndex + 1]).toBe("    해결: 진단 힌트");
  });

  it("notes의 터미널 제어 문자를 위반 줄과 같게 이스케이프한다", () => {
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "failed",
        assertions: [
          assertion("isError", "failed", {
            code: "IS_ERROR_MISMATCH",
            message: "진단 메시지",
            hint: "진단 힌트",
            notes: [`${ESC}[31m빨강`],
          }),
        ],
      }),
    ]);

    expect(renderReport(report)).toContain(`    → ${ESCAPED_ESC}[31m빨강`);
  });

  it("violations를 notes보다 먼저 그린다", () => {
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "failed",
        assertions: [
          assertion("bodyMatchesSchema", "failed", {
            ...diagnostic("진단 메시지", "진단 힌트", ["위반 하나"]),
            notes: ["노트 하나"],
          }),
        ],
      }),
    ]);

    const arrowLines = renderReport(report)
      .split("\n")
      .filter((line) => line.startsWith("    → "));

    expect(arrowLines).toEqual(["    → 위반 하나", "    → 노트 하나"]);
  });

  it("통과한 단언은 그리지 않는다", () => {
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "failed",
        assertions: [
          assertion("bodyMatchesSchema", "passed"),
          assertion("isError", "failed", diagnostic("진단 메시지", "진단 힌트")),
        ],
      }),
    ]);

    expect(renderReport(report)).not.toContain("bodyMatchesSchema");
  });

  it("notRun 단언은 그리지 않는다", () => {
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "notRun",
        assertions: [assertion("isError", "notRun"), assertion("bodyMatchesSchema", "notRun")],
      }),
    ]);

    // 헤더, 빈 줄, 케이스 줄, 빈 줄, 요약 줄, 마지막 개행 뒤의 빈 조각.
    expect(renderReport(report).split("\n").length).toBe(6);
  });

  it("skipped 단언에 건너뜀 접두를 붙인다", () => {
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "failed",
        assertions: [
          assertion("bodyMatchesSchema", "skipped", diagnostic("결과가 없습니다", "연결을 보세요")),
        ],
      }),
    ]);

    const line = lineWith(renderReport(report), "결과가 없습니다");
    expect(line).toContain("(건너뜀) 결과가 없습니다");
  });

  it("diagnostic이 없는 failed 단언은 건너뛴다", () => {
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "failed",
        assertions: [assertion("isError", "failed")],
      }),
    ]);

    const output = renderReport(report);
    expect(output).toContain("✗ weather  날씨를 조회한다");
    expect(output).not.toContain("isError");
  });

  it("케이스 레벨 진단을 단언 이름 없이 그린다", () => {
    const report = makeReport([
      testCase({
        id: "slow-call",
        name: "대용량 예보를 반환한다",
        status: "timedOut",
        operationDiagnostic: diagnostic("타임아웃 진단", "타임아웃 힌트"),
        assertions: [assertion("bodyMatchesSchema", "notRun")],
      }),
    ]);

    expect(renderReport(report)).toBe(
      [
        "날씨 스위트  (1 case)",
        "",
        "⧖ slow-call  대용량 예보를 반환한다",
        "    타임아웃 진단",
        "    해결: 타임아웃 힌트",
        "",
        "1 timed out  (1 total)",
        "",
      ].join("\n"),
    );
  });

  it("passed 케이스의 operation 진단은 그리지 않는다", () => {
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "passed",
        operationDiagnostic: diagnostic("숨겨야 하는 문장", "숨겨야 하는 힌트"),
      }),
    ]);

    const output = renderReport(report);
    expect(output).not.toContain("숨겨야 하는 문장");
    expect(output).not.toContain("숨겨야 하는 힌트");
  });

  it("다섯 상태 기호를 각각 쓴다", () => {
    const report = makeReport([
      testCase({ id: "c1", name: "통과", status: "passed" }),
      testCase({ id: "c2", name: "실패", status: "failed" }),
      testCase({ id: "c3", name: "타임아웃", status: "timedOut" }),
      testCase({ id: "c4", name: "취소", status: "cancelled" }),
      testCase({ id: "c5", name: "미실행", status: "notRun" }),
    ]);

    const output = renderReport(report);
    for (const glyph of ["✓", "✗", "⧖", "⊘", "·"]) {
      expect(countOf(output, glyph)).toBe(1);
    }
  });

  it("caseId 열을 가장 긴 것에 맞춘다", () => {
    const report = makeReport([
      testCase({ id: "a", name: "이름1", status: "passed" }),
      testCase({ id: "medium-id", name: "이름2", status: "passed" }),
      testCase({ id: "the-longest-case-id", name: "이름3", status: "passed" }),
    ]);

    const output = renderReport(report);
    const starts = ["이름1", "이름2", "이름3"].map((name) => lineWith(output, name).indexOf(name));
    expect(new Set(starts).size).toBe(1);
  });

  it("단언 타입 열을 케이스 안에서 맞춘다", () => {
    const report = makeReport([
      testCase({
        id: "weather",
        name: "날씨를 조회한다",
        status: "failed",
        assertions: [
          assertion("isError", "failed", diagnostic("메시지A", "힌트A")),
          assertion("bodyMatchesSchema", "failed", diagnostic("메시지B", "힌트B")),
        ],
      }),
    ]);

    const output = renderReport(report);
    expect(lineWith(output, "메시지A").indexOf("메시지A")).toBe(
      lineWith(output, "메시지B").indexOf("메시지B"),
    );
  });

  it("단언 타입 열은 케이스마다 독립이다", () => {
    const report = makeReport([
      testCase({
        id: "caseA",
        name: "케이스 A",
        status: "failed",
        assertions: [assertion("isError", "failed", diagnostic("메시지A", "힌트A"))],
      }),
      testCase({
        id: "caseB",
        name: "케이스 B",
        status: "failed",
        assertions: [assertion("bodyMatchesSchema", "failed", diagnostic("메시지B", "힌트B"))],
      }),
    ]);

    const output = renderReport(report);
    // 들여쓰기 4 + "isError" 7 + 구분 2.
    expect(lineWith(output, "메시지A").indexOf("메시지A")).toBe(13);
    // 들여쓰기 4 + "bodyMatchesSchema" 17 + 구분 2.
    expect(lineWith(output, "메시지B").indexOf("메시지B")).toBe(23);
  });

  it("케이스 순서를 유지한다", () => {
    const ids = ["zebra", "alpha", "middle"];
    const report = makeReport(
      ids.map((id, index) => testCase({ id, name: `이름${index}`, status: "passed" })),
    );

    const caseLines = renderReport(report)
      .split("\n")
      .filter((line) => line.startsWith("✓ "));
    expect(caseLines.map((line) => line.split(" ")[1])).toEqual(ids);
  });

  it("stopReason 타임아웃 줄을 그린다", () => {
    const report = makeReport(
      [
        testCase({
          id: "slow-call",
          name: "대용량 예보를 반환한다",
          status: "timedOut",
          operationDiagnostic: diagnostic("타임아웃 진단", "타임아웃 힌트"),
        }),
      ],
      { stopReason: { type: "timeout", caseId: "slow-call" } },
    );

    expect(renderReport(report)).toContain(
      "중단: 케이스 'slow-call' 타임아웃으로 실행을 멈췄습니다.",
    );
  });

  it("stopReason abortSignal에 caseId가 있으면 그린다", () => {
    const report = makeReport(
      [testCase({ id: "weather-seoul", name: "서울 날씨", status: "cancelled" })],
      { stopReason: { type: "abortSignal", caseId: "weather-seoul" } },
    );

    expect(renderReport(report)).toContain("마지막 케이스 'weather-seoul'");
  });

  it("stopReason abortSignal에 caseId가 없으면 생략한다", () => {
    const report = makeReport([testCase({ id: "weather", name: "서울 날씨", status: "notRun" })], {
      stopReason: { type: "abortSignal" },
    });

    const output = renderReport(report);
    expect(output).toContain("중단: 외부 요청으로 실행을 멈췄습니다.");
    expect(output).not.toContain("마지막 케이스");
  });

  it("stopReason이 없으면 중단 줄이 없다", () => {
    const report = makeReport([testCase({ id: "weather", name: "서울 날씨", status: "passed" })]);

    expect(renderReport(report)).not.toContain("중단:");
  });

  it("요약에서 0인 항목을 생략한다", () => {
    const report = makeReport([
      testCase({ id: "c1", name: "이름1", status: "passed" }),
      testCase({ id: "c2", name: "이름2", status: "passed" }),
      testCase({ id: "c3", name: "이름3", status: "failed" }),
    ]);

    expect(renderReport(report)).toContain("2 passed, 1 failed  (3 total)");
  });

  it("요약 항목 순서가 고정이다", () => {
    const report = makeReport([
      testCase({ id: "c1", name: "이름1", status: "passed" }),
      testCase({ id: "c2", name: "이름2", status: "failed" }),
      testCase({ id: "c3", name: "이름3", status: "timedOut" }),
      testCase({ id: "c4", name: "이름4", status: "cancelled" }),
      testCase({ id: "c5", name: "이름5", status: "notRun" }),
    ]);

    expect(renderReport(report)).toContain(
      "1 passed, 1 failed, 1 timed out, 1 cancelled, 1 not run  (5 total)",
    );
  });

  it("단수 케이스에 case를 쓴다", () => {
    const report = makeReport([testCase({ id: "c1", name: "이름1", status: "passed" })]);

    expect(renderReport(report).split("\n")[0]?.endsWith("(1 case)")).toBe(true);
  });

  it("복수 케이스에 cases를 쓴다", () => {
    const report = makeReport([
      testCase({ id: "c1", name: "이름1", status: "passed" }),
      testCase({ id: "c2", name: "이름2", status: "passed" }),
      testCase({ id: "c3", name: "이름3", status: "passed" }),
    ]);

    expect(renderReport(report).split("\n")[0]?.endsWith("(3 cases)")).toBe(true);
  });

  it("문자열이 개행 하나로 끝난다", () => {
    const report = makeReport([testCase({ id: "c1", name: "이름1", status: "passed" })]);

    const output = renderReport(report);
    expect(output.endsWith("\n")).toBe(true);
    expect(output.endsWith("\n\n")).toBe(false);
  });

  it("CRLF를 쓰지 않는다", () => {
    const report = makeReport([
      testCase({
        id: "c1",
        name: "이름1",
        status: "failed",
        assertions: [assertion("isError", "failed", diagnostic("메시지", "힌트", ["위반"]))],
      }),
    ]);

    expect(renderReport(report)).not.toContain("\r");
  });

  it("같은 보고서를 두 번 그리면 같다", () => {
    const report = makeReport([
      testCase({ id: "c1", name: "이름1", status: "passed" }),
      testCase({
        id: "c2",
        name: "이름2",
        status: "failed",
        assertions: [assertion("isError", "failed", diagnostic("메시지", "힌트", ["위반"]))],
      }),
    ]);

    expect(renderReport(report)).toBe(renderReport(report));
  });

  it("케이스 이름의 제어 문자를 이스케이프한다", () => {
    const report = makeReport([testCase({ id: "c1", name: `이름${ESC}[2J`, status: "passed" })]);

    const output = renderReport(report);
    expect(output).not.toContain(ESC);
    expect(output).toContain(`${ESCAPED_ESC}[2J`);
  });

  it("위반 메시지의 제어 문자를 이스케이프한다", () => {
    const report = makeReport([
      testCase({
        id: "c1",
        name: "이름1",
        status: "failed",
        assertions: [
          assertion("isError", "failed", diagnostic("메시지", "힌트", [`위반${ESC}[2J`])),
        ],
      }),
    ]);

    const output = renderReport(report);
    expect(output).not.toContain(ESC);
    expect(output).toContain(`${ESCAPED_ESC}[2J`);
  });

  it("caseId의 제어 문자를 이스케이프한다", () => {
    const report = makeReport([testCase({ id: `c1${ESC}[2J`, name: "이름1", status: "passed" })]);

    const output = renderReport(report);
    expect(output).not.toContain(ESC);
    expect(output).toContain(`${ESCAPED_ESC}[2J`);
  });

  it("중단 줄의 caseId도 이스케이프한다", () => {
    const report = makeReport([testCase({ id: "c1", name: "이름1", status: "timedOut" })], {
      stopReason: { type: "timeout", caseId: `slow${ESC}[2J` },
    });

    const output = renderReport(report);
    expect(output).not.toContain(ESC);
    expect(output).toContain(`${ESCAPED_ESC}[2J`);
  });

  it("C1 제어 문자를 이스케이프한다", () => {
    // U+009B 는 8비트 CSI 다. 이것을 통과시키면 일부 터미널이 제어 시퀀스로 해석한다.
    const csi = String.fromCodePoint(0x9b);
    const report = makeReport([
      testCase({ id: `c1${csi}`, name: `이름${csi}[2J`, status: "passed" }),
    ]);

    const output = renderReport(report);
    expect(output).not.toContain(csi);
    expect(output).toContain("\\u009b");
  });

  it("이스케이프 뒤 길이로 열을 맞춘다", () => {
    const report = makeReport([
      testCase({ id: `a${ESC}b`, name: "이름1", status: "passed" }),
      testCase({ id: "0123456789", name: "이름2", status: "passed" }),
    ]);

    const output = renderReport(report);
    expect(lineWith(output, "이름1").indexOf("이름1")).toBe(
      lineWith(output, "이름2").indexOf("이름2"),
    );
  });

  it("색상 옵션이 없으면 ANSI가 없다", () => {
    const report = makeReport([
      testCase({
        id: "c1",
        name: "이름1",
        status: "failed",
        assertions: [assertion("isError", "failed", diagnostic("메시지", "힌트"))],
      }),
    ]);

    expect(renderReport(report)).not.toContain(ESC);
  });

  it("색상 옵션이 false여도 ANSI가 없다", () => {
    const report = makeReport([
      testCase({
        id: "c1",
        name: "이름1",
        status: "failed",
        assertions: [assertion("isError", "failed", diagnostic("메시지", "힌트"))],
      }),
    ]);

    expect(renderReport(report, { color: false })).toBe(renderReport(report));
  });

  it("색상 옵션이 true면 상태 기호에 SGR을 붙인다", () => {
    const report = makeReport([testCase({ id: "a", name: "이름1", status: "passed" })], {
      suiteName: "S",
    });

    expect(renderReport(report, { color: true })).toBe(
      ["S  (1 case)", "", `${ESC}[32m✓${ESC}[0m a  이름1`, "", "1 passed  (1 total)", ""].join(
        "\n",
      ),
    );
  });

  it("색상은 이스케이프 뒤에 넣는다", () => {
    const report = makeReport([testCase({ id: "c1", name: `이름${ESC}[2J`, status: "failed" })]);

    const output = renderReport(report, { color: true });
    expect(output).toContain(`${ESC}[31m✗${ESC}[0m`);
    expect(output).toContain(`${ESCAPED_ESC}[2J`);
    expect(output).not.toContain(`${ESC}[2J`);
  });

  it("해결 줄만 흐리게 한다", () => {
    const report = makeReport([
      testCase({
        id: "c1",
        name: "이름1",
        status: "failed",
        assertions: [assertion("isError", "failed", diagnostic("메시지", "힌트"))],
      }),
      testCase({ id: "c2", name: "이름2", status: "notRun" }),
    ]);

    const plain = renderReport(report);
    const hintLines = plain.split("\n").filter((line) => line.startsWith("    해결: ")).length;
    const dimGlyphs = countOf(plain, "·") + countOf(plain, "⊘");
    expect(countOf(renderReport(report, { color: true }), `${ESC}[2m`)).toBe(hintLines + dimGlyphs);
  });

  it("색상은 줄 수를 바꾸지 않는다", () => {
    const report = makeReport([
      testCase({
        id: "c1",
        name: "이름1",
        status: "failed",
        assertions: [assertion("isError", "failed", diagnostic("메시지", "힌트", ["위반"]))],
      }),
      testCase({ id: "c2", name: "이름2", status: "notRun" }),
    ]);

    expect(renderReport(report, { color: true }).split("\n").length).toBe(
      renderReport(report, { color: false }).split("\n").length,
    );
  });

  /**
   * 거절 근거 확인 고지 (#89 · 설계 문서 §5.1). 문안이 곧 제품이라 세 줄을 글자 그대로 못 박는다.
   * 이 화면은 **"확인 못 함" 을 "결함" 으로 오해시키면 안 된다.**
   */
  describe("거절 근거 미확인 고지", () => {
    /** `rejectionBasis` 만 다른 통과 케이스 n 건. 판정은 전부 passed 다. */
    const unverifiedCases = (count: number): TestCaseResult[] =>
      Array.from({ length: count }, (_, index) =>
        testCase({
          id: `u${index}`,
          name: `미확인${index}`,
          status: "passed",
          rejectionBasis: "unverified",
        }),
      );

    it("확인 못 한 케이스가 없으면 고지 줄이 안 나온다", () => {
      const report = makeReport([
        testCase({ id: "a", name: "첫 번째", status: "passed" }),
        testCase({
          id: "b",
          name: "두 번째",
          status: "passed",
          rejectionBasis: "verified",
        }),
      ]);
      expect(report.summary.rejectionUnverified).toBe(0);
      expect(renderReport(report)).not.toContain("거절 근거");
    });

    it("확인 못 한 케이스가 있으면 건수와 안내를 찍는다", () => {
      const report = makeReport(unverifiedCases(3));
      const text = renderReport(report);
      expect(text).toContain(
        "  → 거절을 기대한 케이스 3건은 거절 근거를 확인하지 못했습니다.\n" +
          "    서버가 거절한 것인지 다른 이유로 실패한 것인지 이 도구는 판단하지 못합니다.\n" +
          "    확인: ohmymcp generate 의 승인 화면에서 해당 케이스의 응답을 확인하세요.",
      );
    });

    it("고지는 요약 줄 뒤에 온다", () => {
      const lines = renderReport(makeReport(unverifiedCases(1))).split("\n");
      const summary = lines.findIndex((line) => line.includes("total)"));
      const notice = lines.findIndex((line) => line.includes("거절 근거를 확인하지 못했습니다"));
      expect(summary).toBeGreaterThanOrEqual(0);
      expect(notice).toBeGreaterThan(summary);
    });

    it("케이스 목록에는 아무 표시도 더하지 않는다", () => {
      // 통과한 케이스 옆에 기호를 더하면 판정이 바뀐 것으로 읽힌다(설계 문서 §5.1).
      const lines = renderReport(makeReport(unverifiedCases(1))).split("\n");
      const caseLine = lines.find((line) => line.includes("미확인0"));
      expect(caseLine).toBe("✓ u0  미확인0");
    });

    it("색상을 켜도 고지에 SGR 이 안 들어간다", () => {
      // 기존 요약 줄과 같은 규칙이다. 요약에는 색이 없다.
      const report = makeReport(unverifiedCases(2));
      const notice = (text: string) => text.split("\n").filter((line) => line.includes("거절"));
      expect(notice(renderReport(report, { color: true }))).toEqual(
        notice(renderReport(report, { color: false })),
      );
      expect(renderReport(report, { color: true }).split("\n").length).toBe(
        renderReport(report, { color: false }).split("\n").length,
      );
    });

    it("한 건이어도 같은 문장을 쓴다", () => {
      expect(renderReport(makeReport(unverifiedCases(1)))).toContain("거절을 기대한 케이스 1건은");
    });
  });
});

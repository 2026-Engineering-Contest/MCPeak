import type { AssertionResult } from "./assertions.js";
import type { RunnerDiagnostic } from "./diagnostics.js";
import type { RunnerReport, RunnerSummary, TestCaseResult } from "./executor.js";

export interface RenderReportOptions {
  /** ANSI 색상 사용 여부. 기본 false. */
  color?: boolean;
}

/** 진단과 단언 줄의 들여쓰기. 설계 문서 §5.3, §5.4. */
const INDENT = "    ";
/** 열 사이 구분. 헤더, 케이스 줄, 단언 줄, 요약 줄에서 같은 값을 쓴다. */
const GAP = "  ";

/** 케이스 상태 기호. 설계 문서 §5.2. 환경에 따라 바뀌지 않는다. */
const MARKS: Readonly<Record<TestCaseResult["status"], { glyph: string; sgr: string }>> = {
  passed: { glyph: "✓", sgr: "32" },
  failed: { glyph: "✗", sgr: "31" },
  timedOut: { glyph: "⧖", sgr: "33" },
  cancelled: { glyph: "⊘", sgr: "2" },
  notRun: { glyph: "·", sgr: "2" },
};

/** 요약 줄 항목. 순서가 곧 출력 순서다. 설계 문서 §5.6. */
const SUMMARY_LABELS: ReadonlyArray<readonly [keyof RunnerSummary, string]> = [
  ["passed", "passed"],
  ["failed", "failed"],
  ["timedOut", "timed out"],
  ["cancelled", "cancelled"],
  ["notRun", "not run"],
];

/**
 * 터미널 제어 문자를 무해한 문자열로 바꾼다. 설계 문서 §6.
 * packages/cli/src/test-command.ts:143 의 규칙과 같은 값을 쓴다.
 * cli 의 것을 import 하지 않는다. 의존 방향이 뒤집힌다. ADR-0013에 근거가 있다.
 */
const escapeTerminalText = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f || codePoint === 0x2028 || codePoint === 0x2029
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");

/**
 * 코드 포인트 수. 표시 폭이 아니다. 설계 문서 §5.2의 알려진 한계를 그대로 받는다.
 * String.prototype.length 를 쓰지 않는다. 서로게이트 페어를 2로 세기 때문이다.
 */
const width = (value: string): number => Array.from(value).length;

/** 오른쪽을 공백으로 채운다. 이미 target 이상이면 그대로 둔다. */
const pad = (value: string, target: number): string =>
  value + " ".repeat(Math.max(0, target - width(value)));

/** color 가 false 면 원문 그대로 반환한다. */
const sgr = (code: string, text: string, color: boolean): string =>
  color ? `\u001b[${code}m${text}\u001b[0m` : text;

// 계획서 §4-5의 코드와 같다. 인자 이름만 escape 에서 escapeText 로 바꿨다.
// biome 의 noShadowRestrictedNames 가 전역 escape 를 가리는 이름을 거부하기 때문이다.
const stopReasonLine = (
  stopReason: NonNullable<RunnerReport["stopReason"]>,
  escapeText: (value: string) => string,
): string =>
  stopReason.type === "timeout"
    ? `중단: 케이스 '${escapeText(stopReason.caseId)}' 타임아웃으로 실행을 멈췄습니다.`
    : stopReason.caseId === undefined
      ? "중단: 외부 요청으로 실행을 멈췄습니다."
      : `중단: 외부 요청으로 실행을 멈췄습니다. 마지막 케이스 '${escapeText(stopReason.caseId)}'`;

/**
 * 그려야 하는 단언인지 판정한다. 설계 문서 §5.4와 구현 계획 §4-7.
 * failed 와 skipped 는 계약상 항상 diagnostic 을 갖지만, 없으면 방어적으로 건너뛴다.
 */
const isDrawn = (
  assertion: AssertionResult,
): assertion is AssertionResult & { diagnostic: RunnerDiagnostic } =>
  (assertion.status === "failed" || assertion.status === "skipped") &&
  assertion.diagnostic !== undefined;

const summaryLine = (summary: RunnerSummary): string => {
  const items = SUMMARY_LABELS.filter(([key]) => summary[key] > 0).map(
    ([key, label]) => `${summary[key]} ${label}`,
  );
  return `${items.join(", ")}${GAP}(${summary.total} total)`;
};

/**
 * RunnerReport를 사람이 읽는 문자열로 그린다. 순수 함수다.
 * process, stdout, isTTY, NO_COLOR, Date, 로케일을 읽지 않는다.
 * 반환값은 항상 개행 하나로 끝난다. 호출부가 개행을 덧붙이지 않는다.
 */
export function renderReport(report: RunnerReport, options?: RenderReportOptions): string {
  const color = options?.color === true;
  // 이스케이프가 먼저, 색상 삽입이 나중이다. 순서를 뒤집으면 우리가 넣은 SGR 시퀀스가
  // 이스케이프되어 화면에 리터럴 문자열로 찍힌다. 설계 문서 §6.
  const hintLine = (hint: string): string =>
    sgr("2", `${INDENT}해결: ${escapeTerminalText(hint)}`, color);

  const total = report.summary.total;
  const lines: string[] = [
    `${escapeTerminalText(report.suite.name)}${GAP}(${total} ${total === 1 ? "case" : "cases"})`,
    "",
  ];

  // 이스케이프한 뒤의 폭으로 열을 맞춘다. 순서를 뒤집으면 열이 어긋난다.
  const idColumn = report.cases.reduce(
    (max, result) => Math.max(max, width(escapeTerminalText(result.spec.id))),
    0,
  );

  for (const result of report.cases) {
    const mark = sgr(MARKS[result.status].sgr, MARKS[result.status].glyph, color);
    lines.push(
      `${mark} ${pad(escapeTerminalText(result.spec.id), idColumn)}${GAP}${escapeTerminalText(result.spec.name)}`,
    );

    const operationDiagnostic = result.operation.diagnostic;
    if (result.status !== "passed" && operationDiagnostic !== undefined) {
      lines.push(`${INDENT}${escapeTerminalText(operationDiagnostic.message)}`);
      lines.push(hintLine(operationDiagnostic.hint));
    }

    // 단언 타입 열은 그 케이스 안에서 출력되는 단언들끼리만 맞춘다. 보고서 전체가 아니다.
    const drawn = result.assertions.filter(isDrawn);
    const typeColumn = drawn.reduce(
      (max, assertion) => Math.max(max, width(escapeTerminalText(assertion.spec.type))),
      0,
    );
    for (const assertion of drawn) {
      const prefix = assertion.status === "skipped" ? "(건너뜀) " : "";
      lines.push(
        `${INDENT}${pad(escapeTerminalText(assertion.spec.type), typeColumn)}${GAP}${prefix}${escapeTerminalText(assertion.diagnostic.message)}`,
      );
      for (const violation of assertion.diagnostic.violations ?? []) {
        lines.push(`${INDENT}→ ${escapeTerminalText(violation.message)}`);
      }
      lines.push(hintLine(assertion.diagnostic.hint));
    }
  }

  lines.push("");
  if (report.stopReason !== undefined) {
    lines.push(stopReasonLine(report.stopReason, escapeTerminalText));
    lines.push("");
  }
  lines.push(summaryLine(report.summary));

  return `${lines.join("\n")}\n`;
}

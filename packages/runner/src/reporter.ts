import type { AssertionResult } from "./assertions.js";
import type { ConnectionLostCause } from "./connection-loss.js";
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
/** 위반·notes 줄의 글머리. */
const BULLET = "→";

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
    // 0x7f..0x9f 는 DEL 과 C1 제어 문자다. U+009B 를 8비트 CSI 로 해석하는 터미널이 있다.
    return codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");

/**
 * 위반·notes 의 글머리 줄 하나를 만든다.
 *
 * **줄이 이미 `→` 로 시작하면 우리 글머리를 붙이지 않는다.** 붙이면 `→ → ...` 가 된다(#280).
 * `→` 글머리는 이 저장소가 권장하는 실패 메시지 형식이라(`CLAUDE.md`,
 * `examples/weather-server/server.mjs`) 우리 안내를 따른 서버가 전부 이 자리에 걸린다.
 *
 * **서버 문장 자체는 고치지 않는다.** 여기서 하는 일은 우리 글머리를 안 붙이는 것뿐이고,
 * `note` 원문은 그대로 나간다. 원문에 의존하는 곳이 셋이다 — `rejection-basis` 의 목 거절
 * 지문이 `→` 글머리를 완전 일치로 요구하고(ADR-0060), `--json` 의 `notes` 가 이 값이며,
 * cli 의 교정 요청 문안이 이 줄을 그대로 싣는다(`diagnostics.ts` 의 `responseBodyNotes`).
 *
 * 선행 공백은 보존한다. 서버가 하위 항목을 들여쓴 것이므로 우리가 펴면 계층이 사라진다.
 * 화살표가 둘 이상이면 그대로 둔다 — 우리가 하나를 안 붙이는 데까지가 이 함수의 몫이다.
 *
 * 이스케이프가 먼저, 판정이 나중이다. `hintLine` 과 같은 순서다(설계 문서 §6).
 */
const bulletLine = (text: string): string => {
  const escaped = escapeTerminalText(text);
  return escaped.trimStart().startsWith(BULLET)
    ? `${INDENT}${escaped}`
    : `${INDENT}${BULLET} ${escaped}`;
};

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

/** 연결 상실 사유별 중단 문장의 가운데 토막. 사유가 곧 사람이 읽는 원인이다. */
const CONNECTION_LOST_TEXT: Readonly<Record<ConnectionLostCause, string>> = {
  processExited: "서버 프로세스가 종료되어",
  transportFailed: "서버와의 연결이 끊겨",
  httpSessionLost: "서버가 세션을 잃어",
};

/**
 * 종료 코드·시그널 괄호. 둘 다 관측하지 못했으면 괄호를 만들지 않는다 — `(없음)` 은
 * 관측하지 못한 것을 관측했다고 말하는 것이다.
 */
const connectionLostDetail = (
  stopReason: { exitCode?: number; signal?: string },
  escapeText: (value: string) => string,
): string => {
  const parts: string[] = [];
  if (stopReason.exitCode !== undefined) parts.push(`종료 코드 ${stopReason.exitCode}`);
  if (stopReason.signal !== undefined) parts.push(`시그널 ${escapeText(stopReason.signal)}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
};

// 계획서 §4-5의 코드에서 출발했다. 인자 이름을 escape 에서 escapeText 로 바꾼 것은 biome 의
// noShadowRestrictedNames 가 전역 escape 를 가리는 이름을 거부하기 때문이고, 삼항을 푼 것은
// connectionLost 가 들어오면서 사유가 셋이 됐기 때문이다(#279).
//
// 연결 상실 줄은 케이스 이름을 말하지 않는다. 바로 위 케이스 목록에 `✗` 로 이미 있고,
// 이 줄이 답해야 하는 것은 "왜 나머지가 안 돌았나" 다. 케이스 식별자는 보고서 JSON 에 남는다.
const stopReasonLine = (
  stopReason: NonNullable<RunnerReport["stopReason"]>,
  escapeText: (value: string) => string,
): string => {
  if (stopReason.type === "timeout")
    return `중단: 케이스 '${escapeText(stopReason.caseId)}' 타임아웃으로 실행을 멈췄습니다.`;
  if (stopReason.type === "connectionLost")
    return `중단: ${CONNECTION_LOST_TEXT[stopReason.cause]} 실행을 멈췄습니다.${connectionLostDetail(stopReason, escapeText)}`;
  return stopReason.caseId === undefined
    ? "중단: 외부 요청으로 실행을 멈췄습니다."
    : `중단: 외부 요청으로 실행을 멈췄습니다. 마지막 케이스 '${escapeText(stopReason.caseId)}'`;
};

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
 * 거절 근거를 확인하지 못한 케이스가 있다는 고지. 설계 문서 §5.1 이 문안을 전량 고정한다.
 *
 * **0건이면 아무 줄도 안 낸다.** 대부분의 실행이 0건이고, 늘 나오는 줄은 읽히지 않는다.
 *
 * 이 케이스들은 **통과했다.** `unverified` 는 "거절이 아니다" 가 아니라 "확인하지 못했다" 는
 * 뜻이다(설계 문서 §4.3). 그래서 문장이 "실패" 나 "결함" 이라고 말하지 않고, 무엇을 판단하지
 * 못했는지와 어디서 확인하는지만 적는다. 케이스 목록에는 아무 표시도 더하지 않는다 — 통과한
 * 케이스 옆에 기호가 붙으면 판정이 바뀐 것으로 읽힌다.
 *
 * 색은 넣지 않는다. 바로 위 요약 줄과 같은 규칙이다.
 */
const rejectionNoticeLines = (summary: RunnerSummary): readonly string[] =>
  summary.rejectionUnverified === 0
    ? []
    : [
        "",
        `${GAP}→ 거절을 기대한 케이스 ${summary.rejectionUnverified}건은 거절 근거를 확인하지 못했습니다.`,
        `${INDENT}서버가 거절한 것인지 다른 이유로 실패한 것인지 이 도구는 판단하지 못합니다.`,
        `${INDENT}확인: mcpeak generate 의 승인 화면에서 해당 케이스의 응답을 확인하세요.`,
      ];

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
      // 서버가 준 이유(원인 체인)가 여기 실린다. 안 그리면 executor 가 살려 온 이유를
      // 화면이 다시 버린다(adoption.md §2.5 넷째). 이유를 본 뒤 해결을 읽도록 hint 앞이다.
      for (const note of operationDiagnostic.notes ?? []) {
        lines.push(bulletLine(note));
      }
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
        lines.push(bulletLine(violation.message));
      }
      // notes 는 위반 다음이다. 위반은 우리가 낸 판정이고 notes 는 서버가 준 값이라,
      // 판정을 먼저 읽고 근거를 나중에 읽는 순서가 된다. ADR-0027.
      for (const note of assertion.diagnostic.notes ?? []) {
        lines.push(bulletLine(note));
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
  lines.push(...rejectionNoticeLines(report.summary));

  return `${lines.join("\n")}\n`;
}

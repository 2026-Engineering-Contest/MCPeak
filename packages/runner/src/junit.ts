import type { RunnerDiagnostic } from "./diagnostics.js";
import type { RunnerReport, TestCaseResult } from "./executor.js";

export interface JUnitRenderOptions {
  /** `<testsuite name>`. 생략하면 `report.suite.name` 을 쓴다. */
  suiteName?: string;
}

/**
 * 모든 `time` 속성의 값. 근거는 ADR-0016 에 있다.
 *
 * `RunnerReport` 는 경과 시간을 갖지 않는다. 같은 입력에 같은 바이트를 내기 위해 시간 필드를
 * 의도적으로 제외했기 때문이다(Runner 설계의 확정 사항). 반면 JUnit 스키마는 `time` 을
 * 기대한다. 여기서 쓰는 `0` 은 "0초 걸렸다" 가 아니라 **"시간 정보를 갖고 있지 않다"** 의
 * 표현이다.
 *
 * 실제 시간이 필요해지면 `RunnerReport` 에 필드를 더하지 마라. 그것은 `--json` 출력 바이트와
 * `renderReport` 의 결정론성까지 흔든다. ADR-0016 가 그 선택지를 배제했다. 대신 측정 책임을
 * 가진 `cli` 가 `JUnitRenderOptions` 에 경과 시간을 넘기도록 확장한다.
 */
const TIME = "0";

/**
 * XML 1.0 이 허용하는 문자만 남긴다.
 *
 * 허용 범위 밖 문자는 `&#x0;` 같은 수치 참조로도 담을 수 없다. XML 1.0 문서에 존재할 수
 * 없는 문자이므로 이스케이프가 아니라 제거가 유일한 방법이다. 서버 응답 문자열이 그대로
 * 여기까지 오므로 이 단계를 건너뛰면 악의 없는 서버가 뱉은 제어문자 하나로 리포트 파일
 * 전체가 파싱 불가가 된다.
 *
 * `for...of` 는 코드 포인트 단위로 순회한다. 정상 서로게이트 페어는 하나의 코드 포인트로
 * 묶여 `0x10000` 이상으로 판정되어 살아남고, 짝 없는 서로게이트만 걸러진다. 코드 유닛
 * 단위로 훑으면 이모지가 통째로 잘려 나간다.
 */
function stripInvalidXmlChars(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      codePoint >= 0x10000
    ) {
      result += character;
    }
  }
  return result;
}

/** 요소 본문. `&` 를 먼저 바꾸지 않으면 뒤에 만든 엔티티를 다시 이스케이프한다. */
const escapeText = (value: string): string =>
  stripInvalidXmlChars(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * 속성값. 줄바꿈과 탭을 공백 하나로 접는다.
 *
 * XML 파서는 속성값 안의 개행·탭을 공백으로 정규화한다(XML 1.0 §3.3.3). 접지 않고 넘기면
 * 도구마다 다른 문자열을 보게 되므로, 우리가 먼저 접어서 어디서든 같은 값이 되게 한다.
 *
 * **앞뒤 공백은 자르지 않는다.** 파서의 정규화 규칙도 자르지 않으므로, 우리가 자르면 오히려
 * 파서가 만드는 값과 어긋난다. 게다가 `suite.id` 와 `spec.name` 은 실행 결과를 명세와 잇는
 * 계약 식별자다. 리포터가 식별자를 조용히 바꾸면 보고서와 XML 이 서로 다른 이름을 갖는다.
 */
const escapeAttribute = (value: string): string =>
  escapeText(value.replace(/[\r\n\t]+/g, " ")).replaceAll('"', "&quot;");

/**
 * 케이스 하나가 JUnit 에서 무엇이 되는지.
 *
 * `failure` 는 "돌았는데 기대와 다르다", `error` 는 "실행 자체가 안 됐다" 다. CI 화면에서
 * "서버가 죽었다" 와 "응답이 다르다" 가 구별되려면 이 둘을 섞으면 안 된다.
 */
type CaseOutcome =
  | { kind: "passed" }
  | { kind: "skipped" }
  | { kind: "failure" | "error"; diagnostics: RunnerDiagnostic[] };

/**
 * 진단 없이 실패한 케이스를 위한 최소 진단.
 *
 * 실행 경로상 나오지 않아야 하지만, 나왔을 때 빈 `<failure/>` 를 내보내면 사용자는 무엇을
 * 해야 할지 알 수 없다. 실패 메시지가 곧 제품이므로 이 경로에도 다음 행동을 적는다.
 */
const fallbackDiagnostic = (result: TestCaseResult): RunnerDiagnostic => ({
  code: result.status === "timedOut" ? "CASE_TIMEOUT" : "OPERATION_FAILED",
  message: `케이스가 '${result.status}' 로 끝났지만 진단이 없습니다.`,
  hint: "runner 가 진단을 채우지 못한 경로입니다. --json 으로 보고서 원본을 확인하세요.",
});

function classify(result: TestCaseResult): CaseOutcome {
  if (result.status === "passed") return { kind: "passed" };
  if (result.status === "cancelled" || result.status === "notRun") return { kind: "skipped" };

  // 시간 초과와 작업 실패는 단언까지 가지도 못했다. 단언 불일치가 아니므로 error 다.
  if (result.status === "timedOut" || result.operation.status !== "completed") {
    return {
      kind: "error",
      diagnostics: [result.operation.diagnostic ?? fallbackDiagnostic(result)],
    };
  }

  const failed = result.assertions
    .filter((assertion) => assertion.status === "failed")
    .map((assertion) => assertion.diagnostic ?? fallbackDiagnostic(result));
  return {
    kind: "failure",
    diagnostics: failed.length > 0 ? failed : [fallbackDiagnostic(result)],
  };
}

/**
 * 진단 하나를 사람이 읽는 문단으로 만든다.
 *
 * `diagnostics.ts` 가 만든 문장을 그대로 쓴다. 여기서 문안을 새로 쓰지 않는다 — 터미널
 * 렌더러와 JUnit 이 서로 다른 문장을 내면 같은 실패가 두 얼굴을 갖게 된다.
 */
function diagnosticBody(diagnostic: RunnerDiagnostic): string {
  const lines: string[] = [diagnostic.message];

  if (diagnostic.expected !== undefined || diagnostic.actual !== undefined) {
    lines.push("");
    if (diagnostic.expected !== undefined) {
      lines.push(`expected: ${JSON.stringify(diagnostic.expected)}`);
    }
    if (diagnostic.actual !== undefined) {
      lines.push(`actual:   ${JSON.stringify(diagnostic.actual)}`);
    }
  }

  if (diagnostic.violations !== undefined && diagnostic.violations.length > 0) {
    lines.push("");
    for (const violation of diagnostic.violations) lines.push(violation.message);
  }

  lines.push("", `→ ${diagnostic.hint}`);
  return lines.join("\n");
}

/** 실패·오류 요소의 `message` 속성. 여러 건이면 첫 문장에 건수를 덧붙인다. */
function summaryMessage(diagnostics: RunnerDiagnostic[]): string {
  const first = diagnostics[0] as RunnerDiagnostic;
  return diagnostics.length > 1
    ? `${first.message} (외 ${diagnostics.length - 1}건)`
    : first.message;
}

function stopReasonText(stopReason: NonNullable<RunnerReport["stopReason"]>): string {
  if (stopReason.type === "timeout") {
    return `실행이 중단되었습니다: 케이스 '${stopReason.caseId}' 가 제한 시간을 넘겼습니다.`;
  }
  return stopReason.caseId === undefined
    ? "실행이 중단되었습니다: 외부 취소 신호(AbortSignal)를 받았습니다."
    : `실행이 중단되었습니다: 케이스 '${stopReason.caseId}' 에서 외부 취소 신호를 받았습니다.`;
}

/**
 * `RunnerReport` 를 JUnit XML 문자열로 만든다.
 *
 * 순수 함수다. `report` 와 `options` 만 읽는다. `process` · `Date` · 로케일 · 난수를 읽지
 * 않으므로 같은 인자에는 항상 같은 바이트를 낸다. 환경 판정과 파일 쓰기는 호출자(`cli`)의 몫이다.
 */
export function renderJUnit(report: RunnerReport, options?: JUnitRenderOptions): string {
  const outcomes = report.cases.map((result) => [result, classify(result)] as const);
  const count = (kind: CaseOutcome["kind"]): number =>
    outcomes.filter(([, outcome]) => outcome.kind === kind).length;

  const counters =
    `tests="${report.cases.length}"` +
    ` failures="${count("failure")}"` +
    ` errors="${count("error")}"` +
    ` skipped="${count("skipped")}"` +
    ` time="${TIME}"`;

  const suiteName = escapeAttribute(options?.suiteName ?? report.suite.name);
  const className = escapeAttribute(report.suite.id);

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${suiteName}" ${counters}>`,
    `  <testsuite name="${suiteName}" ${counters}>`,
  ];

  for (const [result, outcome] of outcomes) {
    const open =
      `    <testcase name="${escapeAttribute(result.spec.name)}"` +
      ` classname="${className}" time="${TIME}"`;

    if (outcome.kind === "passed") {
      lines.push(`${open}/>`);
      continue;
    }

    lines.push(`${open}>`);
    if (outcome.kind === "skipped") {
      lines.push("      <skipped/>");
    } else {
      const tag = outcome.kind === "failure" ? "failure" : "error";
      const message = escapeAttribute(summaryMessage(outcome.diagnostics));
      const type = escapeAttribute(outcome.diagnostics[0]?.code ?? "");
      const body = outcome.diagnostics.map(diagnosticBody).join("\n\n");
      lines.push(`      <${tag} message="${message}" type="${type}">`);
      lines.push(escapeText(body));
      lines.push(`      </${tag}>`);
    }
    lines.push("    </testcase>");
  }

  if (report.stopReason !== undefined) {
    lines.push(`    <system-out>${escapeText(stopReasonText(report.stopReason))}</system-out>`);
  }

  lines.push("  </testsuite>", "</testsuites>", "");
  return lines.join("\n");
}

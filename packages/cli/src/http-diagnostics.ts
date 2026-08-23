/**
 * 원격(Streamable HTTP) 서버 진단 블록 렌더러.
 * `process-diagnostics.ts` 와 같은 계열이고 같은 규칙을 따른다 — 순수 함수만 두고
 * process, Date, 파일 시스템을 읽지 않는다(ADR-0013).
 *
 * 이 모듈이 있는 이유는 ADR-0020 이다. 그 결정이 진단을 transport 별 유니온으로 나누면서
 * HTTP 쪽에 `url` · `status` · `statusText` · `sessionId` 를 실었는데, CLI 에 받는 자리가
 * 없어 그 값이 통째로 버려지고 있었다. stdio 용 `processDiagnostics` 구조 가드는 HTTP
 * 진단을 `undefined` 로 떨어뜨리므로, 배선만 하고 이 모듈을 안 만들면 원격 서버 실패는
 * **아무 진단도 없이** 끝난다.
 */

/** core 의 McpHttpDiagnostics 와 구조가 같다. core 를 import 하지 않는다. */
export interface HttpDiagnosticsInput {
  /** 자격증명이 제거된 정규화 URL. core 가 헤더는 여기에 싣지 않는다. */
  readonly url: string;
  /** 관측된 HTTP 상태 코드. 네트워크 단계에서 실패했거나 아직 실패한 적이 없으면 null. */
  readonly status: number | null;
  readonly statusText: string | null;
  /** 서버가 발급한 Mcp-Session-Id. stateless 서버면 null. */
  readonly sessionId: string | null;
}

/**
 * core 의 HTTP 진단인지 구조와 값의 범위로 확인한다.
 *
 * stdio 진단은 `url` 이 없으므로 여기서 `undefined` 로 떨어진다. 반대로 HTTP 진단은
 * `stderr` 가 없어 `processDiagnostics` 에서 떨어진다. 두 가드가 서로를 배제하는 것이
 * 이 쌍의 요점이다 — 한쪽 블록이 다른 쪽 transport 의 값을 그리면 화면이 거짓말을 한다.
 */
export function httpDiagnostics(value: unknown): HttpDiagnosticsInput | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("url" in value) || typeof value.url !== "string" || value.url === "") return undefined;
  if (
    !("status" in value) ||
    !(
      value.status === null ||
      (typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 0)
    )
  )
    return undefined;
  if (
    !("statusText" in value) ||
    !(value.statusText === null || typeof value.statusText === "string")
  )
    return undefined;
  if (!("sessionId" in value) || !(value.sessionId === null || typeof value.sessionId === "string"))
    return undefined;
  return value as HttpDiagnosticsInput;
}

/**
 * 터미널 제어 문자를 무해한 문자열로 바꾼다.
 *
 * `process-diagnostics.ts` 의 `escapeTokens` 와 같은 계열이되 **TAB 도 이스케이프한다.**
 * 그쪽이 TAB 을 살려 두는 이유는 서버 stderr 의 스택 트레이스 들여쓰기였는데, 여기서
 * 그리는 값은 URL 과 상태 문구와 세션 ID 다. 셋 다 TAB 이 들어갈 자리가 아니다.
 *
 * 사본을 두는 근거는 `process-diagnostics.ts` 와 같다(ADR-0013).
 */
function escapeTerminalText(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    // 0x7f..0x9f 는 DEL 과 C1 제어 문자다. U+009B 를 8비트 CSI 로 해석하는 터미널이 있다.
    return codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");
}

/**
 * 값 하나가 지나치게 길 때 자른다. URL 은 사용자가 준 값이고 세션 ID 는 서버가 준 값이라
 * 둘 다 길이에 상한이 없다. `process-diagnostics.ts` 의 `MAX_LINE_CHARACTERS` 와 같은 값이다.
 */
const MAX_VALUE_CHARACTERS = 1000;

function clamp(value: string): string {
  const escaped = escapeTerminalText(value);
  if (escaped.length <= MAX_VALUE_CHARACTERS) return escaped;
  return `${escaped.slice(0, MAX_VALUE_CHARACTERS)} …(${escaped.length - MAX_VALUE_CHARACTERS}자 생략)`;
}

/**
 * 블록에 담을 내용이 있는지 판정한다. `process-diagnostics.ts` 의 `hasDiagnosticContent` 와
 * 같은 자리에 쓴다.
 *
 * **`status !== null` 이 곧 "실패를 관측했다" 이다.** core 의 `HttpConnectionState` 는 상태
 * 코드를 실패 경로(`toConnectError` · `operationFailureKind`)에서만 채운다. 성공한 실행은
 * 끝까지 null 이므로, 이 판정 없이 그리면 초록불 뒤에 매번 빈 진단 블록이 붙는다.
 *
 * 연결 자체가 실패한 경로는 이 판정을 거치지 않는다. 그때는 상태 코드가 없어도(DNS 실패,
 * 연결 거부) **어느 엔드포인트에 붙으려다 실패했는지**가 정보이고, HTTP 진단에는 stderr 처럼
 * 비어 있을 수 있는 본문이 없어 "정보량 0인 블록" 이 나올 수가 없다.
 */
export function hasHttpDiagnosticContent(diagnostics: HttpDiagnosticsInput): boolean {
  return diagnostics.status !== null;
}

/**
 * 진단 블록을 만든다. 빈 문자열이 아니면 항상 개행으로 끝난다.
 *
 * 상태 코드가 없을 때 `(없음)` 이라고 쓰지 않는다. stdio 의 `종료 코드: 없음` 은 "아직 안
 * 죽었다" 라는 사실이지만, HTTP 에서 상태 코드가 없는 것은 **응답에 닿지 못했다**는 뜻이라
 * 뜻이 정반대다. 같은 문구를 쓰면 읽는 사람이 서버가 200 을 줬다고 읽는다.
 */
export function renderHttpDiagnostics(diagnostics: HttpDiagnosticsInput): string {
  const status =
    diagnostics.status === null
      ? "응답에 닿지 못했습니다"
      : diagnostics.statusText === null
        ? String(diagnostics.status)
        : `${diagnostics.status} ${clamp(diagnostics.statusText)}`;
  // 세션 ID 는 stateless 서버면 없는 것이 정상이다. 없다는 사실 자체가 진단이므로 줄을
  // 지우지 않고 "발급하지 않음" 이라고 적는다 — 세션 상실(404)을 쫓을 때 필요한 값이다.
  const sessionId =
    diagnostics.sessionId === null ? "발급하지 않음 (stateless)" : clamp(diagnostics.sessionId);
  return (
    "원격 서버 진단\n" +
    `  엔드포인트: ${clamp(diagnostics.url)}\n` +
    `  HTTP 상태: ${status}\n` +
    `  세션 ID: ${sessionId}\n`
  );
}

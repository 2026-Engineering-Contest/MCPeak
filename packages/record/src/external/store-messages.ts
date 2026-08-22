import type { NormalizedExternalRequest } from "./protocol.js";

/**
 * `SessionStore` 구현들이 함께 쓰는 오류 문구다.
 *
 * 메모리 구현과 SQLite 구현이 각자 문장을 들고 있으면, 사용자가 보는 실패 메시지가 저장
 * 매체에 따라 달라진다. 저장 매체는 사용자가 고르는 것이고 진단은 같아야 하므로 여기 모은다.
 * 계약 테스트(`session-store-contract.test.ts`)가 두 구현에 같은 단언을 돌리는 것도 같은 이유다.
 */

export const sessionNotFound = (sessionId: string): string =>
  `External session '${sessionId}'을 찾지 못했습니다.`;

export const sessionAlreadyExists = (sessionId: string): string =>
  `External session '${sessionId}'이 이미 존재합니다. 기존 세션을 덮어쓰지 않습니다.`;

export const sessionNotRunning = (sessionId: string): string =>
  `External session '${sessionId}'이 실행 중이 아닙니다.`;

export const replaySourceInvalid = (sessionId: string): string =>
  `External session '${sessionId}'은 완료된 Replay 원본이 아닙니다.`;

export const concurrentMatch =
  "같은 외부 요청의 동시 호출은 현재 지원하지 않습니다. 앞 호출이 끝난 뒤 다시 시도하세요.";

export const interactionNotFound = "완료할 External interaction을 찾지 못했습니다.";

export const interactionAlreadyComplete = "External interaction이 이미 완료됐습니다.";

/**
 * 미완료 interaction 이 남은 채 세션을 닫으려 할 때의 문구.
 *
 * 어떤 호출이 걸렸는지 말해 주지 않으면 사용자는 서버 코드 전체를 뒤져야 한다. 지원하지
 * 않는 응답(비-JSON·redirect)에서 이 경로로 오는 것이 가장 흔하다. `display` 는 마스킹된
 * 쪽이라 그대로 내보내도 안전하다(ADR-0053).
 */
export function incompleteSession(
  sessionId: string,
  incomplete: readonly { readonly request: NormalizedExternalRequest }[],
): string {
  const listed = incomplete
    .slice(0, 3)
    .map((item) => `  - ${item.request.display.method} ${item.request.display.url}`)
    .join("\n");
  const rest = incomplete.length > 3 ? `\n  ... 외 ${incomplete.length - 3}건` : "";
  return (
    `External session '${sessionId}'에 완료되지 않은 외부 호출이 ${incomplete.length}건 있습니다.\n` +
    `${listed}${rest}\n` +
    "→ 지원하지 않는 응답(비-JSON·redirect)을 받으면 그 호출은 저장하지 않고 세션을 실패로 둡니다.\n" +
    "→ 해당 endpoint가 JSON을 돌려주는지 확인하거나, 그 호출을 녹화 범위에서 빼세요."
  );
}

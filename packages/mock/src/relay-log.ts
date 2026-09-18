/**
 * 중계기 기록 줄의 문안. **순수 함수만 둔다** — 시간·난수·I/O·전역 상태가 없다.
 *
 * 이 파일이 따로 있는 이유는 테스트가 stderr 를 파싱하지 않고 문안을 직접 보기
 * 위해서다. `startRelay` 는 `log(line)` 을 주입받아 이 함수들의 결과를 흘린다.
 *
 * 문안 규칙 세 가지는 설계(§4 「기록 채널」)가 못박은 것이다.
 *   1. 인자는 줄이지 않는다 — 무엇을 보냈는지가 이 화면의 존재 이유다.
 *   2. 오류는 진짜 서버가 준 코드·메시지를 그대로 쓴다. 고쳐 쓰지 않는다.
 *   3. 시간은 `ms` 한 곳에만 둔다 — 결정론성 규칙에 걸리는 유일한 필드다.
 */

export interface RelayRequestEvent {
  /** 중계기가 매긴 id. 클라이언트의 id 가 아니다 — 세션 둘이 같은 값을 쓴다. */
  readonly id: number;
  readonly method: string;
  readonly tool?: string;
  readonly args?: unknown;
}

export type RelayResponseEvent = {
  readonly id: number;
  readonly method: string;
  readonly tool?: string;
  readonly ms: number;
} & (
  | { readonly kind: "ok"; readonly bytes: number; readonly toolCount?: number }
  | { readonly kind: "toolError"; readonly bytes: number }
  | { readonly kind: "protocolError"; readonly code: number; readonly message: string }
);

/**
 * 세 자리마다 쉼표를 넣는다. `toLocaleString` 을 쓰지 않는 이유는 로케일에 따라
 * 결과가 달라지기 때문이다 — 같은 입력에 같은 출력이 이 저장소의 핵심 가치다.
 */
export function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}초`;
}

export function humanRequest(event: RelayRequestEvent): string {
  const head = `→ ${event.method}`;
  if (event.tool === undefined) return head;
  const args = event.args === undefined ? "" : ` ${JSON.stringify(event.args)}`;
  return `${head}  ${event.tool}${args}`;
}

export function humanResponse(event: RelayResponseEvent): string {
  const label = event.tool === undefined ? `← ${event.method}` : `← ${event.method}  ${event.tool}`;
  if (event.kind === "protocolError") {
    return `${label} 오류 ${event.code} ${event.message}`;
  }
  if (event.kind === "ok" && event.toolCount !== undefined) {
    return `${label}  툴 ${event.toolCount}개`;
  }
  const verdict = event.kind === "ok" ? "성공" : "툴 오류";
  return `${label} ${verdict} · ${groupDigits(event.bytes)}바이트 · ${formatSeconds(event.ms)}`;
}

export function jsonRequest(event: RelayRequestEvent): string {
  // 키 순서를 리터럴로 고정한다. 조건부 전개라 순서가 흔들리면 4 단계의 스냅샷
  // 비교가 이유 없이 깨진다.
  return JSON.stringify({
    dir: "req",
    id: event.id,
    method: event.method,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
    ...(event.args === undefined ? {} : { args: event.args }),
  });
}

export function jsonResponse(event: RelayResponseEvent): string {
  const head = {
    dir: "res" as const,
    id: event.id,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
  };
  if (event.kind === "protocolError") {
    return JSON.stringify({
      ...head,
      ok: false,
      code: event.code,
      message: event.message,
      ms: event.ms,
    });
  }
  if (event.kind === "toolError") {
    return JSON.stringify({ ...head, ok: false, isError: true, bytes: event.bytes, ms: event.ms });
  }
  return JSON.stringify({
    ...head,
    ok: true,
    ...(event.toolCount === undefined ? {} : { tools: event.toolCount }),
    bytes: event.bytes,
    ms: event.ms,
  });
}

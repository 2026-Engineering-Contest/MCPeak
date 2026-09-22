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
  /**
   * 대시보드가 URL(`?case=<id>`)로 실어 보낸 케이스 꼬리표. **터미널 사용에는 없다.**
   *
   * 중계기가 stateless 라 접속을 구분할 식별자가 없다(`relay-server.ts` 의
   * `sessionIdGenerator: undefined`). 동시 실행에서 케이스를 가르는 유일한 축이다.
   */
  readonly case?: string;
}

export type RelayResponseEvent = {
  readonly id: number;
  readonly method: string;
  readonly tool?: string;
  readonly ms: number;
  /** `RelayRequestEvent.case` 와 같다 — 짝지은 요청의 꼬리표를 그대로 옮긴다. */
  readonly case?: string;
} & (
  | {
      readonly kind: "ok";
      readonly bytes: number;
      readonly toolCount?: number;
      /**
       * JSON-RPC `result` **전체**. `content` 와 `structuredContent` 가 같이 들어 있다.
       *
       * AI 경유로는 `structuredContent` 가 오지 않는다(설계 §3 실측). 사용자가 자기 서버
       * 답의 반쪽만 보게 되므로 중계기가 직접 싣는다. **줄이지 않는다** — 접는 것은 화면이
       * 할 일이고, 관찰 채널의 충실성이 여기서는 먼저다(설계 §2-6).
       */
      readonly body: unknown;
    }
  | { readonly kind: "toolError"; readonly bytes: number; readonly body: unknown }
  // `protocolError` 에는 `body` 가 없다. 서버가 결과를 준 적이 없어 지어낼 것이 없다 —
  // "오류는 진짜 서버가 준 것만 쓴다" 를 타입이 지키게 한다.
  | { readonly kind: "protocolError"; readonly code: number; readonly message: string }
);

/**
 * 중계기가 **버린** 서버발 메시지 하나. 자식이 먼저 건 요청·알림이다.
 *
 * `id`·`ms` 가 없다. 중계기가 id 를 매긴 적이 없고(우리가 보낸 것이 아니다), 짝지을 응답이
 * 없어 걸린 시간도 없다. 그래서 요청·응답 이벤트와 같은 타입에 얹지 않고 따로 둔다.
 */
export interface RelayDropEvent {
  readonly method: string;
  /** `id` 가 있으면 요청, 없으면 알림이다. 문장이 갈리는 유일한 축이다. */
  readonly kind: "request" | "notification";
}

/**
 * 꼬리표 길이 상한. 케이스 id 는 화면 칸 제목에 쓰이는 짧은 식별자다 — 이보다 길면
 * 그것은 id 가 아니라 누가 URL 에 딴 것을 실은 것이다.
 */
export const MAX_CASE_TAG = 200;

/**
 * 제어문자. **기록 채널이 줄 단위라** 개행이 섞이면 대시보드의 줄 파서가 없던 줄을
 * 하나 더 본다. `JSON.stringify` 가 이스케이프하므로 지금 통로로는 새지 않지만, 거르는
 * 자리는 값이 들어오는 지점 한 곳에 둔다.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자를 걸러내는 것이 이 정규식의 목적이다.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * URL 쿼리의 `case` 꼬리표. 순수 함수 — 길이·문자 상한을 건다.
 *
 * **허용 문자를 kebab-case 로 좁히지 않는다.** `cases[].id` 는 스위트 스키마에서
 * `nonEmptyString` 뿐이라 한글·공백 id 가 적법하고(실측: `packages/runner/src/spec/json-schema.ts`),
 * 좁히면 멀쩡한 케이스의 꼬리표가 조용히 사라져 화면이 칸을 못 가른다. 거르는 것은
 * **줄 단위 채널을 깨는 것**(제어문자)과 **id 가 아닌 크기**(상한) 둘뿐이다.
 *
 * 버릴 때 오류를 던지지 않는다 — 꼬리표는 화면을 나누는 편의이고, 없으면 칸이 하나로
 * 합쳐질 뿐 중계 자체는 정상이다. 중계기가 사용자의 요청을 거절할 이유가 되지 않는다.
 */
export function readCaseTag(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  let value: string | null;
  try {
    // `req.url` 은 경로+쿼리라 절대 URL 이 아니다. 기준이 필요하고, 그 기준은 버려지므로
    // 어떤 값이든 결과에 영향이 없다.
    value = new URL(url, "http://127.0.0.1").searchParams.get("case");
  } catch {
    return undefined;
  }
  if (value === null || value === "") return undefined;
  if (value.length > MAX_CASE_TAG) return undefined;
  if (CONTROL_CHARS.test(value)) return undefined;
  return value;
}

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

/**
 * 버린 것을 사람이 읽는 줄. 서버에서 온 것이므로 `←` 다.
 *
 * **무엇을 버렸는지로 끝내지 않고 그 결과까지 적는다.** 서버가 먼저 건 요청은 서버가
 * 응답을 기다리고 있다는 뜻이라, 그 줄이 없으면 사용자는 자기 서버가 멈춘 이유를 알
 * 방법이 없다 — 중계기의 기록이 유일한 관찰 채널이다(설계 §3). 알림은 기다리는 쪽이
 * 없으므로 괄호를 달지 않는다.
 */
export function humanDrop(event: RelayDropEvent): string {
  return event.kind === "request"
    ? `← ${event.method}  버림 · 서버가 먼저 거는 요청은 중계하지 않습니다 (서버는 응답을 기다립니다)`
    : `← ${event.method}  버림 · 서버가 보내는 알림은 중계하지 않습니다`;
}

export function jsonRequest(event: RelayRequestEvent): string {
  // 키 순서를 리터럴로 고정한다. 조건부 전개라 순서가 흔들리면 4 단계의 스냅샷
  // 비교가 이유 없이 깨진다.
  return JSON.stringify({
    dir: "req",
    id: event.id,
    method: event.method,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
    ...(event.case === undefined ? {} : { case: event.case }),
    ...(event.args === undefined ? {} : { args: event.args }),
  });
}

export function jsonResponse(event: RelayResponseEvent): string {
  const head = {
    dir: "res" as const,
    id: event.id,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
    ...(event.case === undefined ? {} : { case: event.case }),
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
    return JSON.stringify({
      ...head,
      ok: false,
      isError: true,
      bytes: event.bytes,
      ms: event.ms,
      body: event.body,
    });
  }
  // `body` 를 맨 뒤에 둔다. 키 순서를 리터럴로 고정하면서 **큰 값이 줄 끝에 오게** 하는
  // 것이다 — 사람이 `--json` 줄을 눈으로 훑을 때 머리 필드들이 먼저 보인다.
  return JSON.stringify({
    ...head,
    ok: true,
    ...(event.toolCount === undefined ? {} : { tools: event.toolCount }),
    bytes: event.bytes,
    ms: event.ms,
    body: event.body,
  });
}

export function jsonDrop(event: RelayDropEvent): string {
  // 키 순서를 리터럴로 고정한다 — `jsonRequest` 와 같은 이유다. `dir` 이 `req`·`res` 가
  // 아닌 세 번째 값이라, 4 단계가 이 줄을 요청·응답으로 세지 않게 하는 것도 이 필드다.
  return JSON.stringify({ dir: "drop", kind: event.kind, method: event.method });
}

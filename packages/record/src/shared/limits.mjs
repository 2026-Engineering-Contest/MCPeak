/**
 * 크기 상한 — **자식(`.mjs`)과 부모(`.ts`)가 같은 값을 봐야 하므로 여기 한 곳에 둔다.**
 *
 * 한때 `protocol.ts` 와 `child/coordinator-client.mjs` 가 각자 `2 * 1024 * 1024` 를 적어
 * 두고 있었다. 한쪽만 고치면 자식은 보내고 부모는 거절하는 상태가 되는데, 그때 나오는
 * 오류는 413 뿐이라 원인이 상한 불일치라는 것을 알 수 없다.
 */

/** 요청·응답 body 하나의 상한. */
export const MAX_HTTP_BODY_BYTES = 1024 * 1024;

/**
 * Coordinator 요청·응답 payload 상한.
 *
 * **HTTP body 상한의 2배에서 출발한다.** `begin` payload 는 정규화한 body 를 `match` 와
 * `display` 에 각각 한 번씩, 즉 **두 번** 싣기 때문이다. 여기에 method·URL·헤더·matchKey
 * 같은 메타데이터 여유를 더한다.
 *
 * 이 관계를 무시하고 2 MiB 로 고정해 두면, HTTP 상한을 통과한 1 MiB body 가 Coordinator
 * 에서 `PAYLOAD_TOO_LARGE` 로 죽는다(실측 2,097,473 바이트 — 상한을 321 바이트 초과).
 * 사용자 입장에서는 "지원한다고 한 크기인데 안 된다" 가 된다.
 */
export const MAX_COORDINATOR_PAYLOAD_BYTES = 2 * MAX_HTTP_BODY_BYTES + 128 * 1024;

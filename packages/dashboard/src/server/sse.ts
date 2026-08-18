import type { RunEvent } from "../api-types.js";

/**
 * SSE 직렬화 유틸. 한 이벤트가 `id:`와 `data:`를 가진 한 덩어리다.
 *
 * id는 RunRecord가 이벤트 발생 순서로 붙인 값이다. 같은 이벤트 배열은 항상 같은
 * id와 바이트를 내므로 Last-Event-ID 재연결도 결정론적이다.
 */
export function formatSseEvent(event: RunEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** 과거 이벤트 전체 선전송용. 순서를 그대로 유지한 채 이어 붙인다. */
export function formatSseEvents(events: readonly RunEvent[]): string {
  return events.map(formatSseEvent).join("");
}

/**
 * SSE 응답 헤더. 프록시·브라우저가 스트림을 버퍼링하거나 캐시하지 않게 고정한다.
 * 상수라 응답마다 값이 흔들리지 않는다.
 */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

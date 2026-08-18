import type { RunEvent } from "../api-types.js";

/**
 * SSE 직렬화 유틸. 한 이벤트가 `data: <JSON>\n\n` 한 덩어리다.
 *
 * 여기에는 타임스탬프나 일련번호처럼 호출 시점마다 달라지는 값을 절대 넣지 않는다.
 * 같은 이벤트 배열이면 같은 바이트가 나와야 늦은 구독자에게 과거 이벤트를 다시
 * 흘려보낸 결과가 처음 흘려보낸 결과와 같아진다. 재생 결정론이 그 위에 선다.
 */
export function formatSseEvent(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
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

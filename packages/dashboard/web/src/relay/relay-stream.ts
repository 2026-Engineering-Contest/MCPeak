import { useEffect, useState } from "react";
import type { RelayEvent } from "../../../src/api-types.js";

/**
 * `GET /api/relay/:id/events` 를 구독한다. `run-stream.ts` 와 같은 모양이되 **훨씬 작다** —
 * 중계 세션에는 질문도 상태 전이도 없고, 이벤트가 곧 화면이다.
 *
 * **주기 폴링을 하지 않는다.** 타이머는 결정론성을 흔든다(ADR-0072 와 같은 판단).
 */
export function useRelayEvents(relayId: string | null): readonly RelayEvent[] {
  const [events, setEvents] = useState<readonly RelayEvent[]>([]);

  useEffect(() => {
    setEvents([]);
    if (relayId === null) return;
    const source = new EventSource(`/api/relay/${encodeURIComponent(relayId)}/events`);
    source.onmessage = (message: MessageEvent<string>): void => {
      const event = JSON.parse(message.data) as RelayEvent;
      // 재연결로 같은 id 가 두 번 올 수 있다. 중복을 여기서 거른다.
      setEvents((previous) =>
        previous.some((received) => received.id === event.id) ? previous : [...previous, event],
      );
    };
    return (): void => source.close();
  }, [relayId]);

  return events;
}

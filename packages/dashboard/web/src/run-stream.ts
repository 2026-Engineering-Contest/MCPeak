import { useEffect, useState } from "react";
import type { PendingQuestion, RunEvent, RunStatus } from "../../src/api-types.js";

export interface RunEventsState {
  readonly events: readonly RunEvent[];
  readonly status: RunStatus | null;
  readonly pendingQuestion: PendingQuestion | null;
}

const INITIAL_STATE: RunEventsState = {
  events: [],
  status: null,
  pendingQuestion: null,
};

/**
 * `GET /api/runs/:id/events` SSE를 구독해 이벤트를 순서대로 쌓는다.
 *
 * `runId`가 null이면 구독하지 않는다(EventSource를 만들지 않는다). `pendingQuestion`은
 * 새 `question` 이벤트로 교체되거나 `done` 이벤트가 올 때만 비운다. `stdout`/`stderr`로는
 * 비우지 않는다. question과 answer 사이에 우연히 stdout/stderr 한 줄이 끼어들면
 * 패널이 사라져 응답 불가 상태로 멈추는 문제가 있었기 때문이다(질문에 대한 답은
 * `QuestionPanel`이 POST 성공 시 자신의 로컬 state로 감춘다). `done` 이벤트는 status를
 * exitCode에 따라 done/failed로 바꾼다.
 */
export function useRunEvents(runId: string | null): RunEventsState {
  const [state, setState] = useState<RunEventsState>(INITIAL_STATE);

  useEffect(() => {
    setState(INITIAL_STATE);

    if (runId === null) {
      return;
    }

    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);

    source.onmessage = (message: MessageEvent<string>): void => {
      const event = JSON.parse(message.data) as RunEvent;

      setState((previous) => {
        const events = [...previous.events, event];

        if (event.kind === "question") {
          return { events, status: "waiting-input", pendingQuestion: event.question };
        }

        if (event.kind === "done") {
          const status: RunStatus = event.exitCode === 0 ? "done" : "failed";
          return { events, status, pendingQuestion: null };
        }

        // stdout/stderr는 pendingQuestion을 건드리지 않는다. 질문과 답 사이에 낀 출력
        // 한 줄이 패널을 지워 응답 불가 상태로 만드는 일을 막는다.
        return { events, status: "running", pendingQuestion: previous.pendingQuestion };
      });
    };

    return (): void => {
      source.close();
    };
  }, [runId]);

  return state;
}

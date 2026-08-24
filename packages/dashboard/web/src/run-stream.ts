import { useEffect, useState } from "react";
import type { PendingQuestion, RunEvent, RunStatus, RunSummary } from "../../src/api-types.js";
import { apiGet } from "./api.js";

export interface RunEventsState {
  readonly events: readonly RunEvent[];
  readonly status: RunStatus | null;
  readonly pendingQuestion: PendingQuestion | null;
  /** 스트림이 붙지 못했거나 끊겼을 때 화면에 그대로 보여줄 문장. null이면 정상. */
  readonly error: string | null;
}

const INITIAL_STATE: RunEventsState = {
  events: [],
  status: null,
  pendingQuestion: null,
  error: null,
};

/** summary.status 검증용. 서버가 모르는 값을 주면 status를 seed하지 않는다. */
const RUN_STATUSES: ReadonlySet<string> = new Set<RunStatus>([
  "running",
  "waiting-input",
  "done",
  "failed",
]);

/** `EventSource.CLOSED`. 테스트의 fake가 정적 상수를 안 가질 수 있어 숫자로 둔다. */
const EVENT_SOURCE_CLOSED = 2;

/**
 * `GET /api/runs/:id/events` SSE를 구독해 이벤트를 순서대로 쌓는다.
 *
 * `runId`가 null이면 구독하지 않는다(EventSource를 만들지 않는다). `pendingQuestion`은
 * 새 `question` 이벤트로 교체되거나 `done` 이벤트가 올 때만 비운다. `stdout`/`stderr`로는
 * 비우지 않는다. question과 answer 사이에 우연히 stdout/stderr 한 줄이 끼어들면
 * 패널이 사라져 응답 불가 상태로 멈추는 문제가 있었기 때문이다(질문에 대한 답은
 * `QuestionPanel`이 POST 성공 시 자신의 로컬 state로 감춘다). `done` 이벤트는 status를
 * exitCode에 따라 done/failed로 바꾼다.
 *
 * status는 이벤트만으로 만들지 않고 `GET /api/runs/:id`의 summary로 공백을 메운다(#295).
 * `mcpeak test`는 끝날 때까지 stdout이 없어, 이벤트만 기다리면 실행 내내 status가
 * null("대기")로 남기 때문이다. summary는 status가 아직 null일 때만 반영한다 —
 * SSE가 이미 정한 status를 늦게 도착한 응답이 되돌리면 안 된다.
 */
export function useRunEvents(runId: string | null): RunEventsState {
  const [state, setState] = useState<RunEventsState>(INITIAL_STATE);

  useEffect(() => {
    setState(INITIAL_STATE);

    if (runId === null) {
      return;
    }

    let disposed = false;
    const summaryPath = `/api/runs/${encodeURIComponent(runId)}`;

    function reportError(message: string): void {
      if (disposed) return;
      setState((previous) =>
        previous.error === null ? { ...previous, error: message } : previous,
      );
    }

    void apiGet<RunSummary>(summaryPath)
      .then((summary) => {
        if (disposed || !RUN_STATUSES.has(summary.status)) return;
        setState((previous) =>
          previous.status === null ? { ...previous, status: summary.status } : previous,
        );
      })
      .catch(() => {
        // 조회 실패의 보고는 onerror 몫이다. run이 없으면 스트림도 붙지 못한다.
      });

    const source = new EventSource(`${summaryPath}/events`);

    source.onmessage = (message: MessageEvent<string>): void => {
      const event = JSON.parse(message.data) as RunEvent;

      setState((previous) => {
        if (previous.events.some((received) => received.id === event.id)) return previous;
        const events = [...previous.events, event];

        if (event.kind === "question") {
          return { ...previous, events, status: "waiting-input", pendingQuestion: event.question };
        }

        if (event.kind === "done") {
          const status: RunStatus = event.exitCode === 0 ? "done" : "failed";
          return { ...previous, events, status, pendingQuestion: null };
        }

        // stdout/stderr는 pendingQuestion을 건드리지 않는다. 질문과 답 사이에 낀 출력
        // 한 줄이 패널을 지워 응답 불가 상태로 만드는 일을 막는다.
        return { ...previous, events, status: "running" };
      });
    };

    // 스트림 실패를 조용히 버리지 않는다(#295). EventSource는 일시 단절이면 스스로
    // 재접속하므로(CONNECTING) 재시도가 없는 CLOSED만 알린다. 실패 응답의 본문은
    // EventSource가 보여주지 않으니 summary를 다시 조회해 원인을 가려낸다.
    source.onerror = (): void => {
      if (source.readyState !== EVENT_SOURCE_CLOSED) return;
      void apiGet<RunSummary>(summaryPath)
        .then(() => {
          reportError(
            "이벤트 스트림 연결이 끊겼습니다. 페이지를 새로 고치면 지난 출력부터 다시 받아옵니다.",
          );
        })
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          reportError(
            `${reason} 실행 이력은 대시보드 서버 메모리에만 있어 서버를 재시작하면 사라집니다. ` +
              "Runs 목록에서 현재 존재하는 run을 확인하세요.",
          );
        });
    };

    return (): void => {
      disposed = true;
      source.close();
    };
  }, [runId]);

  return state;
}

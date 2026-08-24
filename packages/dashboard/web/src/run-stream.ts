import { useEffect, useState } from "react";
import type { PendingQuestion, RunEvent, RunStatus, RunSummary } from "../../src/api-types.js";
import { ApiRequestError, apiGet } from "./api.js";

export interface RunEventsState {
  readonly events: readonly RunEvent[];
  readonly status: RunStatus | null;
  readonly pendingQuestion: PendingQuestion | null;
  /**
   * 스트림이 붙지 못한 이유. 서버가 준 문장에 서버가 알 수 없는 맥락을 덧붙인 것이다.
   * 정상이면 null 이고, **성공 경로는 이 값을 건드리지 않는다** — 두 요청의 도착 순서에
   * 화면이 좌우되면 안 된다.
   */
  readonly error: string | null;
}

const INITIAL_STATE: RunEventsState = {
  events: [],
  status: null,
  pendingQuestion: null,
  error: null,
};

/**
 * `EventSource.CLOSED`. 스펙 고정값(2)이라 상수로 둔다. 전역 `EventSource` 를 스텁하는
 * 테스트가 그 static 을 갖지 않을 수 있고, 그러면 `undefined !== undefined` 가 false 라
 * 판정이 조용히 뒤집힌다.
 */
const EVENT_SOURCE_CLOSED = 2;

/**
 * 서버가 준 "그런 run이 없습니다." 뒤에 서버가 알 수 없는 두 줄을 덧붙인다.
 *
 * 화면 컨트롤 이름을 부르지 않는다. 이 패널은 `RunView` 와 `RepairReview` 두 화면이
 * 공유하는데 후자에는 `← Runs` 링크가 없다 — 없는 버튼을 누르라고 하는 실패 메시지가 된다.
 */
const MISSING_RUN_HINT =
  "→ 대시보드는 실행 이력을 메모리에만 둡니다. 서버를 다시 시작했다면 이전 run 은 남아 있지 않습니다.\n" +
  "→ 홈 화면의 최근 실행 목록에서 살아 있는 run 을 고르거나, 새 실행을 시작하세요.";

/**
 * 404 가 아닌 실패 — 5xx, 네트워크 오류, 본문 파싱 실패 등. **이 경우 run 이 없다고 말하면
 * 안 된다.** run 은 살아 있는데 조회만 실패한 것일 수 있고, 그러면 안내가 거짓이 된다.
 * 우리가 아는 것은 "확인하지 못했다" 뿐이다.
 */
const STATUS_UNKNOWN_HINT =
  "→ 실행 상태를 확인하지 못했습니다. run 이 없다는 뜻은 아닙니다.\n" +
  "→ 아래 터미널 출력은 계속 받습니다. 새로고침하면 상태를 다시 물어봅니다.";

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
 * **이벤트만으로는 상태를 알 수 없다**(#296 아님, #295). `mcpeak test` 는 끝날 때까지
 * stdout 을 뱉지 않으므로 실행 내내 SSE 이벤트가 0건이고, 그동안 status 가 null 이라
 * 화면이 도는 run 과 없는 run 을 똑같이 그렸다. 그래서 구독 직전에 서버 summary 를 한 번
 * 읽는다. **주기 폴링은 하지 않는다** — 타이머는 결정론성을 흔든다. running→waiting-input
 * →done 전이는 전부 SSE 로 오므로 한 번이면 된다. ADR-0072.
 */
export function useRunEvents(runId: string | null): RunEventsState {
  const [state, setState] = useState<RunEventsState>(INITIAL_STATE);

  useEffect(() => {
    setState(INITIAL_STATE);

    if (runId === null) {
      return;
    }

    // 파라미터의 좁힘은 콜백 안에서 유지되지 않는다. const 로 받아 쓴다.
    const id = runId;
    let cancelled = false;

    /**
     * 서버가 이미 아는 것을 물어본다. 두 자리에서만 부른다 — 마운트 직후 1회, 그리고
     * 스트림이 **영구 실패**했을 때 1회.
     *
     * 성공하면 status 가 아직 비어 있을 때만 채운다. SSE 이벤트가 먼저 도착해 상태를
     * 세웠다면 그쪽이 더 새 정보다. 실패하면 서버 문장을 그대로 화면으로 옮긴다.
     */
    const refresh = async (): Promise<void> => {
      try {
        const summary = await apiGet<RunSummary>(`/api/runs/${encodeURIComponent(id)}`);
        if (cancelled) return;
        setState((previous) =>
          previous.status === null ? { ...previous, status: summary.status } : previous,
        );
      } catch (caught: unknown) {
        if (cancelled) return;
        const reason = caught instanceof Error ? caught.message : String(caught);
        // 404 만 "없다" 로 읽는다. `apiGet` 은 모든 non-OK 에서 reject 하므로 상태를 안 보면
        // 5xx·네트워크 오류까지 run-없음 안내로 묶여 살아 있는 run 에 거짓을 말한다.
        const missing = caught instanceof ApiRequestError && caught.status === 404;
        const hint = missing ? MISSING_RUN_HINT : STATUS_UNKNOWN_HINT;
        setState((previous) => ({ ...previous, error: `${reason}\n${hint}` }));
      }
    };

    void refresh();

    const source = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);

    source.onmessage = (message: MessageEvent<string>): void => {
      const event = JSON.parse(message.data) as RunEvent;

      setState((previous) => {
        if (previous.events.some((received) => received.id === event.id)) return previous;
        const events = [...previous.events, event];
        // 이벤트가 흐른다는 것이 곧 이 run 이 있다는 증거다. 앞선 조회 실패로 세운 안내가
        // 남아 있으면 살아 있는 run 화면에 "확인할 수 없음" 이 붙어 있게 된다.
        const base = previous.error === null ? previous : { ...previous, error: null };

        if (event.kind === "question") {
          return { ...base, events, status: "waiting-input", pendingQuestion: event.question };
        }

        if (event.kind === "done") {
          const status: RunStatus = event.exitCode === 0 ? "done" : "failed";
          return { ...base, events, status, pendingQuestion: null };
        }

        // stdout/stderr는 pendingQuestion을 건드리지 않는다. 질문과 답 사이에 낀 출력
        // 한 줄이 패널을 지워 응답 불가 상태로 만드는 일을 막는다.
        return { ...base, events, status: "running" };
      });
    };

    /**
     * `EventSource` 는 응답 본문을 주지 않으므로 404 의 이유를 여기서 알 수 없다.
     * 대신 `readyState` 로 **영구 실패**(스펙: 200·text/event-stream 이 아니면 연결을
     * 실패시키고 재시도하지 않는다)와 **재연결 중**(브라우저가 알아서 다시 붙는다)을
     * 가른다. 영구 실패일 때만 서버에 다시 물어 사람에게 알린다.
     *
     * 정상 종료는 이 갈래를 타지 않는다 — 서버가 스트림을 닫지 않으므로 종료는
     * 언마운트의 `source.close()` 뿐이고 그때는 onerror 가 뜨지 않는다.
     */
    source.onerror = (): void => {
      if (source.readyState !== EVENT_SOURCE_CLOSED) return;
      void refresh();
    };

    return (): void => {
      cancelled = true;
      source.close();
    };
  }, [runId]);

  return state;
}

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalyzeSecurityRequest,
  AnalyzeSecurityResponse,
  RunEvent,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import { useRunEvents } from "../run-stream.js";
import type { PillarState } from "./pillar-state.js";

export interface SecurityAnalysis {
  readonly state: PillarState<AnalyzeSecurityResponse>;
  /** 시작에 성공한 요청 그대로. 다시 점검이 이것을 보낸다. */
  readonly sent: AnalyzeSecurityRequest | null;
  /** running 일 때의 run. 훅이 이 run 의 SSE 를 `useRunEvents` 로 연다. 결과를 읽거나 실패하면 null 로 돌아가 스트림이 닫힌다. */
  readonly runId: string | null;
  /**
   * `POST /api/analyze/security`. 시작에 성공하면 앞 결과가 내려가고 running 이 된다(true).
   * 실패하면(false) `state.kind === "done"` 일 때는 done 을 유지하고 `startError` 만 채운다. 그 밖(idle·failed)
   * 이면 failed { error } 로 간다. 첫 분석의 시작 실패는 카드에 "실패" 로 보여야 하기 때문이다(설계 §7.5).
   */
  readonly start: (request: AnalyzeSecurityRequest) => Promise<boolean>;
  /** 시작 요청 자체의 실패 문장. done 을 유지한 채 옆에 보인다. 다음 start 가 비운다. */
  readonly startError: string | null;
  /** 도는 run 의 진행 이벤트(`useRunEvents(runId).events`). running 이 아니면 빈 배열. 상세가 그린다. */
  readonly events: readonly RunEvent[];
  /** 스트림 조회만 실패한 문장(`useRunEvents(runId).error` 중 missing 이 아닌 것). run 은 살아 있을 수 있어 상태를 바꾸지 않는다. */
  readonly progressError: string | null;
}

function messageOf(err: unknown): string {
  // 서버·CLI 문장 원문이다. 새 문장을 만들지 않는다.
  return err instanceof Error ? err.message : String(err);
}

/**
 * 보안 축의 분석 상태(설계 §5.4). `점검 시작` 이 run 을 시작하고, 진행은 그 run 의 SSE 로 받고, 끝나면
 * `GET /api/analyze/security/<runId>` 를 run 당 한 번 읽는다. 타이머·폴링이 없다. 상태 전이는 구현계획
 * §3.3 의 표가 사양이고 구독부는 그 코드 그대로다.
 */
export function useSecurityAnalysis(): SecurityAnalysis {
  const [state, setState] = useState<PillarState<AnalyzeSecurityResponse>>({ kind: "idle" });
  const [sent, setSent] = useState<AnalyzeSecurityRequest | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  /** 결과가 새로 올 때마다 하나 오른다. 결과 화면의 키다. */
  const serial = useRef(0);
  /** 지금 기다리는 run. 점검 단계를 떠난 뒤에 늦게 도착한 결과를 버리는 데 쓴다. 렌더에서는 읽지 않는다. */
  const awaitedRun = useRef<string | null>(null);
  /** 끝남·없음을 보고한 run. start 성공이 null 로 비운다(같은 runId 가 다시 와도 다시 보고하도록). */
  const reportedRun = useRef<string | null>(null);
  /** 렌더마다 최신 상태를 비춘다. `start` 가 실패 시점의 상태를 낡은 클로저 없이 읽기 위한 것이다. */
  const latestState = useRef(state);
  latestState.current = state;

  const start = useCallback(async (request: AnalyzeSecurityRequest): Promise<boolean> => {
    // 앞선 시작 실패 문장은 다음 start 가 비운다(설계 §5.4). failed 의 문장은 결과가 올 때 바뀐다.
    setStartError(null);
    try {
      const response = await apiSend<StartRunResponse>("POST", "/api/analyze/security", request);
      // 다시 점검이면 여기서 앞 결과를 내린다. 시작에 실패하면 앞 결과는 그대로 남는다.
      awaitedRun.current = response.runId;
      reportedRun.current = null;
      setState({ kind: "running" });
      setSent(request);
      setRunId(response.runId);
      return true;
    } catch (err) {
      const error = messageOf(err);
      // done 이면 결과를 유지한 채 옆에 문장만 보이고, 아니면 failed 의 문장으로 보인다. 둘 다 보이지는 않는다
      // (startError 는 위에서 이미 비웠다).
      if (latestState.current.kind === "done") {
        setStartError(error);
      } else {
        setState({ kind: "failed", error });
      }
      return false;
    }
  }, []);

  /** run 이 끝난 뒤 결과를 한 번 읽는다. 리포트 없이 끝난 점검은 400 이고 그 본문이 CLI stderr 원문이다. */
  const loadResult = useCallback(async (finishedRunId: string): Promise<void> => {
    try {
      const result = await apiGet<AnalyzeSecurityResponse>(
        `/api/analyze/security/${encodeURIComponent(finishedRunId)}`,
      );
      if (awaitedRun.current !== finishedRunId) {
        return;
      }
      awaitedRun.current = null;
      serial.current += 1;
      setRunId(null);
      setState({ kind: "done", result, serial: serial.current });
    } catch (err) {
      if (awaitedRun.current !== finishedRunId) {
        return;
      }
      awaitedRun.current = null;
      setRunId(null);
      setState({ kind: "failed", error: messageOf(err) });
    }
  }, []);

  const run = useRunEvents(runId);
  const finished = run.status === "done" || run.status === "failed";
  const missingMessage = run.missing ? run.error : null;

  useEffect(() => {
    if (runId === null || !finished || reportedRun.current === runId) return;
    reportedRun.current = runId;
    void loadResult(runId);
  }, [runId, finished, loadResult]);

  useEffect(() => {
    if (runId === null || missingMessage === null || reportedRun.current === runId) return;
    reportedRun.current = runId;
    awaitedRun.current = null;
    setRunId(null);
    setState({ kind: "failed", error: missingMessage });
  }, [runId, missingMessage]);

  const events = runId === null ? [] : run.events;
  const progressError = run.missing ? null : run.error;

  return { state, sent, runId, start, startError, events, progressError };
}

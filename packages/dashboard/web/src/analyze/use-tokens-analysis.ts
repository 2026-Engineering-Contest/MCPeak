import { useCallback, useRef, useState } from "react";
import type { AnalyzeTokensRequest, AnalyzeTokensResponse } from "../../../src/api-types.js";
import { apiSend } from "../api.js";
import type { PillarState } from "./pillar-state.js";

export interface TokensAnalysis {
  readonly state: PillarState<AnalyzeTokensResponse>;
  /** 성공한 요청 그대로. 다시 분석과 소스 반영이 이것을 쓴다. 성공 전에는 null. */
  readonly analyzed: AnalyzeTokensRequest | null;
  /**
   * `POST /api/analyze/tokens`. 보내는 순간 running 이 되고 앞 결과는 내려간다. 응답이 오면 done,
   * 실패하면 failed. 성공이면 true 를 돌려준다. 부르는 쪽이 이 값으로 `rememberCommand` 를 결정한다
   * (상태를 다시 읽으면 클로저가 낡은 값을 본다).
   */
  readonly start: (request: AnalyzeTokensRequest) => Promise<boolean>;
  /** 같은 요청으로 다시. 실패하면 done 을 유지한 채 `reanalyzeError` 만 채운다. */
  readonly reanalyze: () => Promise<void>;
  readonly reanalyzing: boolean;
  readonly reanalyzeError: string | null;
  /** T2 전용(임시). "← 서버 다시 고르기". T3 이 지운다. */
  readonly reset: () => void;
}

function messageOf(err: unknown): string {
  // CLI 의 stderr 문장 원문이다. 새 문장을 만들지 않는다.
  return err instanceof Error ? err.message : String(err);
}

/**
 * 비용 최적화 축의 분석 상태(설계 §5.4). 요청은 동기라 "분석 중" 은 그 Promise 의 수명과 같고,
 * 타이머·폴링이 없다. 상태 전이는 구현계획 §3.3 의 표가 사양이다.
 */
export function useTokensAnalysis(): TokensAnalysis {
  const [state, setState] = useState<PillarState<AnalyzeTokensResponse>>({ kind: "idle" });
  const [analyzed, setAnalyzed] = useState<AnalyzeTokensRequest | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  /**
   * 결과가 새로 올 때마다 하나 오른다. 결과 화면의 키라서, 같은 내용이 다시 와도 상태가 비워진다.
   * `state` 에서 읽으면 running 을 거친 뒤라 항상 1 이 되므로 ref 로 센다.
   */
  const serial = useRef(0);

  const start = useCallback(async (request: AnalyzeTokensRequest): Promise<boolean> => {
    setState({ kind: "running" });
    setReanalyzeError(null);
    try {
      const result = await apiSend<AnalyzeTokensResponse>("POST", "/api/analyze/tokens", request);
      serial.current += 1;
      setState({ kind: "done", result, serial: serial.current });
      setAnalyzed(request);
      return true;
    } catch (err) {
      // 실패해도 `analyzed` 는 그대로다. 앞서 성공한 요청이 있었다면 그 기록이 남는다.
      setState({ kind: "failed", error: messageOf(err) });
      return false;
    }
  }, []);

  const reanalyze = useCallback(async (): Promise<void> => {
    if (analyzed === null || reanalyzing) {
      return;
    }
    setReanalyzing(true);
    setReanalyzeError(null);
    try {
      const result = await apiSend<AnalyzeTokensResponse>("POST", "/api/analyze/tokens", analyzed);
      serial.current += 1;
      setState({ kind: "done", result, serial: serial.current });
    } catch (err) {
      // done 을 유지한 채 문장만 보인다. 고친 서버가 안 뜨는 것이 바로 이때 드러난다.
      setReanalyzeError(messageOf(err));
    } finally {
      setReanalyzing(false);
    }
  }, [analyzed, reanalyzing]);

  const reset = useCallback((): void => {
    setState({ kind: "idle" });
    setReanalyzeError(null);
  }, []);

  return { state, analyzed, start, reanalyze, reanalyzing, reanalyzeError, reset };
}

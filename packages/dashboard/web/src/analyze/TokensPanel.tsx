import type { JSX } from "react";
import { useState } from "react";
import type { AnalyzeTokensRequest, AnalyzeTokensResponse } from "../../../src/api-types.js";
import { apiSend } from "../api.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Stepper } from "../components/Stepper.js";
import { AnalyzeTargetForm } from "./AnalyzeTargetForm.js";
import { TokensResult } from "./TokensResult.js";
import type { AnalyzeTarget } from "./use-analyze-target.js";

/** 단계 이름. 결과는 요청 한 번의 산물이라 URL 로 다시 열 수 없으므로 라우트가 아니라 단계다. */
const STEPS = ["서버 선택", "결과"] as const;

/**
 * 토큰 탭(계획서 §5.6). 서버를 고르고 `분석 시작` 을 누르면 `POST /api/analyze/tokens` 한 번으로
 * 결과를 받는다. 요청은 동기라 "분석 중" 은 그 Promise 의 수명과 같고, 타이머·폴링이 없다.
 *
 * 화면은 두 단계다(2026-10-03 단계화면-비교 §3.2). 단계는 `result` 하나에서 구한다. 성공하면
 * 결과 단계로 넘어가고, 실패하면 서버 선택 단계에 머문다.
 */
export function TokensPanel({ target }: { readonly target: AnalyzeTarget }): JSX.Element {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzeTokensResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 분석에 성공한 요청 그대로. 다시 분석이 폼을 다시 읽지 않고 이것을 보낸다. */
  const [analyzed, setAnalyzed] = useState<AnalyzeTokensRequest | null>(null);
  /** 결과가 새로 올 때마다 하나 오른다. 결과 화면의 키라서, 같은 내용이 다시 와도 상태가 비워진다. */
  const [resultSerial, setResultSerial] = useState(0);
  const [reanalyzing, setReanalyzing] = useState(false);

  const { argv } = target;

  async function startAnalysis(): Promise<void> {
    if (!("argv" in argv)) {
      return;
    }
    setAnalyzing(true);
    setError(null);
    setResult(null);
    const body: AnalyzeTokensRequest = {
      argv: argv.argv,
      // 후보 갈래면 id 를 함께 보낸다. 서버가 그 후보의 env 값을 채운다(Home 과 같다).
      ...(target.serverId === undefined ? {} : { serverId: target.serverId }),
    };
    try {
      const response = await apiSend<AnalyzeTokensResponse>("POST", "/api/analyze/tokens", body);
      setResult(response);
      setAnalyzed(body);
      setResultSerial((previous) => previous + 1);
      target.rememberCommand();
    } catch (err) {
      // CLI 의 stderr 문장 원문이다. 새 문장을 만들지 않는다(계획서 §1.3-5).
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  /**
   * 소스를 고친 뒤 같은 요청으로 다시 분석한다. 결과 단계를 떠나지 않는다. 실패하면 이전 결과를 둔 채
   * CLI 문장만 보인다(고친 서버가 안 뜨는 것이 바로 이때 드러난다).
   */
  async function reanalyze(): Promise<void> {
    if (analyzed === null || reanalyzing) {
      return;
    }
    setReanalyzing(true);
    setError(null);
    try {
      const response = await apiSend<AnalyzeTokensResponse>(
        "POST",
        "/api/analyze/tokens",
        analyzed,
      );
      setResult(response);
      setResultSerial((previous) => previous + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReanalyzing(false);
    }
  }

  const errorAlert = error !== null && (
    <pre
      role="alert"
      className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-4 py-3 font-mono text-xs"
      style={{ color: "var(--status-failed-fg)" }}
    >
      {error}
    </pre>
  );

  return (
    <div className="space-y-6">
      <Stepper steps={STEPS} current={result === null ? 0 : 1} />

      {result === null ? (
        <>
          <Card className="space-y-5 p-6">
            <AnalyzeTargetForm target={target} />
            <div className="space-y-2">
              <Button
                variant="primary"
                disabled={analyzing || !("argv" in argv)}
                onClick={() => void startAnalysis()}
              >
                {analyzing ? "분석 중…" : "분석 시작"}
              </Button>
              {"error" in argv && <p className="text-xs text-ink-muted">{argv.error}</p>}
            </div>
          </Card>

          {errorAlert}
        </>
      ) : (
        <>
          {/* 접속 상태(target)는 그대로 두므로 돌아가면 고른 서버가 남아 있다. */}
          <Button
            onClick={() => {
              setResult(null);
              setError(null);
            }}
          >
            ← 서버 다시 고르기
          </Button>
          {/* 다시 분석의 실패는 결과 위에 보인다. 이전 결과는 그대로 둔다. */}
          {errorAlert}
          {reanalyzing && (
            <p role="status" className="text-sm text-ink-muted">
              분석 중…
            </p>
          )}
          <TokensResult
            key={resultSerial}
            result={result}
            argv={analyzed?.argv ?? []}
            onReanalyze={() => void reanalyze()}
          />
        </>
      )}
    </div>
  );
}

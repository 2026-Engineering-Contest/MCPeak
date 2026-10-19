import type { JSX } from "react";
import type { AnalyzeTokensRequest } from "../../../src/api-types.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Stepper } from "../components/Stepper.js";
import { AnalyzeTargetForm } from "./AnalyzeTargetForm.js";
import { ErrorAlert } from "./ErrorAlert.js";
import { TokensResult } from "./TokensResult.js";
import type { AnalyzeTarget } from "./use-analyze-target.js";
import { useTokensAnalysis } from "./use-tokens-analysis.js";

/** 단계 이름. 결과는 요청 한 번의 산물이라 URL 로 다시 열 수 없으므로 라우트가 아니라 단계다. */
const STEPS = ["서버 선택", "결과"] as const;

/**
 * 토큰 탭(계획서 §5.6). 서버를 고르고 `분석 시작` 을 누르면 `POST /api/analyze/tokens` 한 번으로
 * 결과를 받는다. 상태 전이는 `useTokensAnalysis` 가 갖고 이 패널은 그리기와 버튼 배치만 한다.
 *
 * 화면은 두 단계다(2026-10-03 단계화면-비교 §3.2). 단계는 `state.kind` 하나에서 구한다. 성공하면
 * 결과 단계로 넘어가고, 실패하면 서버 선택 단계에 머문다.
 */
export function TokensPanel({ target }: { readonly target: AnalyzeTarget }): JSX.Element {
  const analysis = useTokensAnalysis();
  const { state, analyzed } = analysis;

  const { argv } = target;
  const analyzing = state.kind === "running";

  async function startAnalysis(): Promise<void> {
    if (!("argv" in argv)) {
      return;
    }
    const body: AnalyzeTokensRequest = {
      argv: argv.argv,
      // 후보 갈래면 id 를 함께 보낸다. 서버가 그 후보의 env 값을 채운다(Home 과 같다).
      ...(target.serverId === undefined ? {} : { serverId: target.serverId }),
    };
    if (await analysis.start(body)) {
      target.rememberCommand();
    }
  }

  /** 시작 실패는 failed 의 문장, 다시 분석 실패는 done 을 유지한 채 `reanalyzeError` 다. 자리는 같다. */
  const error = state.kind === "failed" ? state.error : analysis.reanalyzeError;
  const errorAlert = error !== null && <ErrorAlert message={error} />;

  return (
    <div className="space-y-6">
      <Stepper steps={STEPS} current={state.kind === "done" ? 1 : 0} />

      {state.kind !== "done" ? (
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
          <Button onClick={analysis.reset}>← 서버 다시 고르기</Button>
          {/* 다시 분석의 실패는 결과 위에 보인다. 이전 결과는 그대로 둔다. */}
          {errorAlert}
          {analysis.reanalyzing && (
            <p role="status" className="text-sm text-ink-muted">
              분석 중…
            </p>
          )}
          <TokensResult
            key={state.serial}
            result={state.result}
            argv={analyzed?.argv ?? []}
            onReanalyze={() => void analysis.reanalyze()}
          />
        </>
      )}
    </div>
  );
}

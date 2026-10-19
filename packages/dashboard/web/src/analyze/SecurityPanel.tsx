import type { JSX } from "react";
import { useState } from "react";
import type { AnalyzeSecurityRequest } from "../../../src/api-types.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Stepper } from "../components/Stepper.js";
import { describeRun } from "../run-target.js";
import { AnalyzeTargetForm } from "./AnalyzeTargetForm.js";
import {
  buildSecurityRequest,
  INITIAL_SECURITY_FORM,
  type SecurityForm,
} from "./build-security-request.js";
import { ErrorAlert } from "./ErrorAlert.js";
import { REMOTE_SANDBOX_HINT, SecurityOptions } from "./SecurityOptions.js";
import { SecurityProgress, SecurityProgressView } from "./SecurityProgress.js";
import { SecurityResult } from "./SecurityResult.js";
import type { AnalyzeTarget } from "./use-analyze-target.js";
import { useSecurityAnalysis } from "./use-security-analysis.js";

/** `PreCheck.tsx`·`precheck.test.tsx` 가 이 경로로 import 한다. T3 이 그쪽 import 를 옮긴 뒤 지운다. */
export { ErrorAlert, REMOTE_SANDBOX_HINT, SecurityProgress };

/** 단계 이름. 결과는 run 한 번의 산물이라 라우트가 아니라 단계다. */
const STEPS = ["서버 선택", "점검", "결과"] as const;

/**
 * 보안 탭(보안 탭 계획서 §5.7). 서버를 고르고 `점검 시작` 을 누르면 `POST /api/analyze/security` 가
 * run 을 시작한다. 진행은 그 run 의 SSE 로 받고, 끝나면 `GET /api/analyze/security/<runId>` 를 한 번
 * 읽는다. 판정은 CLI 와 같은 함수가 한 것이고 이 화면은 받은 글자를 보이기만 한다.
 *
 * 상태 전이와 SSE 구독은 `useSecurityAnalysis` 가 갖고 이 패널은 그리기와 버튼 배치만 한다. 단계는 따로
 * 상태를 두지 않고 구한다. 결과가 있으면 결과, 도는 run 이 있으면 점검, 아니면 서버 선택이다.
 */
export function SecurityPanel({ target }: { readonly target: AnalyzeTarget }): JSX.Element {
  const [form, setForm] = useState<SecurityForm>(INITIAL_SECURITY_FORM);
  const analysis = useSecurityAnalysis();
  const { state, sent, runId } = analysis;
  /** "점검 중…" 글자와 버튼 비활성. 훅 계약에 없어 패널이 `start` 의 앞뒤로 든다. */
  const [starting, setStarting] = useState(false);

  function patchForm(partial: Partial<SecurityForm>): void {
    setForm((previous) => ({ ...previous, ...partial }));
  }

  /** 버튼 비활성 판정·사유·제출이 같은 함수를 쓴다. 대상 오류가 먼저다. */
  function requestResult():
    | { readonly request: AnalyzeSecurityRequest }
    | { readonly error: string } {
    if (!("argv" in target.argv)) {
      return { error: target.argv.error };
    }
    try {
      return {
        request: buildSecurityRequest(
          target.argv.argv,
          target.serverId,
          target.state.transport,
          form,
        ),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const built = requestResult();

  /** 점검을 시작한다. 성공 여부를 돌려준다. 실패하면 서버 문장을 그대로 보인다. */
  async function start(request: AnalyzeSecurityRequest): Promise<boolean> {
    setStarting(true);
    try {
      return await analysis.start(request);
    } finally {
      setStarting(false);
    }
  }

  async function startFromForm(): Promise<void> {
    if (!("request" in built)) {
      return;
    }
    if (await start(built.request)) {
      target.rememberCommand();
    }
  }

  const step = state.kind === "done" ? 2 : runId !== null ? 1 : 0;

  /** 시작·결과 읽기의 실패는 failed 의 문장, 다시 점검의 시작 실패는 done 을 유지한 채 `startError` 다. */
  const error = state.kind === "failed" ? state.error : analysis.startError;
  const errorAlert = error !== null && <ErrorAlert message={error} />;

  return (
    <div className="space-y-6">
      <Stepper steps={STEPS} current={step} />

      {step === 0 && (
        <>
          <Card className="space-y-5 p-6">
            <AnalyzeTargetForm target={target} />

            <SecurityOptions form={form} transport={target.state.transport} onChange={patchForm} />

            <div className="space-y-2">
              <Button
                variant="primary"
                disabled={starting || !("request" in built)}
                onClick={() => void startFromForm()}
              >
                {starting ? "점검 중…" : "점검 시작"}
              </Button>
              {"error" in built && <p className="text-xs text-ink-muted">{built.error}</p>}
            </div>
          </Card>

          {errorAlert}
        </>
      )}

      {step === 1 && sent !== null && (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={analysis.reset}>← 서버 다시 고르기</Button>
              {/* 취소 API 가 없다. 화면만 돌아가고 서버의 run 은 끝까지 돈다. */}
              <p className="text-xs text-ink-muted">점검은 중단되지 않고 끝까지 돕니다.</p>
            </div>
            <p className="break-all font-mono text-xs text-ink">
              {`점검 대상: ${describeRun("audit", sent.argv).server ?? ""}`}
            </p>
          </div>
          {/* 구독은 훅이 하나만 연다. 여기서 구독형 SecurityProgress 를 쓰면 스트림이 둘이 된다. */}
          <SecurityProgressView events={analysis.events} error={analysis.progressError} />
        </>
      )}

      {step === 2 && state.kind === "done" && sent !== null && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button onClick={analysis.reset}>← 서버 다시 고르기</Button>
            <Button disabled={starting} onClick={() => void start(sent)}>
              다시 점검
            </Button>
          </div>
          {/* 다시 점검의 시작 실패는 결과 위에 보인다. 앞 결과는 그대로 둔다. */}
          {errorAlert}
          <SecurityResult response={state.result} request={sent} />
        </>
      )}
    </div>
  );
}

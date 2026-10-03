import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  AnalyzeSecurityRequest,
  AnalyzeSecurityResponse,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import { ArgChips } from "../components/ArgChips.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Field, INPUT_CLASS, Toggle } from "../components/Field.js";
import { LogPanel } from "../components/LogPanel.js";
import { SegmentedControl } from "../components/SegmentedControl.js";
import { Stepper } from "../components/Stepper.js";
import { useRunEvents } from "../run-stream.js";
import { AnalyzeTargetForm } from "./AnalyzeTargetForm.js";
import {
  buildSecurityRequest,
  INITIAL_SECURITY_FORM,
  type ProbeChoice,
  type SecurityForm,
} from "./build-security-request.js";
import { SecurityResult } from "./SecurityResult.js";
import type { AnalyzeTarget } from "./use-analyze-target.js";

/** 단계 이름. 토큰 탭과 같다. 결과는 run 한 번의 산물이라 라우트가 아니라 단계다. */
const STEPS = ["서버 선택", "결과"] as const;

const PROBE_OPTIONS: readonly { readonly value: ProbeChoice; readonly label: string }[] = [
  { value: "auto", label: "자동" },
  { value: "readonly", label: "읽기 전용만" },
  { value: "none", label: "호출 안 함" },
  { value: "all", label: "전부" },
];

const REMOTE_SANDBOX_HINT =
  "원격 서버는 격리할 수 없습니다. 격리는 프로세스를 띄우는 대상에만 적용됩니다.";
/** 단계 2 의 알려진 한계(PR #497). `npx -y` 제한이 풀리면 둘째·셋째 문장을 지운다. */
const SANDBOX_HINT =
  "격리 이미지는 node, npx, npm 으로 띄우는 서버만 실행합니다. npx -y 로 레지스트리에서 받는 서버는 격리 안에서 뜨지 않습니다. 로컬에 설치해 node 로 띄우세요.";
const COMPARE_HOST_HINT =
  "서버를 이 머신에서 한 번 더 띄워 tools/list 만 받습니다. 도구는 호출하지 않습니다.";
const PROGRESS_DESCRIPTION =
  "격리 실행은 이미지를 처음 만들 때 몇 분이 걸립니다. 도는 동안 대시보드를 끄면 격리 자원이 남습니다(치우는 법: packages/audit/README.md).";

const ALERT_CLASS =
  "overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-4 py-3 font-mono text-xs";

function ErrorAlert({ message }: { readonly message: string }): JSX.Element {
  return (
    <pre role="alert" className={ALERT_CLASS} style={{ color: "var(--status-failed-fg)" }}>
      {message}
    </pre>
  );
}

/**
 * 도는 점검 하나의 진행. run 마다 새로 마운트된다(부모가 `key` 를 run 으로 준다). 그래서 앞 run 의
 * 완료 상태가 새 run 의 첫 렌더에 남지 않고, 완료 보고는 run 마다 정확히 한 번이다.
 *
 * 타이머·폴링이 없다. 완료는 `useRunEvents` 의 status 로만 안다. `failed` 는 "발견이 있다"(종료 코드 2)일
 * 수도 있으므로 여기서는 끝났다는 것만 알리고 실패로 그리지 않는다.
 */
function SecurityProgress({
  runId,
  onFinished,
  onMissing,
}: {
  readonly runId: string;
  readonly onFinished: (runId: string) => void;
  /** 서버가 없다고 확인한 run 이다. 기다려도 이벤트가 오지 않으므로 부모가 폼을 다시 연다. */
  readonly onMissing: (message: string) => void;
}): JSX.Element {
  const run = useRunEvents(runId);
  const finished = run.status === "done" || run.status === "failed";
  /** 부모에 알리는 것은 run 당 한 번이다. 재연결로 지난 이벤트가 다시 흘러도 결과를 다시 읽지 않는다. */
  const reported = useRef(false);

  useEffect(() => {
    if (!finished || reported.current) {
      return;
    }
    reported.current = true;
    onFinished(runId);
  }, [finished, runId, onFinished]);

  // 조회만 실패한 경우(missing 이 아닌 error)는 run 이 살아 있을 수 있으므로 진행을 유지한다.
  const missingMessage = run.missing ? run.error : null;

  useEffect(() => {
    if (missingMessage === null || reported.current) {
      return;
    }
    reported.current = true;
    onMissing(missingMessage);
  }, [missingMessage, onMissing]);

  return (
    <>
      {/* LogPanel 은 부모의 남는 높이를 채우는 모양이다. 높이를 묶어 주지 않으면 본문이 안에서
          스크롤하지 않고 화면이 로그만큼 길어진다. */}
      <div className="flex h-[440px] flex-col">
        <LogPanel title="진행" description={PROGRESS_DESCRIPTION} events={run.events} />
      </div>
      {run.error !== null && <ErrorAlert message={run.error} />}
    </>
  );
}

/**
 * 보안 탭(보안 탭 계획서 §5.7). 서버를 고르고 `점검 시작` 을 누르면 `POST /api/analyze/security` 가
 * run 을 시작한다. 진행은 그 run 의 SSE 로 받고, 끝나면 `GET /api/analyze/security/<runId>` 를 한 번
 * 읽는다. 판정은 CLI 와 같은 함수가 한 것이고 이 화면은 받은 글자를 보이기만 한다.
 *
 * 단계는 `result` 하나에서 구한다. 결과를 받으면 결과 단계로 넘어가고, 시작이나 결과 읽기가 실패하면
 * 서버 선택 단계에 머문다.
 */
export function SecurityPanel({ target }: { readonly target: AnalyzeTarget }): JSX.Element {
  const [form, setForm] = useState<SecurityForm>(INITIAL_SECURITY_FORM);
  const [runId, setRunId] = useState<string | null>(null);
  /** 시작에 성공한 요청 그대로. 다시 점검이 폼을 다시 읽지 않고 이것을 보낸다. */
  const [sent, setSent] = useState<AnalyzeSecurityRequest | null>(null);
  const [result, setResult] = useState<AnalyzeSecurityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const http = target.state.transport === "http";
  /** 원격 대상에서는 체크가 남아 있어도 꺼진 것으로 보인다. 요청도 싣지 않는다. */
  const sandboxOn = form.sandbox && !http;
  const baselineEmpty = form.baselinePath.trim() === "";

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
  /** 시작했고 아직 결과를 받지 못한 run 이 있다. */
  const running = runId !== null && result === null;

  /** 점검을 시작한다. 성공 여부를 돌려준다. 실패하면 서버 문장을 그대로 보인다. */
  async function start(request: AnalyzeSecurityRequest): Promise<boolean> {
    setStarting(true);
    setError(null);
    try {
      const response = await apiSend<StartRunResponse>("POST", "/api/analyze/security", request);
      // 다시 점검이면 여기서 앞 결과를 내린다. 시작에 실패하면 앞 결과는 그대로 남는다.
      setResult(null);
      setSent(request);
      setRunId(response.runId);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
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

  /** run 이 끝난 뒤 결과를 한 번 읽는다. 리포트 없이 끝난 점검은 400 이고 그 본문이 CLI stderr 원문이다. */
  async function loadResult(finishedRunId: string): Promise<void> {
    try {
      setResult(
        await apiGet<AnalyzeSecurityResponse>(
          `/api/analyze/security/${encodeURIComponent(finishedRunId)}`,
        ),
      );
    } catch (err) {
      setRunId(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const errorAlert = error !== null && <ErrorAlert message={error} />;

  return (
    <div className="space-y-6">
      <Stepper steps={STEPS} current={result === null ? 0 : 1} />

      {result === null || sent === null ? (
        <>
          <Card className="space-y-5 p-6">
            <AnalyzeTargetForm target={target} />

            <div className="space-y-4 border-t border-line pt-5">
              <h2 className="text-title font-semibold text-ink">점검 옵션</h2>

              <div className="space-y-1">
                <p className="text-sm font-medium text-ink">호출 정책</p>
                <SegmentedControl
                  options={PROBE_OPTIONS}
                  value={form.probe}
                  onChange={(probe) => patchForm({ probe })}
                />
                <p className="text-xs text-ink-muted">
                  자동은 격리 안에서는 전부, 격리가 없으면 읽기 전용 도구만 호출합니다.
                </p>
              </div>

              <div className="space-y-2">
                <Field
                  label="기준 파일 (프로젝트 루트 기준, 선택)"
                  htmlFor="security-baseline-path"
                >
                  <input
                    id="security-baseline-path"
                    className={`${INPUT_CLASS} font-mono`}
                    value={form.baselinePath}
                    placeholder=".mcpeak/audit-baseline.json"
                    onChange={(event) => patchForm({ baselinePath: event.target.value })}
                  />
                </Field>
                <Toggle
                  id="security-update-baseline"
                  label="기준 파일을 지금 표면으로 갱신"
                  checked={form.updateBaseline && !baselineEmpty}
                  disabled={baselineEmpty}
                  onChange={(updateBaseline) => patchForm({ updateBaseline })}
                />
              </div>

              <div className="space-y-3">
                <Toggle
                  id="security-sandbox"
                  label="Docker 격리 안에서 실행 (행위 관측)"
                  checked={sandboxOn}
                  disabled={http}
                  hint={http ? REMOTE_SANDBOX_HINT : sandboxOn ? SANDBOX_HINT : undefined}
                  onChange={(sandbox) => patchForm({ sandbox })}
                />
                {sandboxOn && (
                  <div className="space-y-3 pl-6">
                    <Toggle
                      id="security-compare-host"
                      label="이 머신에서 받은 도구 표면과 비교 (--compare-host)"
                      checked={form.compareHost}
                      hint={COMPARE_HOST_HINT}
                      onChange={(compareHost) => patchForm({ compareHost })}
                    />
                    <ArgChips
                      idPrefix="security-allow-host"
                      args={form.allowHosts}
                      hint="--allow-host"
                      label="허용 호스트"
                      placeholder="호스트 이름 하나씩 추가 (예: api.example.com)"
                      removeLabel={(host) => `허용 호스트 ${host} 제거`}
                      onChange={(allowHosts) => patchForm({ allowHosts })}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Button
                variant="primary"
                disabled={starting || running || !("request" in built)}
                onClick={() => void startFromForm()}
              >
                {starting || running ? "점검 중…" : "점검 시작"}
              </Button>
              {"error" in built && <p className="text-xs text-ink-muted">{built.error}</p>}
            </div>
          </Card>

          {runId !== null && (
            <SecurityProgress
              key={runId}
              runId={runId}
              onFinished={(finished) => void loadResult(finished)}
              onMissing={(message) => {
                setRunId(null);
                setError(message);
              }}
            />
          )}

          {errorAlert}
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {/* 점검 옵션(form)과 접속 상태(target)는 그대로 두므로 돌아가면 고른 것이 남아 있다. */}
            <Button
              onClick={() => {
                setResult(null);
                setRunId(null);
                setError(null);
              }}
            >
              ← 서버 다시 고르기
            </Button>
            <Button disabled={starting} onClick={() => void start(sent)}>
              다시 점검
            </Button>
          </div>
          {/* 다시 점검의 시작 실패는 결과 위에 보인다. 앞 결과는 그대로 둔다. */}
          {errorAlert}
          <SecurityResult response={result} request={sent} />
        </>
      )}
    </div>
  );
}

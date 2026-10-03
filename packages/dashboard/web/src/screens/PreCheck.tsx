import type { JSX } from "react";
import { useRef, useState } from "react";
import type {
  AnalyzeSecurityRequest,
  AnalyzeSecurityResponse,
  StartRunResponse,
} from "../../../src/api-types.js";
import { ErrorAlert, REMOTE_SANDBOX_HINT, SecurityProgress } from "../analyze/SecurityPanel.js";
import { SecurityResult } from "../analyze/SecurityResult.js";
import { SEVERITIES, SEVERITY_TONE } from "../analyze/security-view.js";
import { apiGet, apiSend } from "../api.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Field, INPUT_CLASS, Toggle } from "../components/Field.js";
import { PageHeader } from "../components/PageHeader.js";
import { Stepper } from "../components/Stepper.js";
import { buildPrecheckRequest } from "../precheck/build-precheck-request.js";
import { type FixLine, fixSummary } from "../precheck/fix-summary.js";
import { type PastedServer, parseServerInput } from "../precheck/parse-server-input.js";
import { describeRun } from "../run-target.js";

const PRECHECK_DESCRIPTION = "등록하기 전에 MCP 서버를 한 번 띄워 도구 정의와 행동을 점검합니다.";

/** 단계 이름. 결과는 run 한 번의 산물이라 라우트가 아니라 단계다. */
const STEPS = ["서버 붙여넣기", "점검", "결과"] as const;

const INPUT_HINT =
  "README 의 mcpServers JSON, 실행 명령 한 줄(npx -y <패키지>), 또는 서버 URL 을 붙여 넣으세요.";
const SANDBOX_ON_HINT =
  "격리 이미지는 node, npx, npm 으로 띄우는 서버만 실행합니다. Docker 가 없거나 그 밖의 명령이면 서버가 이 머신에서 직접 실행되고, 결과 위에 그 사실이 표시됩니다.";
const SANDBOX_OFF_HINT = "격리를 끄면 서버가 이 머신에서 사용자 권한으로 실행됩니다.";

/** 대상 줄과 같은 모양. 보안 탭의 점검 단계가 쓰는 클래스와 같다. */
const TARGET_LINE_CLASS = "break-all font-mono text-xs text-ink";
/** 넘기지 않는 것을 알리는 줄과 버튼 아래 사유 줄. 보안 탭의 사유 줄과 같은 모양이다. */
const NOTE_CLASS = "text-xs text-ink-muted";
/** 요약 줄의 심각도 칩. `SecurityResult` 의 발견 배지와 같은 모양이고 줄이 길어도 눌리지 않는다. */
const SEVERITY_CHIP_CLASS = "inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold";

/** 점검 대상 한 줄. stdio 는 command 와 args 를 공백으로 이은 글자, http 는 주소다. */
function targetOf(server: PastedServer): string {
  return server.transport === "http" ? server.url : [server.command, ...server.args].join(" ");
}

/**
 * 결과 맨 위의 "먼저 할 일" 카드. 문장은 발견의 `fix` 그대로이고 텍스트 노드로 넣는다. 줄이 없으면
 * 그리지 않는다.
 */
function FixSummaryCard({ lines }: { readonly lines: readonly FixLine[] }): JSX.Element | null {
  if (lines.length === 0) {
    return null;
  }
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-title font-semibold text-ink">먼저 할 일</h2>
      <ul className="space-y-2">
        {lines.map((line) => {
          const tone = SEVERITY_TONE[line.severity];
          return (
            // 같은 심각도의 같은 문장은 `fixSummary` 가 한 줄로 접으므로 이 쌍이 유일하다.
            <li key={`${line.severity}:${line.fix}`} className="flex items-start gap-2">
              <span
                data-severity={line.severity}
                className={SEVERITY_CHIP_CLASS}
                style={{ color: tone.fg, background: tone.bg }}
              >
                {SEVERITIES.find((entry) => entry.severity === line.severity)?.label}
              </span>
              <span className="min-w-0 break-words text-sm text-ink">
                {line.fix}
                {line.count >= 2 && ` (발견 ${line.count}건)`}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * 사전 점검(ADR-0111). 사용자 모드의 첫 화면이다. 붙여 넣은 서버 설정을 `POST /api/analyze/security` 로
 * 한 번 점검한다. 진행은 그 run 의 SSE 로 받고, 끝나면 `GET /api/analyze/security/<runId>` 를 한 번
 * 읽는다. 판정은 CLI 와 같은 함수가 한 것이고 이 화면은 받은 글자를 보이기만 한다.
 *
 * 붙여 넣은 설정의 env 값과 헤더 값은 입력 칸 밖 어디에도 보이지 않고 어디에도 보내지 않는다. 이름만
 * 화면에 보이고 요청에는 이름도 싣지 않는다. 최근 명령 목록에도 쓰지 않는다.
 *
 * 단계는 `SecurityPanel` 과 같이 따로 상태를 두지 않고 구한다. 결과가 있으면 결과, 도는 run 이 있으면
 * 점검, 아니면 서버 붙여넣기다. 타이머와 폴링이 없다.
 */
export function PreCheck(): JSX.Element {
  const [text, setText] = useState("");
  /** 고른 서버의 자리. 붙여 넣은 설정에 서버가 둘 이상일 때만 뜻이 있다. */
  const [picked, setPicked] = useState(0);
  /** 사전 점검의 대상은 믿지 않는 서버라 격리가 기본이다. */
  const [sandbox, setSandbox] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  /** 시작에 성공한 요청 그대로. 다시 점검이 입력을 다시 읽지 않고 이것을 보낸다. */
  const [sent, setSent] = useState<AnalyzeSecurityRequest | null>(null);
  const [result, setResult] = useState<AnalyzeSecurityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /**
   * 지금 기다리는 run. 점검 단계를 떠난 뒤에 늦게 도착한 결과를 버리는 데 쓴다. 렌더에서는 읽지 않는다.
   */
  const awaitedRun = useRef<string | null>(null);

  const parsed = parseServerInput(text);
  /** 점검할 서버. `picked` 가 범위를 벗어나면 첫째를 쓴다. */
  const server = parsed.ok ? (parsed.servers[picked] ?? parsed.servers[0] ?? null) : null;
  const http = server?.transport === "http";
  /** 원격 대상에서는 체크가 남아 있어도 꺼진 것으로 보인다. 요청도 싣지 않는다. */
  const sandboxOn = sandbox && !http;

  /** 버튼 비활성 판정·사유·제출이 같은 함수를 쓴다. 입력을 읽지 못한 사유가 먼저다. */
  function requestResult():
    | { readonly request: AnalyzeSecurityRequest }
    | { readonly error: string } {
    if (!parsed.ok) {
      return { error: parsed.error };
    }
    if (server === null) {
      return { error: "설정에 서버가 없습니다." };
    }
    try {
      return { request: buildPrecheckRequest(server, sandbox) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const built = requestResult();

  /** 점검을 시작한다. 실패하면 서버 문장을 그대로 보인다. */
  async function start(request: AnalyzeSecurityRequest): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const response = await apiSend<StartRunResponse>("POST", "/api/analyze/security", request);
      // 다시 점검이면 여기서 앞 결과를 내린다. 시작에 실패하면 앞 결과는 그대로 남는다.
      setResult(null);
      setSent(request);
      setRunId(response.runId);
      awaitedRun.current = response.runId;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  /** run 이 끝난 뒤 결과를 한 번 읽는다. 리포트 없이 끝난 점검은 400 이고 그 본문이 CLI stderr 원문이다. */
  async function loadResult(finishedRunId: string): Promise<void> {
    try {
      const response = await apiGet<AnalyzeSecurityResponse>(
        `/api/analyze/security/${encodeURIComponent(finishedRunId)}`,
      );
      if (awaitedRun.current === finishedRunId) {
        setResult(response);
      }
    } catch (err) {
      if (awaitedRun.current !== finishedRunId) {
        return;
      }
      leaveRun();
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** 서버 붙여넣기 단계로 돌아간다. 입력(text), 고른 서버(picked), 격리 선택(sandbox)은 그대로 둔다. */
  function leaveRun(): void {
    awaitedRun.current = null;
    setRunId(null);
    setResult(null);
    setError(null);
  }

  const step = result !== null && sent !== null ? 2 : runId !== null && sent !== null ? 1 : 0;

  const errorAlert = error !== null && <ErrorAlert message={error} />;

  return (
    <section className="mx-auto max-w-[800px] space-y-6">
      <PageHeader title="사전 점검" description={PRECHECK_DESCRIPTION} />

      <Stepper steps={STEPS} current={step} />

      {step === 0 && (
        <>
          <Card className="space-y-5 p-6">
            <Field label="서버 설정 또는 실행 명령" htmlFor="precheck-input" hint={INPUT_HINT}>
              <textarea
                id="precheck-input"
                className={`${INPUT_CLASS} font-mono`}
                rows={6}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  // 다른 설정을 붙여 넣었으면 앞 설정에서 고른 자리는 뜻이 없다.
                  setPicked(0);
                }}
              />
            </Field>

            {parsed.ok && parsed.servers.length > 1 && (
              <Field label="점검할 서버" htmlFor="precheck-server">
                <select
                  id="precheck-server"
                  className={INPUT_CLASS}
                  value={server === null ? 0 : parsed.servers.indexOf(server)}
                  onChange={(event) => setPicked(Number(event.target.value))}
                >
                  {parsed.servers.map((entry, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 선택지는 붙여 넣은 순서 그대로이고 자리가 곧 값이다. 이름 없는 서버는 글자가 겹칠 수 있다
                    <option key={index} value={index}>
                      {entry.name ?? targetOf(entry)}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {server !== null && (
              <div className="space-y-1">
                <p className={TARGET_LINE_CLASS}>{`점검 대상: ${targetOf(server)}`}</p>
                {server.envNames.length > 0 && (
                  <p className={NOTE_CLASS}>
                    {`이 설정의 환경변수 ${server.envNames.length}개(${server.envNames.join(", ")})는 서버에 넘기지 않습니다. 사전 점검은 실제 비밀값 없이 돕니다.`}
                  </p>
                )}
                {server.headerNames.length > 0 && (
                  <p className={NOTE_CLASS}>
                    {`이 설정의 헤더 ${server.headerNames.length}개(${server.headerNames.join(", ")})는 보내지 않습니다. 인증이 필요한 서버는 접속 실패로 끝날 수 있습니다.`}
                  </p>
                )}
              </div>
            )}

            <Toggle
              id="precheck-sandbox"
              label="Docker 격리 안에서 실행 (권장)"
              checked={sandboxOn}
              disabled={http}
              hint={http ? REMOTE_SANDBOX_HINT : sandboxOn ? SANDBOX_ON_HINT : SANDBOX_OFF_HINT}
              onChange={setSandbox}
            />

            <div className="space-y-2">
              <Button
                variant="primary"
                disabled={starting || !("request" in built)}
                onClick={() => {
                  if ("request" in built) {
                    void start(built.request);
                  }
                }}
              >
                {starting ? "점검 중…" : "점검 시작"}
              </Button>
              {"error" in built && <p className={NOTE_CLASS}>{built.error}</p>}
            </div>
          </Card>

          {errorAlert}
        </>
      )}

      {step === 1 && runId !== null && sent !== null && (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={leaveRun}>← 서버 다시 붙여넣기</Button>
              {/* 취소 API 가 없다. 화면만 돌아가고 서버의 run 은 끝까지 돈다. */}
              <p className={NOTE_CLASS}>점검은 중단되지 않고 끝까지 돕니다.</p>
            </div>
            {/* 보낸 요청에서 읽는다. 다시 점검으로 온 경우에도 실제로 도는 대상과 같은 글자다. */}
            <p className={TARGET_LINE_CLASS}>
              {`점검 대상: ${describeRun("audit", sent.argv).server ?? ""}`}
            </p>
          </div>
          <SecurityProgress
            key={runId}
            runId={runId}
            onFinished={(finished) => void loadResult(finished)}
            onMissing={(message) => {
              leaveRun();
              setError(message);
            }}
          />
        </>
      )}

      {step === 2 && result !== null && sent !== null && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button onClick={leaveRun}>← 서버 다시 붙여넣기</Button>
            <Button disabled={starting} onClick={() => void start(sent)}>
              다시 점검
            </Button>
          </div>
          {/* 다시 점검의 시작 실패는 결과 위에 보인다. 앞 결과는 그대로 둔다. */}
          {errorAlert}
          <FixSummaryCard lines={fixSummary(result.report.findings)} />
          <SecurityResult response={result} request={sent} />
        </>
      )}
    </section>
  );
}

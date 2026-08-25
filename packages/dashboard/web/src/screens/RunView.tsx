import type { JSX } from "react";
import { useEffect, useState } from "react";
import type {
  PendingQuestion,
  RunSummary,
  StartRunRequest,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import { FlowChip } from "../components/FlowChip.js";
import { LogPanel } from "../components/LogPanel.js";
import { QuestionPanel } from "../components/QuestionPanel.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { type AiProvider, MODEL_OPTIONS } from "../provider-models.js";
import { repairBundlePathOf } from "../repair-bundle-path.js";
import { useRunEvents } from "../run-stream.js";
import type { RunTarget } from "../run-target.js";
import { describeRun } from "../run-target.js";

/** repair 폼 입력란 공통 클래스. 대시보드 테마를 그대로 따른다. */
const REPAIR_INPUT_CLASS =
  "w-full rounded border border-line bg-surface px-3 py-1.5 font-mono text-sm text-ink";

/** 검토 메뉴가 연 하위 입력만 뒤로가기를 제공한다. 일반 입력 질문의 의미는 바꾸지 않는다. */
function canReturnToReviewMenu(question: {
  readonly kind: string;
  readonly message: string;
}): boolean {
  if (question.kind !== "input") return false;
  const message = question.message.trim();
  return (
    message === "AI 요청:" ||
    message === "피드백:" ||
    message === "적용할 change ID를 쉼표로 입력하세요:" ||
    message === "편집한 JSON 파일 경로:" ||
    /^(codex|claude) model \(/.test(message)
  );
}

function isAiPrompt(question: PendingQuestion): boolean {
  if (question.kind !== "input") return false;
  const message = question.message.trim();
  return message === "AI 요청:" || message === "피드백:";
}

function isAiDispatchConfirmation(question: PendingQuestion): boolean {
  return question.kind === "confirm" && question.message.trim() === "이 요청을 전송할까요?";
}

interface AiConversation {
  readonly question: string;
  readonly questionEventId: number;
  readonly responseAfterEventId: number | null;
}

interface RunStreamPanelProps {
  readonly runId: string;
  /**
   * 실패 시 repair 시작 버튼을 보여줄지 여부. RepairReview 화면은 이미 수리 진행
   * 화면이므로 여기서 또 새 수리를 시작하는 버튼을 두지 않는다.
   */
  readonly showRepairAction?: boolean;
}

/**
 * `RunView`·`GenerateWizard`·`RepairReview`가 공유하는 스트림 패널(UI 설계 §5-2).
 * stdout/stderr를 도착 순서 그대로 LogPanel에 렌더한다(재작성·재정렬 없음).
 * `pendingQuestion`은 LogPanel footer의 QuestionPanel로 보여주고, 응답은
 * `POST /api/runs/:id/answer`로 보낸다.
 */
export function RunStreamPanel({
  runId,
  showRepairAction = true,
}: RunStreamPanelProps): JSX.Element {
  const { events, status, pendingQuestion, error: streamError } = useRunEvents(runId);
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const [generatingAfterQuestionId, setGeneratingAfterQuestionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [bundlePath, setBundlePath] = useState("");
  const [provider, setProvider] = useState<AiProvider>("claude");
  const [model, setModel] = useState("");
  const [conversations, setConversations] = useState<readonly AiConversation[]>([]);
  /**
   * 이 run 의 argv. `null` 은 "아직 모른다" 다. 홈의 test 실행은 항상 `--repair-bundle` 을
   * 붙이므로(ADR-0080) 여기서 그 값을 읽어 repair 폼을 채운다. 사용자가 같은 경로를 두 번
   * 치던 자리다. 모르면 버튼도 안내도 그리지 않는다(#295 와 같은 원칙. 아는 척하지 않는다).
   */
  const [argv, setArgv] = useState<readonly string[] | null>(null);
  /** 이 run 의 대상(스위트·서버). 목록과 같은 문장을 상세 화면 머리에도 둔다. */
  const [runTarget, setRunTarget] = useState<RunTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    setArgv(null);
    setRunTarget(null);
    // 같은 패널 인스턴스가 다른 run 으로 바뀔 수 있다. 앞 run 의 경로가 남으면 그것을 보내고,
    // 앞 run 에서 연 폼이 그대로 열려 있으면 다른 run 의 폼처럼 보인다.
    setBundlePath("");
    setRepairOpen(false);
    setAnsweredId(null);
    setGeneratingAfterQuestionId(null);
    setConversations([]);
    apiGet<RunSummary>(`/api/runs/${encodeURIComponent(runId)}`)
      .then((summary) => {
        if (cancelled || !Array.isArray(summary.argv)) return;
        setArgv(summary.argv);
        setRunTarget(describeRun(summary.flow, summary.argv));
        const found = repairBundlePathOf(summary.argv);
        if (found !== null) setBundlePath((previous) => (previous === "" ? found : previous));
      })
      .catch(() => {
        // 스트림 쪽이 이미 "없는 run" 문장을 낸다. 여기서 또 말하지 않는다.
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const runBundlePath = argv === null ? null : repairBundlePathOf(argv);

  /**
   * 세 값이 다 차야 보낸다. 예전에는 prompt 세 번을 다 통과한 뒤에야 실패했다(#223).
   * 꺼진 이유는 버튼 옆에 말한다 — 판정만 하고 침묵하면 사용자가 폼 전체를 다시
   * 의심한다(#354). GenerateWizard 의 `reasonForInvalid()` 와 같은 패턴이다.
   */
  const repairBlockReason =
    bundlePath.trim() === ""
      ? "repair 번들 경로를 입력하세요."
      : model.trim() === ""
        ? "model 을 선택하세요."
        : null;
  const repairReady = repairBlockReason === null;

  const doneEvent = events.find((event) => event.kind === "done");
  const exitCode = doneEvent?.kind === "done" ? doneEvent.exitCode : null;

  // run-stream은 pendingQuestion을 다음 question/done까지 유지하므로,
  // "답변 후 패널 숨김"은 마지막으로 응답한 question.id를 여기서 기억해 처리한다.
  const visibleQuestion =
    pendingQuestion !== null && pendingQuestion.id !== answeredId ? pendingQuestion : null;

  const suiteGenerating = generatingAfterQuestionId !== null;

  useEffect(() => {
    if (generatingAfterQuestionId === null) return;
    const nextQuestionArrived =
      pendingQuestion !== null && pendingQuestion.id !== generatingAfterQuestionId;
    if (nextQuestionArrived || status === "done" || status === "failed") {
      setGeneratingAfterQuestionId(null);
    }
  }, [generatingAfterQuestionId, pendingQuestion, status]);

  async function answer(question: PendingQuestion, value: string): Promise<void> {
    setError(null);
    // generate 직후의 첫 전송 승인만 스위트 생성 시작이다. 검토 메뉴에서 AI 요청을
    // 입력한 뒤 도착하는 같은 문구의 승인은 후속 질문 전송이므로 답변 대기 상태만 쓴다.
    const startsSuiteGeneration =
      isAiDispatchConfirmation(question) && value === "y" && conversations.length === 0;
    if (startsSuiteGeneration) setGeneratingAfterQuestionId(question.id);
    if (isAiPrompt(question)) {
      const questionEventId =
        events.find((event) => event.kind === "question" && event.question.id === question.id)
          ?.id ??
        events.at(-1)?.id ??
        0;
      setConversations((previous) => [
        ...previous,
        { question: value, questionEventId, responseAfterEventId: null },
      ]);
    } else if (isAiDispatchConfirmation(question) && value === "y") {
      const latestEventId = events.at(-1)?.id ?? 0;
      setConversations((previous) =>
        previous.map((conversation, index) =>
          index === previous.length - 1
            ? { ...conversation, responseAfterEventId: latestEventId }
            : conversation,
        ),
      );
    }
    try {
      await apiSend("POST", `/api/runs/${encodeURIComponent(runId)}/answer`, {
        questionId: question.id,
        value,
      });
      setAnsweredId(question.id);
    } catch (err) {
      if (startsSuiteGeneration) setGeneratingAfterQuestionId(null);
      if (isAiDispatchConfirmation(question)) {
        setConversations((previous) =>
          previous.map((conversation, index) =>
            index === previous.length - 1
              ? { ...conversation, responseAfterEventId: null }
              : conversation,
          ),
        );
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function back(questionId: string): Promise<void> {
    setError(null);
    try {
      await apiSend("POST", `/api/runs/${encodeURIComponent(runId)}/answer`, {
        questionId,
        action: "back",
      });
      setAnsweredId(questionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 번들 목록 API가 없어 경로는 직접 입력받는다. 예전에는 `window.prompt` 세 번이었다.
   * 그 방식은 테마와 따로 놀고, 되돌아갈 수 없고, provider 가 자유 입력이었다(#223).
   *
   * 번들이 어디서 나오는지는 화면에 적는다 — 그것을 모르면 무엇을 넣어야 하는지 알
   * 방법이 없다는 것이 이 자리의 핵심 불만이었다.
   */
  async function startRepair(): Promise<void> {
    if (!repairReady) return;
    setStarting(true);
    setError(null);
    try {
      // --yes는 넣지 않는다. 승인/거부는 RepairReview 화면에서 question 이벤트로 와
      // QuestionPanel의 confirm/choose로 답한다. --yes를 넣으면 CLI가 자동 승인해 버려
      // 검토 화면이 볼 것이 없어진다.
      const response = await apiSend<StartRunResponse>("POST", "/api/runs", {
        flow: "repair",
        argv: [bundlePath.trim(), "--provider", provider, "--model", model.trim()],
      } satisfies StartRunRequest);
      window.location.hash = `#/repair/${encodeURIComponent(response.runId)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  const terminalConversations = conversations.map((conversation) => {
    const responseStartId = conversation.responseAfterEventId;
    const responseBoundaryId =
      responseStartId === null
        ? null
        : (events.find(
            (event) =>
              event.id > responseStartId && (event.kind === "question" || event.kind === "done"),
          )?.id ?? null);
    const firstResponseEventId =
      responseStartId === null
        ? null
        : (events.find(
            (event) =>
              event.id > responseStartId &&
              (responseBoundaryId === null || event.id < responseBoundaryId) &&
              (event.kind === "stdout" || event.kind === "stderr"),
          )?.id ?? null);
    return {
      question: conversation.question,
      questionEventId: conversation.questionEventId,
      firstResponseEventId,
      waiting:
        responseStartId !== null && firstResponseEventId === null && responseBoundaryId === null,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/*
          "대기" 는 상태가 아니라 **모른다는 뜻인데 아는 척한 문구**였다. `RunStatus` 에
          그런 값은 없다(running/waiting-input/done/failed). 그래서 없는 run 과 도는 run 이
          여기서 같은 글자가 됐다(#295). 모르는 것은 모른다고 쓴다.
        */}
        {status !== null ? (
          <StatusBadge status={status} exitCode={exitCode} />
        ) : streamError === null ? (
          <span className="text-xs text-ink-muted">상태를 확인하는 중...</span>
        ) : (
          <span className="text-xs" style={{ color: "var(--status-failed-fg)" }}>
            상태를 확인할 수 없음
          </span>
        )}
        {status === "failed" && showRepairAction && runBundlePath !== null && (
          <button
            type="button"
            aria-expanded={repairOpen}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={starting}
            onClick={() => setRepairOpen((open) => !open)}
          >
            repair 시작
          </button>
        )}
        {status === "failed" && showRepairAction && argv !== null && runBundlePath === null && (
          <span className="text-xs text-ink-muted">
            이 실행은 repair 번들 없이 시작됐습니다. Test 에서 다시 실행하면 번들이 만들어집니다.
          </span>
        )}
      </div>

      {runTarget !== null && <RunTargetText target={runTarget} />}

      {status === "failed" && showRepairAction && runBundlePath !== null && repairOpen && (
        <form
          className="space-y-4 rounded-lg border border-line bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void startRepair();
          }}
        >
          <div className="space-y-1">
            <label className="block text-sm font-medium text-ink" htmlFor="repair-bundle">
              repair 번들 경로
            </label>
            <input
              id="repair-bundle"
              className={REPAIR_INPUT_CLASS}
              value={bundlePath}
              placeholder="예: .mcpeak/repair-bundle.json"
              onChange={(event) => setBundlePath(event.target.value)}
            />
            <p className="text-xs text-ink-muted">
              이 실행이 만든 번들입니다. 다른 번들을 쓰려면 경로를 바꾸세요.
            </p>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-ink" htmlFor="repair-provider">
              provider
            </label>
            <select
              id="repair-provider"
              className={REPAIR_INPUT_CLASS}
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value === "codex" ? "codex" : "claude");
                setModel("");
              }}
            >
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-ink" htmlFor="repair-model">
              model
            </label>
            <select
              id="repair-model"
              className={REPAIR_INPUT_CLASS}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="">모델을 선택하세요</option>
              {MODEL_OPTIONS[provider].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {/* generate 의 모델 칸은 "(선택)" 인데 이 칸은 CLI 가 --model 을 요구한다.
                같은 생김새의 칸이 화면마다 다르게 구는 것을 여기서 말해 준다(#354). */}
            <p className="text-xs text-ink-muted">repair 는 모델 지정이 필수입니다.</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={starting || !repairReady}
            >
              시작
            </button>
            <button
              type="button"
              className="rounded border border-line px-3 py-1.5 text-sm text-ink-muted"
              onClick={() => setRepairOpen(false)}
            >
              취소
            </button>
            {repairBlockReason !== null && (
              <span className="text-xs text-ink-muted">{repairBlockReason}</span>
            )}
          </div>
        </form>
      )}

      {error !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {error}
        </p>
      )}

      {/*
        서버가 만든 문장을 그대로 옮긴다. 줄바꿈이 살아야 하므로 whitespace-pre-line 이다
        — 안내 두 줄이 한 줄로 뭉개지면 "어떻게 고치는지" 가 사라진다.
      */}
      {streamError !== null && (
        <p className="whitespace-pre-line text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {streamError}
        </p>
      )}

      <LogPanel
        title="터미널 출력"
        meta={
          <span className="font-mono text-xs" style={{ color: "var(--terminal-muted)" }}>
            {events.filter((event) => event.kind === "stdout" || event.kind === "stderr").length}줄
          </span>
        }
        events={events}
        conversations={terminalConversations}
        footer={
          visibleQuestion !== null ? (
            // key로 question.id를 줘서 새 질문마다 리마운트한다(입력값 초기화).
            <QuestionPanel
              key={visibleQuestion.id}
              question={visibleQuestion}
              onAnswer={(value) => answer(visibleQuestion, value)}
              onBack={
                canReturnToReviewMenu(visibleQuestion) ? () => back(visibleQuestion.id) : undefined
              }
            />
          ) : suiteGenerating ? (
            <p className="font-sans text-sm text-white" role="status" aria-live="polite">
              스위트 생성중...
            </p>
          ) : undefined
        }
      />
    </div>
  );
}

/**
 * 이 run 이 무엇을 무엇으로 돌렸는지 한 줄. **어느 서버였는지가 목록에서 안 보이면 run 은
 * 서로 구별되지 않는다** — runId 는 사람이 기억하는 이름이 아니다.
 *
 * 긴 명령은 말줄임하고 전문은 `title` 로 남긴다. 모르는 칸은 그냥 비운다(#295).
 */
function RunTargetText({ target }: { readonly target: RunTarget }): JSX.Element | null {
  if (target.suite === null && target.server === null) {
    return null;
  }
  const full = [target.suite, target.server].filter((part) => part !== null).join("  ·  ");
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2" title={full}>
      {target.suite !== null && (
        <span className="max-w-[45%] truncate font-mono text-xs text-ink">{target.suite}</span>
      )}
      {target.server !== null && (
        <span className="min-w-0 truncate font-mono text-xs text-ink-muted">{target.server}</span>
      )}
    </span>
  );
}

interface RunViewProps {
  readonly runId: string | null;
}

/** `#/runs`(목록 상태)와 `#/runs/:id`(스트림 상태)를 겸하는 Runs 화면. */
export function RunView({ runId }: RunViewProps): JSX.Element {
  if (runId === null) {
    return <RunList />;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <a className="text-sm text-accent hover:underline" href="#/runs">
          ← Runs
        </a>
        <h1 className="font-mono text-lg font-semibold text-ink">{runId}</h1>
      </div>
      <RunStreamPanel runId={runId} />
    </section>
  );
}

/** `#/runs` 목록 상태: 실행 이력 전체를 최근 실행 표와 같은 형태로 보여준다. */
function RunList(): JSX.Element {
  const [runs, setRuns] = useState<readonly RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<RunSummary[]>("/api/runs")
      .then(setRuns)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-ink">실행</h1>
      {error !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {error}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-line-subtle">
            {runs === null && (
              <tr>
                <td className="px-4 py-3 text-ink-muted">불러오는 중...</td>
              </tr>
            )}
            {runs !== null && runs.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-ink-muted">아직 실행이 없습니다.</td>
              </tr>
            )}
            {runs?.map((run) => {
              const target = describeRun(run.flow, run.argv);
              return (
                <tr key={run.runId}>
                  <td className="px-4 py-2">
                    <a
                      className="flex items-center gap-3 text-ink hover:text-accent"
                      href={`#/runs/${encodeURIComponent(run.runId)}`}
                    >
                      <FlowChip flow={run.flow} />
                      <span className="shrink-0 font-mono text-xs">{run.runId}</span>
                      <RunTargetText target={target} />
                      <StatusBadge status={run.status} exitCode={run.exitCode} />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

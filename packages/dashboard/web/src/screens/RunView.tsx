import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  PendingQuestion,
  RunStatus,
  RunSummary,
  StartRunRequest,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { EmptyState } from "../components/EmptyState.js";
import { Field, INPUT_CLASS } from "../components/Field.js";
import { FlowChip } from "../components/FlowChip.js";
import { LogPanel } from "../components/LogPanel.js";
import { PageHeader } from "../components/PageHeader.js";
import { QuestionPanel } from "../components/QuestionPanel.js";
import { RunCounts } from "../components/RunCounts.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { countOutputLines, outputText } from "../output-lines.js";
import { type AiProvider, MODEL_OPTIONS } from "../provider-models.js";
import { repairBundlePathOf } from "../repair-bundle-path.js";
import { useRunEvents } from "../run-stream.js";
import { parseRunTally } from "../run-tally.js";
import type { RunTarget } from "../run-target.js";
import { describeRun } from "../run-target.js";

/** 제목을 따로 받지 않은 실행 화면의 제목. flow 를 모르는 동안은 "실행" 이다. */
const FLOW_TITLES: Record<RunSummary["flow"], string> = {
  test: "테스트 실행",
  generate: "생성 실행",
  repair: "수리 실행",
};

/**
 * 상태 뱃지 아래 한 줄. 뱃지는 **무엇인지**만 말하므로 사람이 지금 할 일을 따로 적는다.
 * 입력 대기일 때가 가장 중요하다 — 화면 어딘가에 답할 자리가 있다는 것을 모르면 run 이 멈춘
 * 것처럼 보인다.
 */
const STATUS_NOTES: Record<RunStatus, string> = {
  running: "CLI 가 실행 중입니다. 끝나면 요약이 나옵니다.",
  "waiting-input": "아래 질문에 답하면 이어서 진행합니다.",
  done: "실행이 끝났습니다.",
  failed: "실패로 끝났습니다. 원인은 터미널 출력에 있습니다.",
};

/** 터미널 카드 머리의 수신 표시. 서버는 스트림을 닫지 않으므로 끝은 status 로만 안다. */
const STREAM_LABELS: Record<RunStatus, { readonly label: string; readonly color: string }> = {
  running: { label: "수신 중", color: "var(--status-done-fg)" },
  "waiting-input": { label: "입력 대기", color: "var(--status-waiting-fg)" },
  done: { label: "끝남", color: "var(--ink-muted)" },
  failed: { label: "끝남", color: "var(--ink-muted)" },
};

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

/**
 * 클립보드에 쓴다. **보안 컨텍스트가 아니면 `navigator.clipboard` 가 아예 없다** — 대시보드를
 * `localhost` 가 아닌 주소로 열었을 때다. 그때 `undefined.writeText` 로 죽게 두면 사람에게 남는
 * 문장이 "Cannot read properties of undefined" 가 된다.
 */
async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard === undefined) {
    throw new Error(
      "이 주소에서는 브라우저가 클립보드 API 를 주지 않습니다(보안 컨텍스트가 아님).",
    );
  }
  await navigator.clipboard.writeText(text);
}

function clipboardFailure(what: string, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  return (
    `${what}을(를) 클립보드에 넣지 못했습니다: ${reason}\n` +
    "→ 브라우저가 클립보드 접근을 막았을 수 있습니다. 해당 영역을 직접 선택해 복사하세요."
  );
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
  /** 화면 제목. 없으면 run 의 flow 로 정한다(`FLOW_TITLES`). */
  readonly title?: string;
  readonly description?: string;
  /** 제목 위 되돌아가기 링크. */
  readonly back?: { readonly href: string; readonly label: string };
}

/**
 * `RunView`·`RepairReview`가 공유하는 실행 화면(UI 설계 §5-2, #459).
 * stdout/stderr를 도착 순서 그대로 LogPanel에 렌더한다(재작성·재정렬 없음).
 * `pendingQuestion`은 LogPanel footer의 QuestionPanel로 보여주고, 응답은
 * `POST /api/runs/:id/answer`로 보낸다.
 *
 * **화면 머리까지 여기서 그린다.** 상태는 이 컴포넌트가 구독하는 스트림에서만 나오는데, 사진
 * 시안(#459)은 그것을 제목 줄 오른쪽에 둔다. 머리를 부르는 쪽에 두면 같은 스트림을 두 번
 * 구독하게 된다.
 */
export function RunStreamPanel({
  runId,
  showRepairAction = true,
  title,
  description,
  back,
}: RunStreamPanelProps): JSX.Element {
  const { events, status, pendingQuestion, error: streamError, missing } = useRunEvents(runId);
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
  /** 제목을 정할 flow. 모르는 동안은 null 이고 제목은 "실행" 이다. */
  const [flow, setFlow] = useState<RunSummary["flow"] | null>(null);
  /**
   * "지우기" 가 가린 마지막 이벤트 id. **화면에서만 가린다** — 이벤트는 그대로 남아 요약 줄을
   * 읽는 데 쓰이고, 새로고침하면 SSE 가 처음부터 다시 보내 전부 돌아온다.
   */
  const [clearedThroughId, setClearedThroughId] = useState(0);
  /**
   * 출력을 복사한 시점의 이벤트 수. 같으면 "복사됨" 이라고 말한다. **타이머로 되돌리지 않는다**
   * — 새 출력이 오면 복사해 둔 것이 낡으므로, 그때 라벨이 "복사" 로 돌아가는 것이 맞다.
   */
  const [copiedAtCount, setCopiedAtCount] = useState<number | null>(null);
  const [runIdCopied, setRunIdCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setArgv(null);
    setRunTarget(null);
    setFlow(null);
    // 같은 패널 인스턴스가 다른 run 으로 바뀔 수 있다. 앞 run 의 경로가 남으면 그것을 보내고,
    // 앞 run 에서 연 폼이 그대로 열려 있으면 다른 run 의 폼처럼 보인다.
    setBundlePath("");
    setRepairOpen(false);
    setAnsweredId(null);
    setGeneratingAfterQuestionId(null);
    setConversations([]);
    setClearedThroughId(0);
    setCopiedAtCount(null);
    setRunIdCopied(false);
    apiGet<RunSummary>(`/api/runs/${encodeURIComponent(runId)}`)
      .then((summary) => {
        if (cancelled || !Array.isArray(summary.argv)) return;
        setArgv(summary.argv);
        setFlow(summary.flow);
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

  /** 요약 줄은 "지우기" 와 무관하게 전체 출력에서 읽는다 — 가린 것이지 없어진 것이 아니다. */
  const tally = useMemo(() => parseRunTally(outputText(events)), [events]);
  const visibleEvents = useMemo(
    () => events.filter((event) => event.id > clearedThroughId),
    [events, clearedThroughId],
  );
  const visibleLineCount = countOutputLines(visibleEvents);

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

  async function returnToReviewMenu(questionId: string): Promise<void> {
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

  async function copyOutput(): Promise<void> {
    setError(null);
    try {
      await writeClipboard(outputText(visibleEvents));
      setCopiedAtCount(events.length);
    } catch (err) {
      setError(clipboardFailure("터미널 출력", err));
    }
  }

  async function copyRunId(): Promise<void> {
    setError(null);
    try {
      await writeClipboard(runId);
      setRunIdCopied(true);
    } catch (err) {
      setError(clipboardFailure("Run ID", err));
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

  const showRepairButton = status === "failed" && showRepairAction && runBundlePath !== null;
  const stream = status === null ? null : STREAM_LABELS[status];

  return (
    /*
      **이 화면만 뷰포트를 채운다.** 로그는 자기 안에서 넘치고 질문 패널은 늘 보이게 하려면
      바깥 높이가 정해져 있어야 한다. 목록 상태(`RunList`)는 그대로 흐르게 둔다 — 실행이
      많아지면 길어지는 것이 맞다.

      **바닥 높이는 터미널 카드가 갖는다**(`LogPanel` 의 `min-h-[440px]`). 예전에는 이 상자가
      `min-h-[600px]` 을 갖고 터미널은 남는 높이만 받아서, 보통 창에서도 터미널이 몇 줄짜리로
      눌렸다(#459 피드백: 더 커야 한다). 이제 창이 낮으면 터미널이 줄어드는 대신 이 화면이 `main`
      보다 길어지고 바깥이 스크롤한다 — 터미널은 읽을 수 있는 크기를 지킨다.
    */
    <section className="flex h-full flex-col gap-4">
      <PageHeader
        back={back}
        title={title ?? (flow === null ? "실행" : FLOW_TITLES[flow])}
        description={description}
        meta={<RunMeta target={runTarget} runId={runId} copied={runIdCopied} onCopy={copyRunId} />}
        aside={
          <>
            {/*
              "대기" 는 상태가 아니라 **모른다는 뜻인데 아는 척한 문구**였다. `RunStatus` 에
              그런 값은 없다(running/waiting-input/done/failed). 그래서 없는 run 과 도는 run 이
              여기서 같은 글자가 됐다(#295). 모르는 것은 모른다고 쓴다.
            */}
            {/* 폭을 좁게 둔다. 문구가 두 줄로 감기는 대신 왼쪽 스위트 경로가 덜 잘린다. */}
            <div className="flex max-w-[200px] flex-col items-end gap-1 text-right">
              {status !== null ? (
                <>
                  <StatusBadge status={status} exitCode={exitCode} />
                  <p className="text-caption text-ink-muted">{STATUS_NOTES[status]}</p>
                </>
              ) : streamError === null ? (
                <span className="text-caption text-ink-muted">상태를 확인하는 중...</span>
              ) : (
                <span className="text-caption" style={{ color: "var(--status-failed-fg)" }}>
                  상태를 확인할 수 없음
                </span>
              )}
            </div>
            {/*
              집계 칸은 **머리에 얹는다** — 한 줄을 따로 쓰면 그만큼 터미널이 준다(#459 피드백:
              터미널이 주인공이다). 생성 · 수리 흐름은 요약 줄을 내지 않으므로 영영 채워지지 않을
              칸을 그리지 않는다. 다만 요약 줄이 실제로 왔다면 흐름과 무관하게 그것이 사실이다.
              없다고 확인된 run 에도 그리지 않는다 — 셀 것이 없다.
            */}
            {!missing && (tally !== null || (flow !== "generate" && flow !== "repair")) && (
              <RunCounts tally={tally} />
            )}
            {showRepairButton && (
              <Button
                variant="primary"
                size="sm"
                aria-expanded={repairOpen}
                disabled={starting}
                onClick={() => setRepairOpen((open) => !open)}
              >
                repair 시작
              </Button>
            )}
          </>
        }
      />

      {status === "failed" && showRepairAction && argv !== null && runBundlePath === null && (
        <p className="shrink-0 text-caption text-ink-muted">
          이 실행은 repair 번들 없이 시작됐습니다. Test 에서 다시 실행하면 번들이 만들어집니다.
        </p>
      )}

      {showRepairButton && repairOpen && (
        <form
          // 폼이 길어져도 로그를 밀어내지 않는다. 넘치면 폼 안에서 스크롤한다.
          //
          // **여기만 `Card` 를 못 쓴다.** `Card` 는 `div` 를 내는데 이 자리는 `form` 이어야
          // 한다. 생김새는 `Card` 와 같아야 하므로 클래스를 손으로 맞춰 둔다 — `Card` 에
          // 다형(`as`) 을 들이는 것이 나은지는 프리미티브가 더 쌓인 뒤에 정한다.
          className="max-h-[45%] shrink-0 space-y-4 overflow-auto rounded-lg border border-line bg-surface p-4 shadow-card"
          onSubmit={(event) => {
            event.preventDefault();
            void startRepair();
          }}
        >
          <Field
            label="repair 번들 경로"
            htmlFor="repair-bundle"
            hint="이 실행이 만든 번들입니다. 다른 번들을 쓰려면 경로를 바꾸세요."
          >
            <input
              id="repair-bundle"
              className={`${INPUT_CLASS} font-mono`}
              value={bundlePath}
              placeholder="예: .mcpeak/repair-bundle.json"
              onChange={(event) => setBundlePath(event.target.value)}
            />
          </Field>

          <Field label="provider" htmlFor="repair-provider">
            <select
              id="repair-provider"
              className={`${INPUT_CLASS} font-mono`}
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value === "codex" ? "codex" : "claude");
                setModel("");
              }}
            >
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
          </Field>

          {/* generate 의 모델 칸은 "(선택)" 인데 이 칸은 CLI 가 --model 을 요구한다.
              같은 생김새의 칸이 화면마다 다르게 구는 것을 여기서 말해 준다(#354). */}
          <Field label="model" htmlFor="repair-model" hint="repair 는 모델 지정이 필수입니다.">
            <select
              id="repair-model"
              className={`${INPUT_CLASS} font-mono`}
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
          </Field>

          <div className="flex items-center gap-2">
            {/* 폼 안이라 `type="submit"` 을 명시한다 — Button 의 기본값은 "button" 이다. */}
            <Button type="submit" variant="primary" size="sm" disabled={starting || !repairReady}>
              시작
            </Button>
            <Button size="sm" onClick={() => setRepairOpen(false)}>
              취소
            </Button>
            {repairBlockReason !== null && (
              <span className="text-xs text-ink-muted">{repairBlockReason}</span>
            )}
          </div>
        </form>
      )}

      {error !== null && (
        <p
          className="shrink-0 whitespace-pre-line text-sm"
          style={{ color: "var(--status-failed-fg)" }}
        >
          {error}
        </p>
      )}

      {missing && streamError !== null ? (
        /*
          **없다고 확인된 run 에는 빈 터미널을 그리지 않는다**(#459). 예전에는 빨간 문장 아래로
          화면을 채우는 빈 터미널 상자가 그대로 그려져, 무언가 올 것처럼 보였다. 서버 문장은
          그대로 옮기고(첫 줄), 그 뒤 안내가 말한 두 행동을 링크로 준다.
        */
        <Card className="shrink-0">
          <EmptyState
            message={streamError.split("\n")[0] ?? streamError}
            hint={streamError.split("\n").slice(1).join("\n")}
            action={{ href: "#/runs", label: "Runs 목록으로" }}
            secondaryAction={{ href: "#/home", label: "새 테스트 실행" }}
          />
        </Card>
      ) : (
        <>
          {/*
            서버가 만든 문장을 그대로 옮긴다. 줄바꿈이 살아야 하므로 whitespace-pre-line 이다
            — 안내 두 줄이 한 줄로 뭉개지면 "어떻게 고치는지" 가 사라진다.
          */}
          {streamError !== null && (
            <p
              className="shrink-0 whitespace-pre-line text-sm"
              style={{ color: "var(--status-failed-fg)" }}
            >
              {streamError}
            </p>
          )}

          <LogPanel
            title="터미널 출력"
            meta={
              <>
                {stream !== null && (
                  <span className="inline-flex items-center gap-1.5 text-caption text-ink-muted">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full"
                      style={{ background: stream.color }}
                    />
                    {stream.label}
                  </span>
                )}
                <span className="font-mono text-caption text-ink-muted">{visibleLineCount}줄</span>
              </>
            }
            actions={
              <>
                <Button
                  size="sm"
                  disabled={visibleLineCount === 0}
                  title="화면에서만 지웁니다. 새로고침하면 다시 나옵니다."
                  onClick={() => setClearedThroughId(events.at(-1)?.id ?? 0)}
                >
                  지우기
                </Button>
                <Button
                  size="sm"
                  disabled={visibleLineCount === 0}
                  onClick={() => void copyOutput()}
                >
                  {copiedAtCount === events.length ? "복사됨" : "복사"}
                </Button>
              </>
            }
            events={visibleEvents}
            conversations={terminalConversations}
            footer={
              visibleQuestion !== null ? (
                // key로 question.id를 줘서 새 질문마다 리마운트한다(입력값 초기화).
                <QuestionPanel
                  key={visibleQuestion.id}
                  question={visibleQuestion}
                  onAnswer={(value) => answer(visibleQuestion, value)}
                  onBack={
                    canReturnToReviewMenu(visibleQuestion)
                      ? () => returnToReviewMenu(visibleQuestion.id)
                      : undefined
                  }
                />
              ) : suiteGenerating ? (
                <p
                  className="rounded-lg border border-accent-border bg-accent-soft p-4 text-sm text-ink shadow-card"
                  role="status"
                  aria-live="polite"
                >
                  스위트 생성중...
                </p>
              ) : undefined
            }
          />
        </>
      )}
    </section>
  );
}

/**
 * 제목 아래 메타: 스위트 한 줄, 그 아래 서버와 Run ID 한 줄.
 *
 * 목록의 `RunTargetText` 를 쓰지 않는다. 그것은 **가로 한 행**에 스위트와 서버를 나란히 두려고
 * 스위트를 45% 로 자르는데, 머리에서는 오른쪽에 상태가 서므로 남는 폭이 좁아 경로가 앞 몇
 * 글자만 남았다. 여기서는 스위트가 한 줄을 다 쓴다.
 */
function RunMeta({
  target,
  runId,
  copied,
  onCopy,
}: {
  readonly target: RunTarget | null;
  readonly runId: string;
  readonly copied: boolean;
  readonly onCopy: () => Promise<void>;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1 pt-1">
      {target !== null && target.suite !== null && (
        <span className="flex min-w-0 items-center gap-2" title={target.suite}>
          <FileIcon />
          <span className="truncate font-mono text-body text-ink">{target.suite}</span>
        </span>
      )}
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
        {/* "서버" 와 명령도 한 덩어리다. 따로 두면 좁을 때 낱말 · 명령 · 구분점이 한 줄씩 끊긴다. */}
        {target !== null && target.server !== null && (
          <span className="inline-flex min-w-0 max-w-full items-center gap-2">
            <span className="shrink-0">서버</span>
            <code className="min-w-0 truncate font-mono text-ink" title={target.server}>
              {target.server}
            </code>
            <span aria-hidden="true">·</span>
          </span>
        )}
        {/* 줄이 넘칠 때 "Run ID" 와 값이 갈라지지 않게 한 덩어리로 묶는다. */}
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          Run ID
          <code className="font-mono text-ink">{runId}</code>
          <Button
            variant="ghost"
            size="xs"
            aria-label={copied ? "Run ID 복사됨" : "Run ID 복사"}
            onClick={() => void onCopy()}
          >
            {copied ? "복사됨" : "복사"}
          </Button>
        </span>
      </span>
    </div>
  );
}

function FileIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0 text-ink-muted"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" />
    </svg>
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
  return <RunStreamPanel runId={runId} back={{ href: "#/runs", label: "Runs 목록" }} />;
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
    <section className="space-y-6">
      <PageHeader
        title="실행"
        description="이 대시보드에서 시작한 실행입니다. 대시보드를 다시 띄우면 목록이 비워집니다."
      />
      {error !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {error}
        </p>
      )}
      <Card className="overflow-hidden">
        {/*
          `table-fixed` 가 없으면 표가 내용 폭을 따라 카드보다 넓어진다. 행 안의 말줄임
          (`truncate`)은 폭이 묶여야 작동하므로, 경로가 길면 줄여지지 않고 끝의 상태 뱃지가
          카드 밖으로 밀려 잘렸다.
        */}
        <table className="w-full table-fixed text-left text-sm">
          <tbody className="divide-y divide-line-subtle">
            {runs === null && (
              <tr>
                <td className="px-4 py-3 text-ink-muted">불러오는 중...</td>
              </tr>
            )}
            {runs !== null && runs.length === 0 && (
              <tr>
                <td>
                  <EmptyState
                    message="아직 실행이 없습니다."
                    hint="Test 에서 서버와 스위트를 골라 실행하면 여기에 쌓입니다."
                    action={{ href: "#/home", label: "Test 로 가서 실행하기" }}
                  />
                </td>
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
      </Card>
    </section>
  );
}

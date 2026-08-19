import { useState } from "react";
import type {
  RunEvent,
  RunStatus,
  StartRunRequest,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiSend } from "../api.js";
import { AnsiText } from "../components/AnsiText.js";
import { QuestionPanel } from "../components/QuestionPanel.js";
import { useRunEvents } from "../run-stream.js";

function StatusBadge({ status }: { readonly status: RunStatus | null }) {
  const label =
    status === "running"
      ? "실행 중"
      : status === "waiting-input"
        ? "응답 대기"
        : status === "done"
          ? "완료"
          : status === "failed"
            ? "실패"
            : "대기";
  const tone =
    status === "done"
      ? "bg-emerald-100 text-emerald-800"
      : status === "failed"
        ? "bg-red-100 text-red-800"
        : status === "waiting-input"
          ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-700";
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}

function LogLine({ event }: { readonly event: RunEvent }) {
  if (event.kind === "stdout" || event.kind === "stderr") {
    return (
      <div className={event.kind === "stderr" ? "text-red-300" : undefined}>
        <AnsiText html={event.html} />
      </div>
    );
  }
  if (event.kind === "question") {
    return <div className="text-amber-300">질문: {event.question.message}</div>;
  }
  return <div className="text-slate-400">종료 코드 {event.exitCode}</div>;
}

interface RunStreamPanelProps {
  readonly runId: string;
  /**
   * 실패 시 수리 시작 버튼을 보여줄지 여부. RepairReview 화면은 이미 수리 진행
   * 화면이므로 여기서 또 새 수리를 시작하는 버튼을 두지 않는다.
   */
  readonly showRepairAction?: boolean;
}

/**
 * `RunView`·`GenerateWizard`·`RepairReview`가 공유하는 스트림 패널. stdout/stderr를
 * 도착 순서 그대로 렌더링한다(재작성·재정렬 없음).
 */
export function RunStreamPanel({ runId, showRepairAction = true }: RunStreamPanelProps) {
  const { events, status, pendingQuestion } = useRunEvents(runId);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startRepair(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      // repair 번들 경로는 이 화면이 아는 정보 밖이다(§4-4는 repair argv 스키마를 두지
      // 않는다). generate가 만든 번들 JSON 경로를 사용자가 직접 지정하게 한다.
      const bundlePath = window.prompt("repair 번들 JSON 경로를 입력하세요:");
      if (bundlePath === null || bundlePath.trim() === "") {
        setStarting(false);
        return;
      }
      const provider = (window.prompt("provider (codex 또는 claude):", "claude") ?? "").trim();
      if (provider === "") {
        setStarting(false);
        return;
      }
      const model = (window.prompt("model:") ?? "").trim();
      if (model === "") {
        setStarting(false);
        return;
      }
      // --yes는 넣지 않는다. 승인/거부는 RepairReview 화면에서 question 이벤트로 와
      // QuestionPanel의 confirm/choose로 답한다(계획 §5 T4). --yes를 넣으면 CLI가 자동
      // 승인해 버려 검토 화면이 볼 것이 없어진다.
      const response = await apiSend<StartRunResponse>("POST", "/api/runs", {
        flow: "repair",
        argv: [bundlePath.trim(), "--provider", provider, "--model", model],
      } satisfies StartRunRequest);
      window.location.hash = `#/repair/${encodeURIComponent(response.runId)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <StatusBadge status={status} />
        {status === "failed" && showRepairAction && (
          <button
            type="button"
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={starting}
            onClick={() => void startRepair()}
          >
            수리 시작
          </button>
        )}
      </div>

      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      <div className="terminal-panel max-h-[60vh] overflow-auto rounded-lg p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap">
        {events.length === 0 ? (
          <p className="text-slate-400">아직 출력이 없습니다.</p>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: events는 append-only라 재정렬·삭제가 없다.
          events.map((event, index) => <LogLine key={index} event={event} />)
        )}
      </div>

      {pendingQuestion !== null && (
        // key로 question.id를 줘서 새 질문마다 QuestionPanel을 리마운트한다.
        // 답변 입력값·에러 초기화를 useEffect 없이 여기서 해결한다.
        <QuestionPanel key={pendingQuestion.id} runId={runId} question={pendingQuestion} />
      )}
    </div>
  );
}

interface RunViewProps {
  readonly runId: string | null;
}

export function RunView({ runId }: RunViewProps) {
  if (runId === null) {
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-semibold text-slate-900">실행</h1>
        <p className="text-slate-600">홈 화면에서 스위트를 선택하면 이 화면으로 이동합니다.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">실행 · {runId}</h1>
      <RunStreamPanel runId={runId} />
    </section>
  );
}

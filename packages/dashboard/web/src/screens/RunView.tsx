import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { RunSummary, StartRunRequest, StartRunResponse } from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import { FlowChip } from "../components/FlowChip.js";
import { LogPanel } from "../components/LogPanel.js";
import { QuestionPanel } from "../components/QuestionPanel.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { useRunEvents } from "../run-stream.js";

/** repair 폼 입력란 공통 클래스. 대시보드 테마를 그대로 따른다. */
const REPAIR_INPUT_CLASS =
  "w-full rounded border border-line bg-surface px-3 py-1.5 font-mono text-sm text-ink";

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
  const { events, status, pendingQuestion } = useRunEvents(runId);
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [bundlePath, setBundlePath] = useState("");
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const [model, setModel] = useState("");

  /** 세 값이 다 차야 보낸다. 예전에는 prompt 세 번을 다 통과한 뒤에야 실패했다(#223). */
  const repairReady = bundlePath.trim() !== "" && model.trim() !== "";

  const doneEvent = events.find((event) => event.kind === "done");
  const exitCode = doneEvent?.kind === "done" ? doneEvent.exitCode : null;

  // run-stream은 pendingQuestion을 다음 question/done까지 유지하므로,
  // "답변 후 패널 숨김"은 마지막으로 응답한 question.id를 여기서 기억해 처리한다.
  const visibleQuestion =
    pendingQuestion !== null && pendingQuestion.id !== answeredId ? pendingQuestion : null;

  async function answer(questionId: string, value: string): Promise<void> {
    setError(null);
    try {
      await apiSend("POST", `/api/runs/${encodeURIComponent(runId)}/answer`, {
        questionId,
        value,
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {status !== null ? (
          <StatusBadge status={status} exitCode={exitCode} />
        ) : (
          <span className="text-xs text-ink-muted">대기</span>
        )}
        {status === "failed" && showRepairAction && (
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
      </div>

      {status === "failed" && showRepairAction && repairOpen && (
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
              <code className="font-mono">
                mcpeak test &lt;suite.json&gt; --repair-bundle &lt;path&gt;
              </code>{" "}
              로 실행했을 때 그 경로에 번들이 생깁니다. 여기에 그 경로를 적으세요.
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
              onChange={(event) => setProvider(event.target.value === "codex" ? "codex" : "claude")}
            >
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-ink" htmlFor="repair-model">
              model
            </label>
            <input
              id="repair-model"
              className={REPAIR_INPUT_CLASS}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </div>

          <div className="flex gap-2">
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
          </div>
        </form>
      )}

      {error !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {error}
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
        footer={
          visibleQuestion !== null ? (
            // key로 question.id를 줘서 새 질문마다 리마운트한다(입력값 초기화).
            <QuestionPanel
              key={visibleQuestion.id}
              question={visibleQuestion}
              onAnswer={(value) => answer(visibleQuestion.id, value)}
            />
          ) : undefined
        }
      />
    </div>
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
            {runs?.map((run) => (
              <tr key={run.runId}>
                <td className="px-4 py-2">
                  <a
                    className="flex items-center gap-3 text-ink hover:text-accent"
                    href={`#/runs/${encodeURIComponent(run.runId)}`}
                  >
                    <FlowChip flow={run.flow} />
                    <span className="font-mono text-xs">{run.runId}</span>
                    <StatusBadge status={run.status} exitCode={run.exitCode} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

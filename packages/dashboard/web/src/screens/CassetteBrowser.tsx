import type { JSX } from "react";
import { useEffect, useState } from "react";
import type {
  FileContent,
  FileEntry,
  PutFileRequest,
  PutFileResponse,
  StartRunRequest,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";

const CONFLICT_MESSAGE = "다른 곳에서 파일이 바뀌었습니다. 새로고침 후 다시 시도하세요.";

interface TimelineRow {
  readonly method: string;
  readonly summary: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * interactions 배열이 있으면 요약 타임라인을 그리기 위한 최소 파싱. 요약은 목록
 * 표시용일 뿐 저장 경로에 관여하지 않는다(textarea 편집 대상 JSON은 원문 그대로,
 * 구현계획 §5 U4). 필드가 없거나 형태가 다르면 그냥 건너뛴다.
 */
function summarizeInteractions(content: string): readonly TimelineRow[] {
  try {
    const parsed = JSON.parse(content) as { interactions?: unknown };
    if (!Array.isArray(parsed.interactions)) return [];
    return parsed.interactions.map((item) => {
      const record =
        item !== null && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const request =
        record.request !== null && typeof record.request === "object"
          ? (record.request as Record<string, unknown>)
          : {};
      const response =
        record.response !== null && typeof record.response === "object"
          ? (record.response as Record<string, unknown>)
          : {};
      const method =
        typeof request.toolName === "string"
          ? request.toolName
          : typeof record.method === "string"
            ? record.method
            : "?";
      const args = "args" in request ? truncate(JSON.stringify(request.args) ?? "", 48) : "";
      const result =
        "content" in response ? truncate(JSON.stringify(response.content) ?? "", 48) : "";
      return { method, summary: [args, result].filter((part) => part !== "").join(" · ") };
    });
  } catch {
    return [];
  }
}

interface CassetteBrowserProps {
  readonly path: string | null;
}

/** Cassettes 화면(UI 설계 §5-4): 좌측 목록(300px) + 우측 상세. */
export function CassetteBrowser({ path }: CassetteBrowserProps): JSX.Element {
  // 상세에서 삭제가 일어나면 목록을 다시 불러오기 위한 신호.
  const [listVersion, setListVersion] = useState(0);

  return (
    <section className="flex min-w-0 gap-6">
      <CassetteList selected={path} version={listVersion} />
      <div className="min-w-0 flex-1">
        {path === null ? (
          <p className="text-sm text-ink-muted">왼쪽 목록에서 카세트를 선택하세요.</p>
        ) : (
          <CassetteDetail
            // 경로 전환 시 상세 상태(초안·경고)를 리셋한다. origin f9198e0의 회귀 수정 계승.
            key={path}
            path={path}
            onDeleted={() => {
              setListVersion((version) => version + 1);
              window.location.hash = "#/cassettes";
            }}
          />
        )}
      </div>
    </section>
  );
}

function CassetteList({
  selected,
  version,
}: {
  readonly selected: string | null;
  readonly version: number;
}): JSX.Element {
  const [cassettes, setCassettes] = useState<readonly FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version은 상세의 삭제 후 목록 재조회를 트리거하는 신호다(본문에서 값은 안 쓴다)
  useEffect(() => {
    apiGet<FileEntry[]>("/api/cassettes")
      .then(setCassettes)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [version]);

  return (
    <aside className="w-[300px] shrink-0">
      <h1 className="mb-3 text-xl font-semibold text-ink">카세트</h1>
      {error !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {error}
        </p>
      )}
      <ul className="overflow-hidden rounded-lg border border-line bg-surface">
        {cassettes === null && <li className="px-3 py-2 text-sm text-ink-muted">불러오는 중...</li>}
        {cassettes !== null && cassettes.length === 0 && (
          <li className="px-3 py-2 text-sm text-ink-muted">카세트가 없습니다.</li>
        )}
        {cassettes?.map((cassette) => (
          <li key={cassette.path} className="border-b border-line-subtle last:border-b-0">
            <a
              aria-current={cassette.path === selected ? "true" : undefined}
              className={`block px-3 py-2 font-mono text-xs break-all hover:text-accent ${
                cassette.path === selected ? "bg-accent-soft text-accent" : "text-ink"
              }`}
              href={`#/cassettes/${encodeURIComponent(cassette.path)}`}
            >
              {cassette.path}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function CassetteDetail({
  path,
  onDeleted,
}: {
  readonly path: string;
  readonly onDeleted: () => void;
}): JSX.Element {
  const [file, setFile] = useState<FileContent | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suites, setSuites] = useState<readonly FileEntry[]>([]);
  const [suitePath, setSuitePath] = useState("");

  useEffect(() => {
    setFile(null);
    setDraft("");
    setSelected(null);
    setLoadError(null);
    setSaveWarning(null);
    apiGet<FileContent>(`/api/cassettes/${encodeURIComponent(path)}`)
      .then((content) => {
        setFile(content);
        setDraft(content.content);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
    apiGet<FileEntry[]>("/api/suites")
      .then(setSuites)
      .catch(() => setSuites([]));
  }, [path]);

  async function save(): Promise<void> {
    if (file === null) return;
    setBusy(true);
    setSaveWarning(null);
    try {
      const response = await apiSend<PutFileResponse>(
        "PUT",
        `/api/cassettes/${encodeURIComponent(path)}`,
        { content: draft, baseMtimeMs: file.mtimeMs } satisfies PutFileRequest,
      );
      if (response.saved) {
        setFile({ path, content: draft, mtimeMs: response.mtimeMs });
      } else {
        // 충돌: 경고 배너만 띄우고 덮어쓰지 않는다. 다시 PUT하지 않는다.
        setSaveWarning(CONFLICT_MESSAGE);
      }
    } catch (err) {
      setSaveWarning(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      await apiSend("DELETE", `/api/cassettes/${encodeURIComponent(path)}`);
      onDeleted();
    } catch (err) {
      setSaveWarning(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function replay(): Promise<void> {
    setBusy(true);
    try {
      const response = await apiSend<StartRunResponse>("POST", "/api/runs", {
        flow: "replay",
        argv: [suitePath, "--cassette", path],
      } satisfies StartRunRequest);
      window.location.hash = `#/runs/${encodeURIComponent(response.runId)}`;
    } catch (err) {
      setSaveWarning(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const timeline = summarizeInteractions(draft);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 font-mono text-sm font-semibold break-all text-ink">
          {path}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
            disabled={busy}
            onClick={() => void remove()}
          >
            삭제
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1.5 text-sm text-ink hover:text-accent disabled:opacity-50"
            disabled={busy || file === null}
            onClick={() => void save()}
          >
            저장
          </button>
          <label className="sr-only" htmlFor="cassette-replay-suite">
            재생할 스위트
          </label>
          <select
            id="cassette-replay-suite"
            className="rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs text-ink"
            value={suitePath}
            onChange={(event) => setSuitePath(event.target.value)}
          >
            <option value="">재생할 스위트 선택</option>
            {suites.map((suite) => (
              <option key={suite.path} value={suite.path}>
                {suite.path}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy || suitePath === ""}
            onClick={() => void replay()}
          >
            replay 실행
          </button>
        </div>
      </header>

      {loadError !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {loadError}
        </p>
      )}

      {saveWarning !== null && (
        <p
          className="rounded-md border px-3 py-2 text-sm"
          style={{
            background: "var(--status-waiting-bg)",
            borderColor: "var(--status-waiting-fg)",
            color: "var(--status-waiting-fg)",
          }}
        >
          {saveWarning}
        </p>
      )}

      {file !== null && (
        <>
          {timeline.length > 0 && (
            <ol className="overflow-hidden rounded-lg border border-line bg-surface">
              {timeline.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 타임라인은 draft 원문에서 통째로 재파생되고 재정렬이 없어 index가 곧 표시 번호다
                <li key={index} className="border-b border-line-subtle last:border-b-0">
                  <button
                    type="button"
                    aria-pressed={selected === index}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                      selected === index ? "bg-accent-soft" : "hover:bg-line-subtle"
                    }`}
                    onClick={() => setSelected(index)}
                  >
                    <span className="w-6 shrink-0 text-right font-mono text-xs text-ink-muted">
                      {index + 1}
                    </span>
                    <span className="inline-flex items-center rounded bg-line-subtle px-2 py-0.5 font-mono text-xs text-ink">
                      {row.method}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted">
                      {row.summary}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}

          {(selected !== null || timeline.length === 0) && (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-ink" htmlFor="cassette-json">
                카세트 JSON (원문)
              </label>
              <textarea
                id="cassette-json"
                className="h-64 w-full rounded border border-line bg-surface p-3 font-mono text-xs text-ink"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

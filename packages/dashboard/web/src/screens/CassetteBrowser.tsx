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

/**
 * interactions 배열이 있으면 요약 타임라인을 보여주기 위한 최소 파싱. 별도 스키마를
 * 두지 않고, 필드가 없거나 형태가 다르면 그냥 건너뛴다(원문 textarea가 항상 기준).
 */
function summarizeInteractions(content: string): readonly string[] {
  try {
    const parsed = JSON.parse(content) as { interactions?: unknown };
    if (!Array.isArray(parsed.interactions)) return [];
    return parsed.interactions.map((item, index) => {
      const method =
        item !== null && typeof item === "object" && "method" in item
          ? String((item as { method: unknown }).method)
          : "?";
      return `${index + 1}. ${method}`;
    });
  } catch {
    return [];
  }
}

interface CassetteBrowserProps {
  readonly path: string | null;
}

export function CassetteBrowser({ path }: CassetteBrowserProps) {
  if (path === null) {
    return <CassetteList />;
  }
  return <CassetteDetail path={path} />;
}

function CassetteList() {
  const [cassettes, setCassettes] = useState<readonly FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<FileEntry[]>("/api/cassettes")
      .then(setCassettes)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">카세트</h1>
      {error !== null && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">경로</th>
              <th className="px-4 py-2 font-medium">동작</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cassettes === null && (
              <tr>
                <td className="px-4 py-3 text-slate-400" colSpan={2}>
                  불러오는 중...
                </td>
              </tr>
            )}
            {cassettes !== null && cassettes.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-slate-400" colSpan={2}>
                  카세트가 없습니다.
                </td>
              </tr>
            )}
            {cassettes?.map((cassette) => (
              <tr key={cassette.path}>
                <td className="px-4 py-2 font-mono text-xs text-slate-700">{cassette.path}</td>
                <td className="px-4 py-2">
                  <a
                    className="text-blue-600 hover:underline"
                    href={`#/cassettes/${encodeURIComponent(cassette.path)}`}
                  >
                    열기
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

function CassetteDetail({ path }: { readonly path: string }) {
  const [file, setFile] = useState<FileContent | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suitePath, setSuitePath] = useState("");
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    apiGet<FileContent>(`/api/cassettes/${encodeURIComponent(path)}`)
      .then((content) => {
        setFile(content);
        setDraft(content.content);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [path]);

  async function save(): Promise<void> {
    if (file === null) return;
    setSaving(true);
    setSaveWarning(null);
    try {
      const response = await apiSend<PutFileResponse>(
        "PUT",
        `/api/cassettes/${encodeURIComponent(path)}`,
        {
          content: draft,
          baseMtimeMs: file.mtimeMs,
        } satisfies PutFileRequest,
      );
      if (response.saved) {
        setFile({ path, content: draft, mtimeMs: response.mtimeMs });
      } else {
        // 충돌: 경고만 띄우고 덮어쓰지 않는다. 다시 PUT하지 않는다.
        setSaveWarning(CONFLICT_MESSAGE);
      }
    } catch (err) {
      setSaveWarning(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function replay(): Promise<void> {
    setReplaying(true);
    setReplayError(null);
    try {
      const response = await apiSend<StartRunResponse>("POST", "/api/runs", {
        flow: "replay",
        argv: [suitePath.trim(), "--cassette", path],
      } satisfies StartRunRequest);
      window.location.hash = `#/run/${encodeURIComponent(response.runId)}`;
    } catch (err) {
      setReplayError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplaying(false);
    }
  }

  const interactions = summarizeInteractions(draft);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">카세트 · {path}</h1>
      <a className="text-sm text-blue-600 hover:underline" href="#/cassettes">
        목록으로
      </a>

      {loadError !== null && <p className="text-sm text-red-600">{loadError}</p>}

      {file !== null && (
        <>
          {interactions.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
              <p className="mb-2 font-medium">interactions 타임라인</p>
              <ul className="space-y-1">
                {interactions.map((line) => (
                  <li key={line} className="font-mono text-xs">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <textarea
            className="h-64 w-full rounded border border-slate-300 p-3 font-mono text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />

          {saveWarning !== null && <p className="text-sm text-amber-700">{saveWarning}</p>}

          <button
            type="button"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={saving}
            onClick={() => void save()}
          >
            저장
          </button>

          <div className="flex items-end gap-2 border-t border-slate-200 pt-4">
            <div>
              <label className="block text-sm font-medium text-slate-700" htmlFor="cb-suite">
                스위트 경로
              </label>
              <input
                id="cb-suite"
                className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
                value={suitePath}
                onChange={(event) => setSuitePath(event.target.value)}
                placeholder="이 카세트로 재생할 스위트 경로"
              />
            </div>
            <button
              type="button"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={replaying || suitePath.trim() === ""}
              onClick={() => void replay()}
            >
              replay 시작
            </button>
          </div>
          {replayError !== null && <p className="text-sm text-red-600">{replayError}</p>}
        </>
      )}
    </section>
  );
}

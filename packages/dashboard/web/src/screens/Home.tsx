import { useEffect, useState } from "react";
import type {
  FileEntry,
  RunSummary,
  StartRunRequest,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";

/**
 * 스위트 목록과 실행 이력을 보여주고, 스위트를 골라 test 플로우를 시작한다.
 *
 * `FileEntry`는 `path`만 갖는다(§4-4). 레퍼런스 스타일의 "수정시각 열"은 목록 API가
 * 주는 정보 밖이라 여기서는 만들지 않는다(개별 파일을 열 때만 `FileContent.mtimeMs`로
 * 온다). 판단 근거는 보고서에 남긴다.
 */
export function Home() {
  const [suites, setSuites] = useState<readonly FileEntry[] | null>(null);
  const [runs, setRuns] = useState<readonly RunSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    apiGet<FileEntry[]>("/api/suites")
      .then(setSuites)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
    apiGet<RunSummary[]>("/api/runs")
      .then(setRuns)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function startRun(suitePath: string): Promise<void> {
    setStarting(suitePath);
    setStartError(null);
    try {
      const argv = [suitePath];
      if (command.trim() !== "") {
        argv.push("--command", command.trim());
      }
      const response = await apiSend<StartRunResponse>("POST", "/api/runs", {
        flow: "test",
        argv,
      } satisfies StartRunRequest);
      window.location.hash = `#/run/${encodeURIComponent(response.runId)}`;
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(null);
    }
  }

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">홈</h1>
        <p className="mt-1 text-slate-600">
          현재 프로젝트 아래에서 찾은 테스트 스위트로 바로 실행을 시작합니다.
        </p>
      </div>

      {loadError !== null && <p className="text-sm text-red-600">{loadError}</p>}

      <div className="max-w-sm">
        <label className="block text-sm font-medium text-slate-700" htmlFor="home-command">
          실행할 명령어 (선택)
        </label>
        <input
          id="home-command"
          className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
          value={command}
          placeholder="비우면 스위트 기본값을 씁니다"
          onChange={(event) => setCommand(event.target.value)}
        />
      </div>

      {startError !== null && <p className="text-sm text-red-600">{startError}</p>}

      <div>
        <h2 className="text-sm font-semibold text-slate-700">스위트</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">경로</th>
                <th className="px-4 py-2 font-medium">동작</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {suites === null && (
                <tr>
                  <td className="px-4 py-3 text-slate-400" colSpan={2}>
                    불러오는 중...
                  </td>
                </tr>
              )}
              {suites !== null && suites.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-slate-400" colSpan={2}>
                    스위트가 없습니다.
                  </td>
                </tr>
              )}
              {suites?.map((suite) => (
                <tr key={suite.path}>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{suite.path}</td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      disabled={starting === suite.path}
                      onClick={() => void startRun(suite.path)}
                    >
                      실행
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700">최근 실행</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">runId</th>
                <th className="px-4 py-2 font-medium">플로우</th>
                <th className="px-4 py-2 font-medium">상태</th>
                <th className="px-4 py-2 font-medium">종료 코드</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs === null && (
                <tr>
                  <td className="px-4 py-3 text-slate-400" colSpan={4}>
                    불러오는 중...
                  </td>
                </tr>
              )}
              {runs !== null && runs.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-slate-400" colSpan={4}>
                    아직 실행이 없습니다.
                  </td>
                </tr>
              )}
              {runs?.map((run) => (
                <tr key={run.runId}>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">
                    <a
                      className="text-blue-600 hover:underline"
                      href={`#/run/${encodeURIComponent(run.runId)}`}
                    >
                      {run.runId}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{run.flow}</td>
                  <td className="px-4 py-2 text-slate-600">{run.status}</td>
                  <td className="px-4 py-2 text-slate-600">{run.exitCode ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

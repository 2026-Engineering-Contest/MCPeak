import type { JSX } from "react";
import { useEffect, useState } from "react";
import type {
  FileEntry,
  RunSummary,
  ServerCandidate,
  ServerMeta,
  StartRunRequest,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import type { SessionMode, TestOptions } from "../build-test-argv.js";
import { buildTestArgv, DEFAULT_TEST_OPTIONS } from "../build-test-argv.js";
import { ArgChips } from "../components/ArgChips.js";
import { FlowChip } from "../components/FlowChip.js";
import type { ServerChoice } from "../components/ServerPicker.js";
import { ServerPicker, sameTarget } from "../components/ServerPicker.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { DETERMINISM_SESSION_HINT, TestOptionsPanel } from "../components/TestOptionsPanel.js";
import { Field, INPUT_CLASS } from "../generate/steps/fields.js";
import type { CommandMethod } from "../generate/steps/StepServer.js";
import { StepServer, splitCommand } from "../generate/steps/StepServer.js";
import type { LastRun } from "../last-run.js";
import { readLastRun, saveLastRun } from "../last-run.js";
import { readRecentCommands, saveRecentCommand } from "../recent-commands.js";
import { effectiveRepairBundlePath } from "../repair-bundle-path.js";

/** External 세션 세그먼트. 라벨이 곧 사용자가 이 기능을 배우는 자리다. */
const SESSION_LABELS: Record<SessionMode, string> = {
  off: "사용 안 함",
  record: "외부 호출 녹화",
  replay: "녹화본 재생",
};

const SESSION_HINTS: Record<SessionMode, string> = {
  off: "서버가 부르는 외부 API 를 그대로 둡니다.",
  record: "서버가 부른 외부 API 응답을 세션 파일에 남깁니다. 이번 실행은 실제로 호출합니다.",
  replay: "세션 파일에 녹화된 응답으로 외부 호출을 대신합니다. 서버는 실제로 실행됩니다.",
};

const HTTP_SESSION_HINT =
  "External 세션은 우리가 띄운 프로세스에만 붙습니다. 원격 서버에는 그 프로세스가 없습니다.";
const HTTP_ARGS_HINT = "원격 서버에는 띄울 프로세스가 없어 인자를 넘기지 않습니다.";
const HTTP_PICKER_HINT = "원격 서버에 붙습니다. 위 서버 명령은 쓰이지 않습니다.";
const CANDIDATE_ARGS_HINT = "선택한 서버의 인자를 가져왔습니다. 고칠 수 있습니다.";

/** 표시 전용. 서버에는 배열로 가므로 여기서 감싼 따옴표가 argv 에 들어가지는 않는다. */
function quote(token: string): string {
  return token.includes(" ") ? `"${token}"` : token;
}

/**
 * Home(UI 설계 §5-1, 홈 실행 폼 설계 §5). 2열 카드: 좌측 테스트 스위트(GET /api/suites),
 * 우측 최근 실행(GET /api/runs). 실행 클릭은 실행 폼을 열고
 * `POST /api/runs {flow:"test", argv}` 하고 `#/runs/:id`로 이동한다.
 *
 * **서버를 고르기만 하면 되는 것이 이 폼의 요점이다.** 후보는 `GET /api/servers` 스캔과
 * 이 브라우저의 지난 실행값이고, 마지막 갈래가 직접 입력이다. 직접 입력은 generate 마법사와
 * 같은 `StepServer` 를 쓴다 — 한 칸에 명령 전체를 받아 공백으로 쪼개던 것이 공백 든 경로를
 * 가진 사용자의 실행을 통째로 막고 있었다(#223).
 *
 * CLI 가 거절하는 조합은 폼에서 만들 수 없다. 그 판정은 `buildTestArgv` 한 곳이며, 실행 버튼
 * 비활성·미리보기 사유·제출이 모두 같은 함수를 부른다.
 */
export function Home(): JSX.Element {
  const [suites, setSuites] = useState<readonly FileEntry[] | null>(null);
  /**
   * 스위트·서버 후보 탐색 루트. 목록이 비었을 때 그 이유를 말하는 데만 쓴다. 못 받아도
   * 화면은 살아야 하므로 실패는 삼키고 null 로 둔다 — 그 경우 경로 없이 나머지 안내만 나간다.
   */
  const [root, setRoot] = useState<string | null>(null);
  const [runs, setRuns] = useState<readonly RunSummary[] | null>(null);
  const [candidates, setCandidates] = useState<readonly ServerCandidate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [promptFor, setPromptFor] = useState<string | null>(null);

  const [choice, setChoice] = useState<ServerChoice>({ kind: "manual" });
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  /** 후보·지난 실행 갈래의 명령과 인자. 직접 입력 갈래는 `method`·`target` 에서 구한다. */
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState<readonly string[]>([]);
  // generate 마법사와 같은 기본값("node"). custom 은 입력 전체를 실행 파일 하나로 본다.
  const [method, setMethod] = useState<CommandMethod>("node");
  const [target, setTarget] = useState("");
  const [sessionMode, setSessionMode] = useState<SessionMode>("off");
  // 경로는 비워 둔다. 재생은 이미 있는 파일을 짚는 것이라 추측한 기본값이 틀리면 방해가 되고,
  // 녹화도 이미 있는 파일을 짚으면 CLI 가 덮어쓰지 않고 거절한다(#290).
  const [sessionPath, setSessionPath] = useState("");
  const [options, setOptions] = useState<TestOptions>(DEFAULT_TEST_OPTIONS);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    apiGet<FileEntry[]>("/api/suites")
      .then(setSuites)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
    apiGet<RunSummary[]>("/api/runs")
      .then(setRuns)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
    apiGet<ServerMeta>("/api/meta")
      .then((meta) => setRoot(meta.root))
      .catch(() => setRoot(null));
    // 후보를 못 읽어도 직접 입력 갈래가 살아 있으므로 화면 전체를 실패로 만들지 않는다.
    apiGet<ServerCandidate[]>("/api/servers")
      .then(setCandidates)
      .catch(() => setCandidates([]));
  }, []);

  const httpTarget = options.transport === "http";

  /** 폼을 열 때의 초기 선택(설계 §6-6). 지난 실행 → 첫 후보 → 직접 입력 순이다. */
  function openPrompt(suitePath: string): void {
    const previous = readLastRun(suitePath);
    const same = previous === null ? undefined : candidates.find((c) => sameTarget(c, previous));
    // 지난 실행이 스캔 후보와 같으면 그 후보를 고른다. 같은 명령이 두 줄로 보이지 않게
    // 목록에서도 지난 실행 항목을 만들지 않는다(설계 §5-2).
    const picked = same ?? candidates[0];
    const next: ServerChoice =
      previous !== null && same === undefined
        ? { kind: "last-run" }
        : picked !== undefined
          ? { kind: "candidate", id: picked.id }
          : { kind: "manual" };

    setPromptFor(suitePath);
    setLastRun(previous);
    setChoice(next);
    if (next.kind === "last-run" && previous !== null) {
      setCommand(previous.command);
      setArgs([...previous.args]);
    } else if (next.kind === "candidate" && picked !== undefined) {
      setCommand(picked.command);
      setArgs([...picked.args]);
    } else {
      setCommand("");
      setArgs([]);
    }
    setMethod("node");
    setTarget("");
    // 세션은 늘 꺼진 채로 시작한다. 녹화 경로를 재사용하면 CLI 가 덮어쓰기를 거절한다(#290).
    setSessionMode("off");
    setSessionPath("");
    setOptions(previous?.options ?? DEFAULT_TEST_OPTIONS);
    setOptionsOpen(false);
    setStartError(null);
  }

  function choose(next: ServerChoice): void {
    setChoice(next);
    if (next.kind === "candidate") {
      const picked = candidates.find((c) => c.id === next.id);
      if (picked !== undefined) {
        setCommand(picked.command);
        setArgs([...picked.args]);
      }
    } else if (next.kind === "last-run" && lastRun !== null) {
      setCommand(lastRun.command);
      setArgs([...lastRun.args]);
    } else if (next.kind === "manual") {
      // 직접 입력은 명령을 `method`·`target` 에서 구한다. 앞 후보의 인자를 남기면
      // 새로 적은 스크립트에 남의 인자가 붙는다.
      setArgs([]);
    }
  }

  /** 갈래별 유효 명령·인자(설계 §6-6). */
  function effectiveTarget(): { command: string; args: readonly string[] } {
    if (choice.kind !== "manual") {
      return { command, args };
    }
    const split = splitCommand(method, target);
    return { command: split.command, args: [...split.leadingArgs, ...args] };
  }

  /**
   * 실행 버튼 비활성 판정·미리보기·제출이 **같은 함수**를 쓴다. 두 벌이면 버튼은 눌리는데
   * 제출은 실패하는 상태가 생긴다.
   */
  function argvResult(
    suitePath: string,
  ): { readonly argv: readonly string[] } | { readonly error: string } {
    const { command: cmd, args: serverArgs } = effectiveTarget();
    try {
      return {
        argv: buildTestArgv({
          suitePath,
          command: cmd,
          args: serverArgs,
          sessionMode,
          sessionPath: sessionPath.trim(),
          // 번들은 항상 켠다(ADR-0080). 비워 두면 대시보드 관리 경로다. 저장(`saveLastRun`)에는
          // 원래 `options` 를 넣는다. 관리 경로를 저장하면 다음에 "직접 적은 값" 으로 읽힌다.
          options: {
            ...options,
            repairBundlePath: effectiveRepairBundlePath(suitePath, options.repairBundlePath),
          },
        }),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function startRun(suitePath: string): Promise<void> {
    const result = argvResult(suitePath);
    if (!("argv" in result)) {
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const response = await apiSend<StartRunResponse>("POST", "/api/runs", {
        flow: "test",
        argv: result.argv,
      } satisfies StartRunRequest);
      // 저장 실패는 무시한다. 실행은 이미 서버에서 시작됐다(Generate 마법사와 같은 이유).
      const effective = effectiveTarget();
      saveLastRun(suitePath, { command: effective.command, args: effective.args, options });
      if (choice.kind === "manual" && target.trim() !== "") {
        saveRecentCommand(target);
      }
      window.location.hash = `#/runs/${encodeURIComponent(response.runId)}`;
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  function renderForm(suitePath: string): JSX.Element {
    const result = argvResult(suitePath);
    const sessionLocked = httpTarget || options.determinism;

    return (
      <form
        className="space-y-4 rounded-md border border-line bg-canvas p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void startRun(suitePath);
        }}
      >
        <ServerPicker
          candidates={candidates}
          lastRun={lastRun}
          choice={choice}
          onChoose={choose}
          disabled={httpTarget}
          disabledHint={HTTP_PICKER_HINT}
          root={root}
        />

        {choice.kind === "manual" ? (
          <StepServer
            idPrefix="home-run"
            method={method}
            target={target}
            args={args}
            disabled={httpTarget}
            recentCommands={readRecentCommands()}
            onMethodChange={setMethod}
            onTargetChange={setTarget}
            onArgsChange={setArgs}
          />
        ) : (
          <ArgChips
            idPrefix="home-run"
            args={args}
            disabled={httpTarget}
            hint={httpTarget ? HTTP_ARGS_HINT : CANDIDATE_ARGS_HINT}
            onChange={setArgs}
          />
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-ink">External 세션</p>
          <fieldset className="inline-flex overflow-hidden rounded-md border border-line">
            {(Object.keys(SESSION_LABELS) as readonly SessionMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={sessionMode === mode}
                disabled={httpTarget || (mode !== "off" && options.determinism)}
                className={`px-3 py-1.5 text-sm disabled:opacity-50 ${
                  sessionMode === mode
                    ? "bg-accent-soft font-semibold text-accent"
                    : "text-ink-muted hover:bg-line-subtle"
                }`}
                onClick={() => setSessionMode(mode)}
              >
                {SESSION_LABELS[mode]}
              </button>
            ))}
          </fieldset>
          <p className="mt-2 text-xs text-ink-muted">
            {httpTarget
              ? HTTP_SESSION_HINT
              : options.determinism
                ? DETERMINISM_SESSION_HINT
                : SESSION_HINTS[sessionMode]}
          </p>
        </div>

        {sessionMode !== "off" && !sessionLocked && (
          <Field
            label="세션 파일 경로"
            htmlFor="home-run-session-path"
            hint={
              sessionMode === "record"
                ? "새 파일 경로를 적습니다. 이미 녹화가 있는 파일은 덮어쓰지 않고 거절합니다."
                : "녹화해 둔 세션 파일을 짚습니다."
            }
          >
            <input
              id="home-run-session-path"
              className={INPUT_CLASS}
              value={sessionPath}
              onChange={(event) => setSessionPath(event.target.value)}
            />
          </Field>
        )}

        <TestOptionsPanel
          suitePath={suitePath}
          options={options}
          sessionMode={sessionMode}
          open={optionsOpen}
          onToggle={() => setOptionsOpen((previous) => !previous)}
          onChange={(patch) => {
            // HTTP 로 바꾸면 stderr 줄 수와 External 세션이 비활성이 되는데, 값이 남아 있으면
            // `buildTestArgv` 가 거절하고 사용자는 비활성 컨트롤을 풀 수 없다. 전환하는 쪽이
            // 치운다. 서버 인자는 §5-3 대로 남긴다(거절이 아니라 무시라 갇히지 않는다).
            if (patch.transport === "http") {
              setSessionMode("off");
              setOptions((previous) => ({ ...previous, ...patch, stderrLines: "" }));
              return;
            }
            setOptions((previous) => ({ ...previous, ...patch }));
          }}
        />

        <div className="rounded-md border border-line bg-line-subtle px-3 py-2">
          <p className="text-xs text-ink-muted">실행될 명령</p>
          {"argv" in result ? (
            <p className="break-all font-mono text-sm text-ink">
              {["mcpeak", "test", ...result.argv.map(quote)].join(" ")}
            </p>
          ) : (
            <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
              {result.error}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            disabled={starting || !("argv" in result)}
          >
            실행 시작
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1.5 text-xs text-ink-muted"
            onClick={() => setPromptFor(null)}
          >
            취소
          </button>
        </div>
      </form>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">홈</h1>
        <p className="mt-1 text-sm text-ink-muted">
          현재 프로젝트 아래에서 찾은 테스트 스위트로 바로 실행을 시작합니다.
        </p>
      </div>

      {loadError !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {loadError}
        </p>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
            테스트 스위트
          </h2>
          <ul className="divide-y divide-line-subtle">
            {suites === null && (
              <li className="px-4 py-3 text-sm text-ink-muted">불러오는 중...</li>
            )}
            {suites !== null && suites.length === 0 && (
              <li className="space-y-1 px-4 py-3 text-sm text-ink-muted">
                <p>
                  이 디렉터리 아래에서 스위트를 찾지 못했습니다{root ? ": " : "."}
                  {root ? <span className="font-mono text-xs text-ink">{root}</span> : null}
                </p>
                <p>
                  → 스위트가 있는 디렉터리에서 mcpeak-dashboard 를 다시 띄우거나, 왼쪽 Generate 로
                  새로 만드세요.
                </p>
                <p className="text-xs">
                  목록에는 스위트 형식을 통과한 .json 만 담습니다. node_modules · .git · dist 아래는
                  보지 않습니다.
                </p>
              </li>
            )}
            {suites?.map((suite) => (
              <li key={suite.path} className="space-y-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-ink">{suite.path}</span>
                  <button
                    type="button"
                    aria-expanded={promptFor === suite.path}
                    className="rounded bg-accent px-3 py-1 text-xs font-medium text-white"
                    onClick={() =>
                      promptFor === suite.path ? setPromptFor(null) : openPrompt(suite.path)
                    }
                  >
                    {promptFor === suite.path ? "닫기" : "실행"}
                  </button>
                </div>
                {promptFor === suite.path && renderForm(suite.path)}
              </li>
            ))}
          </ul>
          {startError !== null && (
            <p className="px-4 py-3 text-sm" style={{ color: "var(--status-failed-fg)" }}>
              {startError}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
            최근 실행
          </h2>
          <ul className="divide-y divide-line-subtle">
            {runs === null && <li className="px-4 py-3 text-sm text-ink-muted">불러오는 중...</li>}
            {runs !== null && runs.length === 0 && (
              <li className="px-4 py-3 text-sm text-ink-muted">아직 실행이 없습니다.</li>
            )}
            {runs?.map((run) => (
              <li key={run.runId}>
                <a
                  className="flex items-center gap-3 px-4 py-3 text-ink hover:bg-line-subtle"
                  href={`#/runs/${encodeURIComponent(run.runId)}`}
                >
                  <FlowChip flow={run.flow} />
                  <span className="flex-1 font-mono text-xs">{run.runId}</span>
                  <StatusBadge status={run.status} exitCode={run.exitCode} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

import type { JSX } from "react";
import { useEffect, useState } from "react";
import type {
  FileEntry,
  ServerCandidate,
  ServerMeta,
  StartRunRequest,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import type { SessionMode, TestOptions } from "../build-test-argv.js";
import { buildTestArgv, DEFAULT_TEST_OPTIONS } from "../build-test-argv.js";
import { Stepper } from "../components/Stepper.js";
import type { CommandMethod } from "../generate/steps/StepServer.js";
import { splitCommand } from "../generate/steps/StepServer.js";
import { StepRunOptions } from "../home/steps/StepRunOptions.js";
import type { RunServerChoice, RunServerPatch } from "../home/steps/StepRunServer.js";
import { StepRunServer } from "../home/steps/StepRunServer.js";
import { StepRunSuite } from "../home/steps/StepRunSuite.js";
import type { LastRun } from "../last-run.js";
import { readLastRun, saveLastRun } from "../last-run.js";
import { readRecentCommands, saveRecentCommand } from "../recent-commands.js";
import { effectiveRepairBundlePath } from "../repair-bundle-path.js";
import { saveSessionOrigin } from "../session-origin.js";

const STEPS = ["테스트할 서버", "테스트할 스위트", "실행 옵션"] as const;

/**
 * 홈 실행 마법사의 상태(설계 §6). `command` 는 갈래별로 구하므로 직접 입력 갈래에서는
 * 쓰이지 않는다 — Generate 마법사와 같은 모양이다.
 */
interface HomeState {
  readonly choice: RunServerChoice;
  /** 후보 갈래의 유효 명령. manual 이면 `method`·`target` 에서 구한다. */
  readonly command: string;
  readonly args: readonly string[];
  readonly method: CommandMethod;
  readonly target: string;
  readonly suitePath: string | null;
  readonly sessionMode: SessionMode;
  readonly sessionPath: string;
  readonly options: TestOptions;
}

const INITIAL_STATE: HomeState = {
  choice: { kind: "manual" },
  command: "",
  args: [],
  // generate 마법사와 같은 기본값("node"). custom 은 입력 전체를 실행 파일 하나로 본다.
  method: "node",
  target: "",
  suitePath: null,
  // 세션은 늘 꺼진 채로 시작한다. 녹화 경로를 재사용하면 CLI 가 덮어쓰기를 거절한다(#290).
  sessionMode: "off",
  // 경로는 비워 둔다. 재생은 이미 있는 파일을 짚는 것이라 추측한 기본값이 틀리면 방해가 된다.
  sessionPath: "",
  options: DEFAULT_TEST_OPTIONS,
};

/** 갈래별 유효 명령·인자(설계 §6-6). */
function effectiveTarget(state: HomeState): { command: string; args: readonly string[] } {
  if (state.choice.kind !== "manual") {
    return { command: state.command, args: state.args };
  }
  const split = splitCommand(state.method, state.target);
  return { command: split.command, args: [...split.leadingArgs, ...state.args] };
}

/**
 * 지난 실행이 지금 고른 서버와 다른가. 같으면 3단계에서 되돌릴 것이 없다.
 * HTTP 대상은 명령을 argv 에 싣지 않으므로, 되돌려도 실행이 달라지지 않는다. 그때는 안 묻는다.
 */
function differsFromLastRun(state: HomeState, lastRun: LastRun | null): boolean {
  if (lastRun === null || state.options.transport === "http") {
    return false;
  }
  const current = effectiveTarget(state);
  return (
    current.command !== lastRun.command ||
    current.args.length !== lastRun.args.length ||
    current.args.some((arg, index) => arg !== lastRun.args[index])
  );
}

/**
 * Home(UI 설계 §5-1). Generate 와 같은 3단계 마법사다: 서버를 고르고, 그 서버의 스위트를
 * 고르고, 옵션을 확인해 실행한다. 실행은 `POST /api/runs {flow:"test", argv}` 뒤
 * `#/runs/:id` 로 이동한다.
 *
 * **서버가 먼저인 것이 이 화면의 요점이다.** 스위트는 서버가 정한다 — generate 가 서버
 * 스크립트 옆에 `.suite.json` 을 두므로, 서버를 고르면 그 스위트를 되짚을 수 있다
 * (`matchSuites`). 스위트를 먼저 고르게 두면 사용자는 매번 어느 서버로 돌릴지 다시 정해야 했다.
 *
 * CLI 가 거절하는 조합은 폼에서 만들 수 없다. 그 판정은 `buildTestArgv` 한 곳이며, 실행 버튼
 * 비활성·미리보기 사유·제출이 모두 같은 함수를 부른다.
 */
export function Home(): JSX.Element {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<HomeState>(INITIAL_STATE);
  const [suites, setSuites] = useState<readonly FileEntry[] | null>(null);
  /**
   * 스위트·서버 후보 탐색 루트. 목록이 비었을 때 그 이유를 말하는 데만 쓴다. 못 받아도
   * 화면은 살아야 하므로 실패는 삼키고 null 로 둔다.
   */
  const [root, setRoot] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<readonly ServerCandidate[]>([]);
  const [recentCommands] = useState<readonly string[]>(() => readRecentCommands());
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 고른 스위트의 지난 실행값. 2단계에서 스위트를 고를 때 읽는다. */
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  /** 사용자가 3단계 옵션을 손댔는가. 지난 실행 옵션을 덮어쓸지 판정한다. */
  const [optionsTouched, setOptionsTouched] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    apiGet<FileEntry[]>("/api/suites")
      .then(setSuites)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
    apiGet<ServerMeta>("/api/meta")
      .then((meta) => setRoot(meta.root))
      .catch(() => setRoot(null));
    // 후보를 못 읽어도 직접 입력 갈래가 살아 있으므로 화면 전체를 실패로 만들지 않는다.
    apiGet<ServerCandidate[]>("/api/servers")
      .then((list) => {
        setCandidates(list);
        const first = list[0];
        if (first === undefined) {
          return;
        }
        // 초기 선택은 첫 후보다. 사용자가 이미 손댔으면 그대로 둔다 — 덮어쓰면 직접 입력
        // 폼이 사라지고 실행 대상이 조용히 바뀐다(#366 리뷰).
        setState((previous) =>
          previous.choice.kind === "manual" && previous.target === "" && previous.command === ""
            ? {
                ...previous,
                choice: { kind: "candidate", id: first.id },
                command: first.command,
                args: [...first.args],
              }
            : previous,
        );
      })
      .catch(() => setCandidates([]));
  }, []);

  const target = effectiveTarget(state);
  const http = state.options.transport === "http";

  function patchServer(partial: Partial<RunServerPatch>): void {
    setState((previous) => {
      const { transport, url, headerEnvs, ...rest } = partial;
      let next: HomeState = { ...previous, ...rest };
      if (transport !== undefined || url !== undefined || headerEnvs !== undefined) {
        next = {
          ...next,
          options: {
            ...next.options,
            ...(transport === undefined ? {} : { transport }),
            ...(url === undefined ? {} : { url }),
            ...(headerEnvs === undefined ? {} : { headerEnvs }),
          },
        };
      }
      // HTTP 로 바꾸면 stderr 줄 수와 External 세션이 비활성이 되는데, 값이 남아 있으면
      // `buildTestArgv` 가 거절하고 사용자는 비활성 컨트롤을 풀 수 없다. 전환하는 쪽이
      // 치운다. 서버 인자는 §5-3 대로 남긴다(거절이 아니라 무시라 갇히지 않는다).
      if (transport === "http") {
        next = {
          ...next,
          sessionMode: "off",
          options: { ...next.options, stderrLines: "" },
        };
      }
      return next;
    });
  }

  /** 스위트를 고르면 그 스위트의 지난 실행 옵션을 3단계 기본값으로 채운다(사용자가 안 만졌을 때만). */
  function chooseSuite(suitePath: string): void {
    const previous = readLastRun(suitePath);
    setLastRun(previous);
    setState((current) => {
      const adopted = optionsTouched
        ? current.options
        : (previous?.options ?? DEFAULT_TEST_OPTIONS);
      return {
        ...current,
        suitePath,
        // 접속은 1단계 소관이다. 지난 실행 옵션을 통째로 덮으면 방금 고른 HTTP 대상이
        // 조용히 stdio 로 돌아가고, 사용자는 2단계에서 무엇이 바뀌었는지 알 수 없다.
        options: {
          ...adopted,
          transport: current.options.transport,
          url: current.options.url,
          headerEnvs: current.options.headerEnvs,
        },
      };
    });
  }

  /** 3단계의 「지난 실행값 쓰기」. 서버 갈래를 지난 실행 명령으로 되돌린다. */
  function useLastRun(): void {
    if (lastRun === null) {
      return;
    }
    setState((current) => ({
      ...current,
      choice: { kind: "manual" },
      // 지난 실행은 실행 파일과 인자로 저장돼 있다. `custom` 이 그 모양 그대로다.
      method: "custom",
      target: lastRun.command,
      command: lastRun.command,
      args: [...lastRun.args],
      // 접속은 1단계 소관이다. `chooseSuite` 와 같은 규칙으로 지킨다 — 통째로 덮으면
      // HTTP 를 고른 사용자가 이 버튼 하나로 stdio 로 돌아가고 URL 이 argv 에서 빠진다.
      options: {
        ...lastRun.options,
        transport: current.options.transport,
        url: current.options.url,
        headerEnvs: current.options.headerEnvs,
      },
    }));
    setOptionsTouched(true);
  }

  /**
   * 실행 버튼 비활성 판정·미리보기·제출이 **같은 함수**를 쓴다. 두 벌이면 버튼은 눌리는데
   * 제출은 실패하는 상태가 생긴다.
   */
  function argvResult(
    suitePath: string,
  ): { readonly argv: readonly string[] } | { readonly error: string } {
    try {
      return {
        argv: buildTestArgv({
          suitePath,
          command: target.command,
          args: target.args,
          sessionMode: state.sessionMode,
          sessionPath: state.sessionPath.trim(),
          // 번들은 항상 켠다(ADR-0080). 비워 두면 대시보드 관리 경로다. 저장(`saveLastRun`)에는
          // 원래 `options` 를 넣는다. 관리 경로를 저장하면 다음에 "직접 적은 값" 으로 읽힌다.
          options: {
            ...state.options,
            repairBundlePath: effectiveRepairBundlePath(suitePath, state.options.repairBundlePath),
          },
        }),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const result = state.suitePath === null ? null : argvResult(state.suitePath);

  const stepValid =
    step === 0
      ? http
        ? state.options.url.trim() !== ""
        : target.command !== ""
      : step === 1
        ? state.suitePath !== null
        : result !== null && "argv" in result;

  function reasonForInvalid(): string | null {
    if (stepValid) {
      return null;
    }
    if (step === 0) {
      return http ? "URL 을 입력하세요." : "서버를 고르거나 실행 명령을 입력하세요.";
    }
    if (step === 1) {
      return "스위트를 고르세요.";
    }
    // 3단계의 사유는 미리보기 자리에 이미 전문으로 나와 있다. 여기서 또 적으면 두 벌이 된다.
    return null;
  }

  async function startRun(): Promise<void> {
    const suitePath = state.suitePath;
    if (suitePath === null || result === null || !("argv" in result)) {
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
      saveLastRun(suitePath, {
        command: target.command,
        args: target.args,
        options: state.options,
      });
      if (state.choice.kind === "manual" && state.target.trim() !== "") {
        saveRecentCommand(state.target);
      }
      // 녹화 실행이면 이 세션 파일이 무엇에서 나왔는지 남긴다. 재생하려면 서버와 스위트가
      // 필요한데 세션 파일은 그 둘을 담지 않아, 지금 적어 두지 않으면 Replay 는 사용자에게
      // 다시 물어야 한다. 여기가 그 값을 아는 유일한 시점이다.
      if (state.sessionMode === "record") {
        saveSessionOrigin(state.sessionPath.trim(), {
          command: target.command,
          args: target.args,
          suitePath,
        });
      }
      window.location.hash = `#/runs/${encodeURIComponent(response.runId)}`;
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="mx-auto max-w-[800px] space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">테스트</h1>
        <p className="mt-1 text-sm text-ink-muted">
          서버를 고르고, 그 서버의 테스트 스위트를 골라 실행합니다.
        </p>
      </div>

      <Stepper steps={STEPS} current={step} />

      {loadError !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {loadError}
        </p>
      )}

      <div className="rounded-lg border border-line bg-surface p-6">
        {step === 0 && (
          <StepRunServer
            choice={state.choice}
            command={state.command}
            args={state.args}
            method={state.method}
            target={state.target}
            transport={state.options.transport}
            url={state.options.url}
            headerEnvs={state.options.headerEnvs}
            candidates={candidates}
            root={root}
            recentCommands={recentCommands}
            onChange={patchServer}
          />
        )}
        {step === 1 && (
          <StepRunSuite
            suites={suites}
            args={target.args}
            root={root}
            selected={state.suitePath}
            onSelect={chooseSuite}
          />
        )}
        {step === 2 && state.suitePath !== null && result !== null && (
          <StepRunOptions
            suitePath={state.suitePath}
            args={state.args}
            argsFrom={state.choice.kind === "manual" ? "manual" : "candidate"}
            sessionMode={state.sessionMode}
            sessionPath={state.sessionPath}
            options={state.options}
            optionsOpen={optionsOpen}
            lastRun={lastRun}
            lastRunDiffers={differsFromLastRun(state, lastRun)}
            result={result}
            onArgsChange={(args) => setState((previous) => ({ ...previous, args }))}
            onSessionModeChange={(sessionMode) =>
              setState((previous) => ({ ...previous, sessionMode }))
            }
            onSessionPathChange={(sessionPath) =>
              setState((previous) => ({ ...previous, sessionPath }))
            }
            onOptionsChange={(patch) => {
              setOptionsTouched(true);
              setState((previous) => ({ ...previous, options: { ...previous.options, ...patch } }));
            }}
            onOptionsToggle={() => setOptionsOpen((previous) => !previous)}
            onUseLastRun={useLastRun}
          />
        )}
      </div>

      {startError !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {startError}
        </p>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="rounded border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
          disabled={step === 0}
          onClick={() => setStep((previous) => Math.max(previous - 1, 0))}
        >
          이전
        </button>
        <div className="flex items-center gap-3">
          {reasonForInvalid() !== null && (
            <span className="text-xs text-ink-muted">{reasonForInvalid()}</span>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={!stepValid}
              onClick={() => setStep((previous) => Math.min(previous + 1, STEPS.length - 1))}
            >
              다음
            </button>
          ) : (
            <button
              type="button"
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={starting || !stepValid}
              onClick={() => void startRun()}
            >
              실행 시작
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

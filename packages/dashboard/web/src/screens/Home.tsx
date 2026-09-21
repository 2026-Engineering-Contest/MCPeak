import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  FileEntry,
  ServerCandidate,
  ServerMeta,
  StartRelayRequest,
  StartRelayResponse,
  StartRunRequest,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import type { SessionMode, TestOptions } from "../build-test-argv.js";
import { buildTestArgv, DEFAULT_TEST_OPTIONS } from "../build-test-argv.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { PageHeader } from "../components/PageHeader.js";
import { Stepper } from "../components/Stepper.js";
import type { CommandMethod } from "../generate/steps/StepServer.js";
import { splitCommand } from "../generate/steps/StepServer.js";
import { StepRelay } from "../home/steps/StepRelay.js";
import { StepRunOptions } from "../home/steps/StepRunOptions.js";
import type { RunServerChoice, RunServerPatch } from "../home/steps/StepRunServer.js";
import { StepRunServer } from "../home/steps/StepRunServer.js";
import { StepRunSuite } from "../home/steps/StepRunSuite.js";
import type { LastRun } from "../last-run.js";
import { readLastRun, saveLastRun } from "../last-run.js";
import { readRecentCommands, saveRecentCommand } from "../recent-commands.js";
import { runAfterClose } from "../relay/close-first.js";
import { useRelayEvents } from "../relay/relay-stream.js";
import { effectiveRepairBundlePath } from "../repair-bundle-path.js";

const BASE_STEPS = ["테스트할 서버", "테스트할 스위트", "실행 옵션"] as const;
const RELAY_STEP = "실제 응답";
/** 4 단계의 인덱스. `BASE_STEPS` 뒤에 붙으므로 곧 `BASE_STEPS.length` 다. */
const RELAY_STEP_INDEX = BASE_STEPS.length;

/**
 * 닫기가 실패했을 때의 안내. **판정 실행을 시작하지 않은 이유**가 요점이다 — 여기서 그냥
 * 시작하면 같은 사용자 서버가 두 벌 뜬다(설계 §1).
 */
const RELAY_CLOSE_FAILED_HINT =
  "→ 중계기를 닫지 못해 실행을 시작하지 않았습니다. 같은 서버가 두 벌 뜨는 것을 막기 위해서입니다.\n" +
  "→ 새로고침한 뒤 다시 시도하세요.";

/**
 * 「이전」에서 닫기가 실패했을 때의 안내. 위와 **맥락이 다르다** — 여기서는 시작하지 않은
 * 실행이 없다. 남은 것은 "사용자 서버가 아직 떠 있다" 이고, 그 사실과 다음 동작이 요점이다.
 * 서버가 준 문장 뒤에 이어 붙이므로 그 문장을 되풀이하지 않는다.
 */
const RELAY_BACK_CLOSE_FAILED_HINT =
  "→ 중계기가 아직 떠 있습니다. 그 중계기가 띄운 서버도 함께 떠 있습니다.\n" +
  "→ 새로고침한 뒤 다시 시도하세요. 그대로 두면 판정 실행이 같은 서버를 두 벌 띄웁니다.";

/**
 * 홈 실행 마법사의 상태(설계 §6). `command` 는 갈래별로 구하므로 직접 입력 갈래에서는
 * 쓰이지 않는다 — Generate 마법사와 같은 모양이다.
 */
interface HomeState {
  readonly choice: RunServerChoice;
  /** 후보 갈래의 유효 명령. manual 이면 `method`·`target` 에서 구한다. */
  readonly command: string;
  readonly args: readonly string[];
  /**
   * 후보 갈래에서 자식에게 넘길 환경변수 **이름**. 직접 입력 갈래는 항상 빈 배열이다.
   * 값은 브라우저에 오지 않는다(설계 §4.3).
   */
  readonly envNames: readonly string[];
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
  envNames: [],
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
  /** 3 단계 체크박스. 켜면 4 단계 「실제 응답」이 붙는다. */
  const [liveResponse, setLiveResponse] = useState(false);
  const [relay, setRelay] = useState<StartRelayResponse | null>(null);
  /** 중계기를 못 띄운 사유 **전문**. 서버가 준 문장을 고치지 않고 그대로 화면에 올린다. */
  const [relayError, setRelayError] = useState<string | null>(null);
  /**
   * 살아 있는 중계기를 **렌더와 무관하게** 들고 있는다. 언마운트 정리는 첫 렌더의 함수를
   * 붙잡으므로, 상태만 보면 그때 `relay` 가 늘 null 이라 아무것도 닫지 않는다.
   */
  const relayRef = useRef<StartRelayResponse | null>(null);
  /**
   * 진행 중인 `POST /api/relay`. **상태가 아니라 ref 인 이유**는 같은 틱의 재진입을 막아야
   * 하기 때문이다 — 상태는 다음 렌더에야 보이므로 두 번째 「다음」이 그 사이를 지나간다.
   *
   * 닫기도 이것을 본다. 안 보면 POST 가 풀리기 전에 「이전」을 눌렀을 때 `relayRef.current`
   * 가 null 이라 일찍 돌아가고, 그 뒤 도착한 중계기를 아무도 닫지 못한다.
   */
  const relayOpeningRef = useRef<Promise<void> | null>(null);
  const relayEvents = useRelayEvents(relay?.relayId ?? null);

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
                envNames: [...first.envNames],
              }
            : previous,
        );
      })
      .catch(() => setCandidates([]));
  }, []);

  const target = effectiveTarget(state);
  const http = state.options.transport === "http";

  /**
   * HTTP 대상에서는 4 단계가 붙지 않는다. 중계기는 stdio 서버를 HTTP 로 **중계**하는
   * 물건이라, 대상이 이미 HTTP 면 중계할 것이 없다.
   */
  const steps: readonly string[] = liveResponse && !http ? [...BASE_STEPS, RELAY_STEP] : BASE_STEPS;

  function rememberRelay(next: StartRelayResponse | null): void {
    relayRef.current = next;
    setRelay(next);
  }

  /** 중계기를 닫고 **닫힌 것을 확인한 뒤** 돌아온다. 없으면 할 일이 없다. */
  async function closeRelay(): Promise<void> {
    // 여는 중이면 먼저 그것이 끝나기를 기다린다. 기다리지 않으면 방금 띄운 중계기를 놓친다.
    const opening = relayOpeningRef.current;
    if (opening !== null) {
      await opening;
    }
    const current = relayRef.current;
    if (current === null) {
      return;
    }
    await apiSend<void>("DELETE", `/api/relay/${encodeURIComponent(current.relayId)}`);
    rememberRelay(null);
  }

  /**
   * 4 단계에 들어설 때 중계기를 띄운다.
   *
   * **이미 하나 있거나 여는 중이면 열지 않는다.** `rememberRelay` 로 덮어쓰면 앞 중계기의
   * id 를 되찾을 길이 없어 아무도 그것을 DELETE 하지 못하고, 사용자 서버가 고아로 남는다.
   * 판정은 `relayRef`·`relayOpeningRef` 로만 한다 — 상태로 하면 같은 틱의 두 번째 호출이
   * 아직 null 을 본다.
   */
  function openRelay(suitePath: string): Promise<void> {
    if (relayRef.current !== null || relayOpeningRef.current !== null) {
      return Promise.resolve();
    }
    setRelayError(null);
    const opening = apiSend<StartRelayResponse>("POST", "/api/relay", {
      suitePath,
      command: target.command,
      args: target.args,
      envNames: state.envNames,
      model: "sonnet",
      ...(state.choice.kind === "candidate" ? { serverId: state.choice.id } : {}),
    } satisfies StartRelayRequest)
      .then((response) => {
        // `rememberRelay` 는 여전히 유일한 기록자다 — `relay` 와 `relayRef` 가 어긋나지 않는다.
        rememberRelay(response);
      })
      .catch((err: unknown) => {
        setRelayError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        relayOpeningRef.current = null;
      });
    // 동기적으로 건다. 여기까지 마이크로태스크가 끼어들지 않으므로 같은 틱의 재진입이 막힌다.
    relayOpeningRef.current = opening;
    return opening;
  }

  // 화면을 떠나도 중계기는 남는다 — 사용자 서버가 그대로 떠 있다는 뜻이다. 정리한다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 언마운트 1회 정리. 살아 있는 중계기는 `relayRef` 가 들고 있다.
  useEffect(() => () => void closeRelay().catch(() => undefined), []);

  function patchServer(partial: Partial<RunServerPatch>): void {
    setState((previous) => {
      const { transport, url, headerEnvs, ...rest } = partial;
      let next: HomeState = { ...previous, ...rest };
      // 갈래가 바뀌면 env 이름도 그 갈래의 것으로 갈아 끼운다. 남기면 새로 고른 서버에 앞
      // 후보의 이름이 붙어, CLI 가 그 이름의 환경변수를 찾다 멈춘다.
      const chosen = partial.choice;
      if (chosen !== undefined) {
        const picked =
          chosen.kind === "candidate"
            ? candidates.find((candidate) => candidate.id === chosen.id)
            : undefined;
        next = { ...next, envNames: picked === undefined ? [] : [...picked.envNames] };
      }
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
      // 지난 실행에는 env 이름이 없다(`last-run` 이 담지 않는다). 후보의 이름을 남기면
      // 되돌린 명령에 남의 env 가 붙는다.
      envNames: [],
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
          envNames: state.envNames,
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
        // 후보 갈래면 id 를 함께 보낸다. 서버가 그 후보의 `.mcp.json` env 를 값으로 바꿔
        // 이 run 의 `readEnv` 에 싣는다. 값은 브라우저를 지나지 않는다(설계 §4.3).
        ...(state.choice.kind === "candidate" ? { serverId: state.choice.id } : {}),
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
      // 녹화 출처는 세션 파일에 저장된다(ADR-0085). 브라우저에 다시 적지 않는다. 적으면
      // 저장 직전에 가려진 값이 가려지지 않은 채 여기에 남기 때문이다(설계 §4.6).
      window.location.hash = `#/runs/${encodeURIComponent(response.runId)}`;
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  /**
   * 건너뛴 케이스 안내. `find` 로 집으면 좁혀지지 않아 `message` 를 읽을 수 없다 —
   * 이벤트 종류마다 필드가 다르기 때문이다.
   */
  const skippedNotice =
    relayEvents.flatMap((event) => (event.kind === "notice" ? [event.message] : []))[0] ?? null;

  return (
    <section className="mx-auto max-w-[800px] space-y-6">
      <PageHeader
        title="테스트"
        description="서버를 고르고, 그 서버의 테스트 스위트를 골라 실행합니다."
      />

      <Stepper steps={steps} current={step} />

      {loadError !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {loadError}
        </p>
      )}

      <Card className="p-6">
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
            liveResponse={liveResponse}
            onLiveResponseChange={setLiveResponse}
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
        {step === RELAY_STEP_INDEX && (
          <StepRelay
            cases={relay?.cases ?? []}
            events={relayEvents}
            error={relayError}
            skipped={skippedNotice}
          />
        )}
      </Card>

      {startError !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {startError}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button
          disabled={step === 0}
          // 4 단계에서 물러날 때도 중계기를 닫는다. 남겨 두면 사용자 서버가 뜬 채로
          // 3 단계가 「실행 시작」을 다시 내민다.
          //
          // **닫기 실패를 삼키지 않는다.** 삼키면 사용자 서버가 도는데 화면에 그 말이 없다.
          // 뒤로 가는 것 자체는 막지 않는다 — 못 닫은 중계기는 `relayRef` 가 그대로 들고
          // 있어 `openRelay` 가 두 번째를 열지 않고, 「실행 시작」도 닫히기 전에는 시작하지
          // 않는다. 여기서 4 단계에 가두면 나갈 길만 없어진다.
          onClick={() =>
            void closeRelay()
              .then(() => setStartError(null))
              .catch((err: unknown) =>
                setStartError(
                  `${err instanceof Error ? err.message : String(err)}\n${RELAY_BACK_CLOSE_FAILED_HINT}`,
                ),
              )
              .finally(() => setStep((previous) => Math.max(previous - 1, 0)))
          }
        >
          이전
        </Button>
        <div className="flex items-center gap-3">
          {reasonForInvalid() !== null && (
            <span className="text-xs text-ink-muted">{reasonForInvalid()}</span>
          )}
          {step < steps.length - 1 ? (
            <Button
              variant="primary"
              disabled={!stepValid}
              onClick={() => {
                const next = Math.min(step + 1, steps.length - 1);
                // 4 단계는 들어서는 순간 중계기를 띄운다. 버튼을 따로 두지 않는 것이
                // 이 단계의 요점이다 — 화면에 들어온 것이 곧 "보겠다" 는 뜻이다.
                if (next === RELAY_STEP_INDEX && state.suitePath !== null) {
                  void openRelay(state.suitePath);
                }
                // 옆의 「이전」과 같은 updater 형으로 둔다. 클로저의 `step` 을 읽으면 batched
                // update 에서 낡은 값을 볼 여지가 생기고, 한 파일 안에 두 모양이 남는다.
                setStep((previous) => Math.min(previous + 1, steps.length - 1));
              }}
            >
              다음
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={starting || !stepValid}
              // **닫기가 먼저다.** 중계기를 닫고 닫힌 것을 확인한 뒤에야 판정 실행을
              // 시작한다. 순서 보장은 `runAfterClose` 가 한다(설계 §1).
              onClick={() =>
                void runAfterClose(closeRelay, startRun).catch((err: unknown) => {
                  setStartError(
                    `${err instanceof Error ? err.message : String(err)}\n${RELAY_CLOSE_FAILED_HINT}`,
                  );
                })
              }
            >
              실행 시작
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

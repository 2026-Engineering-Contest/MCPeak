import type { JSX } from "react";
import { useEffect, useState } from "react";
import type {
  ServerCandidate,
  ServerMeta,
  StartRunRequest,
  StartRunResponse,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import { Stepper } from "../components/Stepper.js";
import type { GenerateForm } from "../generate/build-argv.js";
import { buildGenerateArgv } from "../generate/build-argv.js";
import { StepConfirm } from "../generate/steps/StepConfirm.js";
import { StepMode } from "../generate/steps/StepMode.js";
import type { CommandMethod } from "../generate/steps/StepServer.js";
import { splitCommand } from "../generate/steps/StepServer.js";
import { StepSuite } from "../generate/steps/StepSuite.js";
import type { ServerChoice } from "../generate/steps/StepTarget.js";
import { StepTarget } from "../generate/steps/StepTarget.js";
import { deriveSuiteName, suggestOutPathFor } from "../generate/suggest.js";
import { readRecentCommands, saveRecentCommand } from "../recent-commands.js";

const STEPS = ["테스트할 서버", "만들어질 스위트", "생성 방식", "검증과 확인"] as const;

/** 저장 위치가 제안값일 때의 힌트(설계 §5-2). 제안값이 없으면 아래 문장으로 바뀐다. */
const OUT_PATH_HINT = "서버 스크립트 옆에 제안한 값입니다. 바꿔도 됩니다(.json 파일).";
const OUT_PATH_HINT_NO_SUGGESTION = "원격 서버는 기준 경로가 없어 직접 적습니다(.json 파일).";
/** 스위트 ID·이름이 아직 제안값 그대로일 때만 붙는다. */
const DERIVED_HINT = "저장 위치의 파일명에서 뽑았습니다.";

/** 상태 모델은 설계 §6-1 이다. `command` 는 갈래별로 구하므로 상태에 두지 않는다. */
interface WizardState extends Omit<GenerateForm, "command"> {
  readonly choice: ServerChoice;
  /** 후보 갈래의 유효 명령. manual 이면 쓰이지 않는다. */
  readonly candidateCommand: string;
  readonly candidateArgs: readonly string[];
  /** 직접 입력 갈래. */
  readonly method: CommandMethod;
  readonly target: string;
  /** §6-4. 제안값 추적. 사용자가 고친 필드는 다시 제안하지 않는다. */
  readonly suggested: {
    readonly outPath: string;
    readonly suiteId: string;
    readonly suiteName: string;
  };
}

const INITIAL_STATE: WizardState = {
  choice: { kind: "manual" },
  candidateCommand: "",
  candidateArgs: [],
  method: "node",
  target: "",
  args: [],
  transport: "stdio",
  url: "",
  headerEnvs: [],
  suiteId: "",
  suiteName: "",
  outPath: "",
  suggested: { outPath: "", suiteId: "", suiteName: "" },
  force: false,
  mode: "ai",
  provider: "claude",
  model: "",
  dryRun: true,
  repair: true,
  resetCmd: "",
};

/** 1단계에서 이 필드들이 바뀌면 저장 위치를 다시 제안한다(설계 §6-4). */
const TARGET_KEYS = [
  "choice",
  "candidateCommand",
  "candidateArgs",
  "method",
  "target",
  "args",
  "transport",
] as const satisfies readonly (keyof WizardState)[];

/** 갈래별 유효 명령·인자(설계 §6-1). 이 값이 `GenerateForm.command`·`args` 가 된다. */
function effectiveCommand(state: WizardState): { command: string; args: readonly string[] } {
  if (state.choice.kind === "candidate") {
    return { command: state.candidateCommand, args: state.candidateArgs };
  }
  const split = splitCommand(state.method, state.target);
  return { command: split.command, args: [...split.leadingArgs, ...state.args] };
}

/**
 * 상태 전이 한 곳(설계 §6-4). 저장 위치 제안과 스위트 ID·이름 제안이 한 번에 처리된다.
 *
 * **"사용자가 고쳤는가"를 값 비교로 판정하는 것이 이 함수의 요점이다.** "한 번이라도 입력이
 * 있었으면 고침"으로 두면 제안값을 지웠다가 비워 둔 사용자에게 영영 제안이 오지 않는다.
 */
function applyPatch(
  previous: WizardState,
  partial: Partial<WizardState>,
  candidates: readonly ServerCandidate[],
): WizardState {
  let next: WizardState = { ...previous, ...partial };
  // 시험 실행을 끄면 그에 종속된 초기화 명령을 함께 비운다. 값이 남으면 입력이 잠긴 채
  // buildGenerateArgv 가 throw 해 복구 경로가 없다(PR #199 리뷰 반영).
  if (partial.dryRun === false) {
    next = { ...next, resetCmd: "" };
  }

  if (TARGET_KEYS.some((key) => key in partial)) {
    const choice = next.choice;
    const picked =
      choice.kind === "candidate"
        ? candidates.find((candidate) => candidate.id === choice.id)
        : undefined;
    const suggestion = suggestOutPathFor({
      transport: next.transport,
      args: effectiveCommand(next).args,
      sourcePath: picked?.path ?? null,
      candidateName: picked?.name ?? null,
    });
    if (next.outPath === "" || next.outPath === previous.suggested.outPath) {
      next = { ...next, outPath: suggestion };
    }
    next = { ...next, suggested: { ...next.suggested, outPath: suggestion } };
  }

  // 저장 위치가 바뀌면 파생값을 다시 제안한다. 단, 필드가 이전 제안값과 같거나 비어 있을 때만.
  const derived = deriveSuiteName(next.outPath);
  const keepOrSuggest = (current: string, previousSuggestion: string) =>
    current === "" || current === previousSuggestion ? derived : current;
  return {
    ...next,
    suiteId: keepOrSuggest(next.suiteId, previous.suggested.suiteId),
    suiteName: keepOrSuggest(next.suiteName, previous.suggested.suiteName),
    suggested: { ...next.suggested, suiteId: derived, suiteName: derived },
  };
}

/**
 * Generate 4단계 마법사(설계 §5). 가운데 카드 800px, 상단 스텝 인디케이터,
 * 하단 이전/다음. 단계 상태는 컴포넌트 메모리에만 있다(URL에 안 싣는다. 새로고침
 * 시 1단계로 돌아가는 것을 허용). 생성 시작이 argv를 조립해
 * `POST /api/runs {flow:"generate", argv}` 후 `#/runs/:id`로 이동한다.
 */
export function GenerateWizard(): JSX.Element {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [candidates, setCandidates] = useState<readonly ServerCandidate[]>([]);
  /** 후보가 0개일 때 어디를 뒤졌는지 말하는 데만 쓴다. 못 받아도 화면은 살아야 한다. */
  const [root, setRoot] = useState<string | null>(null);
  const [recentCommands] = useState<readonly string[]>(() => readRecentCommands());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        // 초기 선택은 첫 후보다(설계 §5-1). 저장 위치·스위트 제안도 이때 함께 찬다.
        setState((previous) =>
          applyPatch(
            previous,
            {
              choice: { kind: "candidate", id: first.id },
              candidateCommand: first.command,
              candidateArgs: [...first.args],
            },
            list,
          ),
        );
      })
      .catch(() => setCandidates([]));
  }, []);

  const { command, args } = effectiveCommand(state);
  const form: GenerateForm = { ...state, command, args };
  const http = state.transport === "http";

  function patch(partial: Partial<WizardState>): void {
    setState((previous) => applyPatch(previous, partial, candidates));
  }

  const stepValid =
    step === 0
      ? http
        ? state.url.trim() !== ""
        : command !== ""
      : step === 1
        ? state.suiteId !== "" && state.suiteName !== "" && state.outPath !== ""
        : true;

  function reasonForInvalid(): string | null {
    if (stepValid) {
      return null;
    }
    if (step === 0) {
      return http ? "URL 을 입력하세요." : "서버를 고르거나 실행 명령을 입력하세요.";
    }
    if (state.suiteId === "") {
      return "스위트 ID를 입력하세요.";
    }
    if (state.suiteName === "") {
      return "스위트 이름을 입력하세요.";
    }
    return "저장 위치를 입력하세요.";
  }

  async function start(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const argv = buildGenerateArgv(form);
      const response = await apiSend<StartRunResponse>("POST", "/api/runs", {
        flow: "generate",
        argv: [...argv],
      } satisfies StartRunRequest);
      // 후보 갈래의 명령은 프로젝트 선언에서 온 것이라 "최근 사용값"이 아니다.
      if (state.choice.kind === "manual") {
        saveRecentCommand(state.target);
      }
      window.location.hash = `#/runs/${encodeURIComponent(response.runId)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="mx-auto max-w-[800px] space-y-6">
      <h1 className="text-xl font-semibold text-ink">생성</h1>
      <Stepper steps={STEPS} current={step} />

      <div className="rounded-lg border border-line bg-surface p-6">
        {step === 0 && (
          <StepTarget
            choice={state.choice}
            method={state.method}
            target={state.target}
            args={state.args}
            transport={state.transport}
            url={state.url}
            headerEnvs={state.headerEnvs}
            candidates={candidates}
            root={root}
            recentCommands={recentCommands}
            onChange={patch}
          />
        )}
        {step === 1 && (
          <StepSuite
            form={{
              suiteId: state.suiteId,
              suiteName: state.suiteName,
              outPath: state.outPath,
              force: state.force,
            }}
            outPathHint={
              state.suggested.outPath === "" ? OUT_PATH_HINT_NO_SUGGESTION : OUT_PATH_HINT
            }
            derivedHint={
              state.suggested.suiteId !== "" &&
              (state.suiteId === state.suggested.suiteId ||
                state.suiteName === state.suggested.suiteName)
                ? DERIVED_HINT
                : null
            }
            onChange={patch}
          />
        )}
        {step === 2 && (
          <StepMode
            form={{ mode: state.mode, provider: state.provider, model: state.model }}
            onChange={patch}
          />
        )}
        {step === 3 && <StepConfirm form={form} onChange={patch} />}
      </div>

      {error !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {error}
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
              disabled={starting}
              onClick={() => void start()}
            >
              생성 시작
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

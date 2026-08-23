import type { JSX } from "react";
import { useState } from "react";
import type { StartRunRequest, StartRunResponse } from "../../../src/api-types.js";
import { apiSend } from "../api.js";
import { Stepper } from "../components/Stepper.js";
import type { GenerateForm } from "../generate/build-argv.js";
import { buildGenerateArgv } from "../generate/build-argv.js";
import { StepConfirm } from "../generate/steps/StepConfirm.js";
import { StepMode } from "../generate/steps/StepMode.js";
import type { CommandMethod } from "../generate/steps/StepServer.js";
import { StepServer, splitCommand } from "../generate/steps/StepServer.js";
import { StepSuite } from "../generate/steps/StepSuite.js";

const STEPS = ["테스트할 서버", "만들어질 스위트", "생성 방식", "녹화와 확인"] as const;

const RECENT_KEY = "mcpeak-generate-recent-commands";

function readRecentCommands(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function saveRecentCommand(target: string): void {
  // 저장 용량 초과·스토리지 차단으로 setItem이 throw해도 무시한다. 실행은 이미
  // 서버에서 시작됐으므로 여기서 던지면 #/runs/:id 전환만 막힌다(PR #199 리뷰 반영).
  try {
    const next = [target, ...readRecentCommands().filter((item) => item !== target)].slice(0, 8);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // 최근 사용값은 편의 기능이라 실패를 표시하지 않는다.
  }
}

/** 스크립트 경로에서 저장 위치 기본값을 만든다(확장자를 .suite.json으로). */
function suggestOutPath(target: string): string {
  const withoutExt = target.replace(/\.[^./\\]+$/, "");
  return `${withoutExt}.suite.json`;
}

interface WizardState extends Omit<GenerateForm, "command"> {
  readonly method: CommandMethod;
  readonly target: string;
}

const INITIAL_STATE: WizardState = {
  method: "node",
  target: "",
  args: [],
  suiteId: "",
  suiteName: "",
  outPath: "",
  force: false,
  mode: "ai",
  provider: "claude",
  model: "",
  dryRun: true,
  repair: true,
  cassettePath: "",
  record: false,
  resetCmd: "",
};

/**
 * Generate 4단계 마법사(UI 설계 §5-3). 가운데 카드 800px, 상단 스텝 인디케이터,
 * 하단 이전/다음. 단계 상태는 컴포넌트 메모리에만 있다(URL에 안 싣는다. 새로고침
 * 시 1단계로 돌아가는 것을 허용). 생성 시작이 argv를 조립해
 * `POST /api/runs {flow:"generate", argv}` 후 `#/runs/:id`로 이동한다.
 */
export function GenerateWizard(): JSX.Element {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [recentCommands] = useState<readonly string[]>(() => readRecentCommands());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CLI `--command`는 실행 파일 하나만 받는 계약이다. 대상 스크립트 경로(직접 입력의
  // 나머지 토큰 포함)는 args 선두로 가고, 사용자가 추가한 인자가 그 뒤를 잇는다.
  const split = splitCommand(state.method, state.target);
  const form: GenerateForm = {
    ...state,
    command: split.command,
    args: [...split.leadingArgs, ...state.args],
  };

  function patch(partial: Partial<WizardState>): void {
    setState((previous) => {
      const next = { ...previous, ...partial };
      // 시험 실행을 끄면 그에 종속된 값(카세트·초기화 명령·재녹화)을 함께 비운다.
      // 값이 남으면 4단계 입력이 잠긴 채 buildGenerateArgv가 throw해 복구 경로가
      // 없다(PR #199 리뷰 반영).
      if (partial.dryRun === false) {
        return { ...next, cassettePath: "", resetCmd: "", record: false };
      }
      return next;
    });
  }

  const stepValid =
    step === 0
      ? form.command !== ""
      : step === 1
        ? state.suiteId !== "" && state.suiteName !== "" && state.outPath !== ""
        : true;

  function reasonForInvalid(): string | null {
    if (stepValid) {
      return null;
    }
    if (step === 0) {
      return "실행 명령을 입력하세요.";
    }
    if (state.suiteId === "") {
      return "스위트 ID를 입력하세요.";
    }
    if (state.suiteName === "") {
      return "스위트 이름을 입력하세요.";
    }
    return "저장 위치를 입력하세요.";
  }

  function goNext(): void {
    // 2단계 진입 시 저장 위치가 비어 있으면 스크립트 기준으로 자동 제안한다.
    if (step === 0 && state.outPath === "" && state.method !== "custom" && state.target !== "") {
      patch({ outPath: suggestOutPath(state.target) });
    }
    setStep((previous) => Math.min(previous + 1, STEPS.length - 1));
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
      saveRecentCommand(state.target);
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
          <StepServer
            method={state.method}
            target={state.target}
            args={state.args}
            recentCommands={recentCommands}
            onMethodChange={(method) => patch({ method })}
            onTargetChange={(target) => patch({ target })}
            onArgsChange={(args) => patch({ args })}
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
            onChange={patch}
          />
        )}
        {step === 2 && (
          <StepMode
            form={{
              mode: state.mode,
              provider: state.provider,
              model: state.model,
              dryRun: state.dryRun,
              repair: state.repair,
            }}
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
              onClick={goNext}
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

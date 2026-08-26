import type { JSX } from "react";
import type { SessionMode, TestOptions } from "../../build-test-argv.js";
import { ArgChips } from "../../components/ArgChips.js";
import { DETERMINISM_SESSION_HINT, TestOptionsPanel } from "../../components/TestOptionsPanel.js";
import { Field, INPUT_CLASS } from "../../generate/steps/fields.js";
import type { LastRun } from "../../last-run.js";

/**
 * External 세션 세그먼트. 라벨이 곧 사용자가 이 기능을 배우는 자리다.
 *
 * **재생은 여기서 고르지 않는다.** 재생의 출발점은 스위트가 아니라 녹화본이라 Replay 탭이
 * 목록에서 골라 시작한다 — 거기서는 서버·스위트가 세션에 저장된 출처로 채워지므로(ADR-0085)
 * 사용자가 다시 지목할 것이 없다. 이 화면에 남겨 두면 같은 일을 하는 자리가 둘이 되고,
 * 그중 하나는 사용자가 세션 파일 경로를 손으로 적어야 하는 나쁜 쪽이다.
 *
 * `SessionMode` 의 `replay` 자체는 남는다 — `buildTestArgv` 는 Replay 탭도 쓴다.
 */
const TEST_SESSION_MODES = ["off", "record"] as const satisfies readonly SessionMode[];

const SESSION_LABELS: Record<(typeof TEST_SESSION_MODES)[number], string> = {
  off: "사용 안 함",
  record: "외부 호출 녹화",
};

const SESSION_HINTS: Record<(typeof TEST_SESSION_MODES)[number], string> = {
  off: "서버가 부르는 외부 API 를 그대로 둡니다.",
  record: "서버가 부른 외부 API 응답을 세션 파일에 남깁니다. 이번 실행은 실제로 호출합니다.",
};

const HTTP_SESSION_HINT =
  "External 세션은 우리가 띄운 프로세스에만 붙습니다. 원격 서버에는 그 프로세스가 없습니다.";
const HTTP_ARGS_HINT = "원격 서버에는 띄울 프로세스가 없어 인자를 넘기지 않습니다.";
const CANDIDATE_ARGS_HINT = "선택한 서버의 인자를 가져왔습니다. 고칠 수 있습니다.";
const MANUAL_ARGS_HINT = "1단계에서 적은 인자입니다. 여기서 고쳐도 됩니다.";

/** 표시 전용. 서버에는 배열로 가므로 여기서 감싼 따옴표가 argv 에 들어가지는 않는다. */
function quote(token: string): string {
  return token.includes(" ") ? `"${token}"` : token;
}

/**
 * 3단계 — 실행 옵션. 서버 인자, External 세션, 테스트 옵션, 실행될 명령을 쌓는다.
 * 「실행 시작」은 마법사 바닥에 있다.
 *
 * **CLI 가 거절하는 조합을 여기서 만들 수 없어야 한다.** 그 판정은 `buildTestArgv` 한 곳이고,
 * 이 화면은 그 결과(`argvResult`)를 미리보기 자리에 그대로 보여준다. 실패 사유가 곧 UI 다.
 */
export function StepRunOptions(props: {
  suitePath: string;
  args: readonly string[];
  /** 인자를 어디서 가져왔는지. 힌트 문구만 가른다. */
  argsFrom: "candidate" | "manual";
  sessionMode: SessionMode;
  sessionPath: string;
  options: TestOptions;
  optionsOpen: boolean;
  /** 이 스위트의 지난 실행값. 지금 고른 서버와 다르면 되돌릴 수 있게 알린다. */
  lastRun: LastRun | null;
  lastRunDiffers: boolean;
  /** `buildTestArgv` 의 결과. 성공이면 미리보기, 실패면 그 사유가 같은 자리에 나온다. */
  result: { readonly argv: readonly string[] } | { readonly error: string };
  onArgsChange: (args: readonly string[]) => void;
  onSessionModeChange: (mode: SessionMode) => void;
  onSessionPathChange: (path: string) => void;
  onOptionsChange: (patch: Partial<TestOptions>) => void;
  onOptionsToggle: () => void;
  onUseLastRun: () => void;
}): JSX.Element {
  const http = props.options.transport === "http";
  const sessionLocked = http || props.options.determinism;

  return (
    <div className="space-y-4">
      {props.lastRun !== null && props.lastRunDiffers && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-line-subtle px-3 py-2">
          <p className="min-w-0 text-xs text-ink-muted">
            이 스위트는 지난번에{" "}
            <span className="break-all font-mono text-ink">
              {[props.lastRun.command, ...props.lastRun.args].join(" ")}
            </span>{" "}
            로 실행했습니다.
          </p>
          <button
            type="button"
            className="shrink-0 rounded border border-line px-3 py-1 text-xs text-ink-muted"
            onClick={props.onUseLastRun}
          >
            지난 실행값 쓰기
          </button>
        </div>
      )}

      <ArgChips
        idPrefix="home-run-options"
        args={props.args}
        disabled={http}
        hint={
          http
            ? HTTP_ARGS_HINT
            : props.argsFrom === "candidate"
              ? CANDIDATE_ARGS_HINT
              : MANUAL_ARGS_HINT
        }
        onChange={props.onArgsChange}
      />

      <div>
        <p className="mb-2 text-sm font-medium text-ink">External 세션</p>
        <fieldset className="inline-flex overflow-hidden rounded-md border border-line">
          {TEST_SESSION_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={props.sessionMode === mode}
              disabled={http || (mode !== "off" && props.options.determinism)}
              className={`px-3 py-1.5 text-sm disabled:opacity-50 ${
                props.sessionMode === mode
                  ? "bg-accent-soft font-semibold text-accent"
                  : "text-ink-muted hover:bg-line-subtle"
              }`}
              onClick={() => props.onSessionModeChange(mode)}
            >
              {SESSION_LABELS[mode]}
            </button>
          ))}
        </fieldset>
        <p className="mt-2 text-xs text-ink-muted">
          {http
            ? HTTP_SESSION_HINT
            : props.options.determinism
              ? DETERMINISM_SESSION_HINT
              : // `replay` 는 이 화면에서 고를 수 없다. 그래도 형이 허용하므로 `off` 로 떨어뜨린다.
                (SESSION_HINTS[props.sessionMode as (typeof TEST_SESSION_MODES)[number]] ??
                SESSION_HINTS.off)}
        </p>
      </div>

      {props.sessionMode !== "off" && !sessionLocked && (
        <Field
          label="세션 파일 경로"
          htmlFor="home-run-session-path"
          // 이 화면에서 세션을 켜는 길은 녹화뿐이라 갈래가 하나다(재생은 Replay 탭).
          hint="새 파일 경로를 적습니다. 이미 녹화가 있는 파일은 덮어쓰지 않고 거절합니다."
        >
          <input
            id="home-run-session-path"
            className={INPUT_CLASS}
            value={props.sessionPath}
            onChange={(event) => props.onSessionPathChange(event.target.value)}
          />
        </Field>
      )}

      <TestOptionsPanel
        suitePath={props.suitePath}
        options={props.options}
        sessionMode={props.sessionMode}
        open={props.optionsOpen}
        onToggle={props.onOptionsToggle}
        onChange={props.onOptionsChange}
      />

      <div className="rounded-md border border-line bg-line-subtle px-3 py-2">
        <p className="text-xs text-ink-muted">실행될 명령</p>
        {"argv" in props.result ? (
          <p className="break-all font-mono text-sm text-ink">
            {["mcpeak", "test", ...props.result.argv.map(quote)].join(" ")}
          </p>
        ) : (
          <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
            {props.result.error}
          </p>
        )}
      </div>
    </div>
  );
}

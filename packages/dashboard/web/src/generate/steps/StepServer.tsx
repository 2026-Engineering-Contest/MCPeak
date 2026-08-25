import type { JSX } from "react";
import { ArgChips } from "../../components/ArgChips.js";
import { Field, INPUT_CLASS } from "./fields.js";

/** 1단계 실행 방법 세그먼트. command 문자열 조립 프리셋일 뿐이다(구현계획 §5 U3). */
export type CommandMethod = "node" | "npx" | "python" | "custom";

export const METHOD_LABELS: Record<CommandMethod, string> = {
  node: "Node 스크립트",
  npx: "npx 패키지",
  python: "Python",
  custom: "직접 입력",
};

export interface SplitCommand {
  readonly command: string;
  readonly leadingArgs: readonly string[];
}

/**
 * 세그먼트 + 대상 입력을 실행 파일 하나(command)와 선행 인자(args 선두)로 분해한다.
 * CLI `--command`는 실행 파일 하나만 받는 계약이라(parseTestCommand·generate 동일)
 * 스크립트 경로·패키지명은 `--arg`로 가야 한다.
 *
 * **어느 갈래도 공백으로 쪼개지 않는다.** `custom` 이 예전에는 쪼갰는데, 그러면
 * `node "my server.js"` 가 `--arg '"my'` · `--arg 'server.js"'` 로 깨진다 —
 * 이 컴포넌트가 고치려던 문제가 그 갈래에만 그대로 남아 있었다(#254 리뷰).
 * 지금은 `custom` 의 입력 전체가 실행 파일 하나이고, 인자는 칩으로만 받는다.
 */
export function splitCommand(method: CommandMethod, target: string): SplitCommand {
  const trimmed = target.trim();
  if (trimmed === "") {
    return { command: "", leadingArgs: [] };
  }
  switch (method) {
    case "node":
      return { command: "node", leadingArgs: [trimmed] };
    case "npx":
      return { command: "npx", leadingArgs: [trimmed] };
    case "python":
      return { command: "python", leadingArgs: [trimmed] };
    case "custom":
      return { command: trimmed, leadingArgs: [] };
  }
}

/**
 * 서버 실행 명령 입력. 직접 입력 + 최근 사용값(localStorage, datalist)을 지원한다.
 * 서버 인자는 `ArgChips` 로 쌓는다.
 *
 * **인자를 칩으로 받는 것이 이 컴포넌트의 요점이다.** 한 칸에 명령 전체를 받아 공백으로
 * 쪼개면 공백이 든 경로를 가진 사용자는 실행 자체를 못 한다(#223). 애초에 나눠 받으면
 * 파싱도 따옴표 문제도 생기지 않는다.
 *
 * generate 4단계 마법사와 Home 의 실행 폼이 함께 쓴다. `idPrefix` 로 DOM id 를 가른다.
 */
export function StepServer(props: {
  method: CommandMethod;
  target: string;
  args: readonly string[];
  recentCommands: readonly string[];
  /** DOM id 접두사. 한 문서에 둘 이상 그려질 때 id 가 겹치지 않게 한다. */
  idPrefix?: string;
  onMethodChange: (method: CommandMethod) => void;
  onTargetChange: (target: string) => void;
  onArgsChange: (args: readonly string[]) => void;
}): JSX.Element {
  const { command, leadingArgs } = splitCommand(props.method, props.target);
  const prefix = props.idPrefix ?? "generate";

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-medium text-ink">실행 방법</p>
        <fieldset className="inline-flex overflow-hidden rounded-md border border-line">
          {(Object.keys(METHOD_LABELS) as readonly CommandMethod[]).map((method) => (
            <button
              key={method}
              type="button"
              aria-pressed={props.method === method}
              className={`px-3 py-1.5 text-sm ${
                props.method === method
                  ? "bg-accent-soft font-semibold text-accent"
                  : "text-ink-muted hover:bg-line-subtle"
              }`}
              onClick={() => props.onMethodChange(method)}
            >
              {METHOD_LABELS[method]}
            </button>
          ))}
        </fieldset>
      </div>

      <Field
        label={props.method === "custom" ? "실행 파일" : "서버 스크립트"}
        htmlFor={`${prefix}-target`}
        hint={
          props.method === "custom"
            ? "실행 파일 하나만 적습니다. 인자는 아래 «서버 인자»로 추가하세요."
            : "직접 입력하거나 최근 사용값에서 고릅니다."
        }
      >
        <input
          id={`${prefix}-target`}
          className={`${INPUT_CLASS} font-mono`}
          list={`${prefix}-recent-commands`}
          value={props.target}
          onChange={(event) => props.onTargetChange(event.target.value)}
        />
        <datalist id={`${prefix}-recent-commands`}>
          {props.recentCommands.map((recent) => (
            <option key={recent} value={recent} />
          ))}
        </datalist>
      </Field>

      <ArgChips idPrefix={prefix} args={props.args} onChange={props.onArgsChange} />

      <div className="rounded-md border border-line bg-line-subtle px-3 py-2">
        <p className="text-xs text-ink-muted">실행될 명령</p>
        <p className="font-mono text-sm text-ink">
          {command === "" ? "—" : [command, ...leadingArgs, ...props.args].join(" ")}
        </p>
      </div>
    </div>
  );
}

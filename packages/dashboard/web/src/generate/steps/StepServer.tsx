import type { JSX } from "react";
import { useState } from "react";
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
 * 스크립트 경로·패키지명·직접 입력의 나머지 토큰은 전부 `--arg`로 가야 한다.
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
    case "custom": {
      const [head, ...rest] = trimmed.split(/\s+/);
      return { command: head ?? "", leadingArgs: rest };
    }
  }
}

/**
 * 1단계 — 테스트할 서버. 서버 스크립트 후보 스캔 API가 없으므로 직접 입력 +
 * 최근 사용값(localStorage, datalist)만 지원한다. 서버 인자는 칩 목록으로 쌓는다.
 */
export function StepServer(props: {
  method: CommandMethod;
  target: string;
  args: readonly string[];
  recentCommands: readonly string[];
  onMethodChange: (method: CommandMethod) => void;
  onTargetChange: (target: string) => void;
  onArgsChange: (args: readonly string[]) => void;
}): JSX.Element {
  const [argDraft, setArgDraft] = useState("");
  const { command, leadingArgs } = splitCommand(props.method, props.target);

  function addArg(): void {
    if (argDraft.trim() === "") {
      return;
    }
    props.onArgsChange([...props.args, argDraft]);
    setArgDraft("");
  }

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
        label={props.method === "custom" ? "실행 명령" : "서버 스크립트"}
        htmlFor="generate-target"
        hint={
          props.method === "custom"
            ? "실행 명령 전체를 그대로 입력합니다."
            : "직접 입력하거나 최근 사용값에서 고릅니다(프로젝트 스캔 API 없음)."
        }
      >
        <input
          id="generate-target"
          className={`${INPUT_CLASS} font-mono`}
          list="generate-recent-commands"
          value={props.target}
          onChange={(event) => props.onTargetChange(event.target.value)}
        />
        <datalist id="generate-recent-commands">
          {props.recentCommands.map((recent) => (
            <option key={recent} value={recent} />
          ))}
        </datalist>
      </Field>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-ink" htmlFor="generate-arg-draft">
          서버 인자
        </label>
        {props.args.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {props.args.map((arg, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: 인자 칩은 같은 값 중복을 허용해 값만으로는 유일 키가 없고, 목록은 변경마다 통째로 재생성된다
                key={`${arg}-${index}`}
                className="inline-flex items-center gap-1.5 rounded bg-line-subtle px-2 py-0.5 font-mono text-xs text-ink"
              >
                {arg}
                <button
                  type="button"
                  aria-label={`인자 ${arg} 제거`}
                  className="text-ink-muted hover:text-ink"
                  onClick={() => props.onArgsChange(props.args.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            id="generate-arg-draft"
            className={`${INPUT_CLASS} font-mono`}
            value={argDraft}
            placeholder="인자 하나씩 추가"
            onChange={(event) => setArgDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addArg();
              }
            }}
          />
          <button
            type="button"
            className="rounded border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
            onClick={addArg}
          >
            추가
          </button>
        </div>
      </div>

      <div className="rounded-md border border-line bg-line-subtle px-3 py-2">
        <p className="text-xs text-ink-muted">실행될 명령</p>
        <p className="font-mono text-sm text-ink">
          {command === "" ? "—" : [command, ...leadingArgs, ...props.args].join(" ")}
        </p>
      </div>
    </div>
  );
}

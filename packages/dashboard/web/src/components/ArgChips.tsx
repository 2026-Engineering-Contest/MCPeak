import type { JSX } from "react";
import { useState } from "react";
import { INPUT_CLASS } from "../generate/steps/fields.js";

/**
 * 서버 인자 칩 목록 + 하나씩 추가 입력.
 *
 * **인자를 칩으로 받는 것이 이 컴포넌트의 요점이다.** 한 칸에 명령 전체를 받아 공백으로
 * 쪼개면 공백이 든 경로를 가진 사용자는 실행 자체를 못 한다(#223). 애초에 나눠 받으면
 * 파싱도 따옴표 문제도 생기지 않는다.
 *
 * Generate 마법사의 `StepServer` 와 Home 의 후보 갈래가 함께 쓴다. `idPrefix` 로 DOM id 를
 * 가른다. `disabled` 일 때도 값을 지우지 않는 것은 호출자 몫이다 — HTTP 대상으로 바꿨다가
 * 되돌리면 인자가 그대로 살아 있어야 한다(설계 §5-3).
 */
export function ArgChips(props: {
  /** DOM id 접두사. 한 문서에 둘 이상 그려질 때 id 가 겹치지 않게 한다. */
  idPrefix: string;
  args: readonly string[];
  disabled?: boolean;
  /** 라벨 우측 부제. 비활성 사유나 값의 출처를 적는다. */
  hint?: string;
  onChange: (args: readonly string[]) => void;
}): JSX.Element {
  const [argDraft, setArgDraft] = useState("");
  const disabled = props.disabled ?? false;

  function addArg(): void {
    if (disabled || argDraft.trim() === "") {
      return;
    }
    props.onChange([...props.args, argDraft]);
    setArgDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label
          className="block text-sm font-medium text-ink"
          htmlFor={`${props.idPrefix}-arg-draft`}
        >
          서버 인자
        </label>
        {props.hint !== undefined && <p className="text-xs text-ink-muted">{props.hint}</p>}
      </div>
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
                disabled={disabled}
                className="text-ink-muted hover:text-ink disabled:opacity-50"
                onClick={() => props.onChange(props.args.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={`${props.idPrefix}-arg-draft`}
          className={`${INPUT_CLASS} font-mono`}
          value={argDraft}
          disabled={disabled}
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
          disabled={disabled}
          className="rounded border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
          onClick={addArg}
        >
          추가
        </button>
      </div>
    </div>
  );
}

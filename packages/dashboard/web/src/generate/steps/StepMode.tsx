import type { JSX } from "react";
import type { GenerateForm } from "../build-argv.js";
import { Field, INPUT_CLASS } from "./fields.js";

type ModeFields = Pick<GenerateForm, "mode" | "provider" | "model">;

const MODEL_OPTIONS = {
  codex: [
    ["gpt-5.6-sol", "Sol"],
    ["gpt-5.6-terra", "Terra"],
    ["gpt-5.6-luna", "Luna"],
  ],
  claude: [
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
    ["opus", "Opus"],
  ],
} as const satisfies Record<ModeFields["provider"], readonly (readonly [string, string])[]>;

/**
 * 3단계 — 생성 방식(설계 §5-3). AI/기본 골격 라디오 카드, AI 도구, 모델뿐이다.
 *
 * **시험 실행·자동 교정 토글은 4단계로 갔다.** `--reset-cmd` 가 시험 실행에 종속인데 토글과
 * 입력이 다른 단계에 있으면 비활성 사유를 볼 자리가 없다. 같은 화면에 두면 사유가 토글 옆에
 * 붙는다.
 */
export function StepMode(props: {
  form: ModeFields;
  onChange: (patch: Partial<ModeFields>) => void;
}): JSX.Element {
  const { form } = props;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="생성 방식">
        {(
          [
            ["ai", "AI가 테스트 케이스 작성", "실제 도구 호출을 AI가 설계합니다."],
            ["baseline", "기본 골격만", "AI 없이 스위트 골격만 만듭니다 (--baseline-only)."],
          ] as const
        ).map(([mode, title, desc]) => (
          // biome-ignore lint/a11y/useSemanticElements: 카드형 라디오라 실제 input[type=radio]로 바꾸면 스타일·포커스 구조를 다시 짜야 한다. role/aria-checked로 의미를 보존한다
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={form.mode === mode}
            className={`rounded-lg border p-3 text-left ${
              form.mode === mode
                ? "border-accent-border bg-accent-soft"
                : "border-line hover:bg-line-subtle"
            }`}
            onClick={() => props.onChange({ mode })}
          >
            <p className="text-sm font-semibold text-ink">{title}</p>
            <p className="mt-1 text-xs text-ink-muted">{desc}</p>
          </button>
        ))}
      </div>

      {form.mode === "ai" && (
        <>
          <Field label="AI 도구" htmlFor="generate-provider">
            <select
              id="generate-provider"
              className={INPUT_CLASS}
              value={form.provider}
              onChange={(event) =>
                props.onChange({
                  provider: event.target.value as ModeFields["provider"],
                  model: "",
                })
              }
            >
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
          </Field>
          <Field label="모델 (선택)" htmlFor="generate-model" hint="비우면 도구 기본값을 씁니다.">
            <select
              id="generate-model"
              className={`${INPUT_CLASS} font-mono`}
              value={form.model}
              onChange={(event) => props.onChange({ model: event.target.value })}
            >
              <option value="">도구 기본값</option>
              {MODEL_OPTIONS[form.provider].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </div>
  );
}

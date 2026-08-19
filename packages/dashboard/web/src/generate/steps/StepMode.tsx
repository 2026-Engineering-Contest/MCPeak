import type { JSX } from "react";
import type { GenerateForm } from "../build-argv.js";
import { Field, INPUT_CLASS, Toggle } from "./fields.js";

type ModeFields = Pick<GenerateForm, "mode" | "provider" | "model" | "dryRun" | "repair">;

/**
 * 3단계 — 생성 방식. AI/기본 골격 라디오 카드, AI 도구·모델, 시험 실행·자동 교정 토글.
 * 시험 실행과 자동 교정은 동시에 끌 수 없으므로 나중에 끄려는 쪽 토글을 비활성한다
 * (UI 설계 §5-3 폼 검증 선반영).
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
                props.onChange({ provider: event.target.value as ModeFields["provider"] })
              }
            >
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
          </Field>
          <Field label="모델 (선택)" htmlFor="generate-model" hint="비우면 도구 기본값을 씁니다.">
            <input
              id="generate-model"
              className={`${INPUT_CLASS} font-mono`}
              value={form.model}
              onChange={(event) => props.onChange({ model: event.target.value })}
            />
          </Field>
        </>
      )}

      <Toggle
        id="generate-dry-run"
        label="저장 전에 시험 실행으로 검증"
        checked={form.dryRun}
        disabled={!form.repair && form.dryRun}
        hint={
          !form.repair && form.dryRun
            ? "자동 교정이 꺼져 있어 시험 실행을 끌 수 없습니다."
            : "끄면 --no-dry-run이 들어갑니다."
        }
        onChange={(dryRun) => props.onChange({ dryRun })}
      />
      <Toggle
        id="generate-repair"
        label="실패한 입력값 자동 교정"
        checked={form.repair}
        disabled={!form.dryRun && form.repair}
        hint={
          !form.dryRun && form.repair
            ? "시험 실행이 꺼져 있어 자동 교정을 끌 수 없습니다."
            : "끄면 --no-repair가 들어갑니다."
        }
        onChange={(repair) => props.onChange({ repair })}
      />
    </div>
  );
}

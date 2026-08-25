import type { JSX } from "react";
import type { GenerateForm } from "../build-argv.js";
import { Field, INPUT_CLASS, Toggle } from "./fields.js";

type SuiteFields = Pick<GenerateForm, "suiteId" | "suiteName" | "outPath" | "force">;

/**
 * 2단계 — 만들어질 스위트. --suite-id, --name, --out, --force 대응(설계 §5-2).
 *
 * 힌트 문구는 부모가 넘긴다. 저장 위치 제안이 있는지, 스위트 ID·이름이 아직 제안값 그대로인지
 * 아는 것은 제안 규칙을 굴리는 `GenerateWizard` 쪽이다.
 */
export function StepSuite(props: {
  form: SuiteFields;
  /** 저장 위치 힌트. 제안값이 있을 때와 없을 때가 다르다(설계 §5-2). */
  outPathHint: string;
  /** 스위트 ID·이름 힌트. 아직 제안값 그대로일 때만 문자열이고 아니면 null 이다. */
  derivedHint: string | null;
  onChange: (patch: Partial<SuiteFields>) => void;
}): JSX.Element {
  const derivedHint = props.derivedHint ?? undefined;
  return (
    <div className="space-y-5">
      <Field label="스위트 ID" htmlFor="generate-suite-id" hint={derivedHint}>
        <input
          id="generate-suite-id"
          className={`${INPUT_CLASS} font-mono`}
          value={props.form.suiteId}
          onChange={(event) => props.onChange({ suiteId: event.target.value })}
        />
      </Field>
      <Field label="스위트 이름" htmlFor="generate-suite-name" hint={derivedHint}>
        <input
          id="generate-suite-name"
          className={INPUT_CLASS}
          value={props.form.suiteName}
          onChange={(event) => props.onChange({ suiteName: event.target.value })}
        />
      </Field>
      <Field label="저장 위치" htmlFor="generate-out-path" hint={props.outPathHint}>
        <input
          id="generate-out-path"
          className={`${INPUT_CLASS} font-mono`}
          value={props.form.outPath}
          onChange={(event) => props.onChange({ outPath: event.target.value })}
        />
      </Field>
      <Toggle
        id="generate-force"
        label="이미 있는 파일 덮어쓰기 (--force)"
        checked={props.form.force}
        onChange={(force) => props.onChange({ force })}
      />
    </div>
  );
}

import type { JSX } from "react";
import type { GenerateForm } from "../build-argv.js";
import { Field, INPUT_CLASS, Toggle } from "./fields.js";

type SuiteFields = Pick<GenerateForm, "suiteId" | "suiteName" | "outPath" | "force">;

/** 2단계 — 만들어질 스위트. --suite-id, --name, --out, --force 대응(UI 설계 §5-3). */
export function StepSuite(props: {
  form: SuiteFields;
  onChange: (patch: Partial<SuiteFields>) => void;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <Field label="스위트 ID" htmlFor="generate-suite-id">
        <input
          id="generate-suite-id"
          className={`${INPUT_CLASS} font-mono`}
          value={props.form.suiteId}
          onChange={(event) => props.onChange({ suiteId: event.target.value })}
        />
      </Field>
      <Field label="스위트 이름" htmlFor="generate-suite-name">
        <input
          id="generate-suite-name"
          className={INPUT_CLASS}
          value={props.form.suiteName}
          onChange={(event) => props.onChange({ suiteName: event.target.value })}
        />
      </Field>
      <Field
        label="저장 위치"
        htmlFor="generate-out-path"
        hint="스크립트 경로를 기준으로 자동 제안된 값입니다. 바꿔도 됩니다(.json 파일)."
      >
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

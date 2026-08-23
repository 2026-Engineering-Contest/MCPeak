import type { JSX } from "react";
import type { GenerateForm } from "../build-argv.js";
import { buildGenerateArgv } from "../build-argv.js";
import { Field, INPUT_CLASS } from "./fields.js";

type ConfirmFields = Pick<GenerateForm, "resetCmd">;

/** argv 한 토큰을 셸 표기로 감싼다(표시 전용, 전송은 배열 그대로). */
function quoteToken(token: string): string {
  if (token === "" || /\s|"/.test(token)) {
    return `"${token.replaceAll('"', '\\"')}"`;
  }
  return token;
}

/** 표시용 CLI 명령 전문. 전송 argv 배열과 같은 순서다. */
export function formatCliCommand(argv: readonly string[]): string {
  return ["mcpeak", "generate", ...argv.map(quoteToken)].join(" ");
}

/**
 * 4단계 — 초기화와 확인. 시험 실행을 끄면 초기화 입력을 비활성한다
 * (--no-dry-run은 --reset-cmd와 함께 쓸 수 없다). UI 설계 §5-3.
 */
export function StepConfirm(props: {
  form: GenerateForm;
  onChange: (patch: Partial<ConfirmFields>) => void;
}): JSX.Element {
  const { form } = props;

  let cliCommand: string | null = null;
  let buildError: string | null = null;
  try {
    cliCommand = formatCliCommand(buildGenerateArgv(form));
  } catch (err) {
    buildError = err instanceof Error ? err.message : String(err);
  }

  const summary: readonly (readonly [string, string])[] = [
    ["실행 명령", [form.command, ...form.args].join(" ")],
    ["스위트", `${form.suiteId} (${form.suiteName})`],
    ["저장 위치", form.outPath + (form.force ? " (덮어쓰기)" : "")],
    [
      "생성 방식",
      form.mode === "baseline"
        ? "기본 골격만"
        : `AI (${form.provider}${form.model !== "" ? `, ${form.model}` : ""})`,
    ],
    ["시험 실행", form.dryRun ? "켬" : "끔"],
    ["자동 교정", form.repair ? "켬" : "끔"],
    ["초기화 명령", form.resetCmd === "" ? "없음" : form.resetCmd],
  ];

  return (
    <div className="space-y-5">
      <Field
        label="시험 실행 전 초기화 명령 (선택)"
        htmlFor="generate-reset-cmd"
        hint={
          form.dryRun
            ? "시험 실행 직전에 한 번 실행됩니다."
            : "시험 실행이 꺼져 있어 초기화 명령을 쓸 수 없습니다."
        }
      >
        <input
          id="generate-reset-cmd"
          className={`${INPUT_CLASS} font-mono`}
          value={form.resetCmd}
          disabled={!form.dryRun}
          onChange={(event) => props.onChange({ resetCmd: event.target.value })}
        />
      </Field>
      <div className="rounded-lg border border-line">
        <p className="border-b border-line px-3 py-2 text-xs font-semibold text-ink-muted">
          선택 요약
        </p>
        <dl className="divide-y divide-line-subtle text-sm">
          {summary.map(([label, value]) => (
            <div key={label} className="flex gap-3 px-3 py-1.5">
              <dt className="w-28 shrink-0 text-ink-muted">{label}</dt>
              <dd className="font-mono text-xs text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-md border border-line bg-line-subtle px-3 py-2">
        <p className="text-xs text-ink-muted">실행될 CLI 명령</p>
        {cliCommand !== null ? (
          <p className="font-mono text-sm break-all text-ink">{cliCommand}</p>
        ) : (
          <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
            {buildError}
          </p>
        )}
      </div>
    </div>
  );
}

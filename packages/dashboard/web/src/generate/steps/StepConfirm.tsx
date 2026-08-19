import type { JSX } from "react";
import type { GenerateForm } from "../build-argv.js";
import { buildGenerateArgv } from "../build-argv.js";
import { Field, INPUT_CLASS, Toggle } from "./fields.js";

type ConfirmFields = Pick<GenerateForm, "cassettePath" | "resetCmd" | "record">;

/** argv 한 토큰을 셸 표기로 감싼다(표시 전용, 전송은 배열 그대로). */
function quoteToken(token: string): string {
  if (token === "" || /\s|"/.test(token)) {
    return `"${token.replaceAll('"', '\\"')}"`;
  }
  return token;
}

/** 표시용 CLI 명령 전문. 전송 argv 배열과 같은 순서다. */
export function formatCliCommand(argv: readonly string[]): string {
  return ["ohmymcp", "generate", ...argv.map(quoteToken)].join(" ");
}

/**
 * 4단계 — 녹화와 확인. 시험 실행을 끄면 카세트·초기화 입력을 비활성하고
 * (--no-dry-run은 --cassette·--reset-cmd와 함께 쓸 수 없다), 재녹화 체크는
 * 카세트 경로가 있을 때만 활성한다(--record는 --cassette 전제). UI 설계 §5-3.
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
    ["카세트", form.cassettePath === "" ? "녹화 없음" : form.cassettePath + (form.record ? " (재녹화)" : "")],
    ["초기화 명령", form.resetCmd === "" ? "없음" : form.resetCmd],
  ];

  return (
    <div className="space-y-5">
      <Field
        label="카세트 저장 위치 (선택)"
        htmlFor="generate-cassette"
        hint={
          form.dryRun
            ? "비우면 녹화하지 않습니다."
            : "시험 실행이 꺼져 있어 카세트를 녹화할 수 없습니다."
        }
      >
        <input
          id="generate-cassette"
          className={`${INPUT_CLASS} font-mono`}
          value={form.cassettePath}
          disabled={!form.dryRun}
          onChange={(event) => props.onChange({ cassettePath: event.target.value })}
        />
      </Field>
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
      <Toggle
        id="generate-record"
        label="재녹화 (--record)"
        checked={form.record}
        disabled={form.cassettePath === ""}
        hint={
          form.cassettePath === ""
            ? "카세트 저장 위치가 있어야 재녹화할 수 있습니다."
            : "기존 카세트를 지우고 다시 녹화합니다."
        }
        onChange={(record) => props.onChange({ record })}
      />

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

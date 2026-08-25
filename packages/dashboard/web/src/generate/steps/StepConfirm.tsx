import type { JSX } from "react";
import type { GenerateForm } from "../build-argv.js";
import { buildGenerateArgv } from "../build-argv.js";
import { Field, INPUT_CLASS, Toggle } from "./fields.js";

type ConfirmFields = Pick<GenerateForm, "dryRun" | "repair" | "resetCmd">;

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
 * 4단계 — 검증과 확인(설계 §5-4). 시험 실행·자동 교정 토글, 초기화 명령, 선택 요약,
 * 실행될 CLI 명령 전문을 위에서 아래로 놓는다.
 *
 * **종속된 것끼리 한 화면에 있는 것이 이 단계의 요점이다.** 시험 실행을 끄면 초기화 명령을
 * 쓸 수 없는데(`--no-dry-run` 은 `--reset-cmd` 와 함께 못 쓴다) 토글이 다른 단계에 있으면
 * 사용자는 입력이 왜 잠겼는지 보러 되돌아가야 한다.
 */
export function StepConfirm(props: {
  form: GenerateForm;
  onChange: (patch: Partial<ConfirmFields>) => void;
}): JSX.Element {
  const { form } = props;
  const http = form.transport === "http";

  let cliCommand: string | null = null;
  let buildError: string | null = null;
  try {
    cliCommand = formatCliCommand(buildGenerateArgv(form));
  } catch (err) {
    buildError = err instanceof Error ? err.message : String(err);
  }

  const summary: readonly (readonly [string, string])[] = [
    [
      "실행 명령",
      http
        ? `원격 ${form.url.trim()} (헤더 ${form.headerEnvs.length}개)`
        : [form.command, ...form.args].join(" "),
    ],
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

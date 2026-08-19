import type { ReactNode } from "react";
import { useState } from "react";
import type { StartRunRequest, StartRunResponse } from "../../../src/api-types.js";
import { apiSend } from "../api.js";
import { RunStreamPanel } from "./RunView.js";

/**
 * argv 조립 규칙. `packages/cli/src/generate-command.ts`의 `parseGenerateCommand`가
 * 받는 옵션 이름을 그대로 쓴다(§4-4: "CLI argv 배열 그대로" 원칙. 대시보드가 옵션
 * 스키마를 복제하지 않고 CLI가 이미 아는 이름을 그대로 조립만 한다).
 * `--suite-id`·`--name`·`--out`·`--command`는 필수, 나머지는 값이 있을 때만 붙는다.
 */
export interface GenerateFormValues {
  readonly command: string;
  readonly suiteId: string;
  readonly suiteName: string;
  readonly outPath: string;
  readonly argsText: string;
  readonly cassettePath: string;
  readonly record: boolean;
  readonly provider: "" | "codex" | "claude";
}

export function buildGenerateArgv(form: GenerateFormValues): string[] {
  const argv: string[] = [
    "--command",
    form.command.trim(),
    "--suite-id",
    form.suiteId.trim(),
    "--name",
    form.suiteName.trim(),
    "--out",
    form.outPath.trim(),
  ];
  for (const arg of form.argsText.split(/\s+/).filter((token) => token.length > 0)) {
    argv.push("--arg", arg);
  }
  if (form.provider !== "") {
    argv.push("--provider", form.provider);
  }
  if (form.cassettePath.trim() !== "") {
    argv.push("--cassette", form.cassettePath.trim());
  }
  if (form.record) {
    argv.push("--record");
  }
  return argv;
}

function isFormValid(form: GenerateFormValues): boolean {
  return (
    form.command.trim() !== "" &&
    form.suiteId.trim() !== "" &&
    form.suiteName.trim() !== "" &&
    form.outPath.trim() !== ""
  );
}

const INITIAL_FORM: GenerateFormValues = {
  command: "",
  suiteId: "",
  suiteName: "",
  outPath: "",
  argsText: "",
  cassettePath: "",
  record: false,
  provider: "",
};

export function GenerateWizard() {
  const [form, setForm] = useState<GenerateFormValues>(INITIAL_FORM);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  function update<K extends keyof GenerateFormValues>(key: K, value: GenerateFormValues[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const response = await apiSend<StartRunResponse>("POST", "/api/runs", {
        flow: "generate",
        argv: buildGenerateArgv(form),
      } satisfies StartRunRequest);
      setRunId(response.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  const valid = isFormValid(form);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">생성</h1>
        <p className="mt-1 text-slate-600">MCP 서버를 검사해 테스트 스위트를 생성합니다.</p>
      </div>

      {runId === null ? (
        <form
          className="max-w-xl space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="명령어" htmlFor="gw-command" required>
            <input
              id="gw-command"
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              value={form.command}
              onChange={(event) => update("command", event.target.value)}
              placeholder="예: node server.js"
            />
          </Field>

          <Field label="인자" htmlFor="gw-args">
            <input
              id="gw-args"
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              value={form.argsText}
              onChange={(event) => update("argsText", event.target.value)}
              placeholder="공백으로 구분"
            />
          </Field>

          <Field label="스위트 ID" htmlFor="gw-suite-id" required>
            <input
              id="gw-suite-id"
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              value={form.suiteId}
              onChange={(event) => update("suiteId", event.target.value)}
            />
          </Field>

          <Field label="스위트 이름" htmlFor="gw-suite-name" required>
            <input
              id="gw-suite-name"
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              value={form.suiteName}
              onChange={(event) => update("suiteName", event.target.value)}
            />
          </Field>

          <Field label="출력 경로" htmlFor="gw-out" required>
            <input
              id="gw-out"
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              value={form.outPath}
              onChange={(event) => update("outPath", event.target.value)}
              placeholder="예: suites/weather.json"
            />
          </Field>

          <Field label="카세트 경로" htmlFor="gw-cassette">
            <input
              id="gw-cassette"
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              value={form.cassettePath}
              onChange={(event) => update("cassettePath", event.target.value)}
              placeholder="예: cassettes/weather.json"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-700" htmlFor="gw-record">
            <input
              id="gw-record"
              type="checkbox"
              checked={form.record}
              onChange={(event) => update("record", event.target.checked)}
            />
            --record (카세트를 새로 녹화)
          </label>

          <Field label="AI 제안 provider" htmlFor="gw-provider">
            <select
              id="gw-provider"
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              value={form.provider}
              onChange={(event) =>
                update("provider", event.target.value as GenerateFormValues["provider"])
              }
            >
              <option value="">사용 안 함</option>
              <option value="codex">codex</option>
              <option value="claude">claude</option>
            </select>
          </Field>

          {error !== null && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!valid || starting}
          >
            생성 시작
          </button>
        </form>
      ) : (
        <RunStreamPanel runId={runId} />
      )}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required = false,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly required?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700" htmlFor={htmlFor}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

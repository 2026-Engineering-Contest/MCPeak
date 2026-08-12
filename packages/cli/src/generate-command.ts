import { createHash } from "node:crypto";
import { access, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { McpStdioConnection, ToolDef } from "@ohmymcp/core";
import type {
  AuthoringDiffPreview,
  AuthoringExecutionSnapshot,
  AuthoringRequestPreview,
  AuthoringSessionView,
  BaselineGenerationResult,
  SanitizedAuthoringCandidate,
} from "@ohmymcp/generate";
import type { SuiteValidationResult, TestSuiteSpec } from "@ohmymcp/runner";

export const GENERATE_USAGE =
  "사용법: ohmymcp generate --suite-id <id> --name <name> --out <suite.json> --command <executable> [--arg <value> ...] [--baseline-only] [--provider <codex|claude>] [--model <model>]";

export interface GenerateCommandInput {
  readonly suiteId: string;
  readonly name: string;
  readonly outPath: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly baselineOnly: boolean;
  readonly provider?: "codex" | "claude";
  readonly model?: string;
}
export interface GenerateCommandDependencies {
  connect(options: { command: string; args: readonly string[] }): Promise<McpStdioConnection>;
  createBaselineSuite(
    tools: readonly ToolDef[],
    options: { suiteId: string; suiteName: string },
  ): BaselineGenerationResult;
  createAuthoringSession(baseline: BaselineGenerationResult): AuthoringSessionView;
  finalizeAuthoringDraft(options: {
    session: AuthoringSessionView;
    approval: { approved: boolean; fingerprint: string };
  }): { finalized: true; snapshot: AuthoringExecutionSnapshot } | { finalized: false };
  getAuthoringExecutionSuite(snapshot: AuthoringExecutionSnapshot): TestSuiteSpec;
  validateSuite(value: unknown): SuiteValidationResult;
  exists(path: string): Promise<boolean>;
  openTemp(path: string): Promise<{
    writeFile(data: string, encoding: "utf8"): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }>;
  readFile(path: string): Promise<Uint8Array>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  reviewIO?: ReviewIO;
  providers?: Partial<
    Record<"codex" | "claude", (model: string) => TestAuthoringProvider | undefined>
  >;
  prepareAuthoringRequest?: typeof import("@ohmymcp/generate").prepareAuthoringRequest;
  dispatchAuthoringRequest?: typeof import("@ohmymcp/generate").dispatchAuthoringRequest;
  createAuthoringDiff?: typeof import("@ohmymcp/generate").createAuthoringDiff;
  applyAuthoringChanges?: typeof import("@ohmymcp/generate").applyAuthoringChanges;
  reviewLocalAuthoringCandidate?: typeof import("@ohmymcp/generate").reviewLocalAuthoringCandidate;
}
export interface ReviewIO {
  input(message: string): Promise<string>;
  choose(message: string, choices: readonly string[]): Promise<string>;
  confirm(message: string): Promise<boolean>;
  write(text: string): void;
  readonly interactive: boolean;
  close?(): void;
}
type TestAuthoringProvider = import("@ohmymcp/generate").TestAuthoringProvider;
class UsageError extends Error {}

const optionNames = new Set([
  "--suite-id",
  "--name",
  "--out",
  "--command",
  "--arg",
  "--baseline-only",
  "--provider",
  "--model",
]);
function optionValue(argv: readonly string[], index: number, option: string): [string, number] {
  const item = argv[index];
  if (item === undefined) throw new UsageError(`\`${option}\` 옵션 값이 필요합니다.`);
  const equals = item.indexOf("=");
  if (equals > 0) return [item.slice(equals + 1), index];
  const value = argv[index + 1];
  if (value === undefined || (option !== "--arg" && value.startsWith("--")))
    throw new UsageError(`\`${option}\` 옵션 값이 필요합니다.`);
  return [value, index + 1];
}

export function parseGenerateCommand(argv: readonly string[]): GenerateCommandInput {
  const values = new Map<string, string>();
  const args: string[] = [];
  let baselineOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === undefined) continue;
    const option = item.includes("=") ? item.slice(0, item.indexOf("=")) : item;
    if (!option.startsWith("--"))
      throw new UsageError(`추가 위치 인자 '${item}'는 허용되지 않습니다.`);
    if (!optionNames.has(option))
      throw new UsageError(`지원하지 않는 generate 옵션 '${option}'입니다.`);
    if (option === "--baseline-only") {
      if (item !== option || baselineOnly)
        throw new UsageError("`--baseline-only`는 한 번만 사용할 수 있습니다.");
      baselineOnly = true;
      continue;
    }
    const [value, consumed] = optionValue(argv, index, option);
    index = consumed;
    if (option === "--arg") {
      args.push(value);
      continue;
    }
    if (values.has(option)) throw new UsageError(`\`${option}\`는 한 번만 사용할 수 있습니다.`);
    values.set(option, value);
  }
  for (const option of ["--suite-id", "--name", "--out", "--command"] as const)
    if (values.get(option) === undefined) throw new UsageError(`\`${option}\` 옵션이 필요합니다.`);
  const outPath = values.get("--out") as string;
  if (!outPath.toLowerCase().endsWith(".json"))
    throw new UsageError("`--out`은 .json 파일이어야 합니다.");
  const rawProvider = values.get("--provider");
  if (rawProvider !== undefined && rawProvider !== "codex" && rawProvider !== "claude")
    throw new UsageError("`--provider`는 codex 또는 claude여야 합니다.");
  if (values.has("--model") && rawProvider === undefined)
    throw new UsageError("`--model`은 `--provider`와 함께만 사용할 수 있습니다.");
  return Object.freeze({
    suiteId: values.get("--suite-id") as string,
    name: values.get("--name") as string,
    outPath,
    command: values.get("--command") as string,
    args: Object.freeze(args),
    baselineOnly,
    provider: rawProvider,
    model: values.get("--model"),
  });
}

function renderSuite(suite: TestSuiteSpec): string {
  const ordered: Record<string, unknown> = {
    schemaVersion: suite.schemaVersion,
    id: suite.id,
    name: suite.name,
  };
  if (suite.defaultTimeoutMs !== undefined) ordered.defaultTimeoutMs = suite.defaultTimeoutMs;
  ordered.cases = suite.cases;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("non-json value");
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}
function suiteFingerprint(suite: TestSuiteSpec): string {
  return createHash("sha256").update(canonicalJson(suite)).digest("hex");
}
async function saveSuite(
  input: GenerateCommandInput,
  suite: TestSuiteSpec,
  fingerprint: string,
  deps: GenerateCommandDependencies,
): Promise<void> {
  if (await deps.exists(input.outPath))
    throw new UsageError("기존 출력 파일을 비대화형으로 덮어쓸 수 없습니다.");
  const temporary = join(dirname(input.outPath), `.${basename(input.outPath)}.ohmymcp.tmp`);
  let created = false;
  try {
    const handle = await deps.openTemp(temporary);
    created = true;
    try {
      await handle.writeFile(renderSuite(suite), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const bytes = await deps.readFile(temporary);
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const validated = deps.validateSuite(parsed);
    if (!validated.valid || suiteFingerprint(validated.value) !== fingerprint)
      throw new Error("invalid saved suite");
    await deps.rename(temporary, input.outPath);
    created = false;
  } finally {
    if (created) await deps.unlink(temporary).catch(() => undefined);
  }
}

const defaultModel = (provider: "codex" | "claude") =>
  provider === "codex" ? "gpt-5.6-luna" : "haiku";

function showRequest(io: ReviewIO, preview: AuthoringRequestPreview): void {
  io.write(
    `Provider: ${preview.providerId}\nModel: ${preview.model}\nPayload: ${preview.byteLength} bytes\nResult limit: ${preview.maxResultBytes} bytes\nTimeout: ${preview.providerTimeoutMs}ms\nFingerprint: ${preview.fingerprint}\n전송 데이터: 사용자 요청, baseline suite, current candidate, 툴 이름·설명·inputSchema\n`,
  );
}
function showDiff(io: ReviewIO, preview: AuthoringDiffPreview): void {
  for (const change of preview.changes)
    io.write(`${change.id} ${change.type}${"caseId" in change ? ` ${change.caseId}` : ""}\n`);
}
function safeFailure(deps: GenerateCommandDependencies, code: string): void {
  deps.writeStderr(
    `오류 [GENERATE_${code}]: AI 검토 요청을 완료하지 못했습니다.\n해결: 입력과 provider 상태를 확인한 뒤 메뉴에서 다시 요청하세요.\n`,
  );
}

async function runInteractiveReview(
  input: GenerateCommandInput,
  tools: readonly ToolDef[],
  session: AuthoringSessionView,
  deps: GenerateCommandDependencies,
): Promise<number> {
  const io = deps.reviewIO;
  const prepare = deps.prepareAuthoringRequest;
  const dispatch = deps.dispatchAuthoringRequest;
  const makeDiff = deps.createAuthoringDiff;
  const apply = deps.applyAuthoringChanges;
  const reviewLocal = deps.reviewLocalAuthoringCandidate;
  if (!io?.interactive || !prepare || !dispatch || !makeDiff || !apply || !reviewLocal) {
    safeFailure(deps, "INTERACTIVE_REQUIRED");
    return 1;
  }
  let candidate: SanitizedAuthoringCandidate | undefined = session.workingCandidate;
  let preferred = input.provider;
  let model = input.model;
  try {
    while (true) {
      const action = await io.choose("검토 메뉴", [
        "codex",
        "claude",
        "apply-all",
        "select",
        "revise",
        "edit",
        "save",
        "cancel",
      ]);
      if (action === "cancel") return 0;
      if (action === "save") {
        const fingerprint = session.approvedDraft.suiteFingerprint;
        io.write(`Final fingerprint: ${fingerprint}\n`);
        if (!(await io.confirm("최종 JSON을 저장할까요?"))) continue;
        const final = deps.finalizeAuthoringDraft({
          session,
          approval: { approved: true, fingerprint },
        });
        if (!final.finalized) {
          safeFailure(deps, "FINALIZE_FAILED");
          continue;
        }
        try {
          await saveSuite(
            input,
            deps.getAuthoringExecutionSuite(final.snapshot),
            final.snapshot.fingerprint,
            deps,
          );
          return 0;
        } catch {
          safeFailure(deps, "SAVE_FAILED");
          continue;
        }
      }
      if (action === "apply-all" || action === "select") {
        if (!candidate) {
          io.write("적용할 candidate가 없습니다.\n");
          continue;
        }
        const diff = makeDiff({ session, candidate });
        showDiff(io, diff);
        const selected =
          action === "apply-all"
            ? diff.changes.map((change) => change.id)
            : (await io.input("적용할 change ID를 쉼표로 입력하세요: "))
                .split(",")
                .map((id) => id.trim())
                .filter(Boolean);
        if (!(await io.confirm("선택한 변경을 적용할까요?"))) continue;
        const result = apply({
          session,
          preview: diff,
          selectedChangeIds: selected,
          approval: { approved: true, fingerprint: diff.candidateFingerprint },
        });
        if (!result.applied) io.write(`변경을 적용하지 않았습니다: ${result.reason}\n`);
        else io.write(`revision ${result.draft.revision}을 승인했습니다.\n`);
        continue;
      }
      if (action === "edit") {
        const path = await io.input("편집한 JSON 파일 경로: ");
        try {
          const parsed = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(await deps.readFile(path)),
          );
          const result = reviewLocal({ session, candidate: parsed, tools });
          if (result.status === "preview") {
            candidate = result.preview;
            showDiff(io, makeDiff({ session, candidate }));
          } else io.write("편집한 JSON을 candidate로 사용할 수 없습니다.\n");
        } catch {
          safeFailure(deps, "LOCAL_JSON_INVALID");
        }
        continue;
      }
      const providerId = action === "revise" ? preferred : action;
      if (providerId !== "codex" && providerId !== "claude") {
        io.write("지원하지 않는 메뉴입니다.\n");
        continue;
      }
      if (action !== "revise" && providerId !== preferred)
        model = input.provider === providerId ? input.model : undefined;
      preferred = providerId;
      const selectedModel =
        model ?? (await io.input(`${providerId} model (${defaultModel(providerId)}): `));
      model = selectedModel || defaultModel(providerId);
      const provider = deps.providers?.[providerId]?.(model);
      if (!provider) {
        io.write(`${providerId} provider를 사용할 수 없습니다.\n`);
        continue;
      }
      const instruction = await io.input(action === "revise" ? "피드백: " : "AI 요청: ");
      const preview = prepare({
        mode: action === "revise" ? "revise" : "initial",
        instruction,
        baseline: session.baseline.suite,
        candidate: candidate?.result.suite ?? session.baseline.suite,
        tools,
        providerId,
        model,
      });
      showRequest(io, preview);
      if (!(await io.confirm("이 요청을 전송할까요?"))) continue;
      let result: Awaited<ReturnType<typeof dispatch>>;
      try {
        result = await dispatch({
          provider,
          preview,
          approval: { approved: true, fingerprint: preview.fingerprint },
          session,
        });
      } catch {
        safeFailure(deps, "PROVIDER_FAILED");
        continue;
      }
      if (result.status === "preview") {
        candidate = result.preview;
        showDiff(io, makeDiff({ session, candidate }));
      } else if (result.status === "questions") io.write(`질문:\n${result.questions.join("\n")}\n`);
      else if (result.status === "providerFailed") safeFailure(deps, "PROVIDER_FAILED");
      else io.write("AI 결과를 검토 후보로 사용할 수 없습니다.\n");
    }
  } finally {
    io.close?.();
  }
}

export async function runGenerateCommand(
  argv: readonly string[],
  deps: GenerateCommandDependencies,
): Promise<number> {
  let input: GenerateCommandInput;
  try {
    input = parseGenerateCommand(argv[0] === "generate" ? argv.slice(1) : argv);
  } catch (error) {
    const message =
      error instanceof UsageError ? error.message : "generate 입력을 해석할 수 없습니다.";
    deps.writeStderr(`오류 [CLI_USAGE]: ${message}\n해결: ${GENERATE_USAGE}\n`);
    return 1;
  }
  if (!input.baselineOnly && !deps.reviewIO?.interactive) {
    deps.writeStderr(
      "오류 [GENERATE_INTERACTIVE_REQUIRED]: AI 검토에는 TTY가 필요합니다.\n해결: `--baseline-only`를 지정하거나 대화형 터미널에서 실행하세요.\n",
    );
    return 1;
  }
  let connection: McpStdioConnection | undefined;
  try {
    connection = await deps.connect({ command: input.command, args: input.args });
    const tools = await connection.client.listTools();
    await connection.close();
    connection = undefined;
    const baseline = deps.createBaselineSuite(tools, {
      suiteId: input.suiteId,
      suiteName: input.name,
    });
    const session = deps.createAuthoringSession(baseline);
    if (!input.baselineOnly) return runInteractiveReview(input, tools, session, deps);
    const final = deps.finalizeAuthoringDraft({
      session,
      approval: { approved: true, fingerprint: session.approvedDraft.suiteFingerprint },
    });
    if (!final.finalized) throw new Error("finalize failed");
    await saveSuite(
      input,
      deps.getAuthoringExecutionSuite(final.snapshot),
      final.snapshot.fingerprint,
      deps,
    );
    deps.writeStdout(`baseline suite를 저장했습니다: ${input.outPath}\n`);
    return 0;
  } catch {
    if (connection !== undefined) await connection.forceClose().catch(() => undefined);
    deps.writeStderr(
      "오류 [GENERATE_FAILED]: baseline suite를 생성하거나 저장하지 못했습니다.\n해결: MCP 서버와 출력 경로를 확인한 뒤 다시 실행하세요.\n",
    );
    return 1;
  }
}

export const nodeGenerateDependencies = (): Omit<
  GenerateCommandDependencies,
  | "connect"
  | "createBaselineSuite"
  | "createAuthoringSession"
  | "finalizeAuthoringDraft"
  | "getAuthoringExecutionSuite"
  | "validateSuite"
> => ({
  exists: async (path) =>
    access(path)
      .then(() => true)
      .catch(() => false),
  openTemp: (path) => open(path, "wx"),
  readFile,
  rename,
  unlink,
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
});

export function nodeReviewIO(): ReviewIO {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    input: (message) => readline.question(message),
    choose: async (message, choices) => {
      const value = await readline.question(`${message} [${choices.join("/")}]: `);
      return value.trim();
    },
    confirm: async (message) =>
      (await readline.question(`${message} [y/N] `)).trim().toLowerCase() === "y",
    write: (text) => process.stdout.write(text),
    close: () => readline.close(),
  };
}

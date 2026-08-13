import { extname } from "node:path";
import type { McpStdioConnection } from "@ohmymcp/core";
import type {
  FinalizeRunnerExecutionOptions,
  RunnerExecution,
  RunnerReport,
  RunSuiteOptions,
  SuiteValidationIssue,
  SuiteValidationResult,
} from "@ohmymcp/runner";
import {
  isAbnormalExit,
  type ProcessDiagnosticsInput,
  renderProcessDiagnostics,
} from "./process-diagnostics.js";

export interface TestCommandInput {
  readonly suitePath: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly json: boolean;
  readonly stderrLines: number;
}
export type CliErrorCode =
  | "CLI_USAGE"
  | "COMMAND_NOT_IMPLEMENTED"
  | "SUITE_FORMAT_UNSUPPORTED"
  | "SUITE_READ_FAILED"
  | "SUITE_ENCODING_INVALID"
  | "SUITE_JSON_INVALID"
  | "SUITE_VALIDATION_FAILED"
  | "MCP_CONNECTION_FAILED"
  | "RUNNER_EXECUTION_FAILED"
  | "RUNNER_FINALIZATION_FAILED"
  | "CLI_INTERNAL_ERROR";
export interface CliFailure {
  readonly code: CliErrorCode;
  readonly message: string;
  readonly hint: string;
  readonly coreCode?: string;
  readonly issues?: readonly SuiteValidationIssue[];
}
export interface TestCommandDependencies {
  readFile(path: string): Promise<Uint8Array>;
  validateSuite(input: unknown): SuiteValidationResult;
  connect(options: { command: string; args: readonly string[] }): Promise<McpStdioConnection>;
  startRunner(options: RunSuiteOptions): RunnerExecution;
  finalize(options: FinalizeRunnerExecutionOptions): Promise<RunnerReport>;
  renderReport(report: RunnerReport, options?: { color?: boolean }): string;
  colorEnabled: boolean;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}
const usage =
  "사용법: ohmymcp test <suite.json> --command <executable> [--arg <value> ...] [--stderr-lines <N>]";
/** --stderr-lines 기본값. 설계 문서 §6. */
const DEFAULT_STDERR_LINES = 20;
const dictionary: Record<
  Exclude<CliErrorCode, "CLI_USAGE" | "COMMAND_NOT_IMPLEMENTED">,
  Omit<CliFailure, "code">
> = {
  SUITE_FORMAT_UNSUPPORTED: {
    message: "테스트 명세 형식을 지원하지 않습니다.",
    hint: "UTF-8로 저장한 .json 명세 파일을 사용하세요.",
  },
  SUITE_READ_FAILED: {
    message: "테스트 명세 파일을 읽지 못했습니다.",
    hint: "명세 경로와 읽기 권한을 확인하세요.",
  },
  SUITE_ENCODING_INVALID: {
    message: "테스트 명세 파일이 유효한 UTF-8이 아닙니다.",
    hint: "명세를 UTF-8 JSON으로 다시 저장하세요.",
  },
  SUITE_JSON_INVALID: {
    message: "테스트 명세의 JSON 문법이 유효하지 않습니다.",
    hint: "JSON 문법과 쉼표, 따옴표를 확인하세요.",
  },
  SUITE_VALIDATION_FAILED: {
    message: "MCP 테스트 명세가 유효하지 않습니다.",
    hint: "아래 명세 오류를 모두 수정하세요.",
  },
  MCP_CONNECTION_FAILED: {
    message: "MCP 서버 연결에 실패했습니다.",
    hint: "command 실행 가능 여부와 stdio MCP 서버 설정을 확인하세요.",
  },
  RUNNER_EXECUTION_FAILED: {
    message: "Runner 실행을 시작하지 못했습니다.",
    hint: "테스트 명세와 Runner 설정을 확인하세요.",
  },
  RUNNER_FINALIZATION_FAILED: {
    message: "Runner 실행 또는 MCP 서버 종료에 실패했습니다.",
    hint: "서버 응답과 종료 상태를 확인하세요.",
  },
  CLI_INTERNAL_ERROR: {
    message: "예상하지 못한 CLI 내부 오류가 발생했습니다.",
    hint: "다시 실행한 뒤 재현 정보와 함께 이슈를 보고하세요.",
  },
};
class CliCommandError extends Error {
  constructor(readonly failure: CliFailure) {
    super(failure.message);
  }
}
const fail = (message: string): never => {
  throw new CliCommandError({ code: "CLI_USAGE", message, hint: usage });
};
export function parseTestCommand(argv: readonly string[]): TestCommandInput {
  const suitePath = argv[0] ?? "";
  if (suitePath === "") fail("테스트 명세 JSON 경로가 필요합니다.");
  let command: string | undefined;
  let json = false;
  let stderrLines: number | undefined;
  const args: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--command" || token.startsWith("--command=")) {
      if (command !== undefined) fail("`--command`는 한 번만 사용할 수 있습니다.");
      let value: string;
      if (token === "--command") {
        const next = argv[++index];
        if (next === undefined)
          throw new CliCommandError({
            code: "CLI_USAGE",
            message: "`--command` 옵션 값이 필요합니다.",
            hint: usage,
          });
        value = next;
      } else value = token.slice("--command=".length);
      if (value === "") fail("`--command` 옵션 값이 필요합니다.");
      if (value.startsWith("--")) fail("`--command` 옵션 값이 필요합니다.");
      command = value;
    } else if (token === "--arg" || token.startsWith("--arg=")) {
      let value: string;
      if (token === "--arg") {
        const next = argv[++index];
        if (next === undefined)
          throw new CliCommandError({
            code: "CLI_USAGE",
            message: "`--arg` 옵션 값이 필요합니다.",
            hint: usage,
          });
        value = next;
        if (value.startsWith("-")) fail("`--arg` 옵션 값이 필요합니다.");
      } else value = token.slice("--arg=".length);
      args.push(value);
    } else if (token === "--stderr-lines" || token.startsWith("--stderr-lines=")) {
      if (stderrLines !== undefined) fail("`--stderr-lines`는 한 번만 사용할 수 있습니다.");
      let value: string;
      if (token === "--stderr-lines") {
        const next = argv[++index];
        if (next === undefined)
          throw new CliCommandError({
            code: "CLI_USAGE",
            message: "`--stderr-lines` 옵션 값이 필요합니다.",
            hint: usage,
          });
        // `-1` 처럼 `-` 로 시작해도 값으로 받고 아래 검증에서 거절한다. 설계 문서 §6.
        value = next;
      } else value = token.slice("--stderr-lines=".length);
      if (!/^\d+$/.test(value)) fail("`--stderr-lines` 값은 0 이상의 정수여야 합니다.");
      const parsedLines = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(parsedLines))
        fail("`--stderr-lines` 값은 0 이상의 정수여야 합니다.");
      stderrLines = parsedLines;
    } else if (token === "--json") {
      if (json) fail("`--json`은 한 번만 사용할 수 있습니다.");
      json = true;
    } else if (token.startsWith("--json=")) {
      fail("`--json`은 값을 받지 않습니다.");
    } else if (token.startsWith("-")) fail(`지원하지 않는 test 옵션 '${token}'입니다.`);
    else fail(`추가 위치 인자 '${token}'는 허용되지 않습니다.`);
  }
  if (command === undefined)
    throw new CliCommandError({
      code: "CLI_USAGE",
      message: "`--command` 옵션이 필요합니다.",
      hint: usage,
    });
  return Object.freeze({
    suitePath,
    command,
    args: Object.freeze(args),
    json,
    stderrLines: stderrLines ?? DEFAULT_STDERR_LINES,
  });
}
const escapeTerminalText = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    // 0x7f..0x9f 는 DEL 과 C1 제어 문자다. U+009B 를 8비트 CSI 로 해석하는 터미널이 있다.
    return codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");
function format(failure: CliFailure): string {
  const code =
    failure.coreCode === undefined ? failure.code : `${failure.code}/${failure.coreCode}`;
  let result = `오류 [${escapeTerminalText(code)}]: ${escapeTerminalText(failure.message)}\n해결: ${escapeTerminalText(failure.hint)}`;
  for (const issue of failure.issues ?? [])
    result += `\n- [${escapeTerminalText(issue.code)}] ${escapeTerminalText(issue.path)}: ${escapeTerminalText(issue.message)}\n  해결: ${escapeTerminalText(issue.hint)}`;
  return `${result}\n`;
}
type CoreError = Readonly<{
  name: "McpClientError";
  code: string;
  message: string;
  hint: string;
  diagnostics?: ProcessDiagnosticsInput;
}>;
/**
 * core 의 McpProcessDiagnostics 인지 구조로 확인한다. core 를 import 하지 않는다.
 * 하나라도 어긋나면 undefined 다. 설계 문서 §4.3.1.
 */
function processDiagnostics(value: unknown): ProcessDiagnosticsInput | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("stderr" in value) || typeof value.stderr !== "string") return undefined;
  if (!("stderrTruncated" in value) || typeof value.stderrTruncated !== "boolean") return undefined;
  if (!("exitCode" in value) || !(typeof value.exitCode === "number" || value.exitCode === null))
    return undefined;
  if (!("signal" in value) || !(typeof value.signal === "string" || value.signal === null))
    return undefined;
  return value as ProcessDiagnosticsInput;
}
function coreError(error: unknown): CoreError | undefined {
  const seen = new Set<object>();
  const visit = (value: unknown): CoreError | undefined => {
    if (
      typeof value === "object" &&
      value !== null &&
      "name" in value &&
      value.name === "McpClientError" &&
      "code" in value &&
      typeof value.code === "string" &&
      "message" in value &&
      typeof value.message === "string" &&
      "hint" in value &&
      typeof value.hint === "string"
    )
      return Object.freeze({
        name: "McpClientError" as const,
        code: value.code,
        message: value.message,
        hint: value.hint,
        diagnostics: processDiagnostics(
          "diagnostics" in value ? (value as { diagnostics: unknown }).diagnostics : undefined,
        ),
      });
    if (typeof value !== "object" || value === null || seen.has(value)) return undefined;
    seen.add(value);
    if (value instanceof AggregateError)
      for (const nested of value.errors) {
        const found = visit(nested);
        if (found !== undefined) return found;
      }
    return undefined;
  };
  return visit(error);
}
function writeFailure(dependencies: TestCommandDependencies, failure: CliFailure): number {
  dependencies.writeStderr(format(failure));
  return 1;
}
export async function runCli(
  argv: readonly string[],
  dependencies: TestCommandDependencies,
): Promise<number> {
  if (argv.length === 0)
    return writeFailure(dependencies, {
      code: "CLI_USAGE",
      message: "실행할 CLI 명령이 없습니다.",
      hint: usage,
    });
  if (argv[0] !== "test") {
    if (["generate", "record", "replay", "mock"].includes(argv[0] ?? ""))
      return writeFailure(dependencies, {
        code: "COMMAND_NOT_IMPLEMENTED",
        message: `'${argv[0]}' 명령은 아직 구현되지 않았습니다.`,
        hint: "현재는 test 명령만 사용할 수 있습니다.",
      });
    return writeFailure(dependencies, {
      code: "CLI_USAGE",
      message: `알 수 없는 CLI 명령 '${argv[0]}'입니다.`,
      hint: usage,
    });
  }
  let input: TestCommandInput;
  try {
    input = parseTestCommand(argv.slice(1));
  } catch (error) {
    return error instanceof CliCommandError
      ? writeFailure(dependencies, error.failure)
      : writeFailure(dependencies, {
          code: "CLI_INTERNAL_ERROR",
          ...dictionary.CLI_INTERNAL_ERROR,
        });
  }
  if (extname(input.suitePath).toLowerCase() !== ".json")
    return writeFailure(dependencies, {
      code: "SUITE_FORMAT_UNSUPPORTED",
      ...dictionary.SUITE_FORMAT_UNSUPPORTED,
    });
  let bytes: Uint8Array;
  try {
    bytes = await dependencies.readFile(input.suitePath);
  } catch {
    return writeFailure(dependencies, {
      code: "SUITE_READ_FAILED",
      ...dictionary.SUITE_READ_FAILED,
    });
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return writeFailure(dependencies, {
      code: "SUITE_ENCODING_INVALID",
      ...dictionary.SUITE_ENCODING_INVALID,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return writeFailure(dependencies, {
      code: "SUITE_JSON_INVALID",
      ...dictionary.SUITE_JSON_INVALID,
    });
  }
  let validated: SuiteValidationResult;
  try {
    validated = dependencies.validateSuite(parsed);
  } catch {
    return writeFailure(dependencies, {
      code: "CLI_INTERNAL_ERROR",
      ...dictionary.CLI_INTERNAL_ERROR,
    });
  }
  if (!validated.valid)
    return writeFailure(dependencies, {
      code: "SUITE_VALIDATION_FAILED",
      ...dictionary.SUITE_VALIDATION_FAILED,
      issues: validated.issues,
    });
  let connection: McpStdioConnection;
  try {
    connection = await dependencies.connect({ command: input.command, args: input.args });
  } catch (error) {
    const core = coreError(error);
    const failed = writeFailure(
      dependencies,
      core === undefined
        ? { code: "MCP_CONNECTION_FAILED", ...dictionary.MCP_CONNECTION_FAILED }
        : {
            code: "MCP_CONNECTION_FAILED",
            message: core.message,
            hint: core.hint,
            coreCode: core.code,
          },
    );
    // 이 경로에만 있는 조건이다. spawn 자체가 실패하면 진단이 전부 비어 소음만 남는다. §4.3.1.
    const diagnostics = core?.diagnostics;
    if (
      input.stderrLines > 0 &&
      diagnostics !== undefined &&
      (diagnostics.stderr !== "" || isAbnormalExit(diagnostics))
    ) {
      const block = renderProcessDiagnostics(diagnostics, { maxLines: input.stderrLines });
      if (block !== "") dependencies.writeStderr(`\n${block}`);
    }
    return failed;
  }
  /** 진단 출력 실패가 판정을 바꾸면 안 된다. getDiagnostics 가 던지면 삼킨다. §4.3.1. */
  const snapshotDiagnostics = (): ProcessDiagnosticsInput | undefined => {
    try {
      return connection.getDiagnostics();
    } catch {
      return undefined;
    }
  };
  /**
   * 블록 앞에는 항상 빈 줄을 둔다. 오류 메시지 뒤든 보고서 뒤든 같은 터미널에 이어 나오므로
   * 경로마다 레이아웃이 달라질 이유가 없다. 설계 문서 §7.
   * snapshot 을 주면 그 값을 쓴다. 우리가 프로세스를 정리한 뒤의 상태를 서버 탓으로 보고하지
   * 않기 위해서다(설계 문서 §4.3).
   */
  const writeDiagnostics = (snapshot?: ProcessDiagnosticsInput): void => {
    if (input.stderrLines === 0) return;
    const diagnostics = snapshot ?? snapshotDiagnostics();
    if (diagnostics === undefined) return;
    // 정보가 없는 블록은 소음이다. 설계 문서 §4.3. 판정은 렌더러가 아니라 여기에 둔다.
    if (diagnostics.stderr === "" && !isAbnormalExit(diagnostics)) return;
    const block = renderProcessDiagnostics(diagnostics, { maxLines: input.stderrLines });
    if (block === "") return;
    dependencies.writeStderr(`\n${block}`);
  };
  const shutdown = {
    client: connection.client,
    close: () => connection.close(),
    forceClose: (_reason: unknown) => connection.forceClose(),
  };
  let execution: RunnerExecution;
  try {
    execution = dependencies.startRunner({ client: connection.client, suite: validated.value });
  } catch {
    // forceClose 는 우리가 SIGTERM·SIGKILL 을 보내는 경로다. 그 뒤의 진단을 보여주면 서버가
    // 죽은 것으로 오인된다. 원인은 로컬의 startRunner 실패다. 정리 전 상태를 찍어둔다.
    const snapshot = snapshotDiagnostics();
    try {
      await connection.forceClose();
    } catch {}
    const failed = writeFailure(dependencies, {
      code: "RUNNER_EXECUTION_FAILED",
      ...dictionary.RUNNER_EXECUTION_FAILED,
    });
    writeDiagnostics(snapshot);
    return failed;
  }
  let finalReport: RunnerReport;
  try {
    finalReport = await dependencies.finalize({ execution, shutdown });
  } catch {
    const failed = writeFailure(dependencies, {
      code: "RUNNER_FINALIZATION_FAILED",
      ...dictionary.RUNNER_FINALIZATION_FAILED,
    });
    writeDiagnostics();
    return failed;
  }
  try {
    dependencies.writeStdout(
      input.json
        ? `${JSON.stringify(finalReport, null, 2)}\n`
        : dependencies.renderReport(finalReport, { color: dependencies.colorEnabled }),
    );
  } catch {
    // 원인이 서버가 아니라 우리 렌더링이므로 진단을 쓰지 않는다. 계획서 §4 호출 지점 4.
    return writeFailure(dependencies, {
      code: "CLI_INTERNAL_ERROR",
      ...dictionary.CLI_INTERNAL_ERROR,
    });
  }
  const settled = snapshotDiagnostics();
  // 전부 통과여도 비정상 종료면 쓴다. 종료 경로의 결함을 숨기지 않는다. 설계 문서 §4.3.
  if (finalReport.status !== "passed" || (settled !== undefined && isAbnormalExit(settled)))
    writeDiagnostics(settled);
  return finalReport.status === "passed" ? 0 : 1;
}

import { extname } from "node:path";
import type { McpStdioConnection } from "@ohmymcp/core";
import type {
  FinalizeRunnerExecutionOptions,
  InputContractOptions,
  RunnerExecution,
  RunnerReport,
  RunSuiteOptions,
  SpecFinding,
  SpecFindingCode,
  SpecFindingsResult,
  SuiteCaseApproval,
  SuiteValidationIssue,
  SuiteValidationResult,
  TestSuiteSpec,
} from "@ohmymcp/runner";
import {
  describeSpecFinding,
  checkAssertionSubstance as runnerCheckAssertionSubstance,
  checkInputContract as runnerCheckInputContract,
} from "@ohmymcp/runner";
import { TEST_USAGE_HINT } from "./help.js";
import {
  hasDiagnosticContent,
  isAbnormalExit,
  type ProcessDiagnosticsInput,
  renderProcessDiagnostics,
} from "./process-diagnostics.js";
import {
  caseApprovalStatuses,
  checkSpecApproval,
  renderSpecApproval,
  SERVER_DEFECT_NOTE_LINE,
  type SpecApprovalState,
  shouldShowSpecApproval,
} from "./spec-approval.js";

export interface TestCommandInput {
  readonly suitePath: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly json: boolean;
  /** `--junit` 로 받은 XML 출력 경로. 지정하지 않으면 undefined 이고 XML 을 만들지 않는다. */
  readonly junitPath: string | undefined;
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
  | "JUNIT_WRITE_FAILED"
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
  /**
   * runner 의 `renderJUnit`. 두 번째 인자를 선언하지 않는다 — CLI 는 `suiteName` 을 넘길 이유가
   * 없고(기본값이 `report.suite.name` 이다), 선택 인자를 가진 실제 함수는 이 시그니처에 그대로
   * 할당된다. ADR-0016 이 예약한 `JUnitRenderOptions` 확장 경로도 막지 않는다.
   */
  renderJUnit(report: RunnerReport): string;
  writeFile(path: string, text: string): Promise<void>;
  /**
   * 비차단 진단의 주입 지점. 생략하면 `runner` 의 실제 함수를 쓴다. 필수로 두면 진입점의
   * "런타임 의존성 없음" 경로가 이 두 필드를 채울 수 없다. 설계 문서 §7.
   */
  checkInputContract?(options: InputContractOptions): SpecFindingsResult;
  checkAssertionSubstance?(suite: TestSuiteSpec): SpecFindingsResult;
  colorEnabled: boolean;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}
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
  JUNIT_WRITE_FAILED: {
    message: "JUnit XML 파일을 쓰지 못했습니다.",
    hint: "`--junit` 경로의 디렉터리가 존재하는지와 쓰기 권한을 확인하세요.",
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
  throw new CliCommandError({ code: "CLI_USAGE", message, hint: TEST_USAGE_HINT });
};
export function parseTestCommand(argv: readonly string[]): TestCommandInput {
  const suitePath = argv[0] ?? "";
  if (suitePath === "") fail("테스트 명세 JSON 경로가 필요합니다.");
  let command: string | undefined;
  let json = false;
  let junitPath: string | undefined;
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
            hint: TEST_USAGE_HINT,
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
            hint: TEST_USAGE_HINT,
          });
        value = next;
        if (value.startsWith("-")) fail("`--arg` 옵션 값이 필요합니다.");
      } else value = token.slice("--arg=".length);
      args.push(value);
    } else if (token === "--junit" || token.startsWith("--junit=")) {
      // 값 검사는 `--command` 와 같은 규칙이다. 경로 자리에 플래그가 들어온 것은 값을 빠뜨린
      // 오타이지 `--junit` 이라는 이름의 파일을 만들라는 뜻이 아니다.
      if (junitPath !== undefined) fail("`--junit`은 한 번만 사용할 수 있습니다.");
      let value: string;
      if (token === "--junit") {
        const next = argv[++index];
        if (next === undefined)
          throw new CliCommandError({
            code: "CLI_USAGE",
            message: "`--junit` 옵션 값이 필요합니다.",
            hint: TEST_USAGE_HINT,
          });
        value = next;
      } else value = token.slice("--junit=".length);
      if (value === "") fail("`--junit` 옵션 값이 필요합니다.");
      if (value.startsWith("--")) fail("`--junit` 옵션 값이 필요합니다.");
      junitPath = value;
    } else if (token === "--stderr-lines" || token.startsWith("--stderr-lines=")) {
      if (stderrLines !== undefined) fail("`--stderr-lines`는 한 번만 사용할 수 있습니다.");
      let value: string;
      if (token === "--stderr-lines") {
        const next = argv[++index];
        if (next === undefined)
          throw new CliCommandError({
            code: "CLI_USAGE",
            message: "`--stderr-lines` 옵션 값이 필요합니다.",
            hint: TEST_USAGE_HINT,
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
      hint: TEST_USAGE_HINT,
    });
  return Object.freeze({
    suitePath,
    command,
    args: Object.freeze(args),
    json,
    junitPath,
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
/**
 * 참고 문장의 머리글 종류. 검사 종류가 곧 사용자가 고칠 곳이다. `skipped` 는 고칠 것이 없다는
 * 사실 자체를 알리는 종류라서 위반 둘과 갈린다.
 */
type FindingGroup = "inputContract" | "assertionSubstance" | "skipped";
/**
 * finding 코드를 검사 종류로 가른다. `Record<SpecFindingCode, …>` 라서 `runner` 가 코드를
 * 늘리면 여기서 타입 오류가 난다. 문자열 배열로 두면 새 코드가 조용히 한쪽으로 흘러간다.
 */
const FINDING_GROUP: Readonly<Record<SpecFindingCode, FindingGroup>> = {
  TOOL_NOT_DECLARED: "inputContract",
  REQUIRED_MISSING: "inputContract",
  UNDECLARED_FIELD: "inputContract",
  TYPE_MISMATCH: "inputContract",
  ENUM_MISMATCH: "inputContract",
  SCHEMA_NOT_ANALYZABLE: "skipped",
  VACUOUS_MIN_LENGTH: "assertionSubstance",
  VACUOUS_MIN_ITEMS: "assertionSubstance",
};
/**
 * 머리글은 검사 종류마다 다르다. `minLength: 0` 은 입력이 아니라 단언의 문제이고,
 * `SCHEMA_NOT_ANALYZABLE` 은 명세가 아니라 서버 스키마를 못 읽었다는 뜻이다. 둘 중 어느
 * 것이든 입력 머리글 아래 붙이면 읽는 사람이 멀쩡한 입력을 고치러 간다. 설계 문서 §7.2.
 */
const FINDING_HEADING: Readonly<Record<FindingGroup, (caseId: string) => string>> = {
  inputContract: (caseId) => `참고: ${caseId} 의 입력이 서버 선언과 다릅니다`,
  assertionSubstance: (caseId) => `참고: ${caseId} 의 단언은 무엇이 와도 통과합니다`,
  skipped: (caseId) => `참고: ${caseId} 의 입력 검사를 건너뛰었습니다`,
};
/**
 * 위반이 먼저, 건너뜀이 맨 뒤다. 위반 사이에서는 입력 계약이 먼저다. 명세를 고칠 때 입력이
 * 먼저 맞아야 단언을 볼 수 있다. 건너뜀이 맨 뒤인 이유는 그것만 있을 때 위에 아무 위반도
 * 없다는 사실이 먼저 읽혀야 하기 때문이다.
 */
const FINDING_GROUP_ORDER: readonly FindingGroup[] = [
  "inputContract",
  "assertionSubstance",
  "skipped",
];
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
      hint: TEST_USAGE_HINT,
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
      hint: TEST_USAGE_HINT,
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
  /**
   * 지문 대조는 서버 연결 전에 끝낸다. 연결이 실패해도 파일에 대한 사실은 변하지 않는다.
   * dependencies 에 주입 지점을 두지 않는다. 순수 함수이고 외부 자원을 안 쓰므로, 주입하면
   * 테스트가 실제 대조 로직을 안 거치게 된다. 설계 문서 §7.
   */
  const specApproval = checkSpecApproval(validated.value);
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
    // 억제 조건은 writeDiagnostics 와 같은 함수를 쓴다. 규칙이 갈라지면 spawn 실패처럼 진단이
    // 가장 필요한 경로에만 조용히 미적용된다. §4.3, §4.3.1.
    const diagnostics = core?.diagnostics;
    if (input.stderrLines > 0 && diagnostics !== undefined && hasDiagnosticContent(diagnostics)) {
      const block = renderProcessDiagnostics(diagnostics, { maxLines: input.stderrLines });
      if (block !== "") dependencies.writeStderr(`\n${block}`);
    }
    return failed;
  }
  /**
   * 진단 스냅샷. 읽기를 시도했다는 사실과 그 결과를 함께 담는다. `undefined` 를 센티널로 쓰면
   * "아직 안 읽었다" 와 "읽다 실패했다" 가 섞여, 실패했을 때 다시 읽는 일이 생긴다. §4.3.1.
   */
  type DiagnosticsSnapshot = { readonly value: ProcessDiagnosticsInput | undefined };
  /** 진단 출력 실패가 판정을 바꾸면 안 된다. getDiagnostics 가 던지면 삼킨다. §4.3.1. */
  const snapshotDiagnostics = (): DiagnosticsSnapshot => {
    try {
      return { value: connection.getDiagnostics() };
    } catch {
      return { value: undefined };
    }
  };
  /**
   * 블록 앞에는 항상 빈 줄을 둔다. 오류 메시지 뒤든 보고서 뒤든 같은 터미널에 이어 나오므로
   * 경로마다 레이아웃이 달라질 이유가 없다. 설계 문서 §7.
   * snapshot 을 주면 그 값을 쓴다. 우리가 프로세스를 정리한 뒤의 상태를 서버 탓으로 보고하지
   * 않기 위해서다(설계 문서 §4.3).
   */
  const writeDiagnostics = (snapshot?: DiagnosticsSnapshot): void => {
    if (input.stderrLines === 0) return;
    // 스냅샷을 받았으면 그 결과가 전부다. 실패했더라도 다시 읽지 않는다. 다시 읽으면 우리가
    // 프로세스를 정리한 뒤의 상태를 서버 탓으로 보고하게 된다.
    const diagnostics = (snapshot ?? snapshotDiagnostics()).value;
    if (diagnostics === undefined) return;
    // 정보가 없는 블록은 소음이다. 설계 문서 §4.3. 판정은 렌더러가 아니라 여기에 둔다.
    if (!hasDiagnosticContent(diagnostics)) return;
    const block = renderProcessDiagnostics(diagnostics, { maxLines: input.stderrLines });
    if (block === "") return;
    dependencies.writeStderr(`\n${block}`);
  };
  /**
   * 비차단 진단용 툴 목록. 실패하면 조용히 빈 배열로 둔다. 로그도 남기지 않는다. 진단이 실행을
   * 깨뜨리면 안 되고, 실패 원인과 무관한 줄이 보고서에 섞이면 정작 필요한 줄이 안 읽힌다.
   * 설계 문서 §7.1.
   */
  const tools = await (async () => {
    try {
      return await connection.client.listTools();
    } catch {
      return [];
    }
  })();
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
  const allPassed = finalReport.status === "passed";
  /**
   * XML 파일을 stdout 보다 **먼저** 쓴다. stdout 은 `| head` 같은 파이프에서 EPIPE 로 깨질 수
   * 있는데, 그때 사용자가 `--junit` 으로 명시적으로 요청한 산출물까지 함께 잃을 이유가 없다.
   * `--junit` 을 주지 않으면 이 블록을 통째로 건너뛰므로 기존 순서와 동일하다. ADR-0019.
   */
  if (input.junitPath !== undefined) {
    let xml: string;
    try {
      xml = dependencies.renderJUnit(finalReport);
    } catch {
      // 렌더링 실패는 우리 결함이다. 서버 진단을 붙이면 원인을 서버로 오인하게 만든다.
      return writeFailure(dependencies, {
        code: "CLI_INTERNAL_ERROR",
        ...dictionary.CLI_INTERNAL_ERROR,
      });
    }
    try {
      await dependencies.writeFile(input.junitPath, xml);
    } catch {
      // 전부 통과여도 1 이다. 조용히 0 을 내면 CI 는 리포트 파일 없이 초록이 되고, 사용자는
      // 리포트가 사라진 것을 한참 뒤에야 안다. 원인이 로컬 I/O 이므로 진단은 쓰지 않는다.
      return writeFailure(dependencies, {
        code: "JUNIT_WRITE_FAILED",
        ...dictionary.JUNIT_WRITE_FAILED,
      });
    }
  }
  /**
   * 툴 목록이 비면 입력 계약 대조는 건너뛴다. 목록이 비었을 때 대조하면 모든 케이스가
   * `TOOL_NOT_DECLARED` 로 걸려 실패 원인과 무관한 줄만 늘어난다. 단언 실질성은 툴이 필요
   * 없으므로 항상 돈다. 표시는 실패한 케이스에 한한다. 설계 문서 §7.
   *
   * 검사가 던져도 판정과 exit code 는 바뀌지 않아야 하므로 삼킨다. `validated.value` 는 이미
   * `validateMcpSuite` 를 통과했으니 도달할 일이 없는 경로이고, 도달했다면 그것은 비차단
   * 진단의 결함이지 대상 서버의 결함이 아니다.
   */
  const specFindings: readonly SpecFinding[] = (() => {
    /**
     * 실패한 케이스의 버킷을 보고서의 케이스 순서로 먼저 만든다. 두 검사 결과를 이어 붙인
     * 뒤에 `caseId` 로 묶으면 앞 케이스에 단언 finding 만 있고 뒤 케이스에 입력 계약 finding
     * 이 있을 때 뒤 케이스가 먼저 들어와 순서가 뒤집힌다. 케이스 사이 순서는 검사 종류가
     * 아니라 보고서가 정한다. 한 케이스 안의 블록 순서는 `FINDING_GROUP_ORDER` 가 맡는다.
     * 없는 키를 만들지 않으므로 버킷에 없는 caseId 는 그대로 걸러진다.
     */
    const buckets = new Map<string, SpecFinding[]>();
    for (const item of finalReport.cases)
      if (item.status !== "passed") buckets.set(item.spec.id, []);
    try {
      const inputContract = dependencies.checkInputContract ?? runnerCheckInputContract;
      const assertionSubstance =
        dependencies.checkAssertionSubstance ?? runnerCheckAssertionSubstance;
      const found = [
        ...(tools.length === 0 ? [] : inputContract({ suite: validated.value, tools }).findings),
        ...assertionSubstance(validated.value).findings,
      ];
      for (const finding of found) buckets.get(finding.caseId)?.push(finding);
      return [...buckets.values()].flat();
    } catch {
      return [];
    }
  })();
  /**
   * 참고 문장을 붙일 케이스. 승인 시점에 `serverDefect` 로 표시했는데 지금 또 실패한 것들이다.
   * 설계 문서 §9.
   *
   * **지문이 일치할 때만 본다.** 명세가 바뀌었으면 승인 시점의 판정이 지금 케이스에 해당하는지
   * 알 수 없다. 지문이 없으면 `approval.cases` 도 없으므로 이 집합은 비어 있다.
   * `serverDefect` 케이스가 통과하면 침묵한다. `test` 화면은 실패를 보는 자리다.
   */
  const serverDefectCases: ReadonlySet<string> = (() => {
    if (specApproval.state !== "matched") return new Set<string>();
    const statuses = caseApprovalStatuses(validated.value);
    if (statuses.size === 0) return new Set<string>();
    return new Set(
      finalReport.cases
        .filter((item) => item.status !== "passed" && statuses.get(item.spec.id) === "serverDefect")
        .map((item) => item.spec.id),
    );
  })();
  try {
    if (input.json) {
      /**
       * `spec` 은 억제 규칙과 무관하게 항상 넣는다. 기계가 읽는 출력에서 키가 조건부로
       * 사라지면 소비자가 분기를 하나 더 써야 한다. 설계 문서 §7.3.
       * `approvedFingerprint` 는 absent 일 때 키 자체가 없어야 하므로 조건부로 넣는다.
       */
      const spec: {
        approval: SpecApprovalState;
        fingerprint: string;
        approvedFingerprint?: string;
        findings: readonly { code: string; severity: string; caseId: string; path: string }[];
        cases?: readonly SuiteCaseApproval[];
      } = {
        approval: specApproval.state,
        fingerprint: specApproval.fingerprint,
        // 문장은 담지 않는다. 문장은 사람이 읽는 출력의 것이고 기계는 code 로 분기한다.
        // 키는 억제 규칙과 무관하게 항상 있다. 조건부로 사라지면 소비자가 분기를 하나 더 쓴다.
        // 설계 문서 §7.3.
        findings: specFindings.map(({ code, severity, caseId, path }) => ({
          code,
          severity,
          caseId,
          path,
        })),
      };
      if (specApproval.approvedFingerprint !== undefined)
        spec.approvedFingerprint = specApproval.approvedFingerprint;
      /**
       * 승인 시점 판정은 파일에 적힌 그대로 싣는다. 지문이 불일치여도 억제하지 않는다.
       * 텍스트 참고 문장을 지문 불일치에 억제하는 것은 사람이 읽는 화면의 규칙이고, 기계는
       * `spec.approval` 로 불일치를 이미 안다. 설계 문서 §9.
       * `approvedFingerprint` 와 같은 이유로 없을 때는 키 자체를 만들지 않는다.
       */
      const approvedCases = validated.value.approval?.cases;
      if (approvedCases !== undefined) spec.cases = approvedCases;
      dependencies.writeStdout(`${JSON.stringify({ ...finalReport, spec }, null, 2)}\n`);
    } else {
      dependencies.writeStdout(
        dependencies.renderReport(finalReport, { color: dependencies.colorEnabled }),
      );
      /**
       * 참고 문장은 보고서 뒤, 명세 승인 블록 앞이다. 케이스마다 한 블록으로 묶는다.
       * 순서는 `runner` 가 정한 finding 순서이고 여기서 다시 정렬하지 않는다. 설계 문서 §7.2.
       */
      if (specFindings.length > 0 || serverDefectCases.size > 0) {
        const byCase = new Map<string, SpecFinding[]>();
        for (const finding of specFindings) {
          const list = byCase.get(finding.caseId) ?? [];
          list.push(finding);
          byCase.set(finding.caseId, list);
        }
        /**
         * 케이스 순서는 보고서가 정한다. `specFindings` 의 순서도 같은 출처에서 나오므로
         * 여기서 다시 정렬해도 기존 순서가 그대로다. 승인 판정만 있고 finding 이 없는 케이스는
         * `byCase` 에 없어서 이 목록으로 순회해야 빠지지 않는다.
         */
        for (const item of finalReport.cases) {
          if (item.status === "passed") continue;
          const caseId = item.spec.id;
          const list = byCase.get(caseId) ?? [];
          for (const group of FINDING_GROUP_ORDER) {
            const grouped = list.filter((finding) => FINDING_GROUP[finding.code] === group);
            if (grouped.length === 0) continue;
            // caseId 는 남이 쓴 명세에서 온다. 다른 표시 항목과 같은 이스케이프를 쓴다.
            dependencies.writeStdout(
              `\n${FINDING_HEADING[group](escapeTerminalText(caseId))}\n${grouped
                .map((finding) => `  → ${describeSpecFinding(finding)}\n`)
                .join("")}`,
            );
          }
          if (serverDefectCases.has(caseId))
            dependencies.writeStdout(`\n${SERVER_DEFECT_NOTE_LINE}`);
        }
      }
      // 지문은 우리가 만든 hex 라 제어 문자가 섞일 수 없다. 이스케이프가 필요 없는 유일한
      // 표시 항목이다. 앞의 빈 줄은 진단 블록과 같은 레이아웃 규칙이다. 설계 문서 §7.2.
      if (shouldShowSpecApproval(specApproval, allPassed))
        dependencies.writeStdout(`\n${renderSpecApproval(specApproval)}`);
    }
  } catch {
    // 원인이 서버가 아니라 우리 렌더링이므로 진단을 쓰지 않는다. 계획서 §4 호출 지점 4.
    return writeFailure(dependencies, {
      code: "CLI_INTERNAL_ERROR",
      ...dictionary.CLI_INTERNAL_ERROR,
    });
  }
  const settled = snapshotDiagnostics();
  // 전부 통과여도 비정상 종료면 쓴다. 종료 경로의 결함을 숨기지 않는다. 설계 문서 §4.3.
  if (!allPassed || (settled.value !== undefined && isAbnormalExit(settled.value)))
    writeDiagnostics(settled);
  // 판정은 케이스 결과로만 정한다. 지문이 달라도 종료 코드는 바뀌지 않는다. 설계 문서 §6.
  return allPassed ? 0 : 1;
}

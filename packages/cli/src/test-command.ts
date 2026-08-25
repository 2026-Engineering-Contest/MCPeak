import { extname } from "node:path";
import type { McpHttpConnection, McpStdioConnection } from "@mcpeak/core";
/**
 * **타입만** 가져온다. 값 import 로 바꾸면 `node:sqlite` 가 CLI 를 띄우는 것만으로 로드되어
 * ADR-0056 이 좁혀 둔 실험 경고가 모든 실행에 다시 붙는다. `import type` 은 컴파일에서
 * 지워지므로 `external-wiring.ts` 의 동적 로딩이 그대로 유지된다.
 */
import type { ReplayMissDetail, SessionSummary } from "@mcpeak/record/external";
import type {
  CheckDeterminismOptions,
  DeterminismResult,
  FinalizeRunnerExecutionOptions,
  InputContractOptions,
  RunnerExecution,
  RunnerReport,
  RunSuiteOptions,
  SpecFinding,
  SpecFindingsResult,
  SuiteCaseApproval,
  SuiteValidationIssue,
  SuiteValidationResult,
  TestCaseResult,
  TestSuiteSpec,
} from "@mcpeak/runner";
import {
  describeDeterminismDifference,
  describeSpecFinding,
  checkAssertionSubstance as runnerCheckAssertionSubstance,
  checkDeterminism as runnerCheckDeterminism,
  checkInputContract as runnerCheckInputContract,
} from "@mcpeak/runner";
import {
  type CliConnection,
  type ConnectTarget,
  ConnectTargetError,
  createHeaderEnvCollector,
  openConnection,
  parseHeaderEnvOption,
  parseUrlOption,
} from "./connect-target.js";
import { createDeterminismCapture } from "./determinism-capture.js";
import {
  type ExternalMode,
  type ExternalWiring,
  SessionFileMissingError,
  startExternalWiring,
} from "./external-wiring.js";
import type { FindingGroup } from "./finding-group.js";
import { FINDING_GROUP } from "./finding-group.js";
import { commandDiscovery, TEST_USAGE_HINT } from "./help.js";
import {
  type HttpDiagnosticsInput,
  hasHttpDiagnosticContent,
  httpDiagnostics,
  renderHttpDiagnostics,
} from "./http-diagnostics.js";
import {
  hasDiagnosticContent,
  isAbnormalExit,
  type ProcessDiagnosticsInput,
  processDiagnostics,
  renderProcessDiagnostics,
} from "./process-diagnostics.js";
import {
  buildRepairBundle,
  REPAIR_BUNDLE_EMPTY_LINE,
  serializeRepairBundle,
} from "./repair-bundle.js";
import { runResetCommand as defaultRunResetCommand, ResetCommandError } from "./reset-hook.js";
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
  /**
   * 붙을 대상. `--command`/`--arg` 면 stdio, `--url` 이면 Streamable HTTP 다(#137).
   *
   * `command` · `args` 두 필드를 이 하나로 바꿨다. 두 transport 를 나란히 두면 "url 이
   * 있으면 command 는 무시" 같은 규칙이 읽는 자리마다 되풀이되고, 그 규칙이 한 군데서만
   * 어긋나도 사용자가 지정하지 않은 곳에 붙는다.
   */
  readonly target: ConnectTarget;
  readonly json: boolean;
  /** `--junit` 로 받은 XML 출력 경로. 지정하지 않으면 undefined 이고 XML 을 만들지 않는다. */
  readonly junitPath: string | undefined;
  /** `--repair-bundle` 로 받은 번들 출력 경로. 지정하지 않으면 undefined 이고 번들을 안 만든다. */
  readonly repairBundlePath: string | undefined;
  /** `--determinism`. 스위트를 2회 실행해 결과를 대조한다. 설계 문서 §5.2. */
  readonly determinism: boolean;
  /** `--reset-cmd` 로 받은 초기화 명령. 각 회차 전에 1번씩 실행한다. */
  readonly resetCmd: string | undefined;
  /** `--session`. External 세션을 재생한다. */
  readonly sessionPath: string | undefined;
  /** `--record-session`. External 세션을 녹화한다. */
  readonly recordSessionPath: string | undefined;
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
  | "REPAIR_BUNDLE_WRITE_FAILED"
  | "RESET_COMMAND_FAILED"
  | "EXTERNAL_SESSION_FAILED"
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
  connect(options: {
    command: string;
    args: readonly string[];
    /** External 배선이 만든 자식 환경 변수. Bootstrap 주입이 여기 실린다. */
    env?: Readonly<Record<string, string>>;
  }): Promise<McpStdioConnection>;
  /**
   * 원격(Streamable HTTP) 대상용 연결. `core.connectHttp` 다.
   *
   * **선택 사항으로 둔다.** 위 `checkInputContract` 와 같은 이유다 — 진입점의 "런타임 의존성
   * 없음" 경로와 대시보드처럼 stdio 만 배선한 호출자가 이 필드를 채울 수 없다. 없으면
   * `--url` 이 조용히 stdio 로 떨어지지 않고 무엇이 없는지 말하고 멈춘다(#137).
   */
  connectHttp?(options: {
    url: string;
    headers?: Readonly<Record<string, string>>;
  }): Promise<McpHttpConnection>;
  /**
   * `--header-env` 가 가리키는 환경변수를 읽는다. 이것이 없으면 `--header-env` 를 쓸 수 없다.
   * CLI 코드가 `process` 를 직접 읽지 않기 위한 주입점이다(ADR-0013).
   */
  readEnv?(name: string): string | undefined;
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
  /**
   * 결정론성 비교와 초기화 명령의 주입 지점. 위 두 필드와 같은 이유로 선택 사항이다.
   * 생략하면 각각 `runner` 의 `checkDeterminism` 과 `reset-hook.ts` 의 `runResetCommand` 다.
   * 캡처 래퍼는 CLI 내부 구현이라 주입 대상이 아니다(설계 문서 §5.2).
   */
  checkDeterminism?(options: CheckDeterminismOptions): DeterminismResult;
  runResetCommand?(command: string): Promise<void>;
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
  REPAIR_BUNDLE_WRITE_FAILED: {
    message: "repair 번들 파일을 쓰지 못했습니다.",
    hint: "`--repair-bundle` 경로의 디렉터리가 존재하는지와 쓰기 권한을 확인하세요.",
  },
  RESET_COMMAND_FAILED: {
    // 실제 안내는 명령·종료 코드·stderr 꼬리를 담아 호출 지점에서 만든다. 이 사전 값은
    // 그 정보가 없을 때의 최소 문장이다.
    message: "초기화 명령이 실패했습니다.",
    hint: "`--reset-cmd` 명령이 단독으로 성공하는지 확인한 뒤 다시 실행하세요.",
  },
  EXTERNAL_SESSION_FAILED: {
    // 실제 안내는 원인 오류의 문장을 담아 호출 지점에서 만든다. 이 사전 값은 그것이 없을
    // 때의 최소 문장이다.
    message: "External 세션 처리에 실패했습니다.",
    hint: "세션 파일 경로의 디렉터리가 있는지와 쓰기 권한을 확인하세요.",
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

/**
 * `--name value` 와 `--name=value` 두 형태에서 값을 꺼낸다.
 *
 * 값이 `--` 로 시작하면 거절한다. `--session --json` 처럼 값을 빠뜨리면 다음 옵션이 경로로
 * 먹히고, 그러면 "그런 파일이 없습니다" 라는 엉뚱한 곳에서 실패한다.
 */
const readOptionValue = (
  argv: readonly string[],
  token: string,
  name: string,
  index: number,
): { readonly value: string; readonly index: number } => {
  let value: string;
  let next = index;
  if (token === name) {
    const candidate = argv[++next];
    if (candidate === undefined)
      throw new CliCommandError({
        code: "CLI_USAGE",
        message: `\`${name}\` 옵션 값이 필요합니다.`,
        hint: TEST_USAGE_HINT,
      });
    value = candidate;
  } else value = token.slice(`${name}=`.length);
  if (value.trim() === "" || value.startsWith("--")) fail(`\`${name}\` 옵션 값이 필요합니다.`);
  return { value, index: next };
};
export function parseTestCommand(argv: readonly string[]): TestCommandInput {
  const suitePath = argv[0] ?? "";
  if (suitePath === "") fail("테스트 명세 JSON 경로가 필요합니다.");
  let command: string | undefined;
  let url: string | undefined;
  let json = false;
  let junitPath: string | undefined;
  let repairBundlePath: string | undefined;
  let determinism = false;
  let resetCmd: string | undefined;
  let stderrLines: number | undefined;
  let sessionPath: string | undefined;
  let recordSessionPath: string | undefined;
  const args: string[] = [];
  const headerEnv = createHeaderEnvCollector();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    /**
     * `--` 뒤는 전부 서버를 띄울 명령이다. npm · cargo · docker 가 쓰는 관례라 설명이
     * 필요 없고, 무엇보다 **뒤에 오는 것을 우리가 해석하지 않는다** — `--arg --port` 처럼
     * 옵션처럼 생긴 값에 특수분기를 두지 않아도 된다(#242).
     *
     * 첫 토큰이 실행 파일, 나머지가 그 인자다. `--command` 와 함께 쓸 수 없다 — 대상이
     * 둘이 되면 어느 쪽을 띄울지 화면이 말할 수 없다.
     */
    if (token === "--") {
      if (command !== undefined)
        fail(
          "`--command` 와 `--` 를 함께 쓸 수 없습니다.\n" +
            "→ 둘 다 서버를 띄울 명령을 정하므로 대상이 둘이 됩니다.\n" +
            "→ `--` 뒤에는 실행 파일과 인자를 그대로 적습니다.",
        );
      // `--arg` 는 `--command` 의 짝이다. `--` 와 섞으면 앞의 값이 통과 인자 **앞에**
      // 조용히 끼어들어 사용자가 적지 않은 순서로 서버가 뜬다.
      if (args.length > 0)
        fail(
          "`--arg` 와 `--` 를 함께 쓸 수 없습니다.\n" +
            "→ `--arg` 로 준 값이 `--` 뒤의 인자 앞에 끼어듭니다.\n" +
            "→ `--` 를 쓰면 인자도 그 뒤에 모두 적습니다.",
        );
      const rest = argv.slice(index + 1);
      const executable = rest[0];
      if (executable === undefined || executable === "")
        fail(
          "`--` 뒤에 실행할 명령이 없습니다.\n" +
            "→ `-- <executable> [args...]` 처럼 첫 토큰에 실행 파일을 적으세요.",
        );
      command = executable;
      args.push(...rest.slice(1));
      index = argv.length;
      continue;
    }
    if (token === "--command" || token.startsWith("--command=")) {
      // `--` 가 먼저 왔으면 argv 를 끝냈으므로 여기 올 수 없다. 순수 중복만 남는다.
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
    } else if (token === "--url" || token.startsWith("--url=")) {
      // 값 검사는 `--command` 와 같은 규칙이다. URL 자리의 플래그는 값을 빠뜨린 오타다.
      if (url !== undefined) fail("`--url`은 한 번만 사용할 수 있습니다.");
      const read = readOptionValue(argv, token, "--url", index);
      index = read.index;
      const parsed = parseUrlOption(read.value);
      if (!parsed.ok) fail(parsed.message);
      else url = parsed.value;
    } else if (token === "--header-env" || token.startsWith("--header-env=")) {
      const read = readOptionValue(argv, token, "--header-env", index);
      index = read.index;
      const parsed = parseHeaderEnvOption(read.value);
      if (!parsed.ok) fail(parsed.message);
      else {
        const rejected = headerEnv.add(parsed.value.header, parsed.value.envName);
        if (rejected !== undefined) fail(rejected);
      }
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
        // 하이픈으로 시작하는 값을 거절하지 않는다. 서버 인자는 대부분 플래그 모양이고
        // (-y, --with, --db-path), generate 의 --arg 는 이미 받는다. 값을 빠뜨린 오타는
        // 목록 끝의 `--arg` 가 잡고, 삼켜진 플래그는 서버가 인자 오류로 알린다.
        value = next;
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
    } else if (token === "--repair-bundle" || token.startsWith("--repair-bundle=")) {
      // 값 검사는 `--junit` 과 같은 규칙이다. 경로 자리에 플래그가 들어온 것은 값을 빠뜨린
      // 오타이지 `--json` 이라는 이름의 파일을 만들라는 뜻이 아니다.
      if (repairBundlePath !== undefined) fail("`--repair-bundle`은 한 번만 사용할 수 있습니다.");
      let value: string;
      if (token === "--repair-bundle") {
        const next = argv[++index];
        if (next === undefined)
          throw new CliCommandError({
            code: "CLI_USAGE",
            message: "`--repair-bundle` 옵션 값이 필요합니다.",
            hint: TEST_USAGE_HINT,
          });
        value = next;
      } else value = token.slice("--repair-bundle=".length);
      if (value === "") fail("`--repair-bundle` 옵션 값이 필요합니다.");
      if (value.startsWith("--")) fail("`--repair-bundle` 옵션 값이 필요합니다.");
      repairBundlePath = value;
    } else if (token === "--reset-cmd" || token.startsWith("--reset-cmd=")) {
      // 값 검사는 `--junit` 과 같은 규칙이다. 명령 자리의 플래그는 값을 빠뜨린 오타다.
      if (resetCmd !== undefined) fail("`--reset-cmd`는 한 번만 사용할 수 있습니다.");
      let value: string;
      if (token === "--reset-cmd") {
        const next = argv[++index];
        if (next === undefined)
          throw new CliCommandError({
            code: "CLI_USAGE",
            message: "`--reset-cmd` 옵션 값이 필요합니다.",
            hint: TEST_USAGE_HINT,
          });
        value = next;
      } else value = token.slice("--reset-cmd=".length);
      // 공백뿐인 명령은 runResetCommand 가 TypeError 로 죽는 값이다. 여기서 거른다.
      if (value.trim() === "") fail("`--reset-cmd` 옵션 값이 필요합니다.");
      if (value.startsWith("--")) fail("`--reset-cmd` 옵션 값이 필요합니다.");
      resetCmd = value;
    } else if (token === "--determinism") {
      // 값 없는 스위치다. 중복 지정은 무해하므로 거절하지 않는다.
      determinism = true;
    } else if (token.startsWith("--determinism=")) {
      fail("`--determinism`은 값을 받지 않습니다.");
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
    } else if (token === "--session" || token.startsWith("--session=")) {
      if (sessionPath !== undefined) fail("`--session`은 한 번만 사용할 수 있습니다.");
      const read = readOptionValue(argv, token, "--session", index);
      sessionPath = read.value;
      index = read.index;
    } else if (token === "--record-session" || token.startsWith("--record-session=")) {
      if (recordSessionPath !== undefined) fail("`--record-session`은 한 번만 사용할 수 있습니다.");
      const read = readOptionValue(argv, token, "--record-session", index);
      recordSessionPath = read.value;
      index = read.index;
    } else if (token === "--json") {
      if (json) fail("`--json`은 한 번만 사용할 수 있습니다.");
      json = true;
    } else if (token.startsWith("--json=")) {
      fail("`--json`은 값을 받지 않습니다.");
    } else if (token.startsWith("-"))
      fail(`지원하지 않는 test 옵션 '${escapeTerminalText(token)}'입니다.`);
    else fail(`추가 위치 인자 '${escapeTerminalText(token)}'는 허용되지 않습니다.`);
  }
  // transport 는 여기서 확정한다. 아래 검사들이 "둘 다" 와 "둘 다 아님" 을 먼저 걷어내므로
  // 그 아래로는 `target` 하나만 흐른다(#137).
  if (command !== undefined && url !== undefined)
    fail(
      "`--command` 와 `--url` 은 함께 쓸 수 없습니다.\n" +
        "→ `--command` 는 서버를 프로세스로 띄우고, `--url` 은 이미 떠 있는 원격 서버에 붙습니다.\n" +
        "→ 둘 중 무엇을 검사할지 하나만 고르세요.",
    );
  if (command === undefined && url === undefined)
    throw new CliCommandError({
      code: "CLI_USAGE",
      message: "`--command` 또는 `--url` 옵션이 필요합니다.",
      hint: TEST_USAGE_HINT,
    });
  if (url !== undefined && args.length > 0)
    fail(
      "`--arg` 는 `--url` 과 함께 쓸 수 없습니다.\n" +
        "→ `--arg` 는 우리가 띄우는 프로세스에 넘길 인자입니다. 원격 서버에는 띄울 프로세스가 없습니다.",
    );
  if (command !== undefined && !headerEnv.isEmpty())
    fail(
      "`--header-env` 는 `--url` 과 함께만 쓸 수 있습니다.\n" +
        "→ 헤더는 HTTP 요청에 실립니다. `--command` 로 띄운 서버와는 stdio 로 이야기합니다.",
    );
  // 명시했는데 조용히 무시하면 "막은 척" 이 된다. 기본값이면 무시한다 — 기본값까지 거절하면
  // `--url` 을 쓰는 사용자가 전원 막힌다.
  if (url !== undefined && stderrLines !== undefined)
    fail(
      "`--stderr-lines` 는 `--url` 과 함께 쓸 수 없습니다.\n" +
        "→ 이 옵션은 우리가 띄운 프로세스의 stderr 를 보여줍니다. 원격 서버에는 그 프로세스가 없습니다.\n" +
        "→ 원격 서버 실패는 엔드포인트와 HTTP 상태로 진단합니다. 그 블록은 항상 나옵니다.",
    );
  // External 배선은 자식 프로세스 환경변수로 bootstrap 을 주입한다. 원격 서버에는 그 자식이
  // 없으므로 녹화도 재생도 성립하지 않는다. 실행한 뒤 빈 세션으로 끝나게 두지 않는다.
  if (url !== undefined && (sessionPath !== undefined || recordSessionPath !== undefined))
    fail(
      "External 세션 옵션은 `--url` 과 함께 쓸 수 없습니다.\n" +
        "→ External 배선은 우리가 띄운 자식 프로세스의 환경변수로 들어갑니다.\n" +
        "→ 원격 서버는 우리가 띄우지 않으므로 그 주입 지점이 없습니다.",
    );
  // 재생과 녹화를 한 실행에 같이 시킬 수 없다. 무엇을 하려는 것인지 우리가 고를 문제가 아니다.
  if (sessionPath !== undefined && recordSessionPath !== undefined)
    fail("`--session`과 `--record-session`은 함께 쓸 수 없습니다. 재생과 녹화 중 하나만 고르세요.");
  // `--determinism`은 서버에 2회 연결하는데 External 세션은 연결 하나에 묶여 있다. 2회차가
  // 같은 세션을 쓰면 occurrence 가 어긋나고, 새 세션을 쓰면 비교 기준이 갈라진다. 어느 쪽도
  // "같은 입력에 같은 결과" 를 말해 주지 못하므로 실행 전에 막는다.
  if (determinism && (sessionPath !== undefined || recordSessionPath !== undefined))
    fail(
      "`--determinism`은 External 세션 옵션과 함께 쓸 수 없습니다.\n" +
        "→ `--determinism`은 서버에 2회 연결하지만 External 세션은 연결 하나에 묶여 있습니다.\n" +
        "→ 2회차가 같은 세션을 쓰면 반복 호출 순번이 어긋나고, 새 세션을 쓰면 비교 기준이 갈라집니다.",
    );
  return Object.freeze({
    suitePath,
    target:
      url === undefined
        ? Object.freeze({
            transport: "stdio" as const,
            // 위 두 검사가 `command === undefined && url === undefined` 와 둘 다 있는 경우를
            // 이미 걷어냈으므로, 여기 오면 `command` 는 반드시 있다.
            command: command as string,
            args: Object.freeze(args),
          })
        : Object.freeze({
            transport: "http" as const,
            url,
            headerEnv: headerEnv.snapshot(),
          }),
    json,
    junitPath,
    repairBundlePath,
    determinism,
    resetCmd,
    sessionPath,
    recordSessionPath,
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
 * 머리글은 검사 종류마다 다르다. `minLength: 0` 은 입력이 아니라 단언의 문제이고,
 * `SCHEMA_NOT_ANALYZABLE` 은 명세가 아니라 서버 스키마를 못 읽었다는 뜻이다. 둘 중 어느
 * 것이든 입력 머리글 아래 붙이면 읽는 사람이 멀쩡한 입력을 고치러 간다. 설계 문서 §7.2.
 */
const FINDING_HEADING: Readonly<Record<FindingGroup, (caseId: string) => string>> = {
  inputContract: (caseId) => `참고: ${caseId} 의 입력이 서버 선언과 다릅니다`,
  assertionSubstance: (caseId) => `참고: ${caseId} 의 단언은 무엇이 와도 통과합니다`,
  // '입력이 서버 선언과 다릅니다' 의 정반대 상황이다. 그 머리글 아래 두면 읽는 사람이
  // 멀쩡한 입력에서 위반을 찾으러 간다.
  rejectionIntent: (caseId) => `참고: ${caseId} 는 거절을 기대하지만 선언을 어기지 않습니다`,
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
  "rejectionIntent",
  "skipped",
];

/**
 * 서버 응답 본문이 이미 타입 위반을 설명했는지 보수적으로 판정한다(#350).
 *
 * 응답 문장을 자연어로 해석하려 들면 "city 문자열을 숫자로 바꾸세요" 같은 다른 사실까지
 * 같은 말로 오인할 수 있다. 그래서 TYPE_MISMATCH 에서 구조적으로 아는 세 표식, 즉 필드명과
 * 기대 타입, 실제 타입(또는 실제 입력값)이 한 줄에 모두 있을 때만 참고 finding 을 접는다.
 * 하나라도 없으면 서버가 충분히 설명했다고 단정하지 않고 기존 참고를 남긴다.
 *
 * 다른 finding 은 같은 사실인지 판별할 표식이 부족하다. 예를 들어 REQUIRED_MISSING 은 필드명
 * 하나만 같아도 되므로 여기서 함께 억제하면 조용한 서버에서 유일한 단서를 잃을 수 있다.
 * 이 보수적 억제 범위와 검토한 대안은 ADR-0077에 기록한다.
 */
const responseRepeatsTypeMismatch = (finding: SpecFinding, item: TestCaseResult): boolean => {
  if (finding.code !== "TYPE_MISMATCH") return false;
  const expected = finding.expected;
  const actualType = finding.actual;
  if (typeof expected !== "string" || typeof actualType !== "string") return false;
  if (item.spec.operation.type !== "callTool" || !finding.path.startsWith("input.")) return false;

  const field = finding.path.slice("input.".length);
  if (field === "") return false;
  const notes = [
    ...(item.operation.diagnostic?.notes ?? []),
    ...item.assertions.flatMap((assertion) => assertion.diagnostic?.notes ?? []),
  ];
  const actualValue = item.spec.operation.input[field];
  const actualValueText =
    actualValue === undefined
      ? undefined
      : typeof actualValue === "string"
        ? actualValue
        : JSON.stringify(actualValue);
  const has = (note: string, value: string): boolean => {
    if (value === "") return false;
    const normalizedNote = note.toLocaleLowerCase("en-US");
    const normalizedValue = value.toLocaleLowerCase("en-US");
    const wordCharacter = /[\p{L}\p{N}_]/u;
    let start = 0;
    while (start <= normalizedNote.length - normalizedValue.length) {
      const index = normalizedNote.indexOf(normalizedValue, start);
      if (index === -1) return false;
      const before = Array.from(normalizedNote.slice(0, index)).at(-1);
      const after = Array.from(normalizedNote.slice(index + normalizedValue.length))[0];
      if (
        (before === undefined || !wordCharacter.test(before)) &&
        (after === undefined || !wordCharacter.test(after))
      )
        return true;
      start = index + normalizedValue.length;
    }
    return false;
  };

  return notes.some(
    (note) =>
      has(note, field) &&
      has(note, expected) &&
      (has(note, actualType) || (actualValueText !== undefined && has(note, actualValueText))),
  );
};
/** 결정론성 결과 블록의 머리글. 설계 문서 §8. */
const DETERMINISM_HEADING = "결정론성 확인";
/**
 * 2회차의 결말. 비교까지 간 경우와 못 간 경우를 값으로 구분한다. 못 간 사유를 문자열로만
 * 들고 다니면 "비교했는데 차이 0" 과 "비교를 못 했다" 가 화면에서 섞인다. 설계 문서 §7.
 */
type DeterminismOutcome =
  | { readonly kind: "compared"; readonly result: DeterminismResult }
  | {
      readonly kind: "incomplete";
      readonly reason: string;
      readonly diagnostics?: ProcessDiagnosticsInput;
    }
  | { readonly kind: "internal" };
/**
 * 종료 코드 고지. `--determinism` 은 **비차단 진단**이다 — 차이를 찾아도 종료 코드는 1회차
 * 판정 그대로 0 이다(설계 문서 §서론 "비차단 진단. status·종료 코드·`RunnerReport` 불변",
 * ADR-0018). 오탐이 CI 를 막으면 안 된다는 것이 그 설계의 이유다.
 *
 * **동작은 바꾸지 않는다.** 그 사실이 화면 어디에도 없어서, CI 는 초록인데 서버가 비결정이라는
 * 것을 아무도 모르는 자리가 있었다(#292). 고치는 것은 고지뿐이다.
 *
 * 뒤에 붙는 "어디를 보라" 는 갈래마다 다르다. `--json` 의 `determinism` 키는 **비교까지 갔을
 * 때만** 만들어지므로(위 §JSON 조립), 비교를 못 한 갈래에서 그 키를 가리키면 없는 것을
 * 가리키는 안내가 된다.
 */
const EXIT_CODE_NOTICE = "→ 이 진단은 종료 코드에 반영되지 않습니다.";

/** `(12/12)` 와 `(12/12, 제외 2: 실행되지 않은 케이스)`. 설계 문서 §8. */
const determinismCounts = (result: DeterminismResult): string =>
  result.skipped === 0
    ? `(${result.compared}/${result.compared})`
    : `(${result.compared}/${result.compared}, 제외 ${result.skipped}: 실행되지 않은 케이스)`;
/**
 * 결정론성 블록 전문. 문구는 설계 문서 §8 이 사양이다. 케이스 블록은 runner 의
 * `describeDeterminismDifference` 가 만들고 여기서 들여쓰기를 덧붙이지 않는다. 그 함수가
 * 이미 앞 공백 2칸을 포함한 블록을 낸다.
 */
function renderDeterminism(
  outcome: DeterminismOutcome,
  options: { readonly stateRestored: boolean; readonly stderrLines: number },
): string {
  if (outcome.kind === "internal")
    return `${DETERMINISM_HEADING}\n→ 결정론성 비교에서 예상하지 못한 CLI 내부 오류가 발생했습니다. 시험 판정은 1회차 결과 그대로입니다.\n→ 다시 실행한 뒤 재현 정보와 함께 이슈를 보고하세요.\n`;
  if (outcome.kind === "incomplete") {
    const head =
      `${DETERMINISM_HEADING}\n` +
      `→ 2회차 실행이 완주하지 못해 비교할 수 없습니다. (사유: ${escapeTerminalText(outcome.reason)})\n` +
      "→ 1회차는 완주했으므로, 서버가 반복 실행 자체에 취약할 수 있습니다\n" +
      "  (이전 실행이 남긴 상태·잠금·포트 점유 등).\n" +
      `${EXIT_CODE_NOTICE} --json 에서는 determinism 키가 만들어지지 않아\n` +
      "  이 안내가 stderr 로만 나갑니다.\n";
    // 진단은 2회차 연결의 것이다. 단계 1 의 렌더러를 그대로 쓴다. 설계 문서 §7.
    if (
      options.stderrLines === 0 ||
      outcome.diagnostics === undefined ||
      !hasDiagnosticContent(outcome.diagnostics)
    )
      return head;
    const block = renderProcessDiagnostics(outcome.diagnostics, { maxLines: options.stderrLines });
    return block === "" ? head : `${head}${block}`;
  }
  const { result } = outcome;
  if (result.conclusion === "deterministic")
    return `${DETERMINISM_HEADING}\n→ 같은 초기 상태에서 2회 실행한 결과가 모든 케이스에서 같습니다. ${determinismCounts(result)}\n`;
  if (result.conclusion === "consistentWithoutReset")
    return (
      `${DETERMINISM_HEADING}\n` +
      `→ 2회 실행 결과가 같았습니다. ${determinismCounts(result)}\n` +
      "→ 단, 실행 사이에 상태를 복원하지 않았으므로 결정론성 확인은 아닙니다.\n" +
      "  --reset-cmd 로 초기 상태 복원 명령을 지정하면 확인이 됩니다.\n"
    );
  const suffix = result.skipped === 0 ? "" : ` (제외 ${result.skipped}: 실행되지 않은 케이스)`;
  const blocks = result.differences
    .map((difference) =>
      describeDeterminismDifference(difference, { stateRestored: options.stateRestored }),
    )
    .join("\n\n");
  return (
    `${DETERMINISM_HEADING}\n` +
    `→ ${result.differences.length}/${result.compared} 케이스에서 2회 실행 결과가 다릅니다.${suffix}\n\n` +
    `${blocks}\n` +
    `${EXIT_CODE_NOTICE} CI 를 막으려면 --json 의 determinism 키를 보세요.\n`
  );
}
/**
 * 초기화 명령 실패 안내.
 *
 * 진단(종료 코드·stderr 꼬리)과 다음 행동(hint)을 한 줄에 눌러 담지 않는다(#289). 예전에는
 * 그 둘을 이어 붙이며 경계를 두지 않아 `... ENOENT 명령이 단독으로 성공하는지 ...` 처럼
 * `ENOENT` 가 `명령` 을 수식하는 말로 읽혔다. 진단은 `message` 에 줄을 나눠 담고, `hint` 는
 * 다음에 할 일 한 문장만 남긴다 — `format()` 이 이제 개행을 이스케이프하지 않으므로
 * (`--reset-cmd` 명령이 단독으로) 그대로 구조가 유지된다.
 *
 * `error.command`·stderr 꼬리는 사용자가 지정한 명령과 그 명령이 만든 출력이라, 우리 문장이
 * 아닌 값이 섞이는 자리다. 화면을 깨뜨릴 제어 문자가 실려도 그대로 나가지 않도록 이스케이프한다.
 */
function resetFailure(error: ResetCommandError): CliFailure {
  const exit = error.exitCode === null ? "없음" : String(error.exitCode);
  const tail = error.stderr.split("\n").filter(Boolean).slice(-3).join(" | ");
  const stderrLine = tail === "" ? "" : `\n  stderr 마지막 3줄: ${escapeTerminalText(tail)}`;
  return {
    code: "RESET_COMMAND_FAILED",
    message:
      `초기화 명령이 실패했습니다: ${escapeTerminalText(error.command)}\n` +
      `  종료 코드: ${exit}${stderrLine}`,
    hint: "`--reset-cmd` 명령이 단독으로 성공하는지 확인한 뒤 다시 실행하세요.",
  };
}

/** JUnit 파일 쓰기 실패에 사용자가 지정한 경로와 운영체제 오류 코드를 남긴다(#294). */
/**
 * 노드 오류의 `code`. 문자열(`ENOENT`)이거나 숫자일 수 있고, 둘 다 아니면 우리가 아는 것이
 * 없다. `junitWriteFailure` 가 쓰던 것을 꺼내 다른 실패 생성기와 함께 쓴다(#276).
 */
function errnoOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "알 수 없음";
}

function junitWriteFailure(path: string, error: unknown): CliFailure {
  return {
    code: "JUNIT_WRITE_FAILED",
    message:
      `JUnit XML 파일을 쓰지 못했습니다: ${escapeTerminalText(path)}\n` +
      `  errno: ${escapeTerminalText(errnoOf(error))}`,
    hint: dictionary.JUNIT_WRITE_FAILED.hint,
  };
}

/**
 * `--repair-bundle` 쓰기 실패. 짝인 `junitWriteFailure` 와 같은 모양이어야 한다 — 같은 실행에서
 * 둘 다 실패할 수 있고, 그때 한쪽만 경로를 싣고 있으면 사용자가 어느 파일이 없는지 알 수 없다.
 */
function repairBundleWriteFailure(path: string, error: unknown): CliFailure {
  return {
    code: "REPAIR_BUNDLE_WRITE_FAILED",
    message:
      `repair 번들 파일을 쓰지 못했습니다: ${escapeTerminalText(path)}\n` +
      `  errno: ${escapeTerminalText(errnoOf(error))}`,
    hint: dictionary.REPAIR_BUNDLE_WRITE_FAILED.hint,
  };
}

/**
 * 명세 읽기 실패. **errno 별로 다음 행동이 다르다** — 파일이 없으면 경로를 고치고, 권한이
 * 없으면 권한을 고친다. 둘을 한 문장으로 묶으면 사용자에게 둘 다 확인하게 만든다(#276).
 * 어느 쪽인지 아는데 안 말할 이유가 없다.
 */
function suiteReadFailure(path: string, error: unknown): CliFailure {
  const shown = escapeTerminalText(path);
  const errno = errnoOf(error);
  if (errno === "ENOENT")
    return {
      code: "SUITE_READ_FAILED",
      message: `테스트 명세 파일이 그 경로에 없습니다: ${shown}`,
      hint: "경로와 파일 이름을 확인하세요. 상대 경로는 명령을 실행한 디렉터리 기준입니다.",
    };
  if (errno === "EACCES" || errno === "EPERM")
    return {
      code: "SUITE_READ_FAILED",
      message: `테스트 명세 파일을 읽을 권한이 없습니다: ${shown}`,
      hint: "그 파일의 읽기 권한을 확인하세요. 경로 자체는 찾았습니다.",
    };
  if (errno === "EISDIR")
    return {
      code: "SUITE_READ_FAILED",
      message: `그 경로는 파일이 아니라 디렉터리입니다: ${shown}`,
      hint: "스위트 JSON 파일의 경로를 주세요.",
    };
  return {
    code: "SUITE_READ_FAILED",
    message:
      `테스트 명세 파일을 읽지 못했습니다: ${shown}\n` + `  errno: ${escapeTerminalText(errno)}`,
    hint: dictionary.SUITE_READ_FAILED.hint,
  };
}

/**
 * 확장자 검사 실패. **인코딩 얘기를 하지 않는다.**
 *
 * 이 갈래는 `extname(path) !== ".json"` 하나로만 온다. 그런데 안내가 "UTF-8로 저장한 .json
 * 명세 파일을 사용하세요" 라고 해서, 이미 UTF-8 JSON 인 사용자는 따라 해도 안 풀렸다.
 * 인코딩은 **바로 다음 단계가 따로 검사한다**(`SUITE_ENCODING_INVALID`). 그래서 이 안내는
 * 인코딩을 아예 언급하지 않는다 — 한 번 꺼내면 그것부터 확인하러 가고, 여기서 할 일은
 * 경로를 고치는 것 하나다.
 */
function suiteFormatFailure(path: string): CliFailure {
  const ext = extname(path);
  return {
    code: "SUITE_FORMAT_UNSUPPORTED",
    message:
      ext === ""
        ? `테스트 명세는 .json 파일이어야 합니다. 준 경로에 확장자가 없습니다: ${escapeTerminalText(path)}`
        : `테스트 명세는 .json 파일이어야 합니다. 준 확장자: ${escapeTerminalText(ext)}\n  경로: ${escapeTerminalText(path)}`,
    hint: "경로가 .json 으로 끝나는지 확인하세요. 이 단계는 파일을 열지 않고 확장자만 봅니다.",
  };
}

function suiteEncodingFailure(path: string): CliFailure {
  return {
    code: "SUITE_ENCODING_INVALID",
    message: `테스트 명세 파일이 유효한 UTF-8이 아닙니다: ${escapeTerminalText(path)}`,
    hint: dictionary.SUITE_ENCODING_INVALID.hint,
  };
}

/**
 * JSON 문법 실패. **파서가 준 문장을 그대로 통과시킨다.** 위치 표기는 런타임마다 다르다 —
 * `at position 7 (line 1 column 8)` 을 주는 경우도 있고 깨진 자리의 스니펫만 주는 경우도 있다
 * (Node 25 실측). 우리가 형식을 고정하면 어느 한쪽에서 거짓이 되므로, 그 문장을 옮기고
 * 경로만 우리가 더한다. 파서 문장에는 사용자 파일 내용 조각이 섞이므로 이스케이프한다.
 */
function suiteJsonFailure(path: string, error: unknown): CliFailure {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    code: "SUITE_JSON_INVALID",
    message:
      `테스트 명세의 JSON 문법이 유효하지 않습니다: ${escapeTerminalText(path)}\n` +
      `  ${escapeTerminalText(reason)}`,
    hint: dictionary.SUITE_JSON_INVALID.hint,
  };
}
/**
 * `message`·`hint` 는 **여기서 이스케이프하지 않는다**(#289). 그 필드는 우리가 여러 줄로
 * 공들여 쓴 안내와, 자식 프로세스·경로처럼 신뢰 못 할 값이 섞여 있다 — 어느 부분이 우리 글이고
 * 어느 부분이 남의 값인지는 필드를 다 만든 뒤인 여기서는 구분할 수 없다. 그래서 이스케이프는
 * **만드는 자리에서, 신뢰 못 할 값에만** 건다(`resetFailure`·`externalOpenFailure`·옵션 파싱의
 * `escapeTerminalText(token)` 호출들). 우리가 쓴 리터럴 개행은 그 자리를 거치지 않으므로
 * 구조를 유지한 채 여기까지 그대로 온다.
 *
 * `code`·`issue.*` 는 계속 통째로 건다. `code` 는 항상 우리 열거형이라 무해하고, `issue.*` 는
 * `validateSuite` 가 주는 데이터 레코드라 우리가 개행을 심을 자리가 아니다 — 한 줄 필드에
 * 통째로 걸어도 잃을 구조가 없다.
 */
function format(failure: CliFailure): string {
  const code =
    failure.coreCode === undefined ? failure.code : `${failure.code}/${failure.coreCode}`;
  let result = `오류 [${escapeTerminalText(code)}]: ${failure.message}\n해결: ${failure.hint}`;
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
  /**
   * 원격 대상의 진단. 위 `diagnostics` 와 **동시에 채워지지 않는다** — 두 구조 가드가 서로를
   * 배제하므로 transport 하나당 한쪽만 값이 된다(ADR-0020 의 유니온).
   */
  httpDiagnostics?: HttpDiagnosticsInput;
}>;
/** AggregateError 내부까지 내려가 core 오류와 검증된 진단을 꺼낸다. */
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
        httpDiagnostics: httpDiagnostics(
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
async function runCliCore(
  argv: readonly string[],
  dependencies: TestCommandDependencies,
  childEnv?: Readonly<Record<string, string>>,
): Promise<number> {
  if (argv.length === 0)
    return writeFailure(dependencies, {
      code: "CLI_USAGE",
      message: "실행할 CLI 명령이 없습니다.",
      // 명령을 아예 안 준 사람에게 필요한 것은 명령 목록이지 `test` 의 플래그가 아니다.
      hint: commandDiscovery,
    });
  if (argv[0] !== "test") {
    // 발행본(cli 0.9.0)에 나갔던 명령이라 "알 수 없는 명령" 으로 끝내면 오타와 구분되지
    // 않는다. 무엇이 사라졌고 무엇으로 갈아타는지 말한다(ADR-0059 §결정 4 마이그레이션 안내).
    if (argv[0] === "verify")
      return writeFailure(dependencies, {
        code: "CLI_USAGE",
        message: "`mcpeak verify` 는 제거되었습니다. Tool 카세트와 함께 걷어냅니다(ADR-0059).",
        hint:
          "카세트 드리프트 확인이 목적이었다면 `mcpeak test` 로 실서버를 직접 검증하세요. " +
          "외부 API 호출을 막는 것이 목적이었다면 " +
          "`mcpeak test <suite.json> --command <executable> --record-session <path>` 로 먼저 " +
          "녹화한 뒤 `--session <path>` 로 재생하세요. 두 옵션은 함께 쓸 수 없습니다.",
      });
    if (argv[0] === "replay")
      return writeFailure(dependencies, {
        code: "CLI_USAGE",
        message: "`mcpeak replay` 는 제거되었습니다. Tool 카세트와 함께 걷어냅니다(ADR-0059).",
        hint:
          "서버를 띄우지 않고 저장된 응답으로 스위트를 돌리는 것이 목적이었다면 `mcpeak-mock` 으로 " +
          "서버를 대신하세요. 외부 API 호출만 막는 것이 목적이었다면 " +
          "`mcpeak test <suite.json> --command <executable> --record-session <path>` 로 먼저 " +
          "녹화한 뒤 `--session <path>` 로 재생하세요.",
      });
    // generate 는 index.ts 가 가로챈다. 여기 남겨 두면 구현된 명령을 미구현이라고 말하게 된다.
    if (["generate", "record", "mock"].includes(argv[0] ?? ""))
      return writeFailure(dependencies, {
        code: "COMMAND_NOT_IMPLEMENTED",
        message: `'${escapeTerminalText(argv[0] ?? "")}' 명령은 아직 구현되지 않았습니다.`,
        // "test 명령만" 이라고 적어 두면 틀린 안내다. generate 는 index.ts 가 가로채 실제로
        // 동작한다. `replay` 는 위에서 먼저 걸려 여기 오지 않는다(ADR-0059 로 제거됐다).
        // 여기 걸리는 것은 진입점이 없는 이름뿐이다.
        hint: commandDiscovery,
      });
    return writeFailure(dependencies, {
      code: "CLI_USAGE",
      message: `알 수 없는 CLI 명령 '${escapeTerminalText(argv[0] ?? "")}'입니다.`,
      // `TEST_USAGE_HINT` 를 쓰면 안 된다. 사용자가 친 것은 `test` 가 아닌데 `test` 의 플래그
      // 11 개를 먼저 읽히고 맨 끝에 명령 목록이 온다. 바로 위 분기와 같은 안내를 준다.
      hint: commandDiscovery,
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
    return writeFailure(dependencies, suiteFormatFailure(input.suitePath));
  let bytes: Uint8Array;
  try {
    bytes = await dependencies.readFile(input.suitePath);
  } catch (error: unknown) {
    return writeFailure(dependencies, suiteReadFailure(input.suitePath, error));
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return writeFailure(dependencies, suiteEncodingFailure(input.suitePath));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch (error: unknown) {
    return writeFailure(dependencies, suiteJsonFailure(input.suitePath, error));
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
  const runReset = dependencies.runResetCommand ?? defaultRunResetCommand;
  /**
   * 복원은 시험 실행을 **시작하기 전**이다. 실패하면 서버를 띄우지 않는다. 되돌리지 못한
   * 상태 위에서 돌린 결과는 판정 근거가 될 수 없기 때문이다(설계 문서 §5.2, ADR-0023).
   */
  if (input.resetCmd !== undefined) {
    try {
      await runReset(input.resetCmd);
    } catch (error) {
      // 어떤 오류든 사전 문장으로 바꿔서 내보낸다. 여기서 다시 던지면 이 경로만 스택
      // 트레이스가 화면에 나가고, 2회차의 같은 지점(모든 오류를 미완주로 삼킨다)과도
      // 처리가 갈린다.
      return writeFailure(
        dependencies,
        error instanceof ResetCommandError
          ? resetFailure(error)
          : { code: "CLI_INTERNAL_ERROR", ...dictionary.CLI_INTERNAL_ERROR },
      );
    }
  }
  /**
   * 두 transport 의 연결 주입점을 한 묶음으로 만든다. `--determinism` 의 2회차도 같은 것을
   * 쓴다 — 회차마다 다른 대상에 붙으면 비교가 뜻을 잃는다.
   */
  const connectDependencies = {
    connectStdio: dependencies.connect,
    ...(dependencies.connectHttp === undefined ? {} : { connectHttp: dependencies.connectHttp }),
    ...(dependencies.readEnv === undefined ? {} : { readEnv: dependencies.readEnv }),
  };
  let connection: CliConnection;
  try {
    connection = await openConnection(
      input.target,
      connectDependencies,
      childEnv === undefined ? undefined : { env: childEnv },
    );
  } catch (error) {
    // 연결 전에 멈춘 경우다(원격 미지원 진입점, 빈 환경변수). core 오류가 아니므로 진단이
    // 없고, 고칠 곳도 서버가 아니라 명령줄이다. 사용 오류로 낸다.
    if (error instanceof ConnectTargetError)
      return writeFailure(dependencies, {
        code: "CLI_USAGE",
        message: error.message,
        hint: TEST_USAGE_HINT,
      });
    const core = coreError(error);
    const failed = writeFailure(
      dependencies,
      core === undefined
        ? { code: "MCP_CONNECTION_FAILED", ...dictionary.MCP_CONNECTION_FAILED }
        : {
            code: "MCP_CONNECTION_FAILED",
            // `core.message`·`core.hint` 는 지금은 `@mcpeak/core` 의 고정 열거형 문구뿐이라
            // 안전하지만, 타입은 `string` 이라 그 사실을 여기서 강제하지 못한다. `format()`
            // 이 더 이상 통째로 이스케이프하지 않으므로(#289), 패키지 경계를 넘어온 값은
            // 여기서 직접 건다 — core 쪽에 다치는 값이 생겨도 이 자리가 계속 안전하다.
            message: escapeTerminalText(core.message),
            hint: escapeTerminalText(core.hint),
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
    /**
     * 원격 대상의 진단. `--stderr-lines` 로 억제하지 않는다 — 파서가 그 옵션과 `--url` 의
     * 동시 사용을 막으므로 값이 항상 기본값이라 조건이 뜻을 잃는다.
     *
     * 내용 판정(`hasHttpDiagnosticContent`)도 걸지 않는다. 연결이 실패한 자리에서는 상태
     * 코드가 없어도(DNS 실패, 연결 거부) **어느 엔드포인트에 붙으려다 실패했는지**가 정보다.
     */
    const remote = core?.httpDiagnostics;
    if (remote !== undefined) dependencies.writeStderr(`\n${renderHttpDiagnostics(remote)}`);
    return failed;
  }
  /**
   * 진단 스냅샷. 읽기를 시도했다는 사실과 그 결과를 함께 담는다. `undefined` 를 센티널로 쓰면
   * "아직 안 읽었다" 와 "읽다 실패했다" 가 섞여, 실패했을 때 다시 읽는 일이 생긴다. §4.3.1.
   */
  type DiagnosticsSnapshot = {
    readonly value: ProcessDiagnosticsInput | undefined;
    /** 원격 대상의 진단. 위 `value` 와 동시에 채워지지 않는다 — 두 가드가 서로를 배제한다. */
    readonly remote: HttpDiagnosticsInput | undefined;
  };
  /** 진단 출력 실패가 판정을 바꾸면 안 된다. getDiagnostics 가 던지면 삼킨다. §4.3.1. */
  const snapshotDiagnostics = (): DiagnosticsSnapshot => {
    try {
      const raw = connection.getDiagnostics();
      return { value: processDiagnostics(raw), remote: httpDiagnostics(raw) };
    } catch {
      return { value: undefined, remote: undefined };
    }
  };
  /**
   * 블록 앞에는 항상 빈 줄을 둔다. 오류 메시지 뒤든 보고서 뒤든 같은 터미널에 이어 나오므로
   * 경로마다 레이아웃이 달라질 이유가 없다. 설계 문서 §7.
   * snapshot 을 주면 그 값을 쓴다. 우리가 프로세스를 정리한 뒤의 상태를 서버 탓으로 보고하지
   * 않기 위해서다(설계 문서 §4.3).
   */
  const writeDiagnostics = (snapshot?: DiagnosticsSnapshot): void => {
    // 스냅샷을 받았으면 그 결과가 전부다. 실패했더라도 다시 읽지 않는다. 다시 읽으면 우리가
    // 프로세스를 정리한 뒤의 상태를 서버 탓으로 보고하게 된다.
    const taken = snapshot ?? snapshotDiagnostics();
    /**
     * 원격 대상. `--stderr-lines` 로 억제하지 않는다 — stdio 전용 옵션이고 파서가 `--url`
     * 과의 동시 사용을 막으므로 여기서는 조건이 뜻을 잃는다.
     *
     * 다만 내용 판정은 **건다.** 연결 실패 경로와 달리 여기는 실행이 끝난 뒤라, core 가
     * 상태 코드를 채우지 않은 성공한 실행에서도 불린다. 판정 없이 그리면 초록불 뒤에 매번
     * 빈 진단 블록이 붙는다.
     */
    if (taken.remote !== undefined) {
      if (hasHttpDiagnosticContent(taken.remote))
        dependencies.writeStderr(`\n${renderHttpDiagnostics(taken.remote)}`);
      return;
    }
    if (input.stderrLines === 0) return;
    const diagnostics = taken.value;
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
  /**
   * 캡처 래퍼는 `--determinism` 일 때만 만든다. 플래그가 없으면 기존 경로와 호출·객체가
   * 완전히 같다. 캡처 비용 0 이 설계 문서 §5.1 의 조건이다.
   */
  const firstCapture = input.determinism ? createDeterminismCapture(connection.client) : undefined;
  /**
   * 러너에 넘기는 client 다. **`shutdown.client` 는 반드시 이것과 같은 객체여야 한다.**
   * `finalizeRunnerExecution` 이 `runSuite` 에 바인딩된 client 와 대조해 다르면 TypeError 를
   * 던지고(`runner/src/shutdown.ts` 의 `boundClient`), 그러면 종료 절차가 통째로 건너뛰어져
   * 서버 프로세스가 남는다. 한쪽만 감싸면 정확히 그 일이 난다.
   */
  const firstClient = firstCapture?.client ?? connection.client;
  const shutdown = {
    client: firstClient,
    close: () => connection.close(),
    forceClose: (_reason: unknown) => connection.forceClose(),
  };
  let execution: RunnerExecution;
  try {
    execution = dependencies.startRunner(
      firstCapture === undefined
        ? { client: firstClient, suite: validated.value }
        : { client: firstClient, suite: validated.value, onEvent: firstCapture.onEvent },
    );
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
  let deferredJunitFailure: CliFailure | undefined;
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
    } catch (error) {
      // 전부 통과여도 1 이다. 조용히 0 을 내면 CI 는 리포트 파일 없이 초록이 되고, 사용자는
      // 리포트가 사라진 것을 한참 뒤에야 안다. 다만 여기서 반환하면 시험 결과 stdout 까지
      // 사라진다(#294). 실패를 보관해 결과를 전부 렌더한 뒤 보고한다. 원인이 로컬 I/O 이므로
      // 서버 진단은 쓰지 않는다.
      deferredJunitFailure = junitWriteFailure(input.junitPath, error);
    }
  }
  /**
   * 2회차. `--determinism` 일 때만 돈다. **서버 프로세스를 새로 띄운다.** 1회차 연결은 위
   * `finalize` 의 종료 절차로 이미 닫혔고, 프로세스 내부 상태도 초기화 대상이라 연결을
   * 재사용하지 않는다(설계 문서 §5.2).
   *
   * 이 블록의 실패는 **CLI 오류로 던지지 않는다.** 1회차 판정과 종료 코드는 이미 정해졌고,
   * 관찰이 실패했다고 시험 판정을 뒤집으면 안 된다. 2회차 문제는 결정론성 블록 안의
   * 문장으로만 존재한다(설계 문서 §7).
   */
  const determinismOutcome: DeterminismOutcome | undefined = await (async () => {
    if (firstCapture === undefined) return undefined;
    const snapshotOf = (target: CliConnection): ProcessDiagnosticsInput | undefined => {
      try {
        // 원격 대상이면 구조 가드가 `undefined` 를 낸다. 결정론성 블록의 진단 자리는
        // 프로세스 진단만 그리므로, HTTP 진단을 여기에 실으면 stdio 블록이 남의 값을 그린다.
        return processDiagnostics(target.getDiagnostics());
      } catch {
        return undefined;
      }
    };
    if (input.resetCmd !== undefined) {
      try {
        await runReset(input.resetCmd);
      } catch (error) {
        // 1회차는 이미 끝났다. 여기서 실패로 종료하면 화면에 나간 보고서와 종료 코드가
        // 서로 다른 이야기를 한다. 비교만 포기한다.
        const reason =
          error instanceof ResetCommandError
            ? `2회차 전 초기화 명령 실패: ${error.command}`
            : "2회차 전 초기화 명령 실패";
        return { kind: "incomplete", reason };
      }
    }
    let second: CliConnection;
    try {
      second = await openConnection(
        input.target,
        connectDependencies,
        childEnv === undefined ? undefined : { env: childEnv },
      );
    } catch (error) {
      const core = coreError(error);
      return {
        kind: "incomplete",
        reason: "서버 연결 실패",
        ...(core?.diagnostics === undefined ? {} : { diagnostics: core.diagnostics }),
      };
    }
    const secondCapture = createDeterminismCapture(second.client);
    let secondExecution: RunnerExecution;
    try {
      secondExecution = dependencies.startRunner({
        client: secondCapture.client,
        suite: validated.value,
        onEvent: secondCapture.onEvent,
      });
    } catch {
      // forceClose 전 상태를 찍는다. 우리가 죽인 뒤의 상태를 서버 탓으로 적지 않는다.
      const snapshot = snapshotOf(second);
      try {
        await second.forceClose();
      } catch {}
      return {
        kind: "incomplete",
        reason: "2회차 실행 시작 실패",
        ...(snapshot === undefined ? {} : { diagnostics: snapshot }),
      };
    }
    let secondReport: RunnerReport;
    try {
      secondReport = await dependencies.finalize({
        execution: secondExecution,
        shutdown: {
          // 1회차와 같은 이유로 러너에 넘긴 객체 그대로다. 다르면 종료 절차가 안 돈다.
          client: secondCapture.client,
          close: () => second.close(),
          forceClose: (_reason: unknown) => second.forceClose(),
        },
      });
    } catch {
      const snapshot = snapshotOf(second);
      // finalize 가 실패했으면 종료 절차가 어디까지 갔는지 알 수 없다. 우리가 책임지고
      // 닫는다. 2회차는 보고서에 남지 않으므로 여기서 안 닫으면 그대로 좀비가 된다.
      try {
        await second.forceClose();
      } catch {}
      return {
        kind: "incomplete",
        reason: "2회차 실행 또는 서버 종료 실패",
        ...(snapshot === undefined ? {} : { diagnostics: snapshot }),
      };
    }
    if (secondReport.status === "aborted") {
      const snapshot = snapshotOf(second);
      const stop = secondReport.stopReason;
      const reason =
        stop?.type === "timeout"
          ? `2회차 케이스 타임아웃 (${stop.caseId})`
          : stop?.type === "abortSignal"
            ? "2회차 실행 중단"
            : "2회차 실행 미완주";
      return {
        kind: "incomplete",
        reason,
        ...(snapshot === undefined ? {} : { diagnostics: snapshot }),
      };
    }
    try {
      const check = dependencies.checkDeterminism ?? runnerCheckDeterminism;
      return {
        kind: "compared",
        result: check({
          first: firstCapture.observations(),
          second: secondCapture.observations(),
          stateRestored: input.resetCmd !== undefined,
        }),
      };
    } catch {
      // 관찰 수 불일치를 포함한 비교 실패다. 우리 결함이지만 판정을 뒤집지 않는다.
      return { kind: "internal" };
    }
  })();
  /**
   * 툴 목록이 비면 입력 계약 대조는 건너뛴다. 목록이 비었을 때 대조하면 모든 케이스가
   * `TOOL_NOT_DECLARED` 로 걸려 실패 원인과 무관한 줄만 늘어난다. 단언 실질성은 툴이 필요
   * 없으므로 항상 돈다. 위반 참고는 실패한 케이스에만 표시하지만, 검사를 건너뛴 사실은
   * 통과 케이스에서도 보존한다. 설계 문서 §7.
   *
   * 검사가 던져도 판정과 exit code 는 바뀌지 않아야 하므로 삼킨다. `validated.value` 는 이미
   * `validateMcpSuite` 를 통과했으니 도달할 일이 없는 경로이고, 도달했다면 그것은 비차단
   * 진단의 결함이지 대상 서버의 결함이 아니다.
   */
  const specFindings: readonly SpecFinding[] = (() => {
    /**
     * 케이스 버킷을 보고서의 케이스 순서로 먼저 만든다. 두 검사 결과를 이어 붙인
     * 뒤에 `caseId` 로 묶으면 앞 케이스에 단언 finding 만 있고 뒤 케이스에 입력 계약 finding
     * 이 있을 때 뒤 케이스가 먼저 들어와 순서가 뒤집힌다. 케이스 사이 순서는 검사 종류가
     * 아니라 보고서가 정한다. 한 케이스 안의 블록 순서는 `FINDING_GROUP_ORDER` 가 맡는다.
     * 없는 키를 만들지 않으므로 버킷에 없는 caseId 는 그대로 걸러진다.
     */
    const buckets = new Map<string, SpecFinding[]>();
    const statuses = new Map<string, TestCaseResult["status"]>();
    for (const item of finalReport.cases) {
      buckets.set(item.spec.id, []);
      statuses.set(item.spec.id, item.status);
    }
    try {
      const inputContract = dependencies.checkInputContract ?? runnerCheckInputContract;
      const assertionSubstance =
        dependencies.checkAssertionSubstance ?? runnerCheckAssertionSubstance;
      const found = [
        ...(tools.length === 0 ? [] : inputContract({ suite: validated.value, tools }).findings),
        ...assertionSubstance(validated.value).findings,
      ];
      for (const finding of found) {
        if (statuses.get(finding.caseId) === "passed" && FINDING_GROUP[finding.code] !== "skipped")
          continue;
        buckets.get(finding.caseId)?.push(finding);
      }
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
      /**
       * 결정론성은 비교까지 갔을 때만 키를 만든다. `--determinism` 이 없으면 기존 JSON 이
       * 바이트 그대로여야 하고(설계 문서 §8), 비교를 못 한 경우에는 실어야 할
       * `DeterminismResult` 자체가 없다. 그 사실은 아래에서 stderr 로 알린다.
       */
      const machine =
        determinismOutcome?.kind === "compared"
          ? { ...finalReport, spec, determinism: determinismOutcome.result }
          : { ...finalReport, spec };
      dependencies.writeStdout(`${JSON.stringify(machine, null, 2)}\n`);
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
          const caseId = item.spec.id;
          const allFindings = byCase.get(caseId) ?? [];
          // 통과 케이스의 위반 참고는 기존처럼 숨기되, 검사를 수행하지 못했다는 사실은 숨기지
          // 않는다. 초록 실행에서 이 finding 을 빼면 사용자는 입력 계약이 검증됐다고 읽는다.
          const list =
            item.status === "passed"
              ? allFindings.filter((finding) => FINDING_GROUP[finding.code] === "skipped")
              : allFindings;
          for (const group of FINDING_GROUP_ORDER) {
            const grouped = list.filter(
              (finding) =>
                FINDING_GROUP[finding.code] === group &&
                !(group === "inputContract" && responseRepeatsTypeMismatch(finding, item)),
            );
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
        dependencies.writeStdout(`\n${renderSpecApproval(specApproval, allPassed)}`);
      /**
       * 결정론성 블록은 보고서 뒤, 다른 블록과 같은 레이아웃 규칙(앞에 빈 줄)을 따른다.
       * `--determinism` 없이는 한 줄도 찍지 않는다. 설계 문서 §8.
       */
      if (determinismOutcome !== undefined)
        dependencies.writeStdout(
          `\n${renderDeterminism(determinismOutcome, {
            stateRestored: input.resetCmd !== undefined,
            stderrLines: input.stderrLines,
          })}`,
        );
    }
    /**
     * 기계가 읽는 출력에서는 비교 실패 사실이 사라진다(키를 만들지 않으므로). 그대로 두면
     * 사용자는 왜 키가 없는지 알 수 없다. stdout 은 JSON 전용이므로 stderr 에 적는다.
     */
    if (input.json && determinismOutcome !== undefined && determinismOutcome.kind !== "compared")
      dependencies.writeStderr(
        `\n${renderDeterminism(determinismOutcome, {
          stateRestored: input.resetCmd !== undefined,
          stderrLines: input.stderrLines,
        })}`,
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
  if (!allPassed || (settled.value !== undefined && isAbnormalExit(settled.value)))
    writeDiagnostics(settled);
  /**
   * repair 번들. 스냅샷을 그대로 쓴다. 우리가 프로세스를 정리한 뒤의 상태를 다시 읽으면 그
   * 상태를 서버 탓으로 적게 된다. `--repair-bundle` 을 주지 않으면 이 블록을 통째로 건너뛰므로
   * 기존 경로의 출력과 종료 코드가 그대로다. 계획서 완료 조건 2.
   */
  let deferredRepairBundleFailure: CliFailure | undefined;
  if (input.repairBundlePath !== undefined) {
    const bundle = buildRepairBundle({
      report: finalReport,
      suite: validated.value,
      specApproval,
      processDiagnostics: settled.value,
    });
    if (bundle === undefined) dependencies.writeStdout(`\n${REPAIR_BUNDLE_EMPTY_LINE}`);
    else
      try {
        await dependencies.writeFile(input.repairBundlePath, serializeRepairBundle(bundle));
      } catch (error: unknown) {
        // 전부 통과여도 1 이다. 조용히 0 을 내면 CI 는 번들 없이 초록이 되고, 사용자는 파일이
        // 없다는 것을 한참 뒤에야 안다. JUnit 쓰기도 실패했을 수 있으므로 여기서 반환하지 않고
        // 두 산출물 오류를 모두 보고한다. 원인이 로컬 I/O 이므로 진단은 쓰지 않는다.
        deferredRepairBundleFailure = repairBundleWriteFailure(input.repairBundlePath, error);
      }
  }
  // 두 산출물은 독립적으로 요청한 것이다. 하나가 실패해도 다른 쓰기를 시도하고, 둘 다 실패하면
  // 사용자가 어느 파일이 없는지 모두 알 수 있도록 두 오류를 요청 순서대로 보고한다.
  for (const failure of [deferredJunitFailure, deferredRepairBundleFailure])
    if (failure !== undefined) writeFailure(dependencies, failure);
  if (deferredJunitFailure !== undefined || deferredRepairBundleFailure !== undefined) return 1;
  // 판정은 케이스 결과로만 정한다. 지문이 달라도 종료 코드는 바뀌지 않는다. 설계 문서 §6.
  return allPassed ? 0 : 1;
}

/**
 * 네 경고가 공유하는 마지막 줄(ADR-0057). **한 곳에 둔다** — 갈래마다 따로 쓰면 같은 한계를
 * 사용자가 갈래마다 다르게 배우고, 범위가 넓어질 때 고쳐야 할 곳이 넷이 된다.
 */
const EXTERNAL_SCOPE_NOTE = "→ MCPeak은 서버가 `globalThis.fetch`로 부른 것만 잡습니다.\n";

/**
 * 재생 원본에서 찾지 못한 호출들을 그린다. `misses` 가 비어 있으면 빈 문자열이다.
 *
 * **MCP 오류 채널을 타지 않는다(#259).** `record` 의 `REPLAY_MISS` 진단은 실패한 툴 호출의
 * MCP 오류 메시지로도 나가는데, 그 채널은 `runner` 가 "테스트 대상 서버가 보낸 텍스트"로
 * 취급해 이스케이프(개행 포함)와 200자 절단을 건다 — 우리 자신이 여러 줄로 공들여 쓴 진단이
 * 서버 텍스트와 똑같이 망가진다. 이 함수는 `record` 가 `finish()` 요약에 구조화해 담아 준
 * 값을 CLI 가 직접 stderr 로 쓴다. `runner` 도 그 이스케이프 규칙도 거치지 않는다.
 *
 * `method`·`url`·`matchKeyPrefix` 는 값 자체는 `record` 가 만들지만 원본은 테스트 대상
 * 서버가 시도한 요청이라, 혹시 모를 제어 문자에 대비해 필드 단위로 이스케이프한다(줄 구조를
 * 만드는 정적 문구는 이스케이프 대상이 아니다 — `process-diagnostics.ts` 와 같은 원칙).
 */
export function renderReplayMissDiagnostics(misses: readonly ReplayMissDetail[]): string {
  if (misses.length === 0) return "";
  const body = misses
    .map(
      (miss) =>
        `  ${escapeTerminalText(miss.method)} ${escapeTerminalText(miss.url)}\n` +
        `  occurrence ${miss.occurrence} · matchKey ${escapeTerminalText(miss.matchKeyPrefix)}…\n`,
    )
    .join("");
  return (
    `\nExternal 진단: 재생 원본에서 찾지 못한 호출 ${misses.length}건\n` +
    body +
    "→ 이 호출이 녹화된 뒤에 추가되었거나, 요청이 녹화 때와 달라져 다른 matchKey가 되었습니다.\n" +
    "→ 녹화를 다시 하거나, 요청이 실행마다 달라지는 값을 담고 있는지 확인하세요.\n"
  );
}

/**
 * External 세션 요약을 사용자에게 보이는 한 문단으로 옮긴다. `undefined` 는 할 말이 없다는 뜻이다.
 *
 * **순서가 곧 계약이다**(ADR-0057). `consumedCount === 0` 과 `unusedCount > 0` 은 동시에 참일 수
 * 있어서, 조건을 각각 독립적으로 세우면 한 실행에 경고가 두 번 찍힌다. 아래 순서로 먼저 걸리는
 * 하나만 낸다.
 *
 * 갈래를 넷으로 나눈 이유는 **사용자가 다음에 볼 곳이 다르기 때문이다.** 원본이 비어 있는 것
 * (녹화 단계가 아무것도 못 잡았다)과 원본은 찼는데 하나도 안 쓴 것(세션 파일을 잘못 짚었거나
 * 서버의 호출 방식이 바뀌었다)은 같은 `consumedCount === 0` 이지만 원인이 정반대 방향에 있다.
 * 하나로 합치면 [#258](https://github.com/2026-Engineering-Contest/MCPeak/issues/258) 의 실제
 * 경로에서 "녹화된 호출이 재생되지 않았다" 고 말하게 되는데, 그 문장은 녹화가 있었다는 전제를
 * 깔아 사용자를 재생 쪽으로 보낸다. 정작 볼 곳은 그 앞 단계다.
 *
 * 판정만 하고 쓰기는 하지 않는다 — 순수 함수라 배타성 자체를 프로세스 없이 고정할 수 있다.
 */
/**
 * External 세션을 열지 못한 실패를 사용자 문장으로 옮긴다(#260, #290).
 *
 * **원인마다 다음에 할 일이 다르므로 갈래마다 다른 문장을 쓴다.** 한때 이 자리가 문장 하나로
 * 모든 실패를 덮었고, 그래서 경로를 잘못 친 사람에게 "완료된 Replay 원본이 아닙니다" 와
 * "쓰기 권한을 확인하세요" 를 동시에 말했다 — 앞은 손상된 세션의 문안이고 뒤는 녹화의 문안이라
 * 재생 실패에는 둘 다 맞지 않았다.
 *
 * **경로를 `message` 에 싣는다.** 세션 id 는 넣지 않는다 — 사용자가 준 적 없는 `"default"`
 * 대신 사용자가 아는 경로를 보여준다.
 *
 * `path`·`detail` 은 우리 문장이 아니다. `path` 는 사용자가 CLI 에 그대로 타이핑한 값이고
 * `detail` 은 record 가 던진 오류의 원문(SQLite 원문을 포함할 수 있다)이라, 둘 다 화면을
 * 깨뜨릴 값이 실릴 수 있어 이스케이프한다(#289) — `message` 안에서 그 부분만 걸고, `format()`
 * 은 이제 필드 전체를 다시 이스케이프하지 않는다.
 */
export function externalOpenFailure(mode: ExternalMode, path: string, error: unknown): CliFailure {
  const code = (error as { code?: unknown })?.code;
  const detail = error instanceof Error ? error.message : String(error);
  const shownPath = escapeTerminalText(path);

  if (error instanceof SessionFileMissingError)
    return {
      code: "EXTERNAL_SESSION_FAILED",
      message: `세션 파일을 찾을 수 없습니다: ${shownPath}`,
      hint: "경로를 확인하거나, `--record-session <path>` 로 먼저 녹화하세요.",
    };
  if (code === "SESSION_NOT_FOUND")
    return {
      code: "EXTERNAL_SESSION_FAILED",
      message: `세션 파일에 녹화된 외부 호출이 없습니다: ${shownPath}`,
      hint: "`--record-session` 으로 다시 녹화하세요. 빈 세션으로는 아무 호출도 막지 못합니다.",
    };
  if (code === "REPLAY_SOURCE_INVALID")
    return {
      code: "EXTERNAL_SESSION_FAILED",
      message: `녹화가 완료되지 않은 세션입니다: ${shownPath}`,
      hint: "녹화 실행이 실패했을 수 있습니다. `--record-session` 으로 다시 녹화하세요.",
    };
  // record 가 이 코드에 붙이는 원문(detail)은 두 줄짜리 안내다(ADR-0061). fallback 으로
  // 떨어져 그 원문을 그대로 이스케이프하면 안의 개행이 이스케이프 시퀀스로 찍혀, record
  // 쪽에서 이미 고친 문제(#289)가 여기서 재발한다 — 그래서 우리 문장으로 갈아 별도 갈래를 둔다.
  if (code === "SCHEMA_VERSION_UNSUPPORTED")
    return {
      code: "EXTERNAL_SESSION_FAILED",
      message: `이 버전의 mcpeak 이 지원하지 않는 세션 파일입니다: ${shownPath}`,
      hint: "이 버전의 mcpeak 으로 다시 녹화하세요.",
    };
  // #290. 갈래를 셋만 보고 넷째(이미 존재)를 놓치면, 녹화를 두 번 돌린 흔한 실수가 아래
  // fallback 으로 떨어져 "쓰기 권한을 확인하세요" 를 듣는다 — 권한은 멀쩡하고, 오히려 있는
  // 파일을 지키려고 막은 것이라 원인과 반대 방향이다.
  if (code === "SESSION_ALREADY_EXISTS")
    return {
      code: "EXTERNAL_SESSION_FAILED",
      message: `세션 파일에 이미 녹화가 있습니다: ${shownPath}`,
      hint:
        "기존 녹화를 덮어쓰지 않습니다. 다른 `--record-session` 경로를 쓰거나, " +
        "다시 녹화하려면 그 파일을 지우세요.",
    };
  // 여기부터는 우리가 분류하지 못한 실패다. 원인 문장을 버리지 않고 그대로 보여주되,
  // 안내는 모드에 맞는 것 하나만 준다 — 재생은 읽기라 쓰기 권한을 말할 이유가 없다.
  return {
    code: "EXTERNAL_SESSION_FAILED",
    message: `External 세션을 열지 못했습니다: ${shownPath} (${escapeTerminalText(detail)})`,
    hint:
      mode === "replay"
        ? "경로가 맞는지와 그 파일을 읽을 수 있는지 확인하세요."
        : "경로의 디렉터리가 있는지와 쓰기 권한을 확인하세요.",
  };
}

/**
 * `wiring.finish()` 가 세션을 닫는 데 실패했을 때(#289). record 의 store `finish()` 는 코드
 * 둘만 던진다 — `SESSION_NOT_RUNNING`(한 줄) 과 `INCOMPLETE_SESSION`(record 가 여러 줄로
 * 쓴, 이미 마스킹된 안전한 진단. `display` 는 ADR-0053 이 마스킹을 보장한다).
 *
 * `INCOMPLETE_SESSION` 은 그대로 둬야 구조가 산다. 그 밖은 한 줄이라 이스케이프해도 잃을
 * 구조가 없고, 어떤 값이 올지 모르는 자리이므로 기본은 이스케이프한다.
 */
export function externalCloseFailure(error: unknown): CliFailure {
  const code = (error as { code?: unknown })?.code;
  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: "EXTERNAL_SESSION_FAILED",
    message: "External 세션을 닫지 못했습니다.",
    hint: code === "INCOMPLETE_SESSION" ? detail : escapeTerminalText(detail),
  };
}

/**
 * 개수가 전부가 아닐 수 있다는 단서.
 *
 * **이 줄이 있는 이유는 부분 커버리지다.** 서버가 `globalThis.fetch` 와 `node:http` 를 섞어
 * 쓰면 어댑터는 앞쪽만 본다 — 호출 2건 중 1건만 녹화되고, 재생에서는 그 1건이 재생되는 동안
 * 나머지 1건이 실제 네트워크로 나간다. **경고 네 갈래는 전부 이 상황을 비켜간다**
 * (`interactionCount > 0`·`consumedCount > 0`·`unusedCount === 0`).
 *
 * 녹화에는 셀 수단이 없어 항상 붙는다. 재생은 ADR-0068 이 실제로 세므로 **0 임을 확인한
 * 실행에서는 붙지 않는다** — 조건절은 모를 때만 한다.
 */
const PARTIAL_RECORD_NOTE =
  "  이 수는 어댑터가 잡은 호출만 셉니다. 범위 밖 호출은 세션에 남지 않습니다.\n";

/** 같은 단서의 재생 판. 남지 않는 것이 아니라 **실제 네트워크로 나가는** 것이 요점이다. */
const PARTIAL_REPLAY_NOTE =
  "  이 수는 어댑터가 잡은 호출만 셉니다. 범위 밖 호출은 재생 중에도 실제 네트워크로 나갑니다.\n";

/**
 * 재생 중 범위 밖으로 나간 호출을 **사실로** 알린다(ADR-0068).
 *
 * `externalSessionOutcome` 과 축이 다르므로 따로 낸다 — 그쪽은 "무엇을 했는가", 이쪽은 "그
 * 실행이 재현 가능한가" 다. 같은 실행에서 둘 다 나간다(ADR-0062 의 `bodyUrlNotice` 와 같은
 * 이유).
 *
 * **세 갈래를 정확히 구분한다.** `undefined`(못 셌음)에서 침묵하는 것이 핵심이다 — 거기서
 * "0건" 이라고 말하면 이 기능이 없애려던 거짓 안심을 그대로 되살린다. 그 경우의 방어는
 * `PARTIAL_REPLAY_NOTE` 조건절이 계속 맡는다.
 */
export function outOfScopeNotice(summary: SessionSummary): string | undefined {
  if (summary.mode !== "replay") return undefined;
  if (summary.outOfScope === undefined) return undefined;
  if (summary.outOfScope === 0) return undefined;
  return (
    `\n경고: 범위 밖 호출 ${summary.outOfScope}건이 실제 네트워크로 나갔습니다.\n` +
    "→ 이 실행은 재현 가능하지 않습니다. 그 호출의 응답은 녹화본이 아니라 오늘의 것입니다.\n" +
    "→ 서버가 `node:http`·axios 등으로 부른 호출입니다. 재생하려면 `fetch` 로 바꾸거나,\n" +
    "  그 외부 의존을 `mcpeak mock` 으로 대신하세요.\n"
  );
}

/**
 * 조건절은 **모를 때만** 단다. 세었으면 개수가 그 자리를 대신한다.
 *
 * 0 건이면 붙일 이유가 없고, **N 건이어도 붙이지 않는다** — `outOfScopeNotice` 가 "N건이 실제
 * 네트워크로 나갔습니다" 를 이미 사실로 말하는데 그 위에 "나갈 수 있습니다" 를 얹으면 같은
 * 말을 두 번 하는 것이고, 조건절이 사실보다 먼저 읽혀 경고를 흐린다. 화면에서 실제로 그렇게
 * 나오는 것을 보고 고쳤다.
 */
function replayCaveat(summary: SessionSummary): string {
  if (summary.mode === "replay" && summary.outOfScope !== undefined) return "";
  return PARTIAL_REPLAY_NOTE;
}

/**
 * 이 실행이 External 세션으로 **무엇을 했는지** 한 줄로 말한다(ADR-0066).
 *
 * 성공한 실행이 아무 말도 하지 않으면, 사용자가 방금 본 리포트가 실제 네트워크를 탄 결과인지
 * 녹화본을 재생한 결과인지 구분할 방법이 없다. 판정이 같아도 그 판정의 근거는 다른 사실이다.
 *
 * **`externalSessionNotice` 와 정확히 배타다.** 그쪽이 말하는 갈래에서 여기는 침묵한다 — 둘 다
 * 나오면 같은 사실을 두 번 말하고, 둘 다 침묵하면 이 함수를 만든 이유가 그 갈래에서 사라진다.
 * 그 배타성은 이 주석이 아니라 `external-session.test.ts` 의 매트릭스가 지킨다.
 *
 * **`EXTERNAL_SCOPE_NOTE` 전문은 여기서 반복하지 않는다.** 경고 갈래마다 이미 나오고, 정상
 * 경로에서까지 매번 붙이면 그 문장이 읽히지 않게 된다. 대신 아래 한 줄짜리 단서만 붙인다.
 */
export function externalSessionOutcome(
  summary: SessionSummary,
  sessionPath: string,
): string | undefined {
  // 경로는 사용자가 준 값이다. 다른 세션 문장들과 같은 규칙으로 이스케이프한다.
  const shownPath = escapeTerminalText(sessionPath);
  if (summary.mode === "record") {
    if (summary.interactionCount === 0) return undefined;
    // 실행이 실패하면 세션도 `failed` 로 닫힌다(`runCli`). 그 세션은 재생 원본으로 **거부된다**
    // ("녹화가 완료되지 않은 세션입니다"). 그런데도 "녹화했습니다" 라고 하면, 사용자는 못 쓰는
    // 파일을 가진 채 가졌다고 믿는다 — 이 함수가 없애려던 바로 그 종류의 거짓말이다.
    if (summary.status !== "completed") {
      return (
        `\n→ 이 실행이 실패해 녹화를 완료하지 않았습니다: ${shownPath}\n` +
        `  외부 호출 ${summary.interactionCount}건을 잡았지만 재생 원본으로 쓸 수 없습니다.\n` +
        "→ 실패 원인을 고친 뒤 다시 녹화하세요.\n"
      );
    }
    return (
      `\n→ 외부 호출 ${summary.interactionCount}건을 녹화했습니다: ${shownPath}\n` +
      PARTIAL_RECORD_NOTE
    );
  }
  // **재생은 상태로 가르지 않는다.** 녹화와 비대칭인 것이 의도다 — 실패한 녹화는 산출물 자체가
  // 못 쓰게 되지만, 실패한 재생은 재생이 실패한 것이 아니라 판정이 실패한 것이다. N건은 실제로
  // 재생됐고 그 문장은 여전히 참이다. 여기서 침묵하면 실패한 실행에서 녹화·재생을 구분할 수
  // 없게 되는데, 원인을 찾을 때 그 구분이 가장 필요하다.
  // 재생은 경고가 침묵하는 갈래가 하나뿐이다 — 원본이 차 있고, 하나 이상 썼고, 남은 것이 없다.
  if (summary.interactionCount === 0) return undefined;
  if (summary.consumedCount === 0) return undefined;
  if (summary.unusedCount > 0) return undefined;
  return (
    `\n→ 녹화된 외부 호출 ${summary.interactionCount}건을 재생했습니다: ${shownPath}${recordedAtSuffix(summary)}\n` +
    replayCaveat(summary)
  );
}

/**
 * 원본을 **언제** 녹화했는지 덧붙인다(ADR-0069). 없으면 아무것도 안 붙인다.
 *
 * **나이가 아니라 시각이다.** "12일 전" 이나 "30일 넘었습니다" 는 지금 시각을 읽어야 하고,
 * 그러면 같은 세션의 같은 재생이 날마다 다른 바이트를 낸다 — 결정론이 이 저장소의 핵심
 * 가치이고 대시보드 e2e 가 SSE 바이트 동일을 단언한다. 낡았는지 판정하는 것은 사람의 몫이다.
 *
 * **`toLocale*` 를 쓰지 않는다.** 기계의 로캘·타임존에 따라 같은 세션이 CI 와 로컬에서 다른
 * 문자열을 낸다. ISO 를 자르고 `UTC` 를 명시한다 — 표기를 안 붙이면 KST 사용자가 자기 시간으로
 * 읽어 9시간을 착각한다. 밀리초는 낡음을 판단하는 데 쓸모가 없어 뺀다.
 */
function recordedAtSuffix(summary: SessionSummary): string {
  if (summary.mode !== "replay") return "";
  const recordedAt = summary.recordedAt;
  if (recordedAt === undefined) return "";
  // `2026-05-01T09:12:33.123Z` → `2026-05-01 09:12:33 UTC`. 순수 문자열 연산이라 기계와
  // 무관하다.
  //
  // **끝의 `Z` 를 필수로 요구한다.** 앞부분만 보면 `2026-05-01T09:12:33+09:00` 도 통과해서
  // 그 값을 `09:12:33 UTC` 로 표시한다 — 9시간 틀린 시각을 사실로 말하는 것이다. 지금 우리는
  // `toISOString()` 만 쓰므로 그런 값이 들어올 일이 없지만, **확인하지 않은 것을 단정하지
  // 않는다** 는 쪽을 코드에 남긴다. 모양이 다르면(구 버전 파일 등) 손대지 않고 원문을 보여준다.
  const [, date, time] =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/.exec(recordedAt) ?? [];
  const shown =
    date === undefined || time === undefined
      ? escapeTerminalText(recordedAt)
      : formatUtc(recordedAt, date, time);
  return ` (${shown} 녹화)`;
}

/**
 * 모양이 맞아도 **값이 달력에 없을 수 있다.** `2026-02-30` 은 `NaN` 이 아니라 **3월 2일로
 * 굴러간다**(실측). 그래서 `isNaN` 검사로는 못 잡고 왕복 비교를 해야 한다 — 다시 직렬화한
 * 값이 원래 문자열과 같을 때만 우리가 읽은 대로인 것이다.
 *
 * 파싱은 시계를 읽지 않으므로 결정론에 영향이 없다. 확인에 실패하면 원문을 그대로 보여준다 —
 * 손대지 않는 쪽이 없는 날짜를 그럴듯하게 포장하는 것보다 낫다.
 *
 * **그래서 `recordedAt` 원문을 받는다.** 잘라낸 조각으로 되짚어 만들면 정규식이 허용한 소수
 * 초가 사라져(`2026-02-30T12:00:00.123Z` → `...12:00:00Z`), "원문을 그대로 보여준다" 는 이
 * 함수의 계약이 실패 경로에서만 조용히 깨진다.
 */
function formatUtc(recordedAt: string, date: string, time: string): string {
  const iso = `${date}T${time}`;
  const parsed = new Date(`${iso}Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(iso))
    return escapeTerminalText(recordedAt);
  return `${date} ${time} UTC`;
}

export function externalSessionNotice(summary: SessionSummary): string | undefined {
  if (summary.mode === "record") {
    if (summary.interactionCount > 0) return undefined;
    return (
      "\n알림: 이 실행에서 외부 호출이 하나도 녹화되지 않았습니다.\n" +
      "→ 서버가 외부 API를 호출했다면 지원 범위를 벗어났는지 확인하세요.\n" +
      EXTERNAL_SCOPE_NOTE
    );
  }
  if (summary.interactionCount === 0)
    return (
      "\n알림: 이 세션에는 녹화된 외부 호출이 0건입니다. 재생할 것이 없었습니다.\n" +
      "→ 녹화 실행이 외부 호출을 하나도 잡지 못했다는 뜻입니다. 이 세션은 아무 호출도 막지 못합니다.\n" +
      EXTERNAL_SCOPE_NOTE
    );
  if (summary.consumedCount === 0)
    return (
      "\n알림: 이 실행에서 녹화된 외부 호출이 하나도 재생되지 않았습니다.\n" +
      "→ 지원 범위 밖의 호출은 실제 네트워크로 나갔을 수 있습니다.\n" +
      EXTERNAL_SCOPE_NOTE
    );
  if (summary.unusedCount > 0)
    return (
      `\n알림: 녹화된 외부 호출 ${summary.interactionCount}건 중 ${summary.unusedCount}건이 이번 실행에서 재생되지 않았습니다.\n` +
      "→ 서버 코드나 실행 경로가 녹화 때와 달라졌을 수 있습니다.\n" +
      EXTERNAL_SCOPE_NOTE
    );
  return undefined;
}

/**
 * 세션 본문에 남은 URL 을 알린다(ADR-0062).
 *
 * **`externalSessionNotice` 와 축이 다르므로 따로 낸다.** 그쪽은 "무엇이 녹화·재생됐는가" 를
 * 배타적 갈래 하나로 말하는데, 이 알림은 "그 세션에 무엇이 남았는가" 라서 같은 실행에서 둘 다
 * 나갈 수 있다. 한 함수에 합치면 그쪽의 배타성 계약이 깨진다.
 *
 * **재생에는 나오지 않는다.** 이 판정은 녹화 경로에서만 돌고(ADR-0062), 재생은 이미 있는
 * 파일을 읽을 뿐이라 새로 남는 것이 없다.
 *
 * 개수만 말하고 **URL 도 그 일부도 싣지 않는다.** 알림이 새 유출 경로가 되면 고치려던 것을
 * 그 자리에서 다시 만든다 — ADR-0062 결정 3번이 그 방어이고, `record` 가 지문만 넘기는 것도
 * 같은 이유다. 사용자가 확인할 곳은 세션 파일이지 이 화면이 아니다.
 */
export function bodyUrlNotice(summary: SessionSummary): string | undefined {
  if (summary.mode !== "record") return undefined;
  const counts = summary.bodyUrls;
  if (counts === undefined) return undefined;
  const total = counts.echoed + counts.other;
  if (total === 0) return undefined;
  // 상한에 걸려 일부를 세지 못했으면 이 수는 **최소값**이다. "N건" 이라고 말하면 사용자는
  // 그 수를 다 확인하면 끝이라고 읽는다(ADR-0062).
  const count = (value: number): string => `${value}건${counts.truncated ? " 이상" : ""}`;
  const lines = [`\n알림: 세션 파일 본문에 URL 이 ${count(total)} 남아 있습니다.`];
  // 되돌아온 경로가 먼저다. 그쪽은 "우리가 지운 값이 되돌아왔다" 를 단정할 수 있고, 그 밖은
  // 단정할 수 없다 — 위험도가 아니라 확신도의 차이라 순서로만 나타낸다.
  if (counts.echoed > 0)
    lines.push(
      `  되돌아온 경로 ${count(counts.echoed)} — 이 실행의 요청 경로가 본문에 그대로 실렸습니다`,
    );
  if (counts.other > 0) lines.push(`  그 밖의 URL ${count(counts.other)}`);
  lines.push(
    "→ 경로 자체가 자격증명인 endpoint(Slack·Discord webhook 등)를 녹화했다면 그 값이 세션 파일에",
    "  원문으로 들어 있습니다. 이름으로 판정할 수 없는 자리라 마스킹이 닿지 않습니다.",
    "→ 커밋하기 전에 세션 파일 내용을 확인하세요. 이미 커밋했다면 그 자격증명을 폐기·재발급하세요.",
  );
  return `${lines.join("\n")}\n`;
}

/**
 * `test` 실행에 External Record/Replay 수명주기를 씌운다.
 *
 * Coordinator 를 **먼저 열고 마지막에 닫는다**(ADR-0052). 그 사이에 들어가는 것이 기존 실행
 * 전부라, 성공·실패·예외 어느 경로로 빠져나가도 `finish` 가 불려야 한다. 안 불리면 SQLite
 * 파일 핸들이 남고 Record 세션이 `running` 인 채로 남아 다음 실행이 이어 쓸 수 없다.
 *
 * 세션 옵션이 없으면 배선을 아예 만들지 않는다 — 기존 실행 경로가 한 글자도 달라지지 않는다.
 */
export async function runCli(
  argv: readonly string[],
  dependencies: TestCommandDependencies,
): Promise<number> {
  const mode = externalModeOf(argv);
  if (mode === undefined) return runCliCore(argv, dependencies);

  let wiring: ExternalWiring;
  try {
    wiring = await startExternalWiring({
      mode: mode.mode,
      sessionPath: mode.path,
      existingNodeOptions: process.env.NODE_OPTIONS,
    });
  } catch (error) {
    return writeFailure(dependencies, externalOpenFailure(mode.mode, mode.path, error));
  }

  let exitCode: number;
  try {
    exitCode = await runCliCore(argv, dependencies, wiring.env);
  } catch (error) {
    await wiring.finish("failed").catch(() => undefined);
    throw error;
  }

  try {
    // 실행이 실패했으면 세션도 실패다. 실패한 실행의 녹화를 완료로 닫으면 다음 Replay 가
    // 반쪽짜리 세션을 정상 원본으로 읽는다.
    const summary = await wiring.finish(exitCode === 0 ? "completed" : "failed");
    // 실행이 실패했을 때도 낸다. `exitCode === 0` 으로 좁히면 "외부 호출이 실패해서 0건" 이라는
    // 진짜 사고를 놓친다 — 실패 메시지 위에 한 줄 붙는 비용보다 그쪽이 크다(ADR-0057).
    // 무엇을 했는지가 먼저다(ADR-0066). 아래 진단·알림은 전부 "그런데 무엇이 이상한가" 라서,
    // 무엇을 한 실행인지 모르는 채로 읽으면 어느 것에 대한 지적인지 알 수 없다.
    const outcome = externalSessionOutcome(summary, mode.path);
    if (outcome !== undefined) dependencies.writeStderr(outcome);
    // 구조화된 진단을 먼저 보여준다 — 어느 호출이 왜 빠졌는지가 스코프 알림보다 더 구체적이다.
    if (summary.mode === "replay") {
      const missBlock = renderReplayMissDiagnostics(summary.misses);
      if (missBlock !== "") dependencies.writeStderr(missBlock);
    }
    const notice = externalSessionNotice(summary);
    if (notice !== undefined) dependencies.writeStderr(notice);
    // 재현 불가를 알리는 자리라 경고 갈래와 함께 나갈 수 있다(ADR-0068). 예컨대 일부 미재생
    // 경고와 범위 밖 유출은 동시에 참일 수 있고, 둘은 원인이 다르다.
    const leaked = outOfScopeNotice(summary);
    if (leaked !== undefined) dependencies.writeStderr(leaked);
    // 축이 다른 알림이라 위 갈래와 무관하게 낸다(ADR-0062). 마지막에 두는 것은 화면 하단이
    // 눈에 남기 때문이고, 이 알림은 커밋 전에 확인하라는 행동을 요구한다.
    const urls = bodyUrlNotice(summary);
    if (urls !== undefined) dependencies.writeStderr(urls);
  } catch (error) {
    return writeFailure(dependencies, externalCloseFailure(error));
  }
  return exitCode;
}

/**
 * argv 에서 External 모드를 정한다. **파싱은 `parseTestCommand` 하나만 한다.**
 *
 * 한때 여기서 argv 를 따로 훑었다. 그러면 토큰 소비 규칙이 두 벌이 되고, 두 벌은 갈라진다.
 * 실제로 갈렸다 — `--arg` 는 하이픈으로 시작하는 값을 의도적으로 받으므로
 *
 *     mcpeak test s.json --command node --arg --session=/tmp/x
 *
 * 에서 `parseTestCommand` 는 그 토큰을 **서버 인자**로 소비하는데, 따로 훑는 쪽은 같은 것을
 * replay 지시로 읽었다. 사용자가 요청한 적 없는 세션 파일이 열리고 Bootstrap 이 주입되며,
 * Replay 라 서버의 외부 호출이 전부 실패한다. 원인을 짐작할 방법이 없는 실패다.
 *
 * 파싱 오류는 여기서 삼킨다. 배선은 파싱보다 먼저 서지만 **오류 보고는 기존 경로의 몫**이다.
 * 여기서 던지면 `--session` 이 붙었다는 이유만으로 오류 문구가 달라진다.
 */
function externalModeOf(
  argv: readonly string[],
): { readonly mode: ExternalMode; readonly path: string } | undefined {
  if (argv[0] !== "test") return undefined;
  let input: TestCommandInput;
  try {
    input = parseTestCommand(argv.slice(1));
  } catch {
    return undefined;
  }
  if (input.recordSessionPath !== undefined)
    return { mode: "record", path: input.recordSessionPath };
  if (input.sessionPath !== undefined) return { mode: "replay", path: input.sessionPath };
  return undefined;
}

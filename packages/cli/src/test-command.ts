import { extname } from "node:path";
import type { McpStdioConnection } from "@mcpeak/core";
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
  TestSuiteSpec,
} from "@mcpeak/runner";
import {
  describeDeterminismDifference,
  describeSpecFinding,
  checkAssertionSubstance as runnerCheckAssertionSubstance,
  checkDeterminism as runnerCheckDeterminism,
  checkInputContract as runnerCheckInputContract,
} from "@mcpeak/runner";
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
  readonly command: string;
  readonly args: readonly string[];
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
  let json = false;
  let junitPath: string | undefined;
  let repairBundlePath: string | undefined;
  let determinism = false;
  let resetCmd: string | undefined;
  let stderrLines: number | undefined;
  let sessionPath: string | undefined;
  let recordSessionPath: string | undefined;
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
  if (command === undefined)
    throw new CliCommandError({
      code: "CLI_USAGE",
      message: "`--command` 옵션이 필요합니다.",
      hint: TEST_USAGE_HINT,
    });
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
    command,
    args: Object.freeze(args),
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
      "  (이전 실행이 남긴 상태·잠금·포트 점유 등).\n";
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
    `${blocks}\n`
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
function junitWriteFailure(path: string, error: unknown): CliFailure {
  const code = (error as { code?: unknown } | null)?.code;
  const errno = typeof code === "string" || typeof code === "number" ? String(code) : "알 수 없음";
  return {
    code: "JUNIT_WRITE_FAILED",
    message:
      `JUnit XML 파일을 쓰지 못했습니다: ${escapeTerminalText(path)}\n` +
      `  errno: ${escapeTerminalText(errno)}`,
    hint: dictionary.JUNIT_WRITE_FAILED.hint,
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
}>;
/** AggregateError 내부까지 내려가 core 오류와 검증된 프로세스 진단을 꺼낸다. */
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
async function runCliCore(
  argv: readonly string[],
  dependencies: TestCommandDependencies,
  childEnv?: Readonly<Record<string, string>>,
): Promise<number> {
  if (argv.length === 0)
    return writeFailure(dependencies, {
      code: "CLI_USAGE",
      message: "실행할 CLI 명령이 없습니다.",
      hint: TEST_USAGE_HINT,
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
  let connection: McpStdioConnection;
  try {
    connection = await dependencies.connect({
      command: input.command,
      args: input.args,
      ...(childEnv === undefined ? {} : { env: childEnv }),
    });
  } catch (error) {
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
    const snapshotOf = (target: McpStdioConnection): ProcessDiagnosticsInput | undefined => {
      try {
        return target.getDiagnostics();
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
    let second: McpStdioConnection;
    try {
      second = await dependencies.connect({
        command: input.command,
        args: input.args,
        ...(childEnv === undefined ? {} : { env: childEnv }),
      });
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
      } catch {
        // 전부 통과여도 1 이다. 조용히 0 을 내면 CI 는 번들 없이 초록이 되고, 사용자는 파일이
        // 없다는 것을 한참 뒤에야 안다. JUnit 쓰기도 실패했을 수 있으므로 여기서 반환하지 않고
        // 두 산출물 오류를 모두 보고한다. 원인이 로컬 I/O 이므로 진단은 쓰지 않는다.
        deferredRepairBundleFailure = {
          code: "REPAIR_BUNDLE_WRITE_FAILED",
          ...dictionary.REPAIR_BUNDLE_WRITE_FAILED,
        };
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
    // 구조화된 진단을 먼저 보여준다 — 어느 호출이 왜 빠졌는지가 스코프 알림보다 더 구체적이다.
    if (summary.mode === "replay") {
      const missBlock = renderReplayMissDiagnostics(summary.misses);
      if (missBlock !== "") dependencies.writeStderr(missBlock);
    }
    const notice = externalSessionNotice(summary);
    if (notice !== undefined) dependencies.writeStderr(notice);
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

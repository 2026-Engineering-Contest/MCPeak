import type { McpClient } from "@ohmymcp/core";
import type { Cassette } from "@ohmymcp/record";
import { cassetteClient, matchKey, REDACTED } from "@ohmymcp/record";
import type {
  FinalizeRunnerExecutionOptions,
  RunnerExecution,
  RunnerReport,
  RunSuiteOptions,
  SuiteValidationIssue,
  SuiteValidationResult,
  TestSuiteSpec,
} from "@ohmymcp/runner";
import { REPLAY_USAGE_HINT } from "./help.js";

export interface ReplayCommandInput {
  readonly suitePath: string;
  readonly cassettePath: string;
}

export type ReplayErrorCode =
  | "CLI_USAGE"
  | "SUITE_FORMAT_UNSUPPORTED"
  | "SUITE_READ_FAILED"
  | "SUITE_ENCODING_INVALID"
  | "SUITE_JSON_INVALID"
  | "SUITE_VALIDATION_FAILED"
  | "CASSETTE_NOT_FOUND"
  | "CASSETTE_READ_FAILED"
  | "CASSETTE_INCOMPLETE"
  | "RUNNER_EXECUTION_FAILED"
  | "RUNNER_FINALIZATION_FAILED";

export interface ReplayFailure {
  readonly code: ReplayErrorCode;
  readonly message: string;
  readonly hint: string;
  readonly issues?: readonly SuiteValidationIssue[];
}

/**
 * `connect` 가 없다. replay 가 서버를 띄우지 않는다는 것이 주석이 아니라 타입에 드러난다.
 * ADR-0028.
 */
export interface ReplayCommandDependencies {
  readFile(path: string): Promise<Uint8Array>;
  validateSuite(input: unknown): SuiteValidationResult;
  loadCassette(path: string): Promise<Cassette | null>;
  startRunner(options: RunSuiteOptions): RunnerExecution;
  finalize(options: FinalizeRunnerExecutionOptions): Promise<RunnerReport>;
  renderReport(report: RunnerReport, options?: { color?: boolean }): string;
  colorEnabled: boolean;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

/**
 * 명세 로드 실패 문안은 `test-command.ts` 의 `dictionary` 와 같은 값이다. 두 커맨드가 같은
 * 파일을 같은 이유로 거절하므로 문장이 갈리면 안 된다. 지금 복제인 것은 그 표가 module-private
 * 이기 때문이고, 공용 모듈로 빼는 것은 `test` 서브커맨드 소유자와 합의가 필요한 별도 작업이다.
 */
const dictionary: Record<Exclude<ReplayErrorCode, "CLI_USAGE">, Omit<ReplayFailure, "code">> = {
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
  CASSETTE_NOT_FOUND: {
    message: "카세트 파일이 없습니다.",
    hint: "`ohmymcp generate --cassette <path> --record` 로 먼저 녹화하세요.",
  },
  CASSETTE_READ_FAILED: {
    message: "카세트를 읽지 못했습니다.",
    hint: "카세트 파일이 손상되지 않았는지 확인하고, 필요하면 --record 로 다시 녹화하세요.",
  },
  CASSETTE_INCOMPLETE: {
    message: "카세트에 이 명세의 응답이 모두 들어 있지 않습니다.",
    hint: "명세를 고쳤다면 `ohmymcp generate --cassette <path> --record` 로 다시 녹화하세요.",
  },
  RUNNER_EXECUTION_FAILED: {
    message: "Runner 실행을 시작하지 못했습니다.",
    hint: "테스트 명세와 카세트가 같은 서버에서 나온 것인지 확인하세요.",
  },
  RUNNER_FINALIZATION_FAILED: {
    message: "Runner 실행을 마치지 못했습니다.",
    hint: "카세트에 필요한 응답이 모두 들어 있는지 확인하세요.",
  },
};

class ReplayCommandError extends Error {
  constructor(readonly failure: ReplayFailure) {
    super(failure.message);
  }
}

const usage = (message: string): never => {
  throw new ReplayCommandError({ code: "CLI_USAGE", message, hint: REPLAY_USAGE_HINT });
};

/** replay 에서 의미가 없는 옵션. 조용히 무시하지 않고 거절한다. ADR-0028. */
const SERVER_ONLY_OPTIONS = new Set(["--command", "--arg", "--stderr-lines"]);

export function parseReplayCommand(argv: readonly string[]): ReplayCommandInput {
  let suitePath: string | undefined;
  let cassettePath: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? "";
    const [name] = token.startsWith("--") ? token.split("=", 1) : [token];
    if (SERVER_ONLY_OPTIONS.has(name ?? ""))
      usage(`replay 는 서버를 띄우지 않습니다. ${name} 는 test 명령에서 쓰세요.`);
    if (token === "--cassette" || token.startsWith("--cassette=")) {
      const value = token.startsWith("--cassette=")
        ? token.slice("--cassette=".length)
        : argv[++index];
      if (value === undefined || value === "")
        usage("--cassette 에 카세트 파일 경로가 필요합니다.");
      cassettePath = value;
      continue;
    }
    if (token.startsWith("--")) usage(`알 수 없는 옵션입니다: ${token}`);
    if (suitePath !== undefined) usage(`테스트 명세는 하나만 받습니다: ${token}`);
    suitePath = token;
  }

  if (suitePath === undefined || suitePath === "") usage("테스트 명세 JSON 경로가 필요합니다.");
  if (cassettePath === undefined) usage("--cassette 에 재생할 카세트 파일 경로가 필요합니다.");
  return Object.freeze({ suitePath: suitePath as string, cassettePath: cassettePath as string });
}

/**
 * 실서버 자리를 채우는 오프라인 클라이언트. replay 모드의 `cassetteClient` 는 `listTools` 와
 * `callTool` 을 가로채므로 이 둘은 도달 불가다. 조용히 빈 값을 돌려주면 모드가 새어도 화면이
 * 정상처럼 보이므로 던진다. ADR-0028.
 */
const offlineClient: McpClient = {
  async listTools() {
    throw new Error("replay 는 MCP 서버를 호출하지 않습니다.");
  },
  async callTool() {
    throw new Error("replay 는 MCP 서버를 호출하지 않습니다.");
  },
  async close() {},
};

/**
 * 카세트가 이 명세를 덮는지 실행 전에 확인한다.
 *
 * 재생 중에 나는 미스는 `record` 가 어느 필드가 다른지까지 적어 주지만, 그 문장이 화면까지
 * 오지 못한다. `runner` 가 호출 실패를 `OPERATION_FAILED` 로 감싸면서 "MCP 서버 프로세스와
 * 연결 상태를 확인하세요" 로 바꾸기 때문이다. replay 에는 확인할 서버가 없으므로 그 안내는
 * 사용자를 없는 곳으로 보낸다. 그래서 시작 전에 우리가 말한다.
 */
function missingFromCassette(suite: TestSuiteSpec, cassette: Cassette): string[] {
  const keys = new Set(cassette.interactions.map((interaction) => interaction.key));
  const missing: string[] = [];
  for (const testCase of suite.cases) {
    if (testCase.operation.type === "listTools") {
      if (cassette.tools === undefined) missing.push(`${testCase.id}: listTools 응답`);
      continue;
    }
    const { tool, input } = testCase.operation;
    if (!keys.has(matchKey(tool, input)))
      missing.push(`${testCase.id}: ${tool}(${JSON.stringify(input)})`);
  }
  return missing;
}

/** 경고 한 줄이 화면을 덮지 않도록 상한을 둔다. */
const MAX_REDACTED_PATHS = 5;

/**
 * 마스킹된 값의 JSON 경로를 모은다. 판정이 읽는 자리는 `response.content` 하나이므로 거기만 본다.
 * 값이 JSON 문자열이면 그 안까지 들어간다 — 카세트가 문자열 본문도 구조화해 마스킹하기 때문이다.
 */
function redactedPaths(cassette: Cassette): string[] {
  const found: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (found.length >= MAX_REDACTED_PATHS) return;
    if (typeof value === "string") {
      if (value === REDACTED) found.push(path);
      else if (value.includes(REDACTED)) {
        try {
          visit(JSON.parse(value) as unknown, path);
        } catch {
          found.push(path);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) visit(item, `${path}[${index}]`);
      return;
    }
    if (typeof value === "object" && value !== null)
      for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`);
  };
  for (const [index, interaction] of cassette.interactions.entries())
    visit(interaction.response.content, `interactions[${index}].response.content`);
  return found;
}

const format = (failure: ReplayFailure): string => {
  const issues = (failure.issues ?? []).map(
    (issue) => `\n- [${issue.code}] ${issue.path}: ${issue.message}`,
  );
  return `오류 [${failure.code}]: ${failure.message}${issues.join("")}\n해결: ${failure.hint}\n`;
};

const writeFailure = (dependencies: ReplayCommandDependencies, failure: ReplayFailure): number => {
  dependencies.writeStderr(format(failure));
  return 1;
};

export async function runReplayCommand(
  argv: readonly string[],
  dependencies: ReplayCommandDependencies,
): Promise<number> {
  let input: ReplayCommandInput;
  try {
    input = parseReplayCommand(argv);
  } catch (error) {
    if (error instanceof ReplayCommandError) return writeFailure(dependencies, error.failure);
    throw error;
  }

  if (!input.suitePath.toLowerCase().endsWith(".json"))
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

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return writeFailure(dependencies, {
      code: "SUITE_ENCODING_INVALID",
      ...dictionary.SUITE_ENCODING_INVALID,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return writeFailure(dependencies, {
      code: "SUITE_JSON_INVALID",
      ...dictionary.SUITE_JSON_INVALID,
    });
  }

  const validated = dependencies.validateSuite(parsed);
  if (!validated.valid)
    return writeFailure(dependencies, {
      code: "SUITE_VALIDATION_FAILED",
      ...dictionary.SUITE_VALIDATION_FAILED,
      issues: validated.issues,
    });

  let cassette: Cassette | null;
  try {
    cassette = await dependencies.loadCassette(input.cassettePath);
  } catch {
    return writeFailure(dependencies, {
      code: "CASSETTE_READ_FAILED",
      ...dictionary.CASSETTE_READ_FAILED,
    });
  }
  if (cassette === null)
    return writeFailure(dependencies, {
      code: "CASSETTE_NOT_FOUND",
      message: `카세트 파일이 없습니다: ${input.cassettePath}`,
      hint: dictionary.CASSETTE_NOT_FOUND.hint,
    });

  const missing = missingFromCassette(validated.value, cassette);
  if (missing.length > 0)
    return writeFailure(dependencies, {
      code: "CASSETTE_INCOMPLETE",
      message: [
        `카세트에 없는 케이스가 ${missing.length}개 있습니다: ${input.cassettePath}`,
        ...missing.map((item) => `  ${item}`),
      ].join("\n"),
      hint: dictionary.CASSETTE_INCOMPLETE.hint,
    });

  /**
   * 마스킹된 값은 판정을 바꿀 수 있다. 거부하지 않고 알린다 — 대부분의 카세트는 마스킹 대상이
   * 없어 재생이 라이브와 정확히 일치한다. ADR-0028.
   */
  const redacted = redactedPaths(cassette);
  if (redacted.length > 0)
    dependencies.writeStderr(
      [
        "→ 카세트에 마스킹된 값이 있습니다. 이 자리의 판정은 실제 서버와 다를 수 있습니다.",
        ...redacted.map((path) => `  ${path}`),
        "  → 이 케이스의 결과를 근거로 쓰기 전에 test 명령으로 한 번 확인하세요.",
        "",
      ].join("\n"),
    );

  const client = cassetteClient(offlineClient, {
    cassette,
    mode: "replay",
    cassettePath: input.cassettePath,
  });

  let execution: RunnerExecution;
  try {
    execution = dependencies.startRunner({ client, suite: validated.value });
  } catch {
    return writeFailure(dependencies, {
      code: "RUNNER_EXECUTION_FAILED",
      ...dictionary.RUNNER_EXECUTION_FAILED,
    });
  }

  let report: RunnerReport;
  try {
    // shutdown 의 client 는 startRunner 에 넘긴 것과 같은 참조여야 한다. runner/src/shutdown.ts
    // 가 동일성을 검사한다. 닫을 프로세스가 없으므로 forceClose 도 같은 close 를 부른다.
    report = await dependencies.finalize({
      execution,
      shutdown: { client, close: () => client.close(), forceClose: () => client.close() },
    });
  } catch {
    return writeFailure(dependencies, {
      code: "RUNNER_FINALIZATION_FAILED",
      ...dictionary.RUNNER_FINALIZATION_FAILED,
    });
  }

  dependencies.writeStdout(dependencies.renderReport(report, { color: dependencies.colorEnabled }));
  return report.status === "passed" ? 0 : 1;
}

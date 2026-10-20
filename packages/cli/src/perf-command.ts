/**
 * `mcpeak perf` 서브커맨드. 명세의 callTool 케이스를 실제 입력으로 반복 호출해 응답 시간을 외부
 * HTTP 대기와 서버 안 시간으로 나누고, 기준선이 있으면 회귀를 판정한다(설계 §3, §7, §8.4~§8.6).
 *
 * 대상 옵션의 해석은 `test` 의 `parseTestCommand` 를 쓴다. 다만 `--url`·`--header-env` 는 다른
 * 어떤 검사보다 먼저 거절한다. 측정은 서버 프로세스 안에 관측 코드를 실어야 하는데 우리가 띄우지
 * 않은 프로세스에는 실을 수 없기 때문이다.
 *
 * 명세 오류와 연결 실패 문장은 `test-command.ts`·`optimize-command.ts` 의 비공개 함수가 만든다.
 * 그 파일은 다른 서브커맨드의 것이라 export 를 위해 고치지 않고 같은 문장을 여기서 만든다.
 * 어긋나면 perf-command.test.ts 의 동등성 테스트가 잡는다(설계 §8.5).
 *
 * `@mcpeak/perf` 를 값으로 import 하지 않는다. 정적으로 import 하면 `test` 경로가 그 패키지를
 * 함께 로드한다. 의존성 주입 형태는 `optimize-command.ts` 를 따른다.
 */
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { McpStdioConnection, ToolDef } from "@mcpeak/core";
import type { PerfBaseline, PerfCall, PerfPlan, PerfReport } from "@mcpeak/perf";
import type { SuiteValidationIssue, SuiteValidationResult, TestSuiteSpec } from "@mcpeak/runner";
import {
  type CliConnection,
  type ConnectTarget,
  ConnectTargetError,
  describeTarget,
  openConnection,
} from "./connect-target.js";
import { PERF_USAGE_HINT } from "./help.js";
import { httpDiagnostics, renderHttpDiagnostics } from "./http-diagnostics.js";
import {
  hasDiagnosticContent,
  processDiagnostics,
  renderProcessDiagnostics,
} from "./process-diagnostics.js";
import { escapeTerminalText } from "./repair-render.js";
import { parseTestCommand } from "./test-command.js";

export interface PerfCommandInput {
  readonly suitePath: string;
  readonly target: ConnectTarget;
  readonly repeat: number;
  readonly intervalMs: number;
  /** `--tool` 을 준 순서. 비어 있으면 거르지 않는다. */
  readonly tools: readonly string[];
  readonly baselinePath?: string;
  readonly updateBaseline: boolean;
  readonly thresholdPct: number;
  readonly thresholdMs: number;
  readonly json: boolean;
}

/** 측정 동안 가로채는 종료 신호(계획 E25). SIGHUP 은 터미널을 닫을 때 온다. */
export type PerfSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

export interface PerfCommandDependencies {
  connectStdio(options: {
    command: string;
    args: readonly string[];
    env?: Readonly<Record<string, string>>;
  }): Promise<McpStdioConnection>;
  readEnv(name: string): string | undefined;
  /** test 의 주입점과 같은 바이트 반환. 명세 인코딩 오류 문장을 test 와 같게 내려면 바이트가 필요하다. */
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, text: string): Promise<void>;
  makeTempDir(prefix: string): Promise<string>;
  removeDir(path: string): Promise<void>;
  /** 신호 처리기 안에서 쓴다. 재발신 뒤에는 비동기 작업이 끝나지 못하므로 동기로 지운다. */
  removeDirSync(path: string): void;
  /** SIGINT·SIGTERM·SIGHUP 처리기를 단다. 돌려준 함수가 셋 다 뗀다. */
  onSignal(handler: (signal: PerfSignal) => Promise<void>): () => void;
  /** 처리기를 뗀 뒤 부른다. 같은 신호로 이 프로세스를 다시 끝내 셸이 신호 종료(130 등)를 본다. */
  killSelf(signal: PerfSignal): void;
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  readonly validateSuite: typeof import("@mcpeak/runner").validateMcpSuite;
  readonly perf: Pick<
    typeof import("@mcpeak/perf"),
    | "measure"
    | "readTrace"
    | "analyze"
    | "compareBaseline"
    | "toBaseline"
    | "parseBaseline"
    | "renderReport"
    | "childEnvironment"
  >;
  /** 리포트의 generator.version. `@mcpeak/perf` 의 패키지 버전. 읽는 방식은 optimize 와 같다. */
  readonly generatorVersion: string;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

/** 서버 연결 stderr 진단의 줄 수. `test` 의 `--stderr-lines` 기본값과 같다. */
const STDERR_LINES = 20;
/** 케이스에도 명세에도 타임아웃이 없을 때. `runner` 실행기와 같은 값이다(설계 §3.2 5항). */
const DEFAULT_TIMEOUT_MS = 10_000;
/** 추적 디렉터리 접두(설계 §8.6). */
const TRACE_DIR_PREFIX = "mcpeak-perf-";

const NO_OBSERVATION_HINT = "→ Node 서버인지, NODE_OPTIONS 가 서버까지 전달되는지 확인하세요.";

class UsageError extends Error {
  constructor(
    message: string,
    readonly hint: string = PERF_USAGE_HINT,
  ) {
    super(message);
  }
}

/** 원격 대상 거절. 해결 줄이 사용법 전체가 아니라 바로 쓸 수 있는 명령 모양이다(설계 §8.5). */
class RemoteTargetError extends Error {}

/** `test` 는 받지만 perf 에는 뜻이 없는 옵션. 넘기면 "test 옵션" 이라는 남의 이름으로 거절된다. */
const TEST_ONLY_OPTIONS = new Set([
  "--junit",
  "--repair-bundle",
  "--determinism",
  "--reset-cmd",
  "--stderr-lines",
  "--session",
  "--record-session",
]);
/** 대상 옵션 중 값을 다음 토큰으로 받는 것. 그 값이 `--junit` 처럼 생겨도 옵션으로 읽지 않는다. */
const TARGET_VALUE_OPTIONS = new Set(["--command", "--arg", "--env"]);
const REMOTE_OPTIONS = new Set(["--url", "--header-env"]);

/** 값을 받는 숫자 옵션과 범위(설계 §8.4). */
const NUMBER_OPTIONS = {
  "--repeat": { min: 1, max: 100, fallback: 5 },
  "--interval-ms": { min: 0, max: 60_000, fallback: 0 },
  "--threshold-pct": { min: 0, max: 1000, fallback: 50 },
  "--threshold-ms": { min: 0, max: 60_000, fallback: 20 },
} as const;
type NumberOption = keyof typeof NUMBER_OPTIONS;
const isNumberOption = (name: string): name is NumberOption => name in NUMBER_OPTIONS;

function optionName(token: string): string {
  return token.startsWith("--") && token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
}

export function parsePerfCommand(argv: readonly string[]): PerfCommandInput {
  // `--` 앞의 토큰 전체에서 원격 옵션을 먼저 찾는다. 위치 인자 검사보다 먼저라 명세 경로 자리에
  // `--url` 이 와도 같은 문장이 나온다(설계 §3.1). `--` 뒤는 서버 명령이라 훑지 않는다.
  const separator = argv.indexOf("--");
  const head = separator === -1 ? argv : argv.slice(0, separator);
  if (head.some((token) => REMOTE_OPTIONS.has(optionName(token)))) throw new RemoteTargetError();

  const numbers = new Map<NumberOption, number>();
  const tools: string[] = [];
  let baselinePath: string | undefined;
  let updateBaseline = false;
  let json = false;
  const positionals: string[] = [];
  const targetArgv: string[] = [];

  const readValue = (token: string, name: string, index: number) => {
    const value = token === name ? argv[index + 1] : token.slice(`${name}=`.length);
    // 값 자리의 플래그는 값을 빠뜨린 오타다. `--json` 이라는 이름의 파일을 만들라는 뜻이 아니다.
    if (value === undefined || value.trim() === "" || value.startsWith("--"))
      throw new UsageError(`\`${name}\` 옵션 값이 필요합니다.`);
    return { value, next: token === name ? index + 1 : index };
  };
  const once = (name: string, seen: boolean) => {
    if (seen) throw new UsageError(`\`${name}\`은 한 번만 사용할 수 있습니다.`);
  };
  const flag = (token: string, name: string) => {
    if (token !== name) throw new UsageError(`\`${name}\`은 값을 받지 않습니다.`);
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string;
    if (token === "--") {
      targetArgv.push(...argv.slice(index));
      break;
    }
    const name = optionName(token);
    if (isNumberOption(name)) {
      once(name, numbers.has(name));
      const { value, next } = readValue(token, name, index);
      index = next;
      const { min, max } = NUMBER_OPTIONS[name];
      const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
      if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
        throw new UsageError(
          `\`${name}\` 는 ${min} 이상 ${max} 이하의 정수여야 합니다. 받은 값: '${escapeTerminalText(value)}'`,
        );
      numbers.set(name, parsed);
      continue;
    }
    if (name === "--tool") {
      const { value, next } = readValue(token, name, index);
      index = next;
      tools.push(value);
      continue;
    }
    if (name === "--baseline") {
      once(name, baselinePath !== undefined);
      const { value, next } = readValue(token, name, index);
      index = next;
      baselinePath = value;
      continue;
    }
    if (name === "--update-baseline") {
      flag(token, name);
      once(name, updateBaseline);
      updateBaseline = true;
      continue;
    }
    if (name === "--json") {
      flag(token, name);
      once(name, json);
      json = true;
      continue;
    }
    if (TEST_ONLY_OPTIONS.has(name) || (token.startsWith("-") && !TARGET_VALUE_OPTIONS.has(name)))
      throw new UsageError(`지원하지 않는 perf 옵션 '${escapeTerminalText(name)}'입니다.`);
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    targetArgv.push(token);
    if (TARGET_VALUE_OPTIONS.has(token) && index + 1 < argv.length) {
      targetArgv.push(argv[++index] as string);
    }
  }

  if (updateBaseline && baselinePath === undefined)
    throw new UsageError("--update-baseline 은 --baseline <path> 와 함께 써야 합니다.");
  // 일부 케이스로 기준을 덮어쓰면 기준에서 나머지 케이스가 빠진다(설계 §8.5, 계획 E26).
  if (updateBaseline && tools.length > 0)
    throw new UsageError(
      "--update-baseline 은 --tool 과 함께 쓸 수 없습니다. 기준은 명세 전체로 갱신합니다.",
    );

  // 첫 위치 인자가 명세 경로다. 남은 위치 인자는 `parseTestCommand` 가 test 와 같은 문장으로 거절한다.
  const [suitePath, ...rest] = positionals;
  let target: ConnectTarget;
  try {
    target = parseTestCommand([suitePath ?? "", ...rest, ...targetArgv]).target;
  } catch (error) {
    // 대상 문장은 connect-target·test 의 것을 그대로 쓰고, 해결 줄만 이 명령의 사용법으로 바꾼다.
    const message = usageMessageOf(error);
    if (message === undefined) throw error;
    throw new UsageError(message);
  }
  const number = (name: NumberOption) => numbers.get(name) ?? NUMBER_OPTIONS[name].fallback;
  return Object.freeze({
    suitePath: suitePath as string,
    target,
    repeat: number("--repeat"),
    intervalMs: number("--interval-ms"),
    tools: Object.freeze([...tools]),
    ...(baselinePath === undefined ? {} : { baselinePath }),
    updateBaseline,
    thresholdPct: number("--threshold-pct"),
    thresholdMs: number("--threshold-ms"),
    json,
  });
}

/** `parseTestCommand` 가 던진 사용 오류의 문장. 그 오류 클래스는 export 되지 않아 모양으로 본다. */
function usageMessageOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("failure" in error)) return undefined;
  const failure = (error as { failure: unknown }).failure;
  if (typeof failure !== "object" || failure === null) return undefined;
  const { code, message } = failure as { code?: unknown; message?: unknown };
  return code === "CLI_USAGE" && typeof message === "string" ? message : undefined;
}

function usageFailure(deps: PerfCommandDependencies, message: string, hint: string): number {
  deps.writeStderr(`오류 [CLI_USAGE]: ${message}\n해결: ${hint}\n`);
  return 1;
}

/** `test` 의 실패 한 덩어리. 문장은 test-command.ts 의 같은 이름 함수들과 글자 단위로 같아야 한다. */
interface SuiteFailure {
  readonly code: string;
  readonly message: string;
  readonly hint: string;
  readonly issues?: readonly SuiteValidationIssue[];
}

function writeSuiteFailure(deps: PerfCommandDependencies, failure: SuiteFailure): number {
  let text = `오류 [${escapeTerminalText(failure.code)}]: ${failure.message}\n해결: ${failure.hint}`;
  for (const issue of failure.issues ?? [])
    text += `\n- [${escapeTerminalText(issue.code)}] ${escapeTerminalText(issue.path)}: ${escapeTerminalText(issue.message)}\n  해결: ${escapeTerminalText(issue.hint)}`;
  deps.writeStderr(`${text}\n`);
  return 1;
}

function errnoOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "알 수 없음";
}

function suiteReadFailure(path: string, error: unknown): SuiteFailure {
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
    message: `테스트 명세 파일을 읽지 못했습니다: ${shown}\n  errno: ${escapeTerminalText(errno)}`,
    hint: "명세 경로와 읽기 권한을 확인하세요.",
  };
}

function suiteFormatFailure(path: string): SuiteFailure {
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

const INTERNAL_FAILURE: SuiteFailure = {
  code: "CLI_INTERNAL_ERROR",
  message: "예상하지 못한 CLI 내부 오류가 발생했습니다.",
  hint: "다시 실행한 뒤 재현 정보와 함께 이슈를 보고하세요.",
};

/** 명세를 읽고 검증한다. 순서와 문장은 test 와 같다(설계 §3.2 1항, §8.5). */
async function loadSuite(
  path: string,
  deps: PerfCommandDependencies,
): Promise<TestSuiteSpec | SuiteFailure> {
  if (extname(path).toLowerCase() !== ".json") return suiteFormatFailure(path);
  let bytes: Uint8Array;
  try {
    bytes = await deps.readFile(path);
  } catch (error) {
    return suiteReadFailure(path, error);
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      code: "SUITE_ENCODING_INVALID",
      message: `테스트 명세 파일이 유효한 UTF-8이 아닙니다: ${escapeTerminalText(path)}`,
      hint: "명세를 UTF-8 JSON으로 다시 저장하세요.",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      code: "SUITE_JSON_INVALID",
      message:
        `테스트 명세의 JSON 문법이 유효하지 않습니다: ${escapeTerminalText(path)}\n` +
        `  ${escapeTerminalText(reason)}`,
      hint: "JSON 문법과 쉼표, 따옴표를 확인하세요.",
    };
  }
  let validated: SuiteValidationResult;
  try {
    validated = deps.validateSuite(parsed);
  } catch {
    return INTERNAL_FAILURE;
  }
  if (!validated.valid)
    return {
      code: "SUITE_VALIDATION_FAILED",
      message: "MCP 테스트 명세가 유효하지 않습니다.",
      hint: "아래 명세 오류를 모두 수정하세요.",
      issues: validated.issues,
    };
  return validated.value;
}

/**
 * 측정 대상은 callTool 케이스 중 `{ type: "isError", expected: true }` 단언이 없는 것이다. 거절을
 * 기대하는 케이스는 거절 경로의 시간이라 뺀다(설계 §3.1). 타임아웃 우선순위는 runner 실행기와 같다.
 */
function planOf(suite: TestSuiteSpec, input: PerfCommandInput): PerfPlan {
  const calls: PerfCall[] = [];
  for (const spec of suite.cases) {
    if (spec.operation.type !== "callTool") continue;
    const operation = spec.operation;
    if (spec.assertions.some((a) => a.type === "isError" && a.expected === true)) continue;
    if (input.tools.length > 0 && !input.tools.includes(operation.tool)) continue;
    calls.push({
      caseId: spec.id,
      tool: operation.tool,
      input: operation.input,
      timeoutMs: spec.timeoutMs ?? suite.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }
  return { calls, repeat: input.repeat, intervalMs: input.intervalMs };
}

function isPerfError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    error.name === "PerfError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

/**
 * 기준 파일을 측정 전에 읽는다. 측정을 다 하고 나서 기준 파일 오타로 결과를 버리지 않기 위해서다
 * (설계 §8.5). 없음은 CLI 가 `ENOENT` 로 판정한다.
 */
async function loadBaseline(
  path: string,
  deps: PerfCommandDependencies,
): Promise<PerfBaseline | string> {
  const invalid = (reason: string) =>
    `오류 [PERF_BASELINE_INVALID]: 기준 파일을 읽을 수 없습니다: ${escapeTerminalText(path)} (${reason})\n` +
    "→ mcpeak perf 가 쓴 파일인지 확인하고, 아니면 --update-baseline 으로 다시 만드세요.\n";
  let bytes: Uint8Array;
  try {
    bytes = await deps.readFile(path);
  } catch (error) {
    if (errnoOf(error) === "ENOENT")
      return (
        `오류 [PERF_BASELINE_MISSING]: 기준 파일이 없습니다: ${escapeTerminalText(path)}\n` +
        "→ 처음이면 --update-baseline 을 함께 주어 기준을 만드세요.\n"
      );
    return invalid(escapeTerminalText(errnoOf(error)));
  }
  try {
    return deps.perf.parseBaseline(new TextDecoder("utf-8").decode(bytes));
  } catch (error) {
    if (isPerfError(error)) return invalid(escapeTerminalText(error.message));
    throw error;
  }
}

export async function runPerfCommand(
  argv: readonly string[],
  deps: PerfCommandDependencies,
): Promise<number> {
  let input: PerfCommandInput;
  try {
    input = parsePerfCommand(argv[0] === "perf" ? argv.slice(1) : argv);
  } catch (error) {
    if (error instanceof RemoteTargetError) {
      deps.writeStderr(
        "오류 [CLI_USAGE]: perf 는 원격(Streamable HTTP) 서버를 지원하지 않습니다.\n" +
          "→ 측정은 서버 프로세스 안에 관측 코드를 실어야 하는데, 우리가 띄우지 않은 프로세스에는 실을 수 없습니다.\n" +
          "해결: mcpeak perf <suite.json> -- <서버 명령>\n",
      );
      return 1;
    }
    if (!(error instanceof UsageError)) throw error;
    return usageFailure(deps, error.message, error.hint);
  }

  const suite = await loadSuite(input.suitePath, deps);
  if ("code" in suite) return writeSuiteFailure(deps, suite);

  const plan = planOf(suite, input);
  if (plan.calls.length === 0) {
    if (input.tools.length > 0)
      return usageFailure(
        deps,
        `--tool ${input.tools.map(escapeTerminalText).join(", ")} 에 해당하는 측정 케이스가 없습니다.`,
        "명세의 operation.tool 값과 --tool 값을 맞추세요.",
      );
    return usageFailure(
      deps,
      "측정할 케이스가 없습니다. 명세의 callTool 케이스 중 거절(isError: true)을 기대하지 않는 것이 없습니다.",
      "mcpeak generate 로 성공 케이스를 만들거나 명세를 확인하세요.",
    );
  }

  let baseline: PerfBaseline | undefined;
  if (input.baselinePath !== undefined && !input.updateBaseline) {
    const loaded = await loadBaseline(input.baselinePath, deps);
    if (typeof loaded === "string") {
      deps.writeStderr(loaded);
      return 1;
    }
    // `--tool` 로 뺀 케이스가 "이번 명세에 없습니다" 로 보이지 않게 기준을 이번 plan 으로 좁힌다.
    // `--tool` 이 없으면 좁히지 않아, 명세에서 실제로 사라진 케이스는 그 줄을 낸다(설계 §7.3, 계획 E26).
    if (input.tools.length > 0) {
      const planned = new Set(plan.calls.map((call) => call.caseId));
      baseline = { ...loaded, cases: loaded.cases.filter((row) => planned.has(row.id)) };
    } else {
      baseline = loaded;
    }
  }

  // 여기부터 만든 추적 디렉터리는 어느 경로로 끝나든 지운다. 남으면 요청 헤더·본문이 임시
  // 디렉터리에 남는다(설계 §3.2 8항). SIGINT·SIGTERM·SIGHUP 은 finally 를 거치지 않으므로 처리기가
  // 연결을 닫고 지운 뒤 같은 신호로 다시 끝낸다(계획 E25).
  const traceDir = await deps.makeTempDir(join(tmpdir(), TRACE_DIR_PREFIX));
  const session: MeasureSession = {};
  let detachSignals: (() => void) | undefined;
  const detach = () => {
    detachSignals?.();
    detachSignals = undefined;
  };
  detachSignals = deps.onSignal(async (signal) => {
    // 두 번째 신호는 닫기를 기다리지 않는다. 닫기가 멈춰도 사용자가 빠져나갈 수 있어야 한다.
    if (session.interrupted === undefined) {
      session.interrupted = signal;
      const connection = session.connection;
      if (connection !== undefined) await closeQuietly(connection);
    }
    try {
      deps.removeDirSync(traceDir);
    } catch {
      // 지우지 못해도 신호 종료는 해야 한다. 더 할 수 있는 일이 없다.
    }
    detach();
    deps.killSelf(signal);
  });
  try {
    return await measureAndReport(input, plan, baseline, traceDir, deps, session);
  } finally {
    detach();
    await deps.removeDir(traceDir);
  }
}

/** 신호 처리기와 본 흐름이 함께 보는 상태. */
interface MeasureSession {
  /** 신호 처리기가 닫을 연결. 열린 동안만 채운다. */
  connection?: CliConnection;
  /** 처리기가 받은 첫 신호. 채워진 뒤에는 본 흐름이 아무것도 쓰지 않는다(설계 §3.2 8항). */
  interrupted?: PerfSignal;
}

/** 셸이 신호 종료에 보는 값(128 + 신호 번호). 실제로는 재발신이 먼저 프로세스를 끝낸다. */
const SIGNAL_EXIT_CODES: Readonly<Record<PerfSignal, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

async function measureAndReport(
  input: PerfCommandInput,
  plan: PerfPlan,
  baseline: PerfBaseline | undefined,
  traceDir: string,
  deps: PerfCommandDependencies,
  session: MeasureSession,
): Promise<number> {
  const env = deps.perf.childEnvironment({
    traceDir,
    existingNodeOptions: deps.readEnv("NODE_OPTIONS"),
  });

  // 콜드 스타트: 연결 직전·직후, tools/list 직전·직후의 now 차이(설계 §3.2 3항).
  const connectStart = deps.now();
  let connection: CliConnection;
  try {
    connection = await openConnection(
      input.target,
      { connectStdio: deps.connectStdio, readEnv: deps.readEnv },
      { env },
    );
  } catch (error) {
    if (error instanceof ConnectTargetError)
      return usageFailure(deps, error.message, PERF_USAGE_HINT);
    return writeCoreFailure(deps, "MCP_CONNECTION_FAILED", undefined, error, {
      message: "MCP 서버 연결에 실패했습니다.",
      hint: "command 실행 가능 여부와 MCP 서버 설정을 확인하세요.",
    });
  }
  const connectEnd = deps.now();
  session.connection = connection;

  let tools: ToolDef[];
  const listStart = deps.now();
  try {
    tools = await connection.client.listTools();
  } catch (error) {
    session.connection = undefined;
    await closeQuietly(connection);
    return writeCoreFailure(
      deps,
      "MCP_LIST_TOOLS_FAILED",
      `서버의 tools/list 를 읽지 못했습니다: ${escapeTerminalText(describeTarget(input.target))}`,
      error,
      {
        message: "서버가 tools/list 요청에 답하지 않았습니다.",
        hint: "서버가 tools 능력을 광고하는지 확인하세요.",
      },
    );
  }
  const listEnd = deps.now();

  deps.writeStderr(`측정: 케이스 ${plan.calls.length}개 × ${plan.repeat}회\n`);
  let measurements: Awaited<ReturnType<PerfCommandDependencies["perf"]["measure"]>>;
  try {
    measurements = await deps.perf.measure({
      client: connection.client,
      availableTools: new Set(tools.map((tool) => tool.name)),
      plan,
      now: deps.now,
      sleep: deps.sleep,
      // measure 는 케이스 순(케이스마다 repeat 회)으로 기록할 때마다 부르므로 done 으로 케이스를 되짚는다.
      // 케이스 id 는 명세에서 온 글자라 그대로 터미널에 쓰지 않는다.
      onProgress: (done, total) => {
        const index = Math.floor((done - 1) / plan.repeat);
        const iteration = ((done - 1) % plan.repeat) + 1;
        deps.writeStderr(
          `측정 중 ${done}/${total} · ${escapeTerminalText(plan.calls[index]?.caseId ?? "")} (${iteration}/${plan.repeat}회)\n`,
        );
      },
    });
  } finally {
    // 추적은 연결을 닫은 뒤에 읽는다. 자식이 끝나야 마지막 줄까지 파일에 남는다.
    session.connection = undefined;
    await closeQuietly(connection);
  }
  // 신호 처리기가 연결을 닫으면 남은 callTool 이 거부된 채로 measure 가 끝난다. 그 측정으로
  // 리포트나 기준 파일을 쓰면 중단된 실행의 결과가 남는다(재검토 N5).
  if (session.interrupted !== undefined) return SIGNAL_EXIT_CODES[session.interrupted];
  deps.writeStderr(`측정 완료: 호출 ${measurements.length}회\n`);

  let entries: Awaited<ReturnType<PerfCommandDependencies["perf"]["readTrace"]>>["entries"];
  try {
    ({ entries } = await deps.perf.readTrace(traceDir));
  } catch (error) {
    // 측정 뒤에 온 신호는 추적 디렉터리를 먼저 지워 읽기가 실패할 수 있다.
    if (session.interrupted !== undefined) return SIGNAL_EXIT_CODES[session.interrupted];
    throw error;
  }
  if (session.interrupted !== undefined) return SIGNAL_EXIT_CODES[session.interrupted];
  // 리포트 머리 줄에 그대로 찍히는 값이라 정수로 둔다. 시계는 소수 밀리초다.
  let report: PerfReport = deps.perf.analyze({
    plan,
    measurements,
    trace: entries,
    coldStart: {
      connectMs: Math.round(connectEnd - connectStart),
      listToolsMs: Math.round(listEnd - listStart),
    },
    server: { command: describeTarget(input.target), toolCount: tools.length },
    generatorVersion: deps.generatorVersion,
  });
  const observed = report.settings.observation === "preload";

  if (input.baselinePath !== undefined && input.updateBaseline) {
    if (!observed) return unavailable(deps, report, input, "기준 파일을 쓰지 않았습니다.");
    try {
      await deps.writeFile(
        input.baselinePath,
        `${JSON.stringify(deps.perf.toBaseline(report), null, 2)}\n`,
      );
    } catch (error) {
      writeReport(deps, report, input);
      const code = errnoOf(error);
      deps.writeStderr(
        `오류 [PERF_BASELINE_WRITE_FAILED]: 기준 파일을 쓰지 못했습니다 (${escapeTerminalText(code)}). 경로: ${escapeTerminalText(input.baselinePath)}\n` +
          "해결: --baseline 경로의 디렉터리가 있는지와 쓰기 권한을 확인하세요.\n",
      );
      return 1;
    }
  } else if (input.baselinePath !== undefined && baseline !== undefined) {
    if (!observed) return unavailable(deps, report, input, "기준선과 비교하지 않았습니다.");
    report = deps.perf.compareBaseline(report, baseline, {
      path: input.baselinePath,
      thresholdPct: input.thresholdPct,
      thresholdMs: input.thresholdMs,
    });
  }

  writeReport(deps, report, input);
  return report.exitCode;
}

function writeReport(deps: PerfCommandDependencies, report: PerfReport, input: PerfCommandInput) {
  deps.writeStdout(
    input.json ? `${JSON.stringify(report, null, 2)}\n` : deps.perf.renderReport(report),
  );
}

/**
 * 관측이 없어 기준선을 쓰거나 비교할 수 없다(설계 §8.5, 계획 E9). 잰 응답 시간은 버리지 않고
 * 리포트를 먼저 낸 뒤 종료 코드 1 로 끝낸다.
 */
function unavailable(
  deps: PerfCommandDependencies,
  report: PerfReport,
  input: PerfCommandInput,
  what: string,
): number {
  writeReport(deps, report, input);
  deps.writeStderr(
    `오류 [PERF_BASELINE_UNAVAILABLE]: 외부 호출을 관측하지 못해 ${what}\n${NO_OBSERVATION_HINT}\n`,
  );
  return 1;
}

/**
 * core 오류를 optimize 와 같은 모양으로 낸다: 한 줄 머리, 해결 줄, 그리고 진단 블록. 문장은
 * optimize-command.ts 의 같은 이름 함수와 같아야 한다(설계 §8.5).
 */
function writeCoreFailure(
  deps: PerfCommandDependencies,
  code: string,
  lead: string | undefined,
  error: unknown,
  fallback: { readonly message: string; readonly hint: string },
): number {
  const core = coreErrorOf(error);
  const message = core === undefined ? fallback.message : escapeTerminalText(core.message);
  const hint = core === undefined ? fallback.hint : escapeTerminalText(core.hint);
  const head = core === undefined ? code : `${code}/${escapeTerminalText(core.code)}`;
  deps.writeStderr(
    `오류 [${head}]: ${lead === undefined ? message : `${lead}\n→ ${message}`}\n해결: ${hint}\n`,
  );
  const processBlock = processDiagnostics(core?.diagnostics);
  if (processBlock !== undefined && hasDiagnosticContent(processBlock)) {
    const block = renderProcessDiagnostics(processBlock, { maxLines: STDERR_LINES });
    if (block !== "") deps.writeStderr(`\n${block}`);
  }
  const remote = httpDiagnostics(core?.diagnostics);
  if (remote !== undefined) deps.writeStderr(`\n${renderHttpDiagnostics(remote)}`);
  return 1;
}

/** `McpClientError` 를 AggregateError 안까지 찾는다. 연결 정리 실패가 겹치면 그렇게 감싸인다. */
function coreErrorOf(
  error: unknown,
): { code: string; message: string; hint: string; diagnostics: unknown } | undefined {
  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      const found = coreErrorOf(nested);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "McpClientError"
  ) {
    const { code, message, hint, diagnostics } = error as Record<string, unknown>;
    if (typeof code === "string" && typeof message === "string" && typeof hint === "string")
      return { code, message, hint, diagnostics };
  }
  return undefined;
}

/** 정상 종료가 안 되면 강제로 끝내 자식이 남지 않게 한다. 그것도 안 되면 더 할 수 있는 일이 없다. */
async function closeQuietly(connection: CliConnection): Promise<void> {
  try {
    await connection.close();
  } catch {
    await connection.forceClose().catch(() => {});
  }
}

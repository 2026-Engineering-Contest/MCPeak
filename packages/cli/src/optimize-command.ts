/**
 * `mcpeak optimize` 서브커맨드. 서버의 tools/list 를 읽어 기능을 바꾸지 않고 토큰을 줄인
 * 오버레이를 `--out` 에 쓰고, 사람용 리포트를 stdout 에 낸다(계획서 §5.4, §7.2, §7.4).
 *
 * 대상 옵션(`--`, `--command`/`--arg`/`--env`, `--url`/`--header-env`)의 해석과 오류 문장은
 * `test` 의 `parseTestCommand` 를 그대로 쓴다. 같은 명령줄이 서브커맨드마다 다르게 거절되면
 * 사용자는 그 차이를 기능으로 읽는다(help.ts 의 REMOTE_TARGET_OPTIONS 주석과 같은 이유).
 *
 * 의존성 주입 형태는 `repair-command.ts` 를 따른다. `@mcpeak/optimize` 를 값으로 import 하지
 * 않는다. 정적으로 import 하면 `test` 경로가 그 패키지를 함께 로드한다.
 */
import type {
  HttpConnectOptions,
  McpHttpConnection,
  McpServerInfo,
  McpStdioConnection,
  ToolDef,
} from "@mcpeak/core";
import type { OptimizeInput, OptimizeOverlay } from "@mcpeak/optimize";
import {
  type CliConnection,
  type ConnectTarget,
  ConnectTargetError,
  describeTarget,
  openConnection,
} from "./connect-target.js";
import { OPTIMIZE_USAGE_HINT } from "./help.js";
import { httpDiagnostics, renderHttpDiagnostics } from "./http-diagnostics.js";
import {
  hasDiagnosticContent,
  processDiagnostics,
  renderProcessDiagnostics,
} from "./process-diagnostics.js";
import { escapeTerminalText } from "./repair-render.js";
import { parseTestCommand } from "./test-command.js";

export interface OptimizeCommandInput {
  readonly outPath: string;
  readonly target: ConnectTarget;
  readonly json: boolean;
}

export interface OptimizeCommandDependencies {
  /**
   * 반환에 `McpServerInfo` 가 실려 있어야 한다. `instructions` 와 광고한 능력 키가 오버레이의
   * 입력이기 때문이다. `core.connectStdio` 가 그 모양이다.
   */
  connectStdio(options: {
    command: string;
    args: readonly string[];
    env?: Readonly<Record<string, string>>;
  }): Promise<McpStdioConnection & McpServerInfo>;
  connectHttp?(options: HttpConnectOptions): Promise<McpHttpConnection & McpServerInfo>;
  readEnv?(name: string): string | undefined;
  readonly optimize: typeof import("@mcpeak/optimize").optimize;
  readonly renderReport: typeof import("@mcpeak/optimize").renderReport;
  /** 오버레이의 `generator.version`. `@mcpeak/optimize` 의 패키지 버전이다. */
  readonly generatorVersion: string;
  writeFile(path: string, text: string): Promise<void>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

/** 서버 연결 stderr 진단의 줄 수. `test` 의 `--stderr-lines` 기본값과 같다. */
const STDERR_LINES = 20;

/** 오버레이가 기록하는 tools 외 능력(§5.1 `otherCapabilities`). 이 밖의 키는 프록시와 무관하다. */
const OTHER_CAPABILITIES = ["completions", "logging", "prompts", "resources"] as const;
type OtherCapability = (typeof OTHER_CAPABILITIES)[number];

class UsageError extends Error {
  constructor(
    message: string,
    readonly hint: string = OPTIMIZE_USAGE_HINT,
  ) {
    super(message);
  }
}

/**
 * `test` 는 받지만 `optimize` 에는 뜻이 없는 옵션. `parseTestCommand` 에 넘기기 전에 여기서
 * 거절한다. 넘기면 조용히 통과하거나 "test 옵션" 이라는 남의 이름으로 거절된다.
 */
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
const TARGET_VALUE_OPTIONS = new Set(["--command", "--arg", "--env", "--url", "--header-env"]);

/** `parseTestCommand` 의 첫 위치 인자 자리. 명세 경로를 쓰지 않으므로 형식만 채운다. */
const PLACEHOLDER_SUITE = "optimize.json";

export function parseOptimizeCommand(argv: readonly string[]): OptimizeCommandInput {
  let outPath: string | undefined;
  let json = false;
  const targetArgv: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string;
    // `--` 뒤는 서버 명령이다. 해석하지 않고 통째로 넘긴다(test 와 같은 관례).
    if (token === "--") {
      targetArgv.push(...argv.slice(index));
      break;
    }
    const name =
      token.startsWith("--") && token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
    if (name === "--out") {
      if (outPath !== undefined) throw new UsageError("`--out`은 한 번만 사용할 수 있습니다.");
      const value = token === "--out" ? argv[++index] : token.slice("--out=".length);
      // 경로 자리의 플래그는 값을 빠뜨린 오타다. `--json` 이라는 이름의 파일을 만들라는 뜻이 아니다.
      if (value === undefined || value.trim() === "" || value.startsWith("--"))
        throw new UsageError("`--out` 옵션 값이 필요합니다.");
      outPath = value;
      continue;
    }
    if (name === "--json") {
      if (token !== "--json") throw new UsageError("`--json`은 값을 받지 않습니다.");
      if (json) throw new UsageError("`--json`은 한 번만 사용할 수 있습니다.");
      json = true;
      continue;
    }
    if (TEST_ONLY_OPTIONS.has(name))
      throw new UsageError(`지원하지 않는 optimize 옵션 '${escapeTerminalText(name)}'입니다.`);
    if (token.startsWith("-") && !TARGET_VALUE_OPTIONS.has(name))
      throw new UsageError(`지원하지 않는 optimize 옵션 '${escapeTerminalText(name)}'입니다.`);
    targetArgv.push(token);
    if (TARGET_VALUE_OPTIONS.has(token) && index + 1 < argv.length) {
      targetArgv.push(argv[++index] as string);
    }
  }
  if (outPath === undefined)
    throw new UsageError(
      "--out <overlay.json> 이 필요합니다. 오버레이를 어디에 쓸지 이 도구는 정하지 않습니다.",
      "mcpeak optimize --out ./server.optimize.json -- <서버 명령>",
    );
  let target: ConnectTarget;
  try {
    target = parseTestCommand([PLACEHOLDER_SUITE, ...targetArgv]).target;
  } catch (error) {
    // 대상 옵션 문장은 connect-target·test 의 것을 그대로 쓰고, 해결 줄만 이 명령의 사용법으로
    // 바꾼다. 새 대상 문장을 만들지 않는다(계획서 §7.4).
    const message = usageMessageOf(error);
    if (message === undefined) throw error;
    throw new UsageError(message);
  }
  return Object.freeze({ outPath, target, json });
}

/** `parseTestCommand` 가 던진 사용 오류의 문장. 그 오류 클래스는 export 되지 않아 모양으로 본다. */
function usageMessageOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("failure" in error)) return undefined;
  const failure = (error as { failure: unknown }).failure;
  if (typeof failure !== "object" || failure === null) return undefined;
  const { code, message } = failure as { code?: unknown; message?: unknown };
  return code === "CLI_USAGE" && typeof message === "string" ? message : undefined;
}

function usageFailure(deps: OptimizeCommandDependencies, message: string, hint: string): number {
  deps.writeStderr(`오류 [CLI_USAGE]: ${message}\n해결: ${hint}\n`);
  return 1;
}

export async function runOptimizeCommand(
  argv: readonly string[],
  deps: OptimizeCommandDependencies,
): Promise<number> {
  let input: OptimizeCommandInput;
  try {
    input = parseOptimizeCommand(argv[0] === "optimize" ? argv.slice(1) : argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    return usageFailure(deps, error.message, error.hint);
  }

  // `openConnection` 은 연결을 `CliConnection` 으로 좁혀 돌려준다. HTTP 는 객체를 새로 만들어
  // 서버 정보가 빠진다. 대상 해석과 환경·헤더 처리는 그 함수에 맡기고, 서버 정보는 주입한
  // 연결 함수가 돌려준 값에서 직접 잡는다.
  let serverInfo: McpServerInfo | undefined;
  const capture = <T extends McpServerInfo>(connection: T): T => {
    serverInfo = {
      instructions: connection.instructions,
      capabilityKeys: connection.capabilityKeys,
    };
    return connection;
  };
  const connectHttp = deps.connectHttp;
  let connection: CliConnection;
  try {
    connection = await openConnection(input.target, {
      connectStdio: async (options) => capture(await deps.connectStdio(options)),
      ...(connectHttp === undefined
        ? {}
        : { connectHttp: async (options) => capture(await connectHttp(options)) }),
      ...(deps.readEnv === undefined ? {} : { readEnv: deps.readEnv }),
    });
  } catch (error) {
    if (error instanceof ConnectTargetError)
      return usageFailure(deps, error.message, OPTIMIZE_USAGE_HINT);
    return writeCoreFailure(deps, "MCP_CONNECTION_FAILED", undefined, error, {
      message: "MCP 서버 연결에 실패했습니다.",
      hint: "command 실행 가능 여부와 MCP 서버 설정을 확인하세요.",
    });
  }

  let tools: ToolDef[];
  try {
    tools = await connection.client.listTools();
  } catch (error) {
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
  // 도구 목록을 읽었으면 서버는 더 필요 없다. 변환은 순수 함수라 서버 없이 돈다.
  await closeQuietly(connection);

  const info = serverInfo as McpServerInfo;
  const optimizeInput: OptimizeInput = {
    tools,
    instructions: info.instructions ?? "",
    otherCapabilities: info.capabilityKeys.filter((key): key is OtherCapability =>
      (OTHER_CAPABILITIES as readonly string[]).includes(key),
    ),
  };

  let overlay: OptimizeOverlay;
  try {
    overlay = deps.optimize(optimizeInput, deps.generatorVersion);
  } catch (error) {
    // 게이트 A 실패(§7.1). 문장은 이미 "→ … 해결: …" 형태로 완성돼 있다. 파일은 쓰지 않는다.
    // 원본과 다른 입력을 받는 정의를 디스크에 남기면 누군가 그것을 프록시에 물린다.
    if (isOptimizeError(error, "LOSSLESS_VIOLATION")) {
      deps.writeStderr(
        `오류 [LOSSLESS_VIOLATION]: 오버레이를 쓰지 않았습니다.\n${(error as Error).message}\n`,
      );
      return 1;
    }
    throw error;
  }

  // 2칸 들여쓰기와 끝 개행. 사람이 diff 로 검토하는 파일이라 한 줄로 쓰지 않는다. 키 순서는
  // optimize() 가 만든 순서 그대로라 같은 입력이면 바이트까지 같다.
  const text = `${JSON.stringify(overlay, null, 2)}\n`;
  try {
    await deps.writeFile(input.outPath, text);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    deps.writeStderr(
      `오류 [OVERLAY_WRITE_FAILED]: 오버레이 파일을 쓰지 못했습니다${code === "" ? "" : ` (${escapeTerminalText(code)})`}. 경로: ${escapeTerminalText(input.outPath)}\n` +
        "해결: `--out` 경로의 디렉터리가 있는지와 쓰기 권한을 확인하세요.\n",
    );
    return 1;
  }

  deps.writeStdout(input.json ? text : deps.renderReport(overlay));
  return 0;
}

function isOptimizeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    error.name === "OptimizeError" &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}

/**
 * core 오류를 `test` 와 같은 모양으로 낸다: 한 줄 머리, 해결 줄, 그리고 진단 블록(서버 stderr
 * 꼬리 또는 HTTP 엔드포인트). 연결 실패를 사용자가 가장 먼저 보는 명령이 이것일 수 있어서
 * 진단을 빼지 않는다. `test-command.ts` 의 연결 실패 분기와 같은 규칙이다.
 */
function writeCoreFailure(
  deps: OptimizeCommandDependencies,
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

/**
 * 도구 목록을 읽은 뒤의 종료. 실패해도 결과를 버리지 않는다. 정상 종료가 안 되면 강제로
 * 끝내 자식이 남지 않게 하고, 그것도 안 되면 더 할 수 있는 일이 없다.
 */
async function closeQuietly(connection: CliConnection): Promise<void> {
  try {
    await connection.close();
  } catch {
    await connection.forceClose().catch(() => {});
  }
}

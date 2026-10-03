/**
 * `mcpeak audit` 서브커맨드. 서버를 쓰기 전에 도구 정의·실행 명령·프로토콜 응답을 읽어 보안
 * 위험을 점검하고, 사람용 리포트(또는 JSON)를 stdout 에 낸다(계획서 §6, §7).
 *
 * 대상 옵션(`--`, `--command`/`--arg`/`--env`, `--url`/`--header-env`)의 해석과 오류 문장은
 * `test` 의 `parseTestCommand` 를 그대로 쓴다. `optimize-command.ts` 와 같은 이유다. 같은
 * 명령줄이 서브커맨드마다 다르게 거절되면 사용자는 그 차이를 기능으로 읽는다.
 *
 * `@mcpeak/audit` 를 값으로 import 하지 않는다. 정적으로 import 하면 `test` 경로가 그 패키지를
 * 함께 로드한다. 감사 함수와 렌더러는 index.ts 가 동적 import 해서 주입한다.
 */
import type { AuditTarget, ProbePolicy } from "@mcpeak/audit";
import type {
  AdvertiseOptions,
  HttpConnectOptions,
  McpHttpConnection,
  McpServerInfo,
  McpServerSurface,
  McpStdioConnection,
} from "@mcpeak/core";
import {
  type ConnectTarget,
  ConnectTargetError,
  describeTarget,
  openConnection,
} from "./connect-target.js";
import { AUDIT_USAGE_HINT } from "./help.js";
import { httpDiagnostics, renderHttpDiagnostics } from "./http-diagnostics.js";
import {
  hasDiagnosticContent,
  processDiagnostics,
  renderProcessDiagnostics,
} from "./process-diagnostics.js";
import { escapeTerminalText } from "./repair-render.js";
import { parseTestCommand } from "./test-command.js";

export interface AuditCommandInput {
  readonly target: ConnectTarget;
  readonly probe: ProbePolicy;
  readonly baselinePath?: string;
  readonly updateBaseline: boolean;
  readonly json: boolean;
}

/** 감사가 쓰는 연결. core 의 connectStdio·connectHttp 반환이 이 꼴이다. */
type StdioAuditConnection = McpStdioConnection & McpServerInfo & McpServerSurface;
type HttpAuditConnection = McpHttpConnection & McpServerInfo & McpServerSurface;

export interface AuditCommandDependencies {
  connectStdio(options: {
    command: string;
    args: readonly string[];
    env?: Readonly<Record<string, string>>;
    advertise?: AdvertiseOptions;
  }): Promise<StdioAuditConnection>;
  connectHttp(options: HttpConnectOptions): Promise<HttpAuditConnection>;
  /** `--env`·`--header-env` 가 가리키는 환경변수를 읽는 유일한 지점이다. */
  readEnv(name: string): string | undefined;
  /** 기준 파일을 읽는다. 없으면 `code: "ENOENT"` 인 오류를 던진다(node:fs 그대로). */
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  readonly audit: typeof import("@mcpeak/audit").audit;
  readonly renderReport: typeof import("@mcpeak/audit").renderReport;
  /** 리포트의 `generator.version`. `@mcpeak/audit` 의 패키지 버전이다. */
  readonly generatorVersion: string;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  readonly fetch: typeof globalThis.fetch;
  /** 카나리 값 하나. 16자 소문자 hex 이고 호출마다 다르다. */
  random(): string;
}

/** 서버 연결 stderr 진단의 줄 수. `test` 의 `--stderr-lines` 기본값과 같다. */
const STDERR_LINES = 20;

const PROBE_POLICIES: readonly ProbePolicy[] = ["readonly", "none", "all"];

class UsageError extends Error {}

/**
 * `test` 는 받지만 `audit` 에는 뜻이 없는 옵션. `parseTestCommand` 에 넘기기 전에 여기서
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
/** 대상 옵션 중 값을 다음 토큰으로 받는 것. 그 값이 `--json` 처럼 생겨도 옵션으로 읽지 않는다. */
const TARGET_VALUE_OPTIONS = new Set(["--command", "--arg", "--env", "--url", "--header-env"]);

/** `parseTestCommand` 의 첫 위치 인자 자리. 명세 경로를 쓰지 않으므로 형식만 채운다. */
const PLACEHOLDER_SUITE = "audit.json";

export function parseAuditCommand(argv: readonly string[]): AuditCommandInput {
  let probe: ProbePolicy | undefined;
  let baselinePath: string | undefined;
  let updateBaseline = false;
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
    if (name === "--probe") {
      if (probe !== undefined) throw new UsageError("`--probe`은 한 번만 사용할 수 있습니다.");
      const value = token === "--probe" ? argv[++index] : token.slice("--probe=".length);
      if (!PROBE_POLICIES.includes(value as ProbePolicy))
        throw new UsageError("--probe 값은 readonly, none, all 중 하나입니다.");
      probe = value as ProbePolicy;
      continue;
    }
    if (name === "--baseline") {
      if (baselinePath !== undefined)
        throw new UsageError("`--baseline`은 한 번만 사용할 수 있습니다.");
      const value = token === "--baseline" ? argv[++index] : token.slice("--baseline=".length);
      // 경로 자리의 플래그는 값을 빠뜨린 오타다. `--json` 이라는 이름의 파일을 만들라는 뜻이 아니다.
      if (value === undefined || value.trim() === "" || value.startsWith("--"))
        throw new UsageError("`--baseline` 옵션 값이 필요합니다.");
      baselinePath = value;
      continue;
    }
    if (name === "--update-baseline" || name === "--json") {
      if (token !== name) throw new UsageError(`\`${name}\`은 값을 받지 않습니다.`);
      const already = name === "--json" ? json : updateBaseline;
      if (already) throw new UsageError(`\`${name}\`은 한 번만 사용할 수 있습니다.`);
      if (name === "--json") json = true;
      else updateBaseline = true;
      continue;
    }
    if (TEST_ONLY_OPTIONS.has(name) || (token.startsWith("-") && !TARGET_VALUE_OPTIONS.has(name)))
      throw new UsageError(`지원하지 않는 audit 옵션 '${escapeTerminalText(name)}'입니다.`);
    targetArgv.push(token);
    if (TARGET_VALUE_OPTIONS.has(token) && index + 1 < argv.length) {
      targetArgv.push(argv[++index] as string);
    }
  }
  if (updateBaseline && baselinePath === undefined)
    throw new UsageError("--update-baseline 은 --baseline 과 함께 써야 합니다.");
  let target: ConnectTarget;
  try {
    target = parseTestCommand([PLACEHOLDER_SUITE, ...targetArgv]).target;
  } catch (error) {
    // 대상 옵션 문장은 connect-target·test 의 것을 그대로 쓰고, 해결 줄만 이 명령의 사용법으로
    // 바꾼다. 새 대상 문장을 만들지 않는다(계획서 §6.4).
    const message = usageMessageOf(error);
    if (message === undefined) throw error;
    throw new UsageError(message);
  }
  return Object.freeze({
    target,
    probe: probe ?? "readonly",
    ...(baselinePath === undefined ? {} : { baselinePath }),
    updateBaseline,
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

function usageFailure(deps: AuditCommandDependencies, message: string): number {
  deps.writeStderr(`오류 [CLI_USAGE]: ${message}\n해결: ${AUDIT_USAGE_HINT}\n`);
  return 1;
}

/** 감사 대상 표현. launch·protocol·secret 규칙이 이것을 본다. 값은 담지 않고 이름만 담는다. */
function auditTarget(target: ConnectTarget): AuditTarget {
  return target.transport === "stdio"
    ? {
        kind: "stdio",
        command: target.command,
        args: target.args,
        forwardedEnvNames: target.envNames,
        headerNames: [],
      }
    : {
        kind: "http",
        url: target.url,
        forwardedEnvNames: [],
        headerNames: Object.keys(target.headerEnv),
      };
}

/** 연결 함수가 불리면 던지는 표지. 사전 점검이 환경변수 검사를 통과했다는 뜻이다. */
const PREFLIGHT_PASSED = Symbol("preflight-passed");

/**
 * `--env`·`--header-env` 의 환경변수 검사만 연결 없이 먼저 돌린다. 문장은 connect-target 의 것을
 * 그대로 쓰려고 `openConnection` 에 연결하지 않는 연결 함수를 넣어 부른다. 감사 안에서 이 검사가
 * 실패하면 "서버에 붙지 못했습니다" 로 바뀌어, 서버가 아니라 사용자 환경이 원인이라는 사실이
 * 사라진다.
 */
async function preflight(target: ConnectTarget, readEnv: (name: string) => string | undefined) {
  const refuse = async (): Promise<never> => {
    throw PREFLIGHT_PASSED;
  };
  try {
    await openConnection(target, { connectStdio: refuse, connectHttp: refuse, readEnv });
  } catch (error) {
    if (error === PREFLIGHT_PASSED) return;
    throw error;
  }
}

/** 기준 파일 쓰기 실패. 감사 도중 서버 실패와 구분해 경로와 원인을 말하려고 표지를 단다. */
class BaselineWriteError extends Error {
  constructor(
    readonly path: string,
    readonly reason: unknown,
  ) {
    super("baseline write failed");
  }
}

export async function runAuditCommand(
  argv: readonly string[],
  deps: AuditCommandDependencies,
): Promise<number> {
  let input: AuditCommandInput;
  try {
    input = parseAuditCommand(argv[0] === "audit" ? argv.slice(1) : argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    return usageFailure(deps, error.message);
  }

  try {
    await preflight(input.target, deps.readEnv);
  } catch (error) {
    if (error instanceof ConnectTargetError) return usageFailure(deps, error.message);
    throw error;
  }
  const forwardedEnv: Record<string, string> = {};
  if (input.target.transport === "stdio")
    for (const name of input.target.envNames) forwardedEnv[name] = deps.readEnv(name) ?? "";

  // `openConnection` 은 HTTP 연결을 `CliConnection` 으로 좁혀 새로 만들어 표면 접근자가 빠진다.
  // 대상 해석과 환경·헤더 처리는 그 함수에 맡기고, 감사에 줄 연결은 주입한 함수의 반환에서 잡는다.
  // 연결 실패의 원래 오류도 잡아 둔다. AuditError 는 첫 줄만 싣기 때문에 서버 stderr 꼬리는 여기서 낸다.
  let connectError: unknown;
  const connect = async (
    _target: AuditTarget,
    env: Readonly<Record<string, string>>,
    advertise: AdvertiseOptions,
  ) => {
    let opened: StdioAuditConnection | HttpAuditConnection | undefined;
    try {
      await openConnection(
        input.target,
        {
          connectStdio: async (options) => {
            opened = await deps.connectStdio({ ...options, advertise });
            return opened;
          },
          connectHttp: async (options) => {
            opened = await deps.connectHttp({ ...options, advertise });
            return opened;
          },
          readEnv: deps.readEnv,
        },
        { env },
      );
    } catch (error) {
      connectError = error;
      throw error;
    }
    return opened as StdioAuditConnection | HttpAuditConnection;
  };

  let report: Awaited<ReturnType<AuditCommandDependencies["audit"]>>;
  try {
    report = await deps.audit(
      {
        target: auditTarget(input.target),
        probe: input.probe,
        ...(input.baselinePath === undefined ? {} : { baselinePath: input.baselinePath }),
        updateBaseline: input.updateBaseline,
      },
      {
        connect,
        readFile: deps.readFile,
        writeFile: async (path, text) => {
          try {
            await deps.writeFile(path, text);
          } catch (error) {
            throw new BaselineWriteError(path, error);
          }
        },
        fetch: deps.fetch,
        random: () => deps.random(),
        generatorVersion: deps.generatorVersion,
        forwardedEnv,
      },
    );
  } catch (error) {
    return writeAuditFailure(deps, input.target, error, connectError);
  }

  deps.writeStdout(
    input.json ? `${JSON.stringify(report, null, 2)}\n` : escapeLines(deps.renderReport(report)),
  );
  return report.exitCode;
}

/**
 * 감사 실패를 찍는다. 종료 코드는 언제나 1 이다.
 *
 * - AuditError(연결 실패·기준 파일 문제): message 가 §6.3 블록 전체다. 그대로 찍는다. 연결
 *   실패면 core 오류가 들고 온 진단(서버 stderr 꼬리, HTTP 엔드포인트)을 그 뒤에 붙인다.
 * - 기준 파일 쓰기 실패: optimize 의 오버레이 쓰기 실패와 같은 모양.
 * - 그 밖(연결이 선 뒤 tools/list 실패 등): audit 가 감싸지 않고 올린 원래 오류다.
 */
function writeAuditFailure(
  deps: AuditCommandDependencies,
  target: ConnectTarget,
  error: unknown,
  connectError: unknown,
): number {
  if (isAuditError(error)) {
    deps.writeStderr(`${escapeLines((error as Error).message)}\n`);
    if ((error as { code: unknown }).code === "CONNECT_FAILED")
      writeDiagnostics(deps, connectError);
    return 1;
  }
  if (error instanceof BaselineWriteError) {
    const code = errorCode(error.reason);
    deps.writeStderr(
      `오류 [BASELINE_WRITE_FAILED]: 기준 파일을 쓰지 못했습니다${code === "" ? "" : ` (${escapeTerminalText(code)})`}. 경로: ${escapeTerminalText(error.path)}\n` +
        "해결: --baseline 경로의 디렉터리가 있는지와 쓰기 권한을 확인하세요.\n",
    );
    return 1;
  }
  const core = coreErrorOf(error);
  const cause = core?.message ?? (error instanceof Error ? error.message : String(error));
  const hint = core?.hint ?? "mcpeak test 로 같은 서버가 tools/list 에 답하는지 먼저 확인하세요.";
  deps.writeStderr(
    `오류 [AUDIT_FAILED]: 서버에 붙은 뒤 점검 도중 실패했습니다: ${escapeTerminalText(describeTarget(target))}\n` +
      `→ ${escapeTerminalText(cause.split("\n")[0] ?? "")}\n해결: ${escapeTerminalText(hint)}\n`,
  );
  writeDiagnostics(deps, error);
  return 1;
}

/** AuditError 는 이름과 코드로 알아본다. 패키지 사본이 둘이면 instanceof 가 어긋난다. */
function isAuditError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "AuditError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

/** core 오류가 들고 온 진단 블록. `test`·`optimize` 의 연결 실패와 같은 규칙이다. */
function writeDiagnostics(deps: AuditCommandDependencies, error: unknown): void {
  const core = coreErrorOf(error);
  const processBlock = processDiagnostics(core?.diagnostics);
  if (processBlock !== undefined && hasDiagnosticContent(processBlock)) {
    const block = renderProcessDiagnostics(processBlock, { maxLines: STDERR_LINES });
    if (block !== "") deps.writeStderr(`\n${block}`);
  }
  const remote = httpDiagnostics(core?.diagnostics);
  if (remote !== undefined) deps.writeStderr(`\n${renderHttpDiagnostics(remote)}`);
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
 * 줄마다 터미널 제어 문자를 무해하게 바꾼다. 리포트에는 도구 이름처럼 서버가 정한 글자가 그대로
 * 실린다. 악성 서버가 이름에 ESC 를 넣으면 리포트를 읽는 터미널이 조작된다. 줄바꿈은 리포트의
 * 구조라 남긴다.
 */
function escapeLines(text: string): string {
  return text
    .split("\n")
    .map((line) => escapeTerminalText(line))
    .join("\n");
}

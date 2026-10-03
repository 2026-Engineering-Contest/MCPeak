/**
 * `mcpeak audit` 서브커맨드. 서버를 쓰기 전에 도구 정의·실행 명령·프로토콜 응답을 읽어 보안
 * 위험을 점검하고, 사람용 리포트(또는 JSON)를 stdout 에 낸다(계획서 §6, §7).
 *
 * 대상 옵션(`--`, `--command`/`--arg`/`--env`, `--url`/`--header-env`)의 해석과 오류 문장은
 * `test` 의 `parseTestCommand` 를 그대로 쓴다. `optimize-command.ts` 와 같은 이유다. 같은
 * 명령줄이 서브커맨드마다 다르게 거절되면 사용자는 그 차이를 기능으로 읽는다.
 *
 * `@mcpeak/audit` 를 값으로 import 하지 않는다. 정적으로 import 하면 `test` 경로가 그 패키지를
 * 함께 로드한다. 감사 함수와 렌더러, 격리 백엔드는 index.ts 가 동적 import 해서 주입한다.
 *
 * `--sandbox` 는 서버를 Docker 컨테이너 안에서 띄워 행위를 관측한다(격리 계획서 §3.1, §7). 격리가
 * 켜지지 않으면 같은 감사가 격리 없이 돌고 리포트 둘째 줄이 그 사실을 말한다.
 */
import type {
  AuditReport,
  AuditTarget,
  ProbePolicy,
  SandboxBackend,
  SandboxOptions,
} from "@mcpeak/audit";
import type {
  AdvertiseOptions,
  HttpConnectOptions,
  McpHttpConnection,
  McpServerInfo,
  McpServerSurface,
  McpStdioConnection,
} from "@mcpeak/core";
import {
  isInside,
  readDeclarationTexts,
  resolveMountRoot,
  SandboxTargetError,
  type SandboxTargetFs,
} from "./audit-sandbox-target.js";
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

/** `--sandbox` 와 그 하위 옵션. 경로는 사용자가 쓴 글자 그대로다. 실행할 때 푼다. */
export interface AuditSandboxInput {
  readonly session?: { readonly mode: "record" | "replay"; readonly path: string };
  /** `--allow-host` 값. 준 순서 그대로다. */
  readonly allowHosts: readonly string[];
  readonly compareHost: boolean;
  /** `--sandbox-mount` 값. */
  readonly mountPath?: string;
}

export interface AuditCommandInput {
  readonly target: ConnectTarget;
  /** 격리가 켜지지 않은 실행의 호출 정책. 사용자가 주지 않았으면 `readonly` 다. */
  readonly probe: ProbePolicy;
  /**
   * 사용자가 `--probe` 를 직접 주었는가. 격리가 실제로 켜진 실행은 주지 않았을 때만 `all` 로 돈다
   * (ADR-0107). 준 값은 어느 쪽에서도 그대로다.
   */
  readonly probeExplicit: boolean;
  readonly baselinePath?: string;
  readonly updateBaseline: boolean;
  readonly json: boolean;
  /** `--sandbox` 를 준 실행에만 있다. */
  readonly sandbox?: AuditSandboxInput;
}

/** `--sandbox` 실행에만 쓰는 의존성. 호스트의 파일 시스템과 Docker 를 만지는 유일한 통로다. */
export interface AuditSandboxDependencies {
  /**
   * 격리 백엔드를 만든다. `--sandbox` 를 준 실행에서만 불린다. `progress` 는 백엔드의 진행 문장
   * (이미지를 처음 만들 때의 한 줄)을 받는다.
   */
  createBackend(progress: (line: string) => void): SandboxBackend;
  stat: SandboxTargetFs["stat"];
  /** 서버 인자의 상대 경로를 푸는 기준이자 서버의 작업 디렉터리. */
  readonly cwd: string;
  /** 사용자 홈 디렉터리. 마운트 범위가 이것이면 거절한다. */
  readonly home: string;
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
    connectTimeoutMs?: number;
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
  readonly sandbox: AuditSandboxDependencies;
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

/** 값을 받지 않는 audit 옵션. */
const FLAG_OPTIONS = ["--update-baseline", "--json", "--sandbox", "--compare-host"] as const;
type FlagOption = (typeof FLAG_OPTIONS)[number];
/** 값을 하나 받고 한 번만 쓰는 격리 옵션. */
const SANDBOX_PATH_OPTIONS = ["--sandbox-session", "--sandbox-replay", "--sandbox-mount"] as const;
type SandboxPathOption = (typeof SANDBOX_PATH_OPTIONS)[number];
/** `--sandbox` 없이 주면 거절하는 옵션. 이 순서로 본다. 어느 옵션을 먼저 썼는지에 기대지 않는다. */
const SANDBOX_ONLY_OPTIONS = [
  "--sandbox-session",
  "--sandbox-replay",
  "--allow-host",
  "--compare-host",
  "--sandbox-mount",
] as const;

/** 게이트웨이와 선언 목록이 쓰는 것과 같은 호스트 이름 문법(`sandbox/declared.ts`). 대소문자는 가리지 않는다. */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * 패키지 실행기로 띄운 서버의 격리 접속 제한. 격리 안에서는 npm 캐시가 매번 비어 있어 실행기가
 * 패키지를 새로 받고(ADR-0109), 그 시간이 core 의 기본값 10초를 넘는다. core 가 받는 상한이다.
 */
const RUNNER_CONNECT_TIMEOUT_MS = 60_000;
/** 그 대기가 조용하면 멈춘 것으로 보인다. 격리 연결을 열기 직전에 한 번 낸다. */
const RUNNER_PROGRESS =
  "격리 안에서는 패키지를 매번 새로 받습니다. 서버가 뜨기까지 1분까지 기다립니다.";
/** 패키지 실행기로 띄운 서버가 격리 안에서 붙지 못했을 때의 해결 줄. */
const RUNNER_CONNECT_HINT =
  "해결: 격리 안에서 패키지를 받지 못했거나 1분 안에 뜨지 못했습니다. 패키지 이름과 버전을 확인하고, 큰 패키지는 로컬에 설치한 뒤 node 로 띄우세요.";

/**
 * 명령이 패키지 실행기(npx·npm)인가. `/` 와 `\` 로 자른 마지막 조각의 정확 일치다. 격리 백엔드가
 * npm 캐시 자리를 여는 판정과 같아야 한다(ADR-0109). 인자는 보지 않는다.
 */
function isPackageRunner(command: string | undefined): boolean {
  const name = (command ?? "").split(/[\\/]/).pop();
  return name === "npx" || name === "npm";
}

/** `parseTestCommand` 의 첫 위치 인자 자리. 명세 경로를 쓰지 않으므로 형식만 채운다. */
const PLACEHOLDER_SUITE = "audit.json";

export function parseAuditCommand(argv: readonly string[]): AuditCommandInput {
  let probe: ProbePolicy | undefined;
  let baselinePath: string | undefined;
  const flags: Record<FlagOption, boolean> = {
    "--update-baseline": false,
    "--json": false,
    "--sandbox": false,
    "--compare-host": false,
  };
  const paths: Partial<Record<SandboxPathOption, string>> = {};
  const allowHosts: string[] = [];
  let usesUrl = false;
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
    if ((FLAG_OPTIONS as readonly string[]).includes(name)) {
      const flag = name as FlagOption;
      if (token !== name) throw new UsageError(`\`${name}\`은 값을 받지 않습니다.`);
      if (flags[flag]) throw new UsageError(`\`${name}\`은 한 번만 사용할 수 있습니다.`);
      flags[flag] = true;
      continue;
    }
    if ((SANDBOX_PATH_OPTIONS as readonly string[]).includes(name)) {
      const option = name as SandboxPathOption;
      if (paths[option] !== undefined)
        throw new UsageError(`\`${name}\`은 한 번만 사용할 수 있습니다.`);
      const value = token === name ? argv[++index] : token.slice(name.length + 1);
      if (value === undefined || value.trim() === "" || value.startsWith("--"))
        throw new UsageError(`\`${name}\` 옵션 값이 필요합니다.`);
      paths[option] = value;
      continue;
    }
    if (name === "--allow-host") {
      const value = token === name ? argv[++index] : token.slice(name.length + 1);
      // 값 자리의 플래그는 값을 빠뜨린 오타다. 호스트 이름은 `-` 로 시작하지 않는다.
      if (value === undefined || (token === name && value.startsWith("--")))
        throw new UsageError("`--allow-host` 옵션 값이 필요합니다.");
      if (value.length > 253 || !HOSTNAME.test(value))
        throw new UsageError(
          `--allow-host 값은 호스트 이름이어야 합니다(예: api.example.com): '${escapeTerminalText(value)}'`,
        );
      allowHosts.push(value);
      continue;
    }
    if (name === "--url") usesUrl = true;
    if (TEST_ONLY_OPTIONS.has(name) || (token.startsWith("-") && !TARGET_VALUE_OPTIONS.has(name)))
      throw new UsageError(`지원하지 않는 audit 옵션 '${escapeTerminalText(name)}'입니다.`);
    targetArgv.push(token);
    if (TARGET_VALUE_OPTIONS.has(token) && index + 1 < argv.length) {
      targetArgv.push(argv[++index] as string);
    }
  }
  const updateBaseline = flags["--update-baseline"];
  const json = flags["--json"];
  if (updateBaseline && baselinePath === undefined)
    throw new UsageError("--update-baseline 은 --baseline 과 함께 써야 합니다.");
  const sandbox = parseSandbox(flags, paths, allowHosts, usesUrl);
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
    probeExplicit: probe !== undefined,
    ...(baselinePath === undefined ? {} : { baselinePath }),
    updateBaseline,
    json,
    ...(sandbox === undefined ? {} : { sandbox }),
  });
}

/** 격리 옵션의 조합을 본다. 문장은 격리 계획서 §6.3 이 정본이다. */
function parseSandbox(
  flags: Readonly<Record<FlagOption, boolean>>,
  paths: Readonly<Partial<Record<SandboxPathOption, string>>>,
  allowHosts: readonly string[],
  usesUrl: boolean,
): AuditSandboxInput | undefined {
  if (!flags["--sandbox"]) {
    const given = (option: (typeof SANDBOX_ONLY_OPTIONS)[number]) =>
      option === "--allow-host"
        ? allowHosts.length > 0
        : option === "--compare-host"
          ? flags[option]
          : paths[option] !== undefined;
    const orphan = SANDBOX_ONLY_OPTIONS.find(given);
    if (orphan !== undefined) throw new UsageError(`${orphan} 은 --sandbox 와 함께 써야 합니다.`);
    return undefined;
  }
  if (usesUrl)
    throw new UsageError(
      "--sandbox 는 --url 과 함께 쓸 수 없습니다. 격리는 프로세스를 띄우는 대상(--, --command)에만 적용됩니다.",
    );
  const record = paths["--sandbox-session"];
  const replay = paths["--sandbox-replay"];
  if (record !== undefined && replay !== undefined)
    throw new UsageError(
      "--sandbox-session 과 --sandbox-replay 는 함께 쓸 수 없습니다. 녹화와 재생은 따로 실행하세요.",
    );
  const session =
    record !== undefined
      ? ({ mode: "record", path: record } as const)
      : replay !== undefined
        ? ({ mode: "replay", path: replay } as const)
        : undefined;
  const mountPath = paths["--sandbox-mount"];
  return {
    ...(session === undefined ? {} : { session }),
    allowHosts: [...allowHosts],
    compareHost: flags["--compare-host"],
    ...(mountPath === undefined ? {} : { mountPath }),
  };
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
  /** 패키지 실행기로 띄운 서버가 격리 안에서 붙지 못했는가. 해결 줄이 달라진다. */
  let runnerConnectFailed = false;
  const original = auditTarget(input.target);
  // 진행 문장은 stderr 로 간다. `--json` 이어도 stdout 은 JSON 하나뿐이다.
  const progress = (line: string) => deps.writeStderr(`${escapeTerminalText(line)}\n`);
  const connect = async (
    target: AuditTarget,
    env: Readonly<Record<string, string>>,
    advertise: AdvertiseOptions,
  ) => {
    // 격리가 켜지면 audit 가 원래 대상이 아니라 컨테이너를 띄우는 명령(docker run …)을 넘긴다. 그
    // env 에는 컨테이너에 넘길 값과 docker CLI 가 데몬을 찾는 변수가 이미 들어 있어 그대로 쓴다.
    // `--env` 를 여기서 다시 읽어 얹지 않는다. --compare-host 의 둘째 연결은 원래 대상으로 온다.
    if (target !== original) {
      const runner = isPackageRunner(original.command);
      if (runner) progress(RUNNER_PROGRESS);
      try {
        return await deps.connectStdio({
          command: target.command ?? "",
          args: target.args ?? [],
          env,
          advertise,
          ...(runner ? { connectTimeoutMs: RUNNER_CONNECT_TIMEOUT_MS } : {}),
        });
      } catch (error) {
        connectError = error;
        runnerConnectFailed = runner;
        throw error;
      }
    }
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

  let sandbox: SandboxOptions | undefined;
  try {
    sandbox = await sandboxOptions(input, deps);
  } catch (error) {
    if (error instanceof SandboxTargetError) return usageFailure(deps, error.message);
    throw error;
  }

  let report: AuditReport;
  try {
    report = await deps.audit(
      {
        target: original,
        probe: input.probe,
        ...(input.baselinePath === undefined ? {} : { baselinePath: input.baselinePath }),
        updateBaseline: input.updateBaseline,
        ...(sandbox === undefined ? {} : { sandbox }),
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
        ...(sandbox === undefined
          ? {}
          : { sandbox: deps.sandbox.createBackend(progress), progress }),
      },
    );
  } catch (error) {
    const kept = cleanupFailureReport(error);
    if (kept === undefined)
      return writeAuditFailure(deps, input.target, error, connectError, runnerConnectFailed);
    // 정리 실패는 리포트를 버리지 않는다. 발견을 본 사용자가 정리 실패 때문에 그 발견을 잃으면 안
    // 된다. 리포트를 먼저 내고 남은 자원을 말한 뒤 1 로 끝난다(발견이 있어 2 였더라도).
    writeReport(deps, input, kept);
    deps.writeStderr(`${escapeLines((error as Error).message)}\n`);
    return 1;
  }

  writeReport(deps, input, report);
  return report.exitCode;
}

function writeReport(
  deps: AuditCommandDependencies,
  input: AuditCommandInput,
  report: AuditReport,
): void {
  deps.writeStdout(
    input.json ? `${JSON.stringify(report, null, 2)}\n` : escapeLines(deps.renderReport(report)),
  );
}

/**
 * `--sandbox` 를 `audit()` 의 격리 옵션으로 바꾼다. 마운트 범위를 정하지 못하면 `SandboxTargetError`
 * 를 던진다.
 *
 * 호출 정책은 둘이다. 격리가 실제로 켜지면 `sandbox.probe`, 켜지지 않으면 `options.probe` 가 쓰인다.
 * 사용자가 `--probe` 를 주지 않았을 때만 둘이 갈린다(안은 `all`, 밖은 `readonly`).
 */
async function sandboxOptions(
  input: AuditCommandInput,
  deps: AuditCommandDependencies,
): Promise<SandboxOptions | undefined> {
  const requested = input.sandbox;
  // `--url` 과 함께 쓰는 것은 파서가 이미 거절했다.
  if (requested === undefined || input.target.transport !== "stdio") return undefined;
  const { cwd, home, stat } = deps.sandbox;
  const serverArgs = input.target.args;
  const mountRoot = await resolveMountRoot(
    {
      ...(requested.mountPath === undefined ? {} : { mountPath: requested.mountPath }),
      cwd,
      home,
      serverArgs,
    },
    { stat },
  );
  return {
    probe: input.probeExplicit ? input.probe : "all",
    mountRoot,
    // 컨테이너에는 마운트 범위만 있다. 실행한 자리가 그 밖이면 범위의 꼭대기에서 띄운다. 그 경우
    // 서버 인자는 전부 범위 안의 절대 경로다(상대 경로였다면 범위 밖으로 풀려 위에서 거절됐다).
    cwd: isInside(mountRoot, cwd) ? cwd : mountRoot,
    ...(requested.session === undefined ? {} : { session: requested.session }),
    allowHosts: requested.allowHosts,
    compareHost: requested.compareHost,
    declarationTexts: await readDeclarationTexts(
      { mountRoot, cwd, serverArgs },
      { stat, readFile: deps.readFile },
    ),
  };
}

/**
 * 정리 실패(`SandboxCleanupError`)가 실어 온 리포트. 코드와 실린 리포트로 알아본다. 패키지 사본이
 * 둘이면 instanceof 가 어긋나고, 이 오류의 `name` 은 `AuditError` 가 아니라 `isAuditError` 에도 걸리지
 * 않는다.
 */
function cleanupFailureReport(error: unknown): AuditReport | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code, report } = error as { code?: unknown; report?: unknown };
  if (code !== "SANDBOX_CLEANUP_FAILED" || typeof report !== "object" || report === null)
    return undefined;
  return report as AuditReport;
}

/**
 * 감사 실패를 찍는다. 종료 코드는 언제나 1 이다.
 *
 * - AuditError(연결 실패·기준 파일 문제·재생 세션을 읽지 못함): message 가 §6.3 블록 전체다. 그대로 찍는다. 연결
 *   실패면 core 오류가 들고 온 진단(서버 stderr 꼬리, HTTP 엔드포인트)을 그 뒤에 붙인다. 패키지
 *   실행기로 띄운 서버의 격리 접속 실패면 해결 줄만 바꾼다. 원인 줄은 audit 의 것 그대로다.
 * - 기준 파일 쓰기 실패: optimize 의 오버레이 쓰기 실패와 같은 모양.
 * - 그 밖(연결이 선 뒤 tools/list 실패 등): audit 가 감싸지 않고 올린 원래 오류다.
 */
function writeAuditFailure(
  deps: AuditCommandDependencies,
  target: ConnectTarget,
  error: unknown,
  connectError: unknown,
  runnerConnectFailed: boolean,
): number {
  if (isAuditError(error)) {
    const connectFailed = (error as { code: unknown }).code === "CONNECT_FAILED";
    const message = (error as Error).message;
    deps.writeStderr(
      `${escapeLines(connectFailed && runnerConnectFailed ? withRunnerHint(message) : message)}\n`,
    );
    if (connectFailed) writeDiagnostics(deps, connectError);
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

/** 연결 실패 블록의 해결 줄을 패키지 실행기의 것으로 바꾼다. 해결 줄은 블록의 마지막 줄이다. */
function withRunnerHint(message: string): string {
  return [
    ...message.split("\n").filter((line) => !line.startsWith("해결: ")),
    RUNNER_CONNECT_HINT,
  ].join("\n");
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

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  nodePerfDependencies,
  type PerfCommandDependencies,
  runPerfCommand,
} from "@mcpeak/cli/commands";
import type { PerfReport } from "@mcpeak/perf";
import type { AnalyzePerfRequest, AnalyzePerfResponse } from "../api-types.js";
import { resolveProjectPath } from "./paths.js";

/**
 * 성능 측정 실행기. `mcpeak perf --json` 의 커맨드 함수(`runPerfCommand`)를 그대로 돌리고 stdout
 * 바이트를 메모리로 받는다(ADR-0046, ADR-0119). 측정·판정·종료 코드를 여기서 다시 쓰지 않는다.
 *
 * 테스트가 실제 서버에 붙지 않고 fake 를 끼울 수 있도록 커맨드 함수와 동적 import 로더를
 * `overrides` 로 바꿔치기할 수 있게 연다. `analyze-security.ts` 의 `AnalyzeSecurityOverrides` 와 같은 꼴이다.
 */
export interface PerfModuleLoaders {
  readonly loadCore: () => Promise<typeof import("@mcpeak/core")>;
  readonly loadRunner: () => Promise<typeof import("@mcpeak/runner")>;
  readonly loadPerf: () => Promise<typeof import("@mcpeak/perf")>;
}

export interface AnalyzePerfOverrides {
  /** 기본값은 `@mcpeak/cli/commands` 의 `runPerfCommand`. 테스트가 fake 로 바꾼다. */
  readonly runner?: typeof runPerfCommand;
  readonly loaders?: Partial<PerfModuleLoaders>;
  /** `routes.ts` 가 `resolveCandidateEnv` 로 만든 후보 env. */
  readonly candidateEnv?: Readonly<Record<string, string>>;
}

export type PreparePerfOutcome =
  | { readonly ok: true; readonly argv: readonly string[] }
  | { readonly ok: false; readonly error: string };

export type AnalyzePerfOutcome =
  | { readonly ok: true; readonly body: AnalyzePerfResponse }
  | { readonly ok: false; readonly error: string };

/** CLI `perf-command.ts` 의 TARGET_VALUE_OPTIONS 와 같다. 원격 옵션은 perf 가 받지 않으므로 없다. */
const TARGET_VALUE_OPTIONS = new Set(["--command", "--arg", "--env"]);

function usage(token: string): string {
  return `오류 [ANALYZE_USAGE]: argv 에는 대상 옵션(--command, --arg, --env)과 그 값만 실을 수 있습니다: '${token}'\n해결: 측정 옵션은 요청의 suitePath·repeat·tools 필드로 보내세요.`;
}

const REPEAT_RANGE = "반복 횟수는 1 이상 100 이하의 정수여야 합니다.";

/** 요청을 가두고 CLI argv 로 조립한다. 서버에 붙지 않는다. */
export function preparePerfRun(root: string, request: AnalyzePerfRequest): PreparePerfOutcome {
  for (let index = 0; index < request.argv.length; index += 2) {
    const token = request.argv[index] as string;
    if (!TARGET_VALUE_OPTIONS.has(token) || index + 1 >= request.argv.length)
      return { ok: false, error: usage(token) };
  }
  if (resolveProjectPath(root, request.suitePath) === null)
    return { ok: false, error: "허용되지 않는 경로입니다." };
  if (!request.suitePath.endsWith(".json"))
    return { ok: false, error: "명세는 .json 확장자 파일만 쓸 수 있습니다." };
  // 범위는 CLI NUMBER_OPTIONS["--repeat"] 와 같다(perf-command.ts).
  if (
    request.repeat !== undefined &&
    (!Number.isInteger(request.repeat) || request.repeat < 1 || request.repeat > 100)
  )
    return { ok: false, error: REPEAT_RANGE };
  const tools = request.tools ?? [];
  if (tools.some((tool) => tool.trim() === "" || tool.startsWith("--")))
    return { ok: false, error: "도구 이름이 비었거나 옵션처럼 생겼습니다." };
  // 순서를 고정한다. 같은 요청이면 항상 같은 배열이다. 명세 경로는 상대경로 그대로다.
  const argv: string[] = [request.suitePath, "--json"];
  if (request.repeat !== undefined) argv.push("--repeat", String(request.repeat));
  for (const tool of tools) argv.push("--tool", tool);
  argv.push(...request.argv);
  return { ok: true, argv };
}

const RUNTIME_UNAVAILABLE =
  "오류 [ANALYZE_RUNTIME_UNAVAILABLE]: 측정에 필요한 @mcpeak/core·@mcpeak/runner·@mcpeak/perf 를 로드하지 못했습니다.\n해결: 의존성을 설치한 뒤 다시 실행하세요.";

const defaultLoaders: PerfModuleLoaders = {
  loadCore: () => import("@mcpeak/core"),
  loadRunner: () => import("@mcpeak/runner"),
  loadPerf: () => import("@mcpeak/perf"),
};

/** 던져진 값의 첫 줄. 스택이나 여러 줄 메시지를 문장 가운데에 싣지 않는다. */
function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? "";
}

/** 측정을 끝까지 돌린다. 던지지 않는다. `exitCode` 는 run 의 종료 코드가 된다. */
export async function analyzePerf(
  argv: readonly string[],
  io: { readonly writeStderr: (text: string) => void },
  context: { readonly root: string },
  overrides: AnalyzePerfOverrides = {},
): Promise<{ readonly exitCode: number; readonly outcome: AnalyzePerfOutcome }> {
  const runner = overrides.runner ?? runPerfCommand;
  const loaders: PerfModuleLoaders = { ...defaultLoaders, ...overrides.loaders };
  const fail = (error: string) => {
    io.writeStderr(`${error}\n`);
    return { exitCode: 1, outcome: { ok: false as const, error } };
  };

  let core: typeof import("@mcpeak/core");
  let runnerModule: typeof import("@mcpeak/runner");
  let perf: typeof import("@mcpeak/perf");
  try {
    [core, runnerModule, perf] = await Promise.all([
      loaders.loadCore(),
      loaders.loadRunner(),
      loaders.loadPerf(),
    ]);
  } catch {
    return fail(RUNTIME_UNAVAILABLE);
  }

  // CLI 의 조립을 그대로 쓰고 다섯 자리만 바꾼다(ADR-0119). onSignal·killSelf 는 그대로다. 대시보드가
  // 신호로 끝날 때 perf 가 추적 디렉터리(요청 본문 기록)와 자식 서버를 먼저 정리해야 한다.
  const base = nodePerfDependencies(core, runnerModule, perf);
  let stdout = "";
  let stderr = "";
  const deps: PerfCommandDependencies = {
    ...base,
    readEnv: (name) => overrides.candidateEnv?.[name] ?? process.env[name],
    // 명세는 상대경로로 온다. 대시보드 루트 기준으로 푼다. perf 는 바이트를 받는다("utf8" 을 붙이지 않는다).
    readFile: (path) => readFile(resolve(context.root, path)),
    writeFile: (path, text) => writeFile(resolve(context.root, path), text, "utf8"),
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      stderr += text;
      io.writeStderr(text);
    },
  };

  let exitCode: number;
  try {
    exitCode = await runner(argv, deps);
  } catch (error) {
    return fail(
      `오류 [ANALYZE_FAILED]: 측정이 예기치 않게 끝났습니다: ${firstLine(error)}\n해결: 같은 서버에 mcpeak perf 를 터미널에서 직접 돌려 같은 오류가 나는지 확인하세요.`,
    );
  }
  // 리포트 없이 끝났다(사용법 오류, 명세 오류, 연결 실패). CLI 가 stderr 에 쓴 문장이 곧 결과다.
  if (stdout === "") return { exitCode, outcome: { ok: false, error: stderr.replace(/\n+$/, "") } };

  let report: PerfReport;
  try {
    report = JSON.parse(stdout) as PerfReport;
  } catch (error) {
    return fail(
      `오류 [ANALYZE_FAILED]: 측정 결과를 읽지 못했습니다: ${firstLine(error)}\n해결: 같은 서버에 mcpeak perf --json 을 터미널에서 직접 돌려 출력이 JSON 인지 확인하세요.`,
    );
  }
  return {
    exitCode,
    outcome: { ok: true, body: { report, rendered: perf.renderReport(report), exitCode } },
  };
}

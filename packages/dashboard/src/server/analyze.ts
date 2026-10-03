import { type OptimizeCommandDependencies, runOptimizeCommand } from "@mcpeak/cli/commands";
import type { ToolDef } from "@mcpeak/core";
import type { OptimizeOverlay } from "@mcpeak/optimize";
import optimizeMetadata from "../../../optimize/package.json";
import type { AnalyzeTokensResponse } from "../api-types.js";

/**
 * 토큰 분석 실행기. `mcpeak optimize` 의 커맨드 함수(`runOptimizeCommand`)를 그대로 돌리고,
 * `--out` 에 쓸 바이트를 디스크 대신 메모리로 받는다(계획서 §3, ADR-0046). 오버레이 직렬화
 * 규칙이 CLI 한 곳에만 있어야 "CLI 와 같다" 가 구조로 보장된다.
 *
 * 테스트가 실제 서버에 붙지 않고 fake 를 끼울 수 있도록 커맨드 함수와 동적 import 로더를
 * `overrides` 로 바꿔치기할 수 있게 연다. `wiring.ts` 의 `ExecuteFlowOverrides` 와 같은 꼴이다.
 */
export interface AnalyzeModuleLoaders {
  readonly loadCore: () => Promise<typeof import("@mcpeak/core")>;
  readonly loadOptimize: () => Promise<typeof import("@mcpeak/optimize")>;
}

export interface AnalyzeTokensOverrides {
  /** 기본값은 `@mcpeak/cli/commands` 의 `runOptimizeCommand`. 테스트가 fake 로 바꾼다. */
  readonly runner?: typeof runOptimizeCommand;
  readonly loaders?: Partial<AnalyzeModuleLoaders>;
  /** `routes.ts` 가 `resolveCandidateEnv` 로 만든 후보 env. `wiring.ts` 의 같은 필드와 같은 뜻. */
  readonly candidateEnv?: Readonly<Record<string, string>>;
}

export type AnalyzeTokensOutcome =
  | { readonly ok: true; readonly body: AnalyzeTokensResponse }
  | { readonly ok: false; readonly error: string };

const defaultLoaders: AnalyzeModuleLoaders = {
  loadCore: () => import("@mcpeak/core"),
  loadOptimize: () => import("@mcpeak/optimize"),
};

/** `parseOptimizeCommand` 가 `--out` 을 요구해 채우는 자리. 디스크에는 쓰지 않는다(`writeFile` 이 가로챈다). */
const OUT_PLACEHOLDER = "overlay.json";

export async function analyzeTokens(
  argv: readonly string[],
  overrides: AnalyzeTokensOverrides = {},
): Promise<AnalyzeTokensOutcome> {
  // 화면이 보낼 수 없는 옵션. 통과시키면 CLI 가 "`--out`은 한 번만" 이라는 엉뚱한 문장으로 거절한다.
  if (argv.some((token) => token === "--out" || token.startsWith("--out=") || token === "--json")) {
    return {
      ok: false,
      error:
        "오류 [ANALYZE_USAGE]: argv 에 `--out`·`--json` 을 실을 수 없습니다. 저장 위치는 화면의 저장 버튼이 정합니다.",
    };
  }
  const runner = overrides.runner ?? runOptimizeCommand;
  const loaders: AnalyzeModuleLoaders = { ...defaultLoaders, ...overrides.loaders };

  // 모듈 로드. wiring.ts 의 executeRepair 와 같은 꼴.
  let core: typeof import("@mcpeak/core");
  let optimize: typeof import("@mcpeak/optimize");
  try {
    [core, optimize] = await Promise.all([loaders.loadCore(), loaders.loadOptimize()]);
  } catch {
    return {
      ok: false,
      error:
        "오류 [ANALYZE_RUNTIME_UNAVAILABLE]: 분석에 필요한 @mcpeak/core·@mcpeak/optimize 를 로드하지 못했습니다.\n해결: 의존성을 설치한 뒤 다시 실행하세요.",
    };
  }

  // 의존성 조립. cli 의 nodeOptimizeDependencies 와 항목 단위로 같고, 쓰기 세 자리만 메모리다.
  // readEnv 는 wiring.ts 의 createReadEnv 와 같은 규칙(후보 env 가 process.env 를 이긴다)이다.
  // 그 함수는 export 되지 않아 여기 한 줄로 다시 적는다.
  let overlayText: string | undefined;
  // 화면의 before/after 비교용 원본. 오버레이에서는 역산할 수 없다(지운 키의 값이 남지 않는다).
  let sourceTools: readonly ToolDef[] | undefined;
  let stdout = "";
  let stderr = "";
  const deps: OptimizeCommandDependencies = {
    connectStdio: core.connectStdio,
    connectHttp: core.connectHttp,
    readEnv: (name) => overrides.candidateEnv?.[name] ?? process.env[name],
    optimize: (input, version) => {
      sourceTools = input.tools;
      return optimize.optimize(input, version);
    },
    renderReport: optimize.renderReport,
    // CLI 와 같은 값이어야 overlay.generator.version 이 같아진다(계획서 §1.3-1).
    generatorVersion: optimizeMetadata.version,
    writeFile: async (_path, text) => {
      overlayText = text;
    },
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      stderr += text;
    },
  };

  // `--json` 없이 돌리므로 stdout 은 사람용 리포트다.
  const exitCode = await runner(["--out", OUT_PLACEHOLDER, ...argv], deps);
  // exitCode 0 인데 overlayText 가 비는 경우는 runOptimizeCommand 계약상 없다. 방어로만 둔다.
  if (exitCode !== 0 || overlayText === undefined) {
    return { ok: false, error: stderr.replace(/\n+$/, "") };
  }
  return {
    ok: true,
    body: {
      overlay: JSON.parse(overlayText) as OptimizeOverlay,
      overlayText,
      report: stdout,
      // exitCode 0 이면 계약상 항상 채워진다. [] 는 방어다.
      sourceTools: sourceTools ?? [],
    },
  };
}

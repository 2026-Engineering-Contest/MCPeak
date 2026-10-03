import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { OptimizeCommandDependencies } from "@mcpeak/cli/commands";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeTokens } from "../src/server/analyze.js";

function fakeCoreModule(): typeof import("@mcpeak/core") {
  return {
    connectStdio: vi.fn(),
    connectHttp: vi.fn(),
  } as unknown as typeof import("@mcpeak/core");
}

function fakeOptimizeModule(): typeof import("@mcpeak/optimize") {
  return {
    optimize: vi.fn(),
    renderReport: vi.fn(),
  } as unknown as typeof import("@mcpeak/optimize");
}

type Runner = (argv: readonly string[], deps: OptimizeCommandDependencies) => Promise<number>;

/** runner 가 받은 argv·deps 를 잡아 두고 `body` 를 돌린다. */
function capturingRunner(
  body: (deps: OptimizeCommandDependencies) => Promise<number> | number = () => 0,
) {
  const seen: { argv?: readonly string[]; deps?: OptimizeCommandDependencies } = {};
  const runner = vi.fn<Runner>(async (argv, deps) => {
    seen.argv = argv;
    seen.deps = deps;
    return body(deps);
  });
  return { runner, seen };
}

function loadersFor(core = fakeCoreModule(), optimize = fakeOptimizeModule()) {
  return {
    core,
    optimize,
    loaders: { loadCore: async () => core, loadOptimize: async () => optimize },
  };
}

const ARGV = ["--command", "node", "--arg", "s.mjs"] as const;

afterEach(() => {
  delete process.env.ANALYZE_T;
});

describe("analyzeTokens", () => {
  it("argv 앞에 --out 자리표시자를 붙여 runner 에 넘긴다", async () => {
    const { runner, seen } = capturingRunner(() => 1);
    await analyzeTokens(ARGV, { runner, loaders: loadersFor().loaders });
    expect(seen.argv).toEqual(["--out", "overlay.json", "--command", "node", "--arg", "s.mjs"]);
  });

  it("의존성에 connectStdio·connectHttp·readEnv·optimize·renderReport·generatorVersion·writeFile·writeStdout·writeStderr 가 전부 있다", async () => {
    const { runner, seen } = capturingRunner(() => 1);
    const { core, optimize, loaders } = loadersFor();
    await analyzeTokens(ARGV, { runner, loaders });
    const keys = Object.keys(seen.deps ?? {});
    for (const key of [
      "connectStdio",
      "connectHttp",
      "readEnv",
      "optimize",
      "renderReport",
      "generatorVersion",
      "writeFile",
      "writeStdout",
      "writeStderr",
    ]) {
      expect(keys).toContain(key);
    }
    expect(seen.deps?.connectStdio).toBe(core.connectStdio);
    expect(seen.deps?.renderReport).toBe(optimize.renderReport);
  });

  it("deps.optimize 는 optimize.optimize 에 같은 인자를 넘기고 그 반환값을 돌려준다", async () => {
    const { runner, seen } = capturingRunner(() => 1);
    const { optimize, loaders } = loadersFor();
    const overlay = { schemaVersion: 1 };
    vi.mocked(optimize.optimize).mockReturnValue(overlay as never);
    await analyzeTokens(ARGV, { runner, loaders });
    const input = { tools: [], instructions: "", otherCapabilities: [] };
    expect(seen.deps?.optimize(input, "v")).toBe(overlay);
    expect(optimize.optimize).toHaveBeenCalledWith(input, "v");
  });

  it("generatorVersion 은 packages/optimize/package.json 의 version 이다", async () => {
    const { runner, seen } = capturingRunner(() => 1);
    await analyzeTokens(ARGV, { runner, loaders: loadersFor().loaders });
    const manifest = JSON.parse(
      await readFile(new URL("../../optimize/package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(seen.deps?.generatorVersion).toBe(manifest.version);
  });

  it("writeFile 로 받은 텍스트가 overlayText 이고 overlay 는 그것을 파싱한 값, report 는 stdout 누적이다", async () => {
    const { runner } = capturingRunner(async (deps) => {
      await deps.writeFile("overlay.json", '{\n  "a": 1\n}\n');
      deps.writeStdout("r1\n");
      deps.writeStdout("r2\n");
      return 0;
    });
    const result = await analyzeTokens(ARGV, { runner, loaders: loadersFor().loaders });
    expect(result).toEqual({
      ok: true,
      body: {
        overlay: { a: 1 },
        overlayText: '{\n  "a": 1\n}\n',
        report: "r1\nr2\n",
        sourceTools: [],
      },
    });
  });

  it("sourceTools 는 optimize 에 들어간 input.tools 그대로다", async () => {
    const tools = [{ name: "t", description: "T", inputSchema: { type: "object" } }];
    const { runner } = capturingRunner(async (deps) => {
      deps.optimize({ tools, instructions: "", otherCapabilities: [] }, "v");
      await deps.writeFile("overlay.json", '{\n  "a": 1\n}\n');
      return 0;
    });
    const result = await analyzeTokens(ARGV, { runner, loaders: loadersFor().loaders });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.body.sourceTools : undefined).toBe(tools);
  });

  it("sourceTools 를 받아도 overlayText·report 는 바뀌지 않는다", async () => {
    const tools = [{ name: "t", inputSchema: {} }];
    const { runner } = capturingRunner(async (deps) => {
      deps.optimize({ tools, instructions: "", otherCapabilities: [] }, "v");
      await deps.writeFile("overlay.json", '{\n  "a": 1\n}\n');
      deps.writeStdout("r1\n");
      deps.writeStdout("r2\n");
      return 0;
    });
    const result = await analyzeTokens(ARGV, { runner, loaders: loadersFor().loaders });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.overlayText).toBe('{\n  "a": 1\n}\n');
    expect(result.body.overlay).toEqual({ a: 1 });
    expect(result.body.report).toBe("r1\nr2\n");
  });

  it("디스크에는 아무것도 쓰지 않는다", async () => {
    const { runner } = capturingRunner(async (deps) => {
      await deps.writeFile("overlay.json", '{\n  "a": 1\n}\n');
      return 0;
    });
    await analyzeTokens(ARGV, { runner, loaders: loadersFor().loaders });
    expect(existsSync("overlay.json")).toBe(false);
  });

  it("종료 코드가 0 이 아니면 ok:false 이고 error 는 stderr 누적에서 끝 개행만 뗀 것이다", async () => {
    const { runner } = capturingRunner((deps) => {
      deps.writeStderr("오류 [CLI_USAGE]: x\n해결: y\n");
      return 1;
    });
    const result = await analyzeTokens(ARGV, { runner, loaders: loadersFor().loaders });
    expect(result).toEqual({ ok: false, error: "오류 [CLI_USAGE]: x\n해결: y" });
  });

  it("candidateEnv 가 process.env 보다 먼저다", async () => {
    process.env.ANALYZE_T = "from-process";
    const { runner, seen } = capturingRunner(() => 1);
    await analyzeTokens(ARGV, {
      runner,
      loaders: loadersFor().loaders,
      candidateEnv: { ANALYZE_T: "from-candidate" },
    });
    expect(seen.deps?.readEnv?.("ANALYZE_T")).toBe("from-candidate");
    expect(seen.deps?.readEnv?.("ANALYZE_NONE")).toBeUndefined();
  });

  it("argv 에 --out 이나 --json 이 있으면 runner 를 부르지 않는다", async () => {
    const { runner } = capturingRunner();
    for (const argv of [["--json"], ["--out=x"]]) {
      const result = await analyzeTokens(argv, { runner, loaders: loadersFor().loaders });
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.error).toMatch(/^오류 \[ANALYZE_USAGE\]:/);
    }
    expect(runner).toHaveBeenCalledTimes(0);
  });

  it("모듈을 못 읽으면 ANALYZE_RUNTIME_UNAVAILABLE 문장이다", async () => {
    const { runner } = capturingRunner();
    const result = await analyzeTokens(ARGV, {
      runner,
      loaders: {
        loadCore: async () => fakeCoreModule(),
        loadOptimize: () => Promise.reject(new Error("missing")),
      },
    });
    expect(result.ok).toBe(false);
    const error = result.ok ? "" : result.error;
    expect(error).toMatch(/^오류 \[ANALYZE_RUNTIME_UNAVAILABLE\]:/);
    expect(error).toContain("\n해결:");
    expect(runner).toHaveBeenCalledTimes(0);
  });
});

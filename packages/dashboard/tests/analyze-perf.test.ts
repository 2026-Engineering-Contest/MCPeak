import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PerfCommandDependencies } from "@mcpeak/cli/commands";
import type { CallOutcome, CaseResult, PerfFinding, PerfReport } from "@mcpeak/perf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzePerfRequest } from "../src/api-types.js";
import { analyzePerf, preparePerfRun } from "../src/server/analyze-perf.js";

/**
 * `nodePerfDependencies` 가 읽는 필드만 채운 fake 모듈. 서버에 붙지 않는다(설계 §3.7).
 * `renderReport` 만 결과를 단언하려고 고정 문자열을 돌려준다.
 */
function fakeLoaders() {
  const core = { connectStdio: vi.fn() } as unknown as typeof import("@mcpeak/core");
  const runner = { validateMcpSuite: vi.fn() } as unknown as typeof import("@mcpeak/runner");
  const perf = {
    measure: vi.fn(),
    readTrace: vi.fn(),
    analyze: vi.fn(),
    compareBaseline: vi.fn(),
    toBaseline: vi.fn(),
    parseBaseline: vi.fn(),
    renderReport: () => "R\n",
    childEnvironment: vi.fn(),
  } as unknown as typeof import("@mcpeak/perf");
  return {
    loadCore: async () => core,
    loadRunner: async () => runner,
    loadPerf: async () => perf,
  };
}

type Runner = (argv: readonly string[], deps: PerfCommandDependencies) => Promise<number>;

function capturingIo() {
  const written: string[] = [];
  return { written, io: { writeStderr: (text: string) => void written.push(text) } };
}

function perfCase(
  id: string,
  tool: string,
  p50: number | undefined,
  outcomes: Partial<Record<CallOutcome, number>> = {},
): CaseResult {
  return {
    id,
    tool,
    n: p50 === undefined ? 0 : 5,
    outcomes: { ok: 5, isError: 0, empty: 0, threw: 0, skipped: 0, missingTool: 0, ...outcomes },
    ...(p50 === undefined ? {} : { total: { p50, p95: p50, min: p50, max: p50 } }),
    dependency: { dependent: 0, independent: 0, unknown: 0 },
    requestSummaries: [],
  };
}

function sequential(tool: string, saving: number): PerfFinding {
  return {
    ruleId: "perf/sequential-independent",
    caseIds: [tool],
    tools: [tool],
    lines: [],
    evidence: { observed: 5, of: 5, requests: [], savingUpperBoundMs: saving },
  };
}

/** web 쪽 `perfResponse().report`(계획 §4.6)와 같은 필드·값이다. */
const REPORT: PerfReport = {
  schemaVersion: 1,
  generator: { name: "@mcpeak/perf", version: "0.0.0" },
  server: { command: "node s.mjs", toolCount: 6 },
  settings: { repeat: 5, intervalMs: 0, caseCount: 3, observation: "preload" },
  coldStart: { connectMs: 80, listToolsMs: 3 },
  cases: [
    perfCase("a", "get_forecast", 412.4),
    perfCase("b", "compare_cities", 600.6),
    perfCase("c", "lookup_country", undefined),
  ],
  findings: [
    sequential("compare_cities", 299.5),
    sequential("get_forecast", 120.4),
    {
      ruleId: "perf/repeated-request",
      caseIds: ["a"],
      tools: ["get_forecast"],
      lines: [],
      evidence: { observed: 5, of: 5, requests: [] },
    },
  ],
  undecidedCases: 0,
  aborted: null,
  exitCode: 0,
};

const ARGV = ["s.json", "--json", "--command", "node"];

function request(overrides: Partial<AnalyzePerfRequest> = {}): AnalyzePerfRequest {
  return { argv: ["--command", "node"], suitePath: "s.json", ...overrides };
}

const USAGE = (token: string) =>
  `오류 [ANALYZE_USAGE]: argv 에는 대상 옵션(--command, --arg, --env)과 그 값만 실을 수 있습니다: '${token}'\n해결: 측정 옵션은 요청의 suitePath·repeat·tools 필드로 보내세요.`;

const REPEAT_RANGE = "반복 횟수는 1 이상 100 이하의 정수여야 합니다.";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-analyze-perf-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("preparePerfRun", () => {
  it("preparePerfRun 은 대상 옵션 쌍만 argv 로 받는다", () => {
    expect(preparePerfRun(root, request({ argv: ["--json"] }))).toEqual({
      ok: false,
      error: USAGE("--json"),
    });
    expect(preparePerfRun(root, request({ argv: ["--url", "http://x"] }))).toEqual({
      ok: false,
      error: USAGE("--url"),
    });
    expect(preparePerfRun(root, request({ argv: ["--command"] }))).toEqual({
      ok: false,
      error: USAGE("--command"),
    });
  });

  it("preparePerfRun 은 명세 경로를 가둔다", () => {
    for (const suitePath of ["../x.json", "/abs/x.json"]) {
      expect(preparePerfRun(root, request({ suitePath }))).toEqual({
        ok: false,
        error: "허용되지 않는 경로입니다.",
      });
    }
    expect(preparePerfRun(root, request({ suitePath: "a.txt" }))).toEqual({
      ok: false,
      error: "명세는 .json 확장자 파일만 쓸 수 있습니다.",
    });
  });

  it("preparePerfRun 은 반복 횟수 범위를 CLI 와 같게 본다", () => {
    for (const repeat of [0, 101, 1.5]) {
      expect(preparePerfRun(root, request({ repeat }))).toEqual({
        ok: false,
        error: REPEAT_RANGE,
      });
    }
    for (const repeat of [1, 100]) {
      expect(preparePerfRun(root, request({ repeat })).ok).toBe(true);
    }
  });

  it("preparePerfRun 은 옵션처럼 생긴 도구 이름을 거절한다", () => {
    for (const tools of [["--json"], [" "]]) {
      expect(preparePerfRun(root, request({ tools }))).toEqual({
        ok: false,
        error: "도구 이름이 비었거나 옵션처럼 생겼습니다.",
      });
    }
  });

  it("preparePerfRun 은 순서를 고정해 조립한다", () => {
    const outcome = preparePerfRun(root, {
      argv: ["--command", "node", "--arg", "s.mjs"],
      suitePath: "examples/x/server.suite.json",
      repeat: 3,
      tools: ["b", "a"],
    });
    expect(outcome).toEqual({
      ok: true,
      argv: [
        "examples/x/server.suite.json",
        "--json",
        "--repeat",
        "3",
        "--tool",
        "b",
        "--tool",
        "a",
        "--command",
        "node",
        "--arg",
        "s.mjs",
      ],
    });
  });

  it("preparePerfRun 은 빠진 선택 필드를 싣지 않는다", () => {
    expect(preparePerfRun(root, { argv: ["--command", "node"], suitePath: "s.json" })).toEqual({
      ok: true,
      argv: ["s.json", "--json", "--command", "node"],
    });
  });
});

describe("analyzePerf", () => {
  it("analyzePerf 는 stdout 의 리포트와 renderReport 결과를 돌려준다", async () => {
    const runner = vi.fn<Runner>(async (_argv, deps) => {
      deps.writeStdout(`${JSON.stringify(REPORT, null, 2)}\n`);
      return 0;
    });
    const result = await analyzePerf(
      ARGV,
      capturingIo().io,
      { root },
      { runner, loaders: fakeLoaders() },
    );
    expect(runner).toHaveBeenCalledWith(ARGV, expect.anything());
    expect(result.exitCode).toBe(0);
    expect(result.outcome).toEqual({
      ok: true,
      body: { report: REPORT, rendered: "R\n", exitCode: 0 },
    });
  });

  it("analyzePerf 는 리포트 없이 끝나면 stderr 원문을 오류로 낸다", async () => {
    const text = "오류 [PERF_X]: 문장\n→ 해결\n\n";
    const runner = vi.fn<Runner>(async (_argv, deps) => {
      deps.writeStderr(text);
      return 1;
    });
    const { written, io } = capturingIo();
    const result = await analyzePerf(ARGV, io, { root }, { runner, loaders: fakeLoaders() });
    expect(result).toEqual({
      exitCode: 1,
      outcome: { ok: false, error: "오류 [PERF_X]: 문장\n→ 해결" },
    });
    expect(written.join("")).toBe(text);
  });

  it("analyzePerf 는 runner 가 던지면 ANALYZE_FAILED 첫 줄만 싣는다", async () => {
    const runner = vi.fn<Runner>(async () => {
      throw new Error("터짐\n스택");
    });
    const result = await analyzePerf(
      ARGV,
      capturingIo().io,
      { root },
      { runner, loaders: fakeLoaders() },
    );
    expect(result.exitCode).toBe(1);
    expect(result.outcome.ok).toBe(false);
    const error = result.outcome.ok ? "" : result.outcome.error;
    expect(
      error.startsWith("오류 [ANALYZE_FAILED]: 측정이 예기치 않게 끝났습니다: 터짐\n해결: "),
    ).toBe(true);
    expect(error).not.toContain("스택");
  });

  it("analyzePerf 는 모듈을 못 읽으면 RUNTIME_UNAVAILABLE", async () => {
    const runner = vi.fn<Runner>(async () => 0);
    const result = await analyzePerf(
      ARGV,
      capturingIo().io,
      { root },
      {
        runner,
        loaders: { ...fakeLoaders(), loadPerf: () => Promise.reject(new Error("missing")) },
      },
    );
    expect(result.exitCode).toBe(1);
    const error = result.outcome.ok ? "" : result.outcome.error;
    expect(error.startsWith("오류 [ANALYZE_RUNTIME_UNAVAILABLE]: ")).toBe(true);
    expect(runner).not.toHaveBeenCalled();
  });

  it("analyzePerf 는 후보 env 를 process.env 보다 먼저 읽는다", async () => {
    const previous = { A: process.env.A, B: process.env.B };
    process.env.A = "2";
    process.env.B = "3";
    const seen: (string | undefined)[] = [];
    try {
      const runner = vi.fn<Runner>(async (_argv, deps) => {
        seen.push(deps.readEnv("A"), deps.readEnv("B"));
        return 1;
      });
      await analyzePerf(
        ARGV,
        capturingIo().io,
        { root },
        { runner, loaders: fakeLoaders(), candidateEnv: { A: "1" } },
      );
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expect(seen).toEqual(["1", "3"]);
  });

  it("analyzePerf 의 readFile 은 루트 기준이고 바이트를 돌려준다", async () => {
    await writeFile(join(root, "s.json"), '{"a":1}', "utf8");
    let bytes: unknown;
    const runner = vi.fn<Runner>(async (_argv, deps) => {
      bytes = await deps.readFile("s.json");
      return 1;
    });
    await analyzePerf(ARGV, capturingIo().io, { root }, { runner, loaders: fakeLoaders() });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe('{"a":1}');
  });

  it("analyzePerf 의 writeFile 은 루트 기준이다", async () => {
    await mkdir(join(root, "out"));
    const runner = vi.fn<Runner>(async (_argv, deps) => {
      await deps.writeFile("out/b.json", "x");
      return 1;
    });
    await analyzePerf(ARGV, capturingIo().io, { root }, { runner, loaders: fakeLoaders() });
    await expect(readFile(join(root, "out/b.json"), "utf8")).resolves.toBe("x");
  });

  it("analyzePerf 는 신호 처리기를 그대로 둔다", async () => {
    const counts: number[] = [];
    const runner = vi.fn<Runner>(async (_argv, deps) => {
      const before = process.listenerCount("SIGINT");
      const off = deps.onSignal(async () => {});
      counts.push(before, process.listenerCount("SIGINT"));
      off();
      counts.push(process.listenerCount("SIGINT"));
      return 1;
    });
    await analyzePerf(ARGV, capturingIo().io, { root }, { runner, loaders: fakeLoaders() });
    const [before = -1, during, after] = counts;
    expect(during).toBe(before + 1);
    expect(after).toBe(before);
  });
});

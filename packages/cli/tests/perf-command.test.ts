import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpStdioConnection, ToolDef } from "@mcpeak/core";
import type { PerfPlan, PerfReport, TraceEntry } from "@mcpeak/perf";
import * as perf from "@mcpeak/perf";
import { validateMcpSuite } from "@mcpeak/runner";
import { describe, expect, it, vi } from "vitest";
import { PERF_USAGE, PERF_USAGE_HINT } from "../src/help.js";
import { nodePerfDependencies, run } from "../src/index.js";
import {
  type PerfCommandDependencies,
  type PerfSignal,
  parsePerfCommand,
  runPerfCommand,
} from "../src/perf-command.js";

/**
 * 설계 §10.2 와 계획 §8.3 의 단언. 서버는 띄우지 않는다. 측정·분석은 실제 `@mcpeak/perf` 를
 * 쓰되 추적 읽기만 가짜로 둔다(추적 디렉터리가 실제로 없기 때문이다).
 */

const SUITE = "/w/server.suite.json";
const BASELINE = "/w/perf.baseline.json";
const HELLO: TraceEntry = { kind: "hello", pid: 1, ppid: 0, node: "v24.14.0", t: 0 };

function callCase(
  id: string,
  tool: string,
  extra: { readonly reject?: boolean; readonly timeoutMs?: number; readonly input?: object } = {},
) {
  return {
    id,
    name: id,
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
    operation: { type: "callTool", tool, input: extra.input ?? {} },
    assertions: [{ type: "isError", expected: extra.reject === true }],
  };
}

function suite(cases: readonly object[], defaultTimeoutMs?: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: "s",
    name: "s",
    ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
    cases,
  });
}

const TWO_CASES = suite([callCase("a-ok", "a"), callCase("b-ok", "b")]);
const TOOLS: ToolDef[] = [
  { name: "a", inputSchema: { type: "object" } },
  { name: "b", inputSchema: { type: "object" } },
];

function fakeConnection(): { connection: McpStdioConnection; closed: () => number } {
  let closed = 0;
  const connection: McpStdioConnection = {
    client: {
      listTools: async () => TOOLS,
      callTool: async () => ({ content: [{ type: "text", text: "ok" }], isError: false, raw: {} }),
      close: async () => {},
    },
    getDiagnostics: () => ({ stderr: "", stderrTruncated: false, exitCode: null, signal: null }),
    close: async () => {
      closed += 1;
    },
    forceClose: async () => {},
  };
  return { connection, closed: () => closed };
}

function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
    code: "ENOENT",
  });
}

function harness(
  options: {
    readonly files?: Readonly<Record<string, string>>;
    readonly trace?: readonly TraceEntry[];
    readonly perf?: Partial<PerfCommandDependencies["perf"]>;
    readonly extra?: Partial<PerfCommandDependencies>;
  } = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const written = new Map<string, string>();
  const files: Readonly<Record<string, string>> = { [SUITE]: TWO_CASES, ...options.files };
  const { connection, closed } = fakeConnection();
  const connectStdio = vi.fn(async () => connection);
  const removeDir = vi.fn(async () => {});
  const writeFileFake = vi.fn(async (path: string, text: string) => {
    written.set(path, text);
  });
  // 신호 처리기는 등록만 기록하고 실제 프로세스 신호에는 달지 않는다.
  const handlers: ((signal: PerfSignal) => Promise<void>)[] = [];
  const detach = vi.fn();
  const onSignal = vi.fn((handler: (signal: PerfSignal) => Promise<void>) => {
    handlers.push(handler);
    return detach;
  });
  let clock = 1000;
  const deps: PerfCommandDependencies = {
    connectStdio,
    readEnv: () => undefined,
    readFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw enoent(path);
      return new TextEncoder().encode(text);
    },
    writeFile: writeFileFake,
    makeTempDir: async () => "/tmp/mcpeak-perf-fake",
    removeDir,
    removeDirSync: vi.fn(),
    onSignal,
    killSelf: vi.fn(),
    now: () => {
      clock += 1;
      return clock;
    },
    // 간격 sleep(signal 없음)은 바로 끝나고, 타임아웃 경쟁의 sleep 은 끝나지 않는다.
    sleep: (_ms, signal) => (signal === undefined ? Promise.resolve() : new Promise(() => {})),
    validateSuite: validateMcpSuite,
    perf: {
      measure: perf.measure,
      readTrace: async () => ({ entries: options.trace ?? [], skippedLines: 0 }),
      analyze: perf.analyze,
      compareBaseline: perf.compareBaseline,
      toBaseline: perf.toBaseline,
      parseBaseline: perf.parseBaseline,
      renderReport: perf.renderReport,
      childEnvironment: perf.childEnvironment,
      ...options.perf,
    },
    generatorVersion: "9.9.9",
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
    ...options.extra,
  };
  return {
    deps,
    connectStdio,
    removeDir,
    writeFile: writeFileFake,
    written,
    closed,
    connection,
    onSignal,
    detach,
    /** 등록된 신호 처리기를 흉내 내어 부른다. 처리기가 없으면 실패한다. */
    signal: async (signal: PerfSignal) => {
      const handler = handlers.at(-1);
      if (handler === undefined) throw new Error("신호 처리기가 등록되지 않았다");
      await handler(signal);
    },
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  };
}

/** 측정에 넘어간 plan 을 잡는다. */
function capturePlan(): { plan: () => PerfPlan; measure: typeof perf.measure } {
  let captured: PerfPlan | undefined;
  return {
    plan: () => {
      if (captured === undefined) throw new Error("measure 가 불리지 않았다");
      return captured;
    },
    measure: (input) => {
      captured = input.plan;
      return perf.measure(input);
    },
  };
}

const usage = (message: string, hint = PERF_USAGE_HINT) =>
  `오류 [CLI_USAGE]: ${message}\n해결: ${hint}\n`;

async function usageError(argv: readonly string[]): Promise<string> {
  const h = harness();
  await expect(runPerfCommand(argv, h.deps)).resolves.toBe(1);
  expect(h.connectStdio).not.toHaveBeenCalled();
  return h.stderr();
}

const REMOTE_REJECTION =
  "오류 [CLI_USAGE]: perf 는 원격(Streamable HTTP) 서버를 지원하지 않습니다.\n" +
  "→ 측정은 서버 프로세스 안에 관측 코드를 실어야 하는데, 우리가 띄우지 않은 프로세스에는 실을 수 없습니다.\n" +
  "해결: mcpeak perf <suite.json> -- <서버 명령>\n";

describe("parsePerfCommand", () => {
  it("기본값", () => {
    expect(parsePerfCommand(["s.json", "--", "node", "server.mjs"])).toEqual({
      suitePath: "s.json",
      target: { transport: "stdio", command: "node", args: ["server.mjs"], envNames: [] },
      repeat: 5,
      intervalMs: 0,
      tools: [],
      updateBaseline: false,
      thresholdPct: 50,
      thresholdMs: 20,
      json: false,
    });
  });

  it("각 옵션을 공백 형식과 = 형식으로 받는다", () => {
    const spaced = parsePerfCommand([
      "s.json",
      "--repeat",
      "3",
      "--interval-ms",
      "100",
      "--tool",
      "a",
      "--tool",
      "b",
      "--baseline",
      "base.json",
      "--threshold-pct",
      "125",
      "--threshold-ms",
      "0",
      "--json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
    ]);
    const equals = parsePerfCommand([
      "s.json",
      "--repeat=3",
      "--interval-ms=100",
      "--tool=a",
      "--tool=b",
      "--baseline=base.json",
      "--threshold-pct=125",
      "--threshold-ms=0",
      "--json",
      "--",
      "node",
      "server.mjs",
    ]);
    const expected = {
      suitePath: "s.json",
      target: { transport: "stdio", command: "node", args: ["server.mjs"], envNames: [] },
      repeat: 3,
      intervalMs: 100,
      tools: ["a", "b"],
      baselinePath: "base.json",
      // `--update-baseline` 은 `--tool` 과 함께 쓸 수 없어(계획 E26) 여기서 빼고 아래 테스트가 따로 본다.
      updateBaseline: false,
      thresholdPct: 125,
      thresholdMs: 0,
      json: true,
    };
    expect(spaced).toEqual(expected);
    expect(equals).toEqual(expected);
  });

  it("명세 경로가 옵션 뒤에 와도 첫 위치 인자다", () => {
    expect(parsePerfCommand(["--repeat", "2", "s.json", "--", "node"]).suitePath).toBe("s.json");
  });

  it("--env 이름을 대상에 싣는다", () => {
    expect(
      parsePerfCommand(["s.json", "--env", "API_KEY", "--", "node", "server.mjs"]).target,
    ).toEqual({ transport: "stdio", command: "node", args: ["server.mjs"], envNames: ["API_KEY"] });
  });

  it("-- 뒤의 옵션 모양 토큰은 서버 인자다", () => {
    expect(
      parsePerfCommand(["s.json", "--", "node", "x", "--repeat", "9", "--url", "u"]).target,
    ).toEqual({
      transport: "stdio",
      command: "node",
      args: ["x", "--repeat", "9", "--url", "u"],
      envNames: [],
    });
  });

  it.each([
    [["s.json", "--repeat"], "`--repeat` 옵션 값이 필요합니다."],
    [["s.json", "--repeat", "--json", "--", "node"], "`--repeat` 옵션 값이 필요합니다."],
    [["s.json", "--interval-ms=", "--", "node"], "`--interval-ms` 옵션 값이 필요합니다."],
    [["s.json", "--tool", "--", "node"], "`--tool` 옵션 값이 필요합니다."],
    [["s.json", "--baseline", "--json", "--", "node"], "`--baseline` 옵션 값이 필요합니다."],
    [["s.json", "--threshold-pct", "--", "node"], "`--threshold-pct` 옵션 값이 필요합니다."],
    [["s.json", "--threshold-ms", "--", "node"], "`--threshold-ms` 옵션 값이 필요합니다."],
  ])("값 누락 %j", async (argv, message) => {
    expect(await usageError(argv)).toBe(usage(message));
  });

  it.each([
    ["--repeat", ["--repeat", "2", "--repeat", "3"]],
    ["--interval-ms", ["--interval-ms=1", "--interval-ms", "2"]],
    ["--baseline", ["--baseline", "a.json", "--baseline=b.json"]],
    ["--update-baseline", ["--baseline", "a.json", "--update-baseline", "--update-baseline"]],
    ["--threshold-pct", ["--threshold-pct", "1", "--threshold-pct", "2"]],
    ["--threshold-ms", ["--threshold-ms", "1", "--threshold-ms", "2"]],
    ["--json", ["--json", "--json"]],
  ])("%s 를 두 번 주면 거절한다", async (name, options) => {
    expect(await usageError(["s.json", ...options, "--", "node"])).toBe(
      usage(`\`${name}\`은 한 번만 사용할 수 있습니다.`),
    );
  });

  it.each([
    ["--repeat", "0", "1 이상 100 이하"],
    ["--repeat", "101", "1 이상 100 이하"],
    ["--repeat", "2.5", "1 이상 100 이하"],
    ["--repeat", "abc", "1 이상 100 이하"],
    ["--interval-ms", "-1", "0 이상 60000 이하"],
    ["--interval-ms", "60001", "0 이상 60000 이하"],
    ["--threshold-pct", "1001", "0 이상 1000 이하"],
    ["--threshold-ms", "60001", "0 이상 60000 이하"],
  ])("범위 밖 숫자 %s %s", async (name, value, range) => {
    expect(await usageError(["s.json", `${name}=${value}`, "--", "node"])).toBe(
      usage(`\`${name}\` 는 ${range}의 정수여야 합니다. 받은 값: '${value}'`),
    );
  });

  it("값을 받지 않는 옵션에 값을 주면 거절한다", async () => {
    expect(await usageError(["s.json", "--json=yes", "--", "node"])).toBe(
      usage("`--json`은 값을 받지 않습니다."),
    );
    expect(
      await usageError(["s.json", "--baseline", "b.json", "--update-baseline=1", "--", "node"]),
    ).toBe(usage("`--update-baseline`은 값을 받지 않습니다."));
  });

  it.each([
    [["s.json", "--url", "http://127.0.0.1:1/mcp"]],
    [["s.json", "--url=http://127.0.0.1:1/mcp"]],
    [["s.json", "--command", "node", "--header-env", "Authorization=TOKEN"]],
    [["s.json", "--header-env=Authorization=TOKEN", "--", "node"]],
  ])("--url·--header-env 는 원격 거절 문장 %j", async (argv) => {
    expect(await usageError(argv)).toBe(REMOTE_REJECTION);
  });

  it("--url 은 위치 인자보다 먼저 거절한다", async () => {
    const first = await usageError(["--url", "http://127.0.0.1:1/mcp", "x.json"]);
    const last = await usageError(["x.json", "--url", "http://127.0.0.1:1/mcp"]);
    expect(first).toBe(REMOTE_REJECTION);
    expect(last).toBe(first);
    // 명세 경로가 없어도, 다른 옵션이 틀려도 원격 문장이 먼저다.
    expect(await usageError(["--repeat", "0", "--url", "u"])).toBe(REMOTE_REJECTION);
  });

  it.each([
    "--junit",
    "--repair-bundle=x",
    "--determinism",
    "--reset-cmd",
    "--stderr-lines=3",
    "--session",
    "--record-session",
  ])("test 전용 옵션 %s 는 perf 이름으로 거절한다", async (option) => {
    expect(await usageError(["s.json", option, "--", "node"])).toBe(
      usage(`지원하지 않는 perf 옵션 '${option.split("=")[0]}'입니다.`),
    );
  });

  it("--update-baseline 단독은 거절한다", async () => {
    expect(await usageError(["s.json", "--update-baseline", "--", "node"])).toBe(
      usage("--update-baseline 은 --baseline <path> 와 함께 써야 합니다."),
    );
  });

  it("--update-baseline 과 --tool 을 함께 주면 측정 전에 거절한다(계획 E26)", async () => {
    const measure = vi.fn(perf.measure);
    const h = harness({ perf: { measure } });
    await expect(
      runPerfCommand(
        [SUITE, "--baseline", BASELINE, "--update-baseline", "--tool", "a", "--", "node"],
        h.deps,
      ),
    ).resolves.toBe(1);
    expect(h.stderr()).toBe(
      `오류 [CLI_USAGE]: --update-baseline 은 --tool 과 함께 쓸 수 없습니다. 기준은 명세 전체로 갱신합니다.\n해결: ${PERF_USAGE_HINT}\n`,
    );
    expect(h.connectStdio).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it("명세 경로가 없으면 test 와 같은 문장에 perf 사용법", async () => {
    expect(await usageError(["--", "node"])).toBe(usage("테스트 명세 JSON 경로가 필요합니다."));
  });

  it("대상 문장은 test 의 것을 쓰고 사용법만 perf 다", async () => {
    const stderr = await usageError(["s.json", "--command", "node", "--", "node"]);
    expect(stderr).toMatch(/^오류 \[CLI_USAGE\]: /);
    expect(stderr.endsWith(`해결: ${PERF_USAGE_HINT}\n`)).toBe(true);
  });

  it("사용법 줄이 설계 §3.1 의 형식이다", () => {
    expect(PERF_USAGE).toBe(
      "사용법: mcpeak perf <suite.json> (-- <executable> [args...] | --command <executable> [--arg <value> ...] [--env <NAME> ...]) [--repeat <n>] [--interval-ms <ms>] [--tool <name> ...] [--baseline <path> [--update-baseline]] [--threshold-pct <n>] [--threshold-ms <n>] [--json]",
    );
    expect(PERF_USAGE_HINT.startsWith(`${PERF_USAGE} `)).toBe(true);
    expect(PERF_USAGE_HINT).not.toContain("\n");
  });
});

describe("runPerfCommand: 명세와 plan", () => {
  it("명세에서 callTool 중 거절 기대가 아닌 케이스만 PerfPlan 이 된다", async () => {
    const spec = suite(
      [
        {
          id: "list",
          name: "list",
          operation: { type: "listTools" },
          assertions: [{ type: "toolExists", tool: "a" }],
        },
        callCase("a-ok", "a", { timeoutMs: 700, input: { x: 1 } }),
        callCase("a-reject", "a", { reject: true }),
        callCase("b-ok", "b"),
      ],
      5000,
    );
    const captured = capturePlan();
    const h = harness({ files: { [SUITE]: spec }, perf: { measure: captured.measure } });
    await expect(runPerfCommand([SUITE, "--repeat", "2", "--", "node"], h.deps)).resolves.toBe(0);
    expect(captured.plan()).toEqual({
      calls: [
        { caseId: "a-ok", tool: "a", input: { x: 1 }, timeoutMs: 700 },
        { caseId: "b-ok", tool: "b", input: {}, timeoutMs: 5000 },
      ],
      repeat: 2,
      intervalMs: 0,
    });
  });

  it("명세에 defaultTimeoutMs 가 없으면 10000", async () => {
    const captured = capturePlan();
    const h = harness({ perf: { measure: captured.measure } });
    await runPerfCommand([SUITE, "--", "node"], h.deps);
    expect(captured.plan().calls.map((call) => call.timeoutMs)).toEqual([10_000, 10_000]);
  });

  it("--tool 은 그 도구의 케이스만 남긴다", async () => {
    const captured = capturePlan();
    const h = harness({ perf: { measure: captured.measure } });
    await runPerfCommand([SUITE, "--tool", "b", "--", "node"], h.deps);
    expect(captured.plan().calls.map((call) => call.caseId)).toEqual(["b-ok"]);
  });

  it("측정할 케이스가 없으면 측정 전에 끝난다", async () => {
    const onlyReject = suite([callCase("a-reject", "a", { reject: true })]);
    const h = harness({ files: { [SUITE]: onlyReject } });
    await expect(runPerfCommand([SUITE, "--", "node"], h.deps)).resolves.toBe(1);
    expect(h.stderr()).toBe(
      "오류 [CLI_USAGE]: 측정할 케이스가 없습니다. 명세의 callTool 케이스 중 거절(isError: true)을 기대하지 않는 것이 없습니다.\n" +
        "해결: mcpeak generate 로 성공 케이스를 만들거나 명세를 확인하세요.\n",
    );
    expect(h.connectStdio).not.toHaveBeenCalled();
  });

  it("--tool 에 해당하는 케이스가 없으면 준 순서대로 이름을 적는다", async () => {
    const h = harness();
    await expect(
      runPerfCommand([SUITE, "--tool", "zz", "--tool", "aa", "--", "node"], h.deps),
    ).resolves.toBe(1);
    expect(h.stderr()).toBe(
      "오류 [CLI_USAGE]: --tool zz, aa 에 해당하는 측정 케이스가 없습니다.\n" +
        "해결: 명세의 operation.tool 값과 --tool 값을 맞추세요.\n",
    );
    expect(h.connectStdio).not.toHaveBeenCalled();
  });
});

describe("runPerfCommand: 기준선", () => {
  it("기준 파일 없음은 측정 전에 끝난다", async () => {
    const h = harness();
    await expect(
      runPerfCommand([SUITE, "--baseline", BASELINE, "--", "node"], h.deps),
    ).resolves.toBe(1);
    expect(h.stderr()).toBe(
      `오류 [PERF_BASELINE_MISSING]: 기준 파일이 없습니다: ${BASELINE}\n` +
        "→ 처음이면 --update-baseline 을 함께 주어 기준을 만드세요.\n",
    );
    expect(h.connectStdio).not.toHaveBeenCalled();
    expect(h.stdout()).toBe("");
  });

  it("기준 파일 형식 오류는 측정 전에 끝난다", async () => {
    const h = harness({ files: { [BASELINE]: "{not json" } });
    await expect(
      runPerfCommand([SUITE, "--baseline", BASELINE, "--", "node"], h.deps),
    ).resolves.toBe(1);
    expect(h.stderr()).toBe(
      `오류 [PERF_BASELINE_INVALID]: 기준 파일을 읽을 수 없습니다: ${BASELINE} (JSON 이 아닙니다)\n` +
        "→ mcpeak perf 가 쓴 파일인지 확인하고, 아니면 --update-baseline 으로 다시 만드세요.\n",
    );
    expect(h.connectStdio).not.toHaveBeenCalled();
  });

  it("관측 없이 --update-baseline 이면 리포트를 낸 뒤 1", async () => {
    const h = harness();
    await expect(
      runPerfCommand([SUITE, "--baseline", BASELINE, "--update-baseline", "--", "node"], h.deps),
    ).resolves.toBe(1);
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.stdout()).toContain("관측 안 함(Node 프리로드가 실리지 않음)");
    expect(
      h
        .stderr()
        .endsWith(
          "오류 [PERF_BASELINE_UNAVAILABLE]: 외부 호출을 관측하지 못해 기준 파일을 쓰지 않았습니다.\n" +
            "→ Node 서버인지, NODE_OPTIONS 가 서버까지 전달되는지 확인하세요.\n",
        ),
    ).toBe(true);
  });

  it("관측 없이 --baseline 비교면 리포트를 낸 뒤 1", async () => {
    const base = {
      schemaVersion: 1,
      generator: { name: "@mcpeak/perf", version: "0.0.0" },
      settings: { repeat: 5, intervalMs: 0 },
      cases: [],
    };
    const compareBaseline = vi.fn(perf.compareBaseline);
    const analyze = vi.fn(() => noneReport());
    const h = harness({
      files: { [BASELINE]: `${JSON.stringify(base, null, 2)}\n` },
      perf: { analyze, compareBaseline },
    });
    await expect(
      runPerfCommand([SUITE, "--baseline", BASELINE, "--", "node"], h.deps),
    ).resolves.toBe(1);
    expect(compareBaseline).not.toHaveBeenCalled();
    expect(h.stdout()).toBe(perf.renderReport(noneReport()));
    expect(
      h
        .stderr()
        .endsWith(
          "오류 [PERF_BASELINE_UNAVAILABLE]: 외부 호출을 관측하지 못해 기준선과 비교하지 않았습니다.\n" +
            "→ Node 서버인지, NODE_OPTIONS 가 서버까지 전달되는지 확인하세요.\n",
        ),
    ).toBe(true);
  });

  it("--update-baseline 은 기준 파일을 쓰고 비교하지 않으며 0", async () => {
    const compareBaseline = vi.fn(perf.compareBaseline);
    const h = harness({ trace: [HELLO], perf: { compareBaseline } });
    await expect(
      runPerfCommand([SUITE, "--baseline", BASELINE, "--update-baseline", "--", "node"], h.deps),
    ).resolves.toBe(0);
    expect(compareBaseline).not.toHaveBeenCalled();
    const text = h.written.get(BASELINE);
    expect(text?.endsWith("}\n")).toBe(true);
    const written = perf.parseBaseline(text ?? "");
    expect(written.cases.map((c) => c.id)).toEqual(["a-ok", "b-ok"]);
    expect(written.generator.version).toBe("9.9.9");
  });

  it("관측이 있으면 compareBaseline 의 종료 코드를 그대로 돌려준다", async () => {
    // 기준 요청 수가 -1 이라 지금 0 건이 회귀다.
    const base = {
      schemaVersion: 1,
      generator: { name: "@mcpeak/perf", version: "0.0.0" },
      settings: { repeat: 5, intervalMs: 0 },
      cases: [
        {
          id: "a-ok",
          tool: "a",
          n: 5,
          insideP50: 1,
          externalP50: 0,
          totalP50: 1,
          requestsP50: -1,
        },
      ],
    };
    const files = { [BASELINE]: JSON.stringify(base) };
    const regressed = harness({ trace: [HELLO], files });
    await expect(
      runPerfCommand([SUITE, "--baseline", BASELINE, "--", "node"], regressed.deps),
    ).resolves.toBe(2);
    expect(regressed.stdout()).toContain(`기준선 비교 (${BASELINE})`);
    expect(regressed.stdout()).toContain("'a-ok' 호출당 외부 요청 0건, 기준 -1건");
  });

  /** 회귀가 나지 않는 기준 한 행. */
  const baseRow = (id: string, tool: string) => ({
    id,
    tool,
    n: 5,
    insideP50: 1000,
    externalP50: 0,
    totalP50: 1,
    requestsP50: 0,
  });
  const baselineOf = (rows: readonly object[]) =>
    JSON.stringify({
      schemaVersion: 1,
      generator: { name: "@mcpeak/perf", version: "0.0.0" },
      settings: { repeat: 5, intervalMs: 0 },
      cases: rows,
    });

  it("--tool 로 비교하면 기준을 이번 plan 의 케이스로 좁혀 뺀 케이스 줄을 내지 않는다(계획 E26)", async () => {
    const compareBaseline = vi.fn(perf.compareBaseline);
    const h = harness({
      trace: [HELLO],
      files: { [BASELINE]: baselineOf([baseRow("a-ok", "a"), baseRow("b-ok", "b")]) },
      perf: { compareBaseline },
    });
    await expect(
      runPerfCommand([SUITE, "--baseline", BASELINE, "--tool", "b", "--", "node"], h.deps),
    ).resolves.toBe(0);
    expect(compareBaseline).toHaveBeenCalledTimes(1);
    expect(compareBaseline.mock.calls[0]?.[1].cases.map((c) => c.id)).toEqual(["b-ok"]);
    expect(h.stdout()).not.toContain("'a-ok' 는 기준에 있지만 이번 명세에 없습니다.");
  });

  it("--tool 이 없으면 명세에서 사라진 케이스는 지금처럼 '명세에 없습니다' 줄을 낸다", async () => {
    const compareBaseline = vi.fn(perf.compareBaseline);
    const rows = [baseRow("a-ok", "a"), baseRow("b-ok", "b"), baseRow("gone", "c")];
    const h = harness({
      trace: [HELLO],
      files: { [BASELINE]: baselineOf(rows) },
      perf: { compareBaseline },
    });
    await expect(
      runPerfCommand([SUITE, "--baseline", BASELINE, "--", "node"], h.deps),
    ).resolves.toBe(0);
    expect(compareBaseline.mock.calls[0]?.[1].cases.map((c) => c.id)).toEqual([
      "a-ok",
      "b-ok",
      "gone",
    ]);
    expect(h.stdout()).toContain("'gone' 는 기준에 있지만 이번 명세에 없습니다.");
  });
});

describe("runPerfCommand: 실행", () => {
  it("진행 문장은 stderr 두 줄", async () => {
    const h = harness();
    await expect(runPerfCommand([SUITE, "--repeat", "3", "--", "node"], h.deps)).resolves.toBe(0);
    expect(h.stderr()).toBe("측정: 케이스 2개 × 3회\n측정 완료: 호출 6회\n");
  });

  it("--json 이어도 진행 문장은 stderr 이고 stdout 은 JSON 하나다", async () => {
    const h = harness();
    await expect(runPerfCommand([SUITE, "--json", "--", "node"], h.deps)).resolves.toBe(0);
    expect(h.stderr()).toBe("측정: 케이스 2개 × 5회\n측정 완료: 호출 10회\n");
    const report = JSON.parse(h.stdout()) as PerfReport;
    expect(h.stdout()).toBe(`${JSON.stringify(report, null, 2)}\n`);
    expect(report.generator.version).toBe("9.9.9");
    expect(report.server).toEqual({ command: "node", toolCount: 2 });
  });

  it("콜드 스타트는 연결 전후와 tools/list 전후의 now 차이다", async () => {
    const times = [1000, 1312, 1312, 1316];
    let next = 2000;
    const analyze = vi.fn(perf.analyze);
    const h = harness({
      perf: { analyze },
      extra: {
        now: () => {
          const value = times.shift();
          if (value !== undefined) return value;
          next += 1;
          return next;
        },
      },
    });
    await expect(runPerfCommand([SUITE, "--", "node"], h.deps)).resolves.toBe(0);
    expect(analyze.mock.calls[0]?.[0].coldStart).toEqual({ connectMs: 312, listToolsMs: 4 });
  });

  it("자식 환경에 추적 디렉터리와 기존 NODE_OPTIONS 를 싣는다", async () => {
    const h = harness({
      extra: { readEnv: (name) => (name === "NODE_OPTIONS" ? "--max-old-space-size=4096" : "") },
    });
    await runPerfCommand([SUITE, "--", "node", "server.mjs"], h.deps);
    expect(h.connectStdio).toHaveBeenCalledWith({
      command: "node",
      args: ["server.mjs"],
      env: perf.childEnvironment({
        traceDir: "/tmp/mcpeak-perf-fake",
        existingNodeOptions: "--max-old-space-size=4096",
      }),
    });
  });

  it("측정 뒤 연결을 닫고 추적 디렉터리를 지운다", async () => {
    const h = harness();
    await runPerfCommand([SUITE, "--", "node"], h.deps);
    expect(h.closed()).toBe(1);
    expect(h.removeDir).toHaveBeenCalledWith("/tmp/mcpeak-perf-fake");
  });

  it("추적 디렉터리는 연결 실패에서도 지운다", async () => {
    const h = harness({
      extra: {
        connectStdio: vi.fn(async () => {
          throw new Error("spawn failed");
        }),
      },
    });
    await expect(runPerfCommand([SUITE, "--", "node"], h.deps)).resolves.toBe(1);
    expect(h.removeDir).toHaveBeenCalledTimes(1);
    expect(h.removeDir).toHaveBeenCalledWith("/tmp/mcpeak-perf-fake");
    expect(h.stderr()).toBe(
      "오류 [MCP_CONNECTION_FAILED]: MCP 서버 연결에 실패했습니다.\n" +
        "해결: command 실행 가능 여부와 MCP 서버 설정을 확인하세요.\n",
    );
  });
});

describe("runPerfCommand: 신호 정리(계획 E25)", () => {
  it("측정 동안 신호 처리기를 달고, 정상 종료면 떼며 재발신하지 않는다", async () => {
    const h = harness();
    await expect(runPerfCommand([SUITE, "--", "node"], h.deps)).resolves.toBe(0);
    expect(h.onSignal).toHaveBeenCalledTimes(1);
    expect(h.detach).toHaveBeenCalledTimes(1);
    expect(h.deps.killSelf).not.toHaveBeenCalled();
    expect(h.deps.removeDirSync).not.toHaveBeenCalled();
  });

  it("추적 디렉터리를 만들기 전에 끝나는 경로에서는 처리기를 달지 않는다", async () => {
    const h = harness();
    await expect(runPerfCommand([SUITE, "--tool", "zz", "--", "node"], h.deps)).resolves.toBe(1);
    expect(h.onSignal).not.toHaveBeenCalled();
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "측정 중 %s 가 오면 연결 close → 추적 동기 삭제 → 처리기 떼기 → 같은 신호로 재발신",
    async (signal) => {
      const events: string[] = [];
      let h: ReturnType<typeof harness> | undefined;
      const measure: typeof perf.measure = async (input) => {
        await h?.signal(signal);
        return perf.measure(input);
      };
      h = harness({
        perf: { measure },
        extra: {
          removeDirSync: vi.fn((path: string) => events.push(`removeDirSync:${path}`)),
          killSelf: vi.fn((s: PerfSignal) => events.push(`kill:${s}`)),
        },
      });
      const close = h.connection.close;
      h.connection.close = async () => {
        events.push("close");
        await close();
      };
      h.detach.mockImplementation(() => events.push("detach"));
      await runPerfCommand([SUITE, "--", "node"], h.deps);
      // 테스트의 재발신은 프로세스를 끝내지 않으므로 그 뒤 정상 경로가 이어진다. 앞 네 단계만 본다.
      expect(events.slice(0, 4)).toEqual([
        "close",
        "removeDirSync:/tmp/mcpeak-perf-fake",
        "detach",
        `kill:${signal}`,
      ]);
      expect(h.deps.killSelf).toHaveBeenCalledTimes(1);
    },
  );

  it("연결 전에 신호가 오면 닫을 연결 없이 지우고 재발신한다", async () => {
    const events: string[] = [];
    let h: ReturnType<typeof harness> | undefined;
    const { connection } = fakeConnection();
    h = harness({
      extra: {
        connectStdio: vi.fn(async () => {
          await h?.signal("SIGINT");
          return connection;
        }),
        removeDirSync: vi.fn(() => events.push("removeDirSync")),
        killSelf: vi.fn(() => events.push("kill")),
      },
    });
    await runPerfCommand([SUITE, "--", "node"], h.deps);
    expect(events.slice(0, 2)).toEqual(["removeDirSync", "kill"]);
  });

  it("연결 닫기가 실패해도 지우고 재발신한다", async () => {
    let h: ReturnType<typeof harness> | undefined;
    const measure: typeof perf.measure = async (input) => {
      await h?.signal("SIGINT");
      return perf.measure(input);
    };
    h = harness({ perf: { measure } });
    h.connection.close = async () => {
      throw new Error("close failed");
    };
    h.connection.forceClose = async () => {
      throw new Error("forceClose failed");
    };
    await runPerfCommand([SUITE, "--", "node"], h.deps);
    expect(h.deps.removeDirSync).toHaveBeenCalledWith("/tmp/mcpeak-perf-fake");
    expect(h.deps.killSelf).toHaveBeenCalledWith("SIGINT");
  });
});

/** 관측이 없는 최소 리포트. */
function noneReport(): PerfReport {
  return perf.analyze({
    plan: {
      calls: [{ caseId: "a-ok", tool: "a", input: {}, timeoutMs: 10_000 }],
      repeat: 1,
      intervalMs: 0,
    },
    measurements: [{ caseId: "a-ok", tool: "a", iteration: 0, t0: 1, t1: 2, outcome: "ok" }],
    trace: [],
    coldStart: { connectMs: 1, listToolsMs: 1 },
    server: { command: "node", toolCount: 1 },
    generatorVersion: "9.9.9",
  });
}

/** 진입점 `run` 의 stderr 를 모은다. */
async function runCaptured(argv: string[]): Promise<{ code: number; stderr: string }> {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const code = await run(argv);
    return { code, stderr: stderr.mock.calls.map(([text]) => String(text)).join("") };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

describe("진입점 동등성", () => {
  it("명세 오류 문장은 test 와 같다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcpeak-perf-cli-"));
    try {
      const bom = join(directory, "bom.json");
      const broken = join(directory, "broken.json");
      const empty = join(directory, "empty.json");
      await writeFile(bom, `﻿${JSON.stringify({ schemaVersion: 1 })}`, "utf8");
      await writeFile(broken, '{"schemaVersion": 1,', "utf8");
      await writeFile(empty, JSON.stringify({ schemaVersion: 1, id: "s", name: "s", cases: [] }));
      for (const path of [join(directory, "missing.json"), bom, broken, empty]) {
        const test = await runCaptured(["test", path, "--", "node", "x"]);
        const perfRun = await runCaptured(["perf", path, "--", "node", "x"]);
        expect(test.code).toBe(1);
        expect(perfRun.code).toBe(1);
        expect(test.stderr).not.toBe("");
        expect(perfRun.stderr).toBe(test.stderr);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("--url 은 진입점에서도 위치 인자보다 먼저 거절한다", async () => {
    const first = await runCaptured(["perf", "--url", "http://127.0.0.1:1/mcp", "x.json"]);
    const last = await runCaptured(["perf", "x.json", "--url", "http://127.0.0.1:1/mcp"]);
    expect(first).toEqual({ code: 1, stderr: REMOTE_REJECTION });
    expect(last).toEqual(first);
  });

  it("연결 실패 문장은 optimize 와 같고 사용법 줄만 다르다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcpeak-perf-cli-"));
    try {
      const path = join(directory, "s.json");
      await writeFile(path, TWO_CASES, "utf8");
      const missing = join(directory, "no-such-server-binary");
      const optimizeRun = await runCaptured([
        "optimize",
        "--out",
        join(directory, "o.json"),
        "--",
        missing,
      ]);
      const perfRun = await runCaptured(["perf", path, "--", missing]);
      expect(optimizeRun.code).toBe(1);
      expect(perfRun.code).toBe(1);
      const head = (text: string) => text.slice(0, text.indexOf("\n해결:"));
      expect(head(optimizeRun.stderr)).toMatch(/^오류 \[MCP_CONNECTION_FAILED/);
      expect(head(perfRun.stderr)).toBe(head(optimizeRun.stderr));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("nodePerfDependencies", () => {
  it("의존성 주입 모양: 설계 §8.6 의 모든 필드를 채운다", async () => {
    const [core, runner] = await Promise.all([import("@mcpeak/core"), import("@mcpeak/runner")]);
    const deps = nodePerfDependencies(core, runner, perf);
    expect(Object.keys(deps).sort()).toEqual(
      [
        "connectStdio",
        "readEnv",
        "readFile",
        "writeFile",
        "makeTempDir",
        "removeDir",
        "removeDirSync",
        "onSignal",
        "killSelf",
        "now",
        "sleep",
        "validateSuite",
        "perf",
        "generatorVersion",
        "writeStdout",
        "writeStderr",
      ].sort(),
    );
    expect(deps.connectStdio).toBe(core.connectStdio);
    expect(deps.validateSuite).toBe(runner.validateMcpSuite);
    expect(deps.perf).toEqual({
      measure: perf.measure,
      readTrace: perf.readTrace,
      analyze: perf.analyze,
      compareBaseline: perf.compareBaseline,
      toBaseline: perf.toBaseline,
      parseBaseline: perf.parseBaseline,
      renderReport: perf.renderReport,
      childEnvironment: perf.childEnvironment,
    });
    const perfPackage = await import("../../perf/package.json");
    expect(deps.generatorVersion).toBe(perfPackage.default.version);

    // 시계는 프로세스 간 정렬이 되는 epoch 밀리초다(설계 §2.1).
    expect(Math.abs(deps.now() - Date.now())).toBeLessThan(1000);

    // sleep: signal 이 abort 되면 타이머를 해제하고 끝나지 않는다.
    const controller = new AbortController();
    let settled = false;
    void deps.sleep(10_000, controller.signal).then(() => {
      settled = true;
    });
    controller.abort();
    await deps.sleep(5);
    expect(settled).toBe(false);

    // 임시 디렉터리를 만들고 지운다.
    const dir = await deps.makeTempDir(join(tmpdir(), "mcpeak-perf-"));
    expect(dir.startsWith(join(tmpdir(), "mcpeak-perf-"))).toBe(true);
    await deps.removeDir(dir);
    await expect(deps.readFile(dir)).rejects.toMatchObject({ code: "ENOENT" });

    // 동기 삭제도 같은 디렉터리를 지운다. 없는 경로는 조용히 넘어간다.
    const syncDir = await deps.makeTempDir(join(tmpdir(), "mcpeak-perf-"));
    await writeFile(join(syncDir, "1.jsonl"), "{}\n");
    deps.removeDirSync(syncDir);
    await expect(deps.readFile(syncDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => deps.removeDirSync(syncDir)).not.toThrow();

    // 신호 처리기는 SIGINT·SIGTERM 둘에 달리고, 돌려준 함수가 둘 다 뗀다. 재발신은 부르지 않는다.
    const before = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
    const off = deps.onSignal(async () => {});
    expect(process.listenerCount("SIGINT")).toBe(before.int + 1);
    expect(process.listenerCount("SIGTERM")).toBe(before.term + 1);
    off();
    expect(process.listenerCount("SIGINT")).toBe(before.int);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
  });
});

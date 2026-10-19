import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectStdio } from "@mcpeak/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { childEnvironment } from "../src/child-env.js";
import { measure } from "../src/measure.js";
import { readTrace } from "../src/trace.js";
import type { CaseResult, PerfCall, PerfFinding, PerfPlan, PerfReport } from "../src/types.js";
import { DELAY_MS, startOrigin } from "./fixtures/loopback-origin.js";

const SERVER = fileURLToPath(new URL("./fixtures/serial-server.mjs", import.meta.url));
const SUITE = fileURLToPath(new URL("./fixtures/serial-server.suite.json", import.meta.url));
const WEATHER_SERVER = fileURLToPath(
  new URL("../../../examples/weather-server/server.mjs", import.meta.url),
);
const WEATHER_SUITE = fileURLToPath(
  new URL("../../../examples/weather-server/server.suite.json", import.meta.url),
);

/** CLI 기본값과 같은 반복 수(설계 §8.4). */
const REPEAT = 5;
/** runner 실행기와 같은 기본 타임아웃(설계 §3.2 5항). */
const DEFAULT_TIMEOUT_MS = 10_000;
const HOOK_TIMEOUT_MS = 60_000;

/** 명세에서 이 스펙이 읽는 부분만. `@mcpeak/runner` 를 import 하지 않는다(계획 §10.2). */
interface SuiteCase {
  readonly id: string;
  readonly timeoutMs?: number;
  readonly operation: {
    readonly type: string;
    readonly tool?: string;
    readonly input?: Record<string, unknown>;
  };
  readonly assertions: readonly { readonly type: string; readonly expected?: unknown }[];
}

interface Suite {
  readonly defaultTimeoutMs?: number;
  readonly cases: readonly SuiteCase[];
}

async function readSuite(path: string): Promise<Suite> {
  return JSON.parse(await readFile(path, "utf8")) as Suite;
}

/** 설계 §3.1 의 선택 규칙: callTool 이고 `{ type: "isError", expected: true }` 단언이 없는 케이스. */
function measuredCalls(suite: Suite): PerfCall[] {
  return suite.cases
    .filter(
      (c) =>
        c.operation.type === "callTool" &&
        !c.assertions.some((a) => a.type === "isError" && a.expected === true),
    )
    .map((c) => ({
      caseId: c.id,
      tool: c.operation.tool ?? "",
      input: c.operation.input ?? {},
      timeoutMs: c.timeoutMs ?? suite.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    }));
}

/** 두 프로세스가 같은 시계를 쓴다(설계 §2.1). */
const now = (): number => performance.timeOrigin + performance.now();

/** abort 되면 타이머만 해제하고 끝나지 않는다(`measure` 의 sleep 계약). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
  });
}

const dirs: string[] = [];

async function freshTraceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcpeak-perf-e2e-"));
  dirs.push(dir);
  return dir;
}

/** serial-server 를 띄우는 환경 변수. `observe` 면 프리로드를 싣는다. */
function serverEnv(origin: string, traceDir: string | undefined): Record<string, string> {
  return {
    MCPEAK_PERF_FIXTURE_ORIGIN: origin,
    MCPEAK_PERF_FIXTURE_DELAY_MS: String(DELAY_MS),
    ...(traceDir === undefined ? {} : childEnvironment({ traceDir })),
  };
}

/**
 * CLI 를 거치지 않는 경로(설계 §10.3): connectStdio → listTools → measure → 닫기 → readTrace → analyze.
 * `observe` 가 거짓이면 프리로드를 싣지 않는다. 추적 디렉터리는 어느 쪽이든 만들어 읽는다.
 */
async function runPerf(options: {
  readonly env: Record<string, string>;
  readonly traceDir: string;
  readonly plan: PerfPlan;
  readonly args: readonly string[];
}): Promise<PerfReport> {
  const started = now();
  const connection = await connectStdio({
    command: process.execPath,
    args: options.args,
    env: options.env,
  });
  let coldStart: { connectMs: number; listToolsMs: number };
  let toolCount: number;
  let measurements: Awaited<ReturnType<typeof measure>>;
  try {
    const connected = now();
    const tools = await connection.client.listTools();
    coldStart = { connectMs: connected - started, listToolsMs: now() - connected };
    toolCount = tools.length;
    measurements = await measure({
      client: connection.client,
      availableTools: new Set(tools.map((tool) => tool.name)),
      plan: options.plan,
      now,
      sleep,
    });
  } finally {
    await connection.close();
  }
  const { entries } = await readTrace(options.traceDir);
  return analyze({
    plan: options.plan,
    measurements,
    trace: entries,
    coldStart,
    server: { command: "node serial-server.mjs", toolCount },
    generatorVersion: "0.0.0-test",
  });
}

function caseOf(report: PerfReport, id: string): CaseResult {
  const found = report.cases.find((c) => c.id === id);
  if (found === undefined) {
    throw new Error(
      `리포트에 케이스 '${id}' 가 없습니다. 있는 케이스: ${report.cases.map((c) => c.id).join(", ")}`,
    );
  }
  return found;
}

/** 실패했을 때 무엇이 어긋났는지 보이도록 케이스 상태를 한 줄로 적는다. */
function describeCase(c: CaseResult): string {
  return `'${c.id}' n=${c.n} outcomes=${JSON.stringify(c.outcomes)} firstError=${c.firstError ?? "없음"} external=${JSON.stringify(c.external)} requests=${JSON.stringify(c.requests)}`;
}

function findingsOf(report: PerfReport, ruleId: PerfFinding["ruleId"], caseId: string) {
  return report.findings.filter((f) => f.ruleId === ruleId && f.caseIds.includes(caseId));
}

/** (a) 는 케이스 하나, (b) 는 서로 다른 케이스 2개 이상이다(설계 §6.2). */
const isWithinCall = (f: PerfFinding): boolean =>
  f.ruleId === "perf/repeated-request" && f.caseIds.length === 1;
const isCrossCase = (f: PerfFinding): boolean =>
  f.ruleId === "perf/repeated-request" && f.caseIds.length >= 2;

function listFindings(report: PerfReport): string {
  return report.findings.length === 0
    ? "진단 없음"
    : report.findings.map((f) => `${f.ruleId} [${f.caseIds.join(",")}] ${f.lines[0]}`).join("\n");
}

/** 연결 하나로 케이스 순서대로 한 번씩 불러 `content` 를 모은다. */
async function contentsOf(options: {
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly calls: readonly PerfCall[];
}): Promise<unknown[]> {
  const connection = await connectStdio({
    command: process.execPath,
    args: options.args,
    env: options.env,
  });
  try {
    const contents: unknown[] = [];
    for (const call of options.calls) {
      contents.push((await connection.client.callTool(call.tool, call.input)).content);
    }
    return contents;
  } finally {
    await connection.close();
  }
}

afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.sequential("serial-server 를 프리로드와 함께 잰다", () => {
  let report: PerfReport;

  beforeAll(async () => {
    const suite = await readSuite(SUITE);
    const origin = await startOrigin();
    const traceDir = await freshTraceDir();
    try {
      report = await runPerf({
        args: [SERVER],
        env: serverEnv(origin.origin, traceDir),
        traceDir,
        plan: { calls: measuredCalls(suite), repeat: REPEAT, intervalMs: 0 },
      });
    } finally {
      await origin.close();
    }
  }, HOOK_TIMEOUT_MS);

  it("관측이 프리로드이고 fails 를 뺀 모든 케이스가 반복마다 ok 다", () => {
    expect(report.settings.observation).toBe("preload");
    expect(report.aborted).toBeNull();
    for (const c of report.cases) {
      if (c.id === "fails") continue;
      expect(c.n, describeCase(c)).toBe(REPEAT);
    }
  });

  it("serial: 순차 독립 요청을 진단하고 외부 대기 p50 이 DELAY_MS × 2 이상이다", () => {
    const serial = caseOf(report, "serial");
    expect(
      findingsOf(report, "perf/sequential-independent", "serial"),
      listFindings(report),
    ).toHaveLength(1);
    expect(serial.external?.p50, describeCase(serial)).toBeGreaterThanOrEqual(DELAY_MS * 2);
  });

  it("fetch 한 번은 요청 1건: serial 의 호출당 요청 수 p50 이 정확히 2 다", () => {
    // AsyncLocalStorage 귀속이 깨지면 undici 중복이 남아 4 가 된다(설계 §5.2, §10.3).
    const serial = caseOf(report, "serial");
    expect(serial.requests?.p50, describeCase(serial)).toBe(2);
  });

  it("parallel: 순차 독립 진단이 없고 외부 대기 p50 이 DELAY_MS × 2 보다 작다", () => {
    const parallel = caseOf(report, "parallel");
    expect(
      findingsOf(report, "perf/sequential-independent", "parallel"),
      listFindings(report),
    ).toHaveLength(0);
    expect(parallel.external?.p50, describeCase(parallel)).toBeLessThan(DELAY_MS * 2);
  });

  it("dependent: 앞 응답의 id 를 쓰는 요청은 의존으로 판정되고 순차 독립 진단이 없다", () => {
    const dependent = caseOf(report, "dependent");
    expect(
      findingsOf(report, "perf/sequential-independent", "dependent"),
      listFindings(report),
    ).toHaveLength(0);
    expect(dependent.dependency.dependent, describeCase(dependent)).toBeGreaterThanOrEqual(1);
  });

  it("repeat: 호출 안 중복 (a) 가 나고 케이스 간 반복 (b) 는 없다", () => {
    const own = findingsOf(report, "perf/repeated-request", "repeat");
    expect(own.filter(isWithinCall), listFindings(report)).toHaveLength(1);
    expect(own.filter(isCrossCase), listFindings(report)).toHaveLength(0);
  });

  it("retry: 429 뒤 재시도는 호출 안 중복 (a) 로 보지 않는다", () => {
    const own = findingsOf(report, "perf/repeated-request", "retry");
    expect(own.filter(isWithinCall), listFindings(report)).toHaveLength(0);
  });

  it("prefetch: 케이스 간 반복 (b) 가 정확히 하나이고 prefetch 두 케이스를 가리킨다", () => {
    const cross = report.findings.filter(isCrossCase);
    expect(cross, listFindings(report)).toHaveLength(1);
    const [finding] = cross;
    expect(finding?.caseIds).toEqual(["prefetch-1", "prefetch-2"]);
    expect(finding?.tools).toEqual(["prefetch"]);
  });

  it("http: node:http 요청도 본문 끝까지 외부 대기에 들어간다", () => {
    const http = caseOf(report, "http");
    expect(http.external?.p50, describeCase(http)).toBeGreaterThanOrEqual(DELAY_MS);
    expect(http.externalLowerBound, describeCase(http)).toBe(false);
  });

  it("local: 외부 요청이 없다", () => {
    const local = caseOf(report, "local");
    expect(local.requests?.p50, describeCase(local)).toBe(0);
  });

  it("fails: isError 반복은 통계에서 빠지고 횟수만 센다", () => {
    const fails = caseOf(report, "fails");
    expect(fails.n, describeCase(fails)).toBe(0);
    expect(fails.outcomes.isError, describeCase(fails)).toBe(REPEAT);
  });
});

describe.sequential("관측 없음", () => {
  it(
    "NODE_OPTIONS 없이 띄우면 observation 이 none 이고 진단과 분해 필드가 없다",
    async () => {
      const suite = await readSuite(SUITE);
      const origin = await startOrigin();
      let report: PerfReport;
      try {
        const traceDir = await freshTraceDir();
        report = await runPerf({
          args: [SERVER],
          env: serverEnv(origin.origin, undefined),
          traceDir,
          plan: { calls: measuredCalls(suite), repeat: 1, intervalMs: 0 },
        });
      } finally {
        await origin.close();
      }
      expect(report.settings.observation).toBe("none");
      expect(report.findings).toEqual([]);
      const serial = caseOf(report, "serial");
      expect(serial.n, describeCase(serial)).toBe(1);
      expect(serial.external).toBeUndefined();
      expect(serial.inside).toBeUndefined();
      expect(serial.requests).toBeUndefined();
    },
    HOOK_TIMEOUT_MS,
  );
});

describe.sequential("프리로드 유무에 따라 tools/call 결과가 같다", () => {
  it(
    "serial-server 의 모든 도구",
    async () => {
      const calls = (await readSuite(SUITE)).cases
        .filter((c) => c.operation.type === "callTool")
        .map((c) => ({
          caseId: c.id,
          tool: c.operation.tool ?? "",
          input: c.operation.input ?? {},
          timeoutMs: DEFAULT_TIMEOUT_MS,
        }));
      // 루프백 응답의 카운터가 본문에 들어가므로 실행마다 응답 서버를 새로 띄워 카운터를 맞춘다.
      const run = async (observe: boolean): Promise<{ contents: unknown[]; traceDir: string }> => {
        const origin = await startOrigin();
        const traceDir = await freshTraceDir();
        try {
          const contents = await contentsOf({
            args: [SERVER],
            env: serverEnv(origin.origin, observe ? traceDir : undefined),
            calls,
          });
          return { contents, traceDir };
        } finally {
          await origin.close();
        }
      };
      const withPreload = await run(true);
      const without = await run(false);
      // 프리로드가 실제로 실렸어야 비교가 의미 있다.
      const { entries } = await readTrace(withPreload.traceDir);
      expect(
        entries.some((e) => e.kind === "hello"),
        "프리로드를 실은 실행의 추적에 hello 줄이 없습니다. childEnvironment 의 NODE_OPTIONS 가 서버에 닿았는지 확인하세요.",
      ).toBe(true);
      expect(withPreload.contents).toEqual(without.contents);
    },
    HOOK_TIMEOUT_MS,
  );

  it(
    "examples/weather-server 의 측정 대상 케이스",
    async () => {
      const calls = measuredCalls(await readSuite(WEATHER_SUITE));
      expect(
        calls.length,
        "weather-server 명세에서 측정 대상 케이스를 하나도 고르지 못했습니다",
      ).toBeGreaterThan(0);
      const traceDir = await freshTraceDir();
      const withPreload = await contentsOf({
        args: [WEATHER_SERVER],
        env: childEnvironment({ traceDir }),
        calls,
      });
      const without = await contentsOf({ args: [WEATHER_SERVER], env: {}, calls });
      const { entries } = await readTrace(traceDir);
      expect(
        entries.some((e) => e.kind === "hello"),
        "프리로드를 실은 weather-server 실행의 추적에 hello 줄이 없습니다.",
      ).toBe(true);
      expect(withPreload).toEqual(without);
    },
    HOOK_TIMEOUT_MS,
  );
});

describe.sequential("임계 실측", () => {
  it.runIf(process.env.MCPEAK_PERF_THRESHOLD_PROBE === "1")(
    "serial 을 10회 재서 inside p50 의 최소·최대와 기본 게이트 초과 여부를 출력한다",
    async () => {
      // 계획 E17·§10.2: 연결 하나에서 serial 만 담은 plan 을 10회 잰다. 추적 디렉터리는 비우지 않는다.
      // hello 줄은 서버가 뜰 때 한 번만 쓰이고, 이전 회의 요청은 이번 회의 호출 창 밖이라 배정에서 빠진다.
      const suite = await readSuite(SUITE);
      const plan: PerfPlan = {
        calls: measuredCalls(suite).filter((call) => call.caseId === "serial"),
        repeat: 5,
        intervalMs: 0,
      };
      const origin = await startOrigin();
      const traceDir = await freshTraceDir();
      const insides: number[] = [];
      try {
        const connection = await connectStdio({
          command: process.execPath,
          args: [SERVER],
          env: serverEnv(origin.origin, traceDir),
        });
        try {
          const tools = await connection.client.listTools();
          const availableTools = new Set(tools.map((tool) => tool.name));
          for (let round = 0; round < 10; round += 1) {
            const measurements = await measure({
              client: connection.client,
              availableTools,
              plan,
              now,
              sleep,
            });
            const { entries } = await readTrace(traceDir);
            const report = analyze({
              plan,
              measurements,
              trace: entries,
              coldStart: { connectMs: 0, listToolsMs: 0 },
              server: { command: "node serial-server.mjs", toolCount: tools.length },
              generatorVersion: "0.0.0-test",
            });
            const serial = caseOf(report, "serial");
            if (serial.inside === undefined) {
              throw new Error(`${round + 1}회차에 inside 가 없습니다. ${describeCase(serial)}`);
            }
            insides.push(serial.inside.p50);
          }
        } finally {
          await connection.close();
        }
      } finally {
        await origin.close();
      }
      const min = Math.min(...insides);
      const max = Math.max(...insides);
      console.log(
        `inside p50 min=${min.toFixed(2)} max=${max.toFixed(2)} 초과=${max > min * 1.5 + 20}`,
      );
    },
    120_000,
  );
});

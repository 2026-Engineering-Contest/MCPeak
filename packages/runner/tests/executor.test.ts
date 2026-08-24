import type { McpClient } from "@mcpeak/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_VALUE_STRING_CHARS,
  type RunnerEvent,
  runSuite,
  SuiteValidationError,
  type TestSuiteSpec,
} from "../src/index.js";
import { byteLength } from "../src/sanitization.js";

const suite: TestSuiteSpec = {
  schemaVersion: 1,
  id: "weather",
  name: "weather",
  defaultTimeoutMs: 123,
  cases: [
    {
      id: "tools",
      name: "tools",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "get_weather" }],
    },
    {
      id: "call",
      name: "call",
      operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
      assertions: [
        { type: "isError", expected: false },
        { type: "isError", expected: false },
      ],
    },
  ],
};

function fake(records: unknown[], reject = false): McpClient {
  return {
    listTools: async () => {
      records.push({ type: "listTools" });
      return [{ name: "get_weather", inputSchema: {} }];
    },
    callTool: async (name, args) => {
      records.push({ type: "callTool", name, args });
      if (reject) throw new Error("nope");
      return { content: null, isError: false, raw: { secret: "no" } };
    },
    close: async () => {
      records.push({ type: "close" });
    },
  };
}
describe("runSuite", () => {
  afterEach(() => vi.useRealTimers());

  it("timeout 뒤 현재 case를 종료하고 나머지를 실행하지 않는다", async () => {
    vi.useFakeTimers();
    const records: unknown[] = [];
    const client = fake(records);
    client.listTools = () => {
      records.push({ type: "listTools" });
      return new Promise(() => undefined);
    };
    const execution = runSuite({ client, suite });
    await vi.advanceTimersByTimeAsync(123);
    await expect(execution.report).resolves.toMatchObject({
      status: "failed",
      stopReason: { type: "timeout", caseId: "tools" },
      summary: { timedOut: 1, notRun: 1 },
    });
    expect(records).toEqual([{ type: "listTools" }]);
    expect(records).not.toContainEqual({ type: "close" });
  });
  it("시작 전 abort는 operation 없이 suite를 중단한다", async () => {
    const controller = new AbortController();
    controller.abort();
    const records: unknown[] = [];
    const report = await runSuite({ client: fake(records), suite, signal: controller.signal })
      .report;
    expect(report).toMatchObject({ status: "aborted", stopReason: { type: "abortSignal" } });
    expect(report.cases.map((item) => item.status)).toEqual(["notRun", "notRun"]);
    expect(records).toEqual([]);
  });
  it("case, suite, fallback 순으로 timeout을 적용하고 최대값을 보존한다", async () => {
    const values: number[] = [];
    const pending = () => new Promise<never>(() => undefined);
    const firstCase = suite.cases[0];
    if (firstCase === undefined) throw new Error("fixture case missing");
    for (const [caseTimeout, suiteTimeout, expected] of [
      [7, 9, 7],
      [undefined, 9, 9],
      [undefined, undefined, 10_000],
      [2_147_483_647, undefined, 2_147_483_647],
    ] as const) {
      vi.useFakeTimers();
      const controller = new AbortController();
      const input = structuredClone(suite);
      if (suiteTimeout === undefined) delete input.defaultTimeoutMs;
      else input.defaultTimeoutMs = suiteTimeout;
      input.cases = [
        { ...firstCase, ...(caseTimeout === undefined ? {} : { timeoutMs: caseTimeout }) },
      ];
      const execution = runSuite({
        client: { ...fake([]), listTools: pending },
        suite: input,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "operationStarted") values.push(event.timeoutMs);
        },
      });
      if (expected !== 2_147_483_647) await vi.advanceTimersByTimeAsync(expected);
      else {
        await vi.advanceTimersByTimeAsync(1);
        controller.abort();
      }
      await execution.report;
      vi.useRealTimers();
    }
    expect(values).toEqual([7, 9, 10_000, 2_147_483_647]);
  });
  it("operation abort와 timeout 동시 abort는 cancelled가 우선이다", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const client = { ...fake([]), listTools: () => new Promise<never>(() => undefined) };
    const firstCase = suite.cases[0];
    if (firstCase === undefined) throw new Error("fixture case missing");
    const execution = runSuite({
      client,
      suite: { ...suite, defaultTimeoutMs: 10, cases: [firstCase] },
      signal: controller.signal,
      drainTimeoutMs: 1,
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    await expect(execution.report).resolves.toMatchObject({
      status: "aborted",
      cases: [{ status: "cancelled" }],
    });
    await vi.advanceTimersByTimeAsync(1);
    await execution.drain;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("drain option은 호출 전 동기 검증하고 deadline 결과는 late reject에도 유지한다", async () => {
    for (const drainTimeoutMs of [0, NaN, Infinity, -1, 1.5, 60_001])
      expect(() => runSuite({ client: fake([]), suite, drainTimeoutMs })).toThrow(RangeError);
    vi.useFakeTimers();
    let reject!: (error: unknown) => void;
    const client = {
      ...fake([]),
      listTools: () =>
        new Promise<never>((_, fail) => {
          reject = fail;
        }),
    };
    const firstCase = suite.cases[0];
    if (firstCase === undefined) throw new Error("fixture case missing");
    const execution = runSuite({
      client,
      suite: { ...suite, defaultTimeoutMs: 1, cases: [firstCase] },
      drainTimeoutMs: 2,
    });
    await vi.advanceTimersByTimeAsync(3);
    await expect(execution.drain).resolves.toEqual({
      status: "deadlineExceeded",
      pendingOperations: 1,
    });
    reject(new Error("late"));
    await Promise.resolve();
  });
  it("순서대로 이벤트와 케이스를 실행한다", async () => {
    const records: unknown[] = [];
    const events: unknown[] = [];
    const execution = runSuite({
      client: fake(records),
      suite,
      onEvent: (event) => events.push(event),
    });
    const report = await execution.report;
    expect(records).toEqual([
      { type: "listTools" },
      { type: "callTool", name: "get_weather", args: { city: "서울" } },
    ]);
    expect((events as { type: string; sequence: number }[]).map((e) => e.type)).toEqual([
      "suiteStarted",
      "caseStarted",
      "operationStarted",
      "operationCompleted",
      "assertionCompleted",
      "caseCompleted",
      "caseStarted",
      "operationStarted",
      "operationCompleted",
      "assertionCompleted",
      "assertionCompleted",
      "caseCompleted",
      "suiteCompleted",
    ]);
    expect((events as { sequence: number }[]).map((e) => e.sequence)).toEqual(
      Array.from({ length: events.length }, (_, i) => i),
    );
    expect(report.summary).toEqual({
      total: 2,
      passed: 2,
      failed: 0,
      timedOut: 0,
      cancelled: 0,
      notRun: 0,
      // 거절 근거 확인(#89). 판정 종류가 아니므로 아래 total 합산식에는 안 들어간다.
      rejectionUnverified: 0,
    });
    expect(report.summary.total).toBe(
      report.summary.passed +
        report.summary.failed +
        report.summary.timedOut +
        report.summary.cancelled +
        report.summary.notRun,
    );
    await expect(execution.drain).resolves.toEqual({ status: "settled" });
  });
  it("작업 reject 뒤 다음 case를 실행하고 assertion을 skip한다", async () => {
    const records: unknown[] = [];
    const input = structuredClone(suite);
    const [first, second] = suite.cases;
    if (first === undefined || second === undefined) throw new Error("fixture cases missing");
    input.cases = [second, first];
    const report = await runSuite({ client: fake(records, true), suite: input }).report;
    expect(report.cases[0]?.operation.diagnostic?.code).toBe("OPERATION_FAILED");
    expect(report.cases[0]?.assertions.every((a) => a.status === "skipped")).toBe(true);
    expect(
      report.cases[0]?.assertions.every(
        (assertion) => assertion.diagnostic?.code === "OPERATION_RESULT_UNAVAILABLE",
      ),
    ).toBe(true);
    expect(report.cases[1]?.status).toBe("passed");
  });
  it("작업 실패 진단에 원인 체인을 notes 로 싣는다", async () => {
    // 서버가 준 거절 이유는 core 가 cause 에 보존한다. 진단의 actual 은 화면에 안 찍히므로
    // notes 로 실어야 사람이 본다(adoption.md §2.5 넷째).
    const root = new Error(
      "MCP error -32601: Tool simulate-research-query requires task augmentation (taskSupport: 'required')",
    );
    const wrapped = new Error("MCP 작업이 protocol 오류로 거절되었습니다.", { cause: root });
    const client: McpClient = {
      listTools: async () => [{ name: "get_weather", inputSchema: {} }],
      callTool: async () => {
        throw wrapped;
      },
      close: async () => {},
    };
    const report = await runSuite({ client, suite: structuredClone(suite) }).report;
    const failedCase = report.cases.find((item) => item.operation.status === "failed");
    expect(failedCase?.operation.diagnostic?.notes).toEqual([
      "원인: MCP error -32601: Tool simulate-research-query requires task augmentation (taskSupport: 'required')",
    ]);
  });
  it("원인이 없는 작업 실패에는 notes 키를 만들지 않는다", async () => {
    // undefined 로 키를 만들면 기존 보고서의 JSON 바이트가 흔들린다.
    const report = await runSuite({ client: fake([], true), suite: structuredClone(suite) }).report;
    const failedCase = report.cases.find((item) => item.operation.status === "failed");
    expect(failedCase?.operation.diagnostic).toBeDefined();
    expect(Object.hasOwn(failedCase?.operation.diagnostic ?? {}, "notes")).toBe(false);
  });
  it("listener 오류를 그대로 전파하고 후속 호출을 막는다", async () => {
    const records: unknown[] = [];
    const sentinel = new Error("sentinel");
    const execution = runSuite({
      client: fake(records),
      suite,
      onEvent: () => {
        throw sentinel;
      },
    });
    await expect(execution.report).rejects.toBe(sentinel);
    expect(records).toEqual([]);
  });
  it("한 operation 결과로 source assertion 순서를 유지하고 assertion failure 뒤에도 실행한다", async () => {
    const records: unknown[] = [];
    const input = structuredClone(suite);
    input.cases[0] = {
      id: "failed",
      name: "failed",
      operation: { type: "callTool", tool: "get_weather", input: {} },
      assertions: [
        { type: "isError", expected: true },
        { type: "isError", expected: false },
      ],
    };
    const failedCase = input.cases[0];
    if (failedCase === undefined) throw new Error("fixture case missing");
    input.cases = [
      failedCase,
      {
        id: "passed",
        name: "passed",
        operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
        assertions: [{ type: "isError", expected: false }],
      },
    ];
    const report = await runSuite({ client: fake(records), suite: input }).report;
    expect(
      records.filter((record) => (record as { type: string }).type === "callTool"),
    ).toHaveLength(2);
    expect(report.cases.slice(0, 2).map((item) => item.status)).toEqual(["failed", "passed"]);
    expect(report.cases[0]?.assertions.map((item) => item.spec)).toEqual(
      input.cases[0]?.assertions,
    );
  });
  it("무효 명세는 동기 거절하고 timeout 원본과 모든 case identity를 보존한다", async () => {
    const records: unknown[] = [];
    const events: RunnerEvent[] = [];
    expect(() =>
      runSuite({
        client: fake(records),
        suite: { ...suite, cases: [] },
        onEvent: (event) => events.push(event),
      }),
    ).toThrow(SuiteValidationError);
    expect(records).toEqual([]);
    expect(events).toEqual([]);
    const execution = runSuite({
      client: fake(records),
      suite,
      onEvent: (event) => events.push(event),
    });
    const report = await execution.report;
    expect(report.suite.defaultTimeoutMs).toBe(123);
    for (const event of events.filter((event) => "caseId" in event)) {
      const source = suite.cases[event.caseIndex];
      expect(event.caseId).toBe(source?.id);
      expect(event.caseIndex).toBe(suite.cases.findIndex((item) => item.id === event.caseId));
    }
  });
  it("caller와 listener mutation이 observer snapshot이나 report를 바꾸지 않는다", async () => {
    const records: unknown[] = [];
    let release: (() => void) | undefined;
    const client = fake(records);
    client.listTools = () =>
      new Promise((resolve) => {
        release = () => resolve([{ name: "get_weather", inputSchema: {} }]);
      });
    const input = structuredClone(suite);
    const events: RunnerEvent[] = [];
    const execution = runSuite({
      client,
      suite: input,
      onEvent: (event) => {
        events.push(event);
        if (event.type === "caseStarted") event.case.name = "mutated";
      },
    });
    const firstCase = input.cases[0];
    if (firstCase === undefined) throw new Error("fixture case missing");
    firstCase.name = "caller-mutated";
    release?.();
    const report = await execution.report;
    expect(events.filter((event) => event.type === "caseCompleted")[0]?.result.spec.name).toBe(
      "tools",
    );
    expect(report.cases[0]?.spec.name).toBe("tools");
  });
  it("결정론적 event/report 및 JSON-safe report를 만든다", async () => {
    const firstEvents: RunnerEvent[] = [];
    const secondEvents: RunnerEvent[] = [];
    const first = await runSuite({
      client: fake([]),
      suite,
      onEvent: (event) => firstEvents.push(event),
    }).report;
    const second = await runSuite({
      client: fake([]),
      suite,
      onEvent: (event) => secondEvents.push(event),
    }).report;
    expect({ firstEvents, first }).toEqual({ firstEvents: secondEvents, first: second });
    const serialized = JSON.stringify(first);
    for (const forbidden of ["raw", "timestamp", "duration", "durationMs"])
      expect(serialized).not.toContain(forbidden);
  });
});

/** 본문 단언 통합 검증용. content 접근 횟수를 세는 ToolResult를 만든다. */
function bodyResult(
  text: string,
  counter: { reads: number },
  options?: { throwOnRead?: boolean; isError?: boolean },
) {
  return {
    get content() {
      counter.reads++;
      if (options?.throwOnRead) throw new Error("content를 읽으면 안 됩니다.");
      return [{ type: "text", text }];
    },
    isError: options?.isError ?? false,
    raw: null,
  } as unknown as import("@mcpeak/core").ToolResult;
}

function bodyClient(result: () => import("@mcpeak/core").ToolResult): McpClient {
  return {
    listTools: async () => [{ name: "get_weather", inputSchema: {} }],
    callTool: async () => result(),
    close: async () => undefined,
  };
}

const bodySuite = (assertions: unknown[]): TestSuiteSpec =>
  ({
    schemaVersion: 1,
    id: "body",
    name: "body",
    defaultTimeoutMs: 1_000,
    cases: [
      {
        id: "call",
        name: "call",
        operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
        assertions,
      },
    ],
  }) as TestSuiteSpec;

/** 빈 properties와 빈 required는 검사할 제약이 없어 명세 검증이 거부한다. 있을 때만 넣는다. */
const schemaOf = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  ...(required.length === 0 ? {} : { required }),
  ...(Object.keys(properties).length === 0 ? {} : { properties }),
});

describe("runSuite와 bodyMatchesSchema", () => {
  afterEach(() => vi.useRealTimers());

  it("bodyMatchesSchema가 있는 케이스에서 본문을 검사한다", async () => {
    const counter = { reads: 0 };
    const report = await runSuite({
      client: bodyClient(() => bodyResult('{"temperature":21}', counter)),
      suite: bodySuite([
        { type: "bodyMatchesSchema", schema: schemaOf({ temp: { type: "number" } }, ["temp"]) },
      ]),
    }).report;
    expect(report.cases[0]?.status).toBe("failed");
    expect(report.cases[0]?.assertions[0]?.diagnostic?.code).toBe("BODY_SCHEMA_MISMATCH");
  });

  it("bodyMatchesSchema가 없으면 추출을 호출하지 않는다", async () => {
    const counter = { reads: 0 };
    const report = await runSuite({
      client: bodyClient(() => bodyResult("{}", counter, { throwOnRead: true })),
      suite: bodySuite([{ type: "isError", expected: false }]),
    }).report;
    expect(report.status).toBe("passed");
    expect(counter.reads).toBe(0);
  });

  it("한 케이스의 bodyMatchesSchema 두 개가 같은 추출을 공유한다", async () => {
    const counter = { reads: 0 };
    const result = bodyResult('{"temp":21}', counter);
    const report = await runSuite({
      client: bodyClient(() => result),
      suite: bodySuite([
        { type: "bodyMatchesSchema", schema: schemaOf({ temp: { type: "number" } }, ["temp"]) },
        { type: "bodyMatchesSchema", schema: schemaOf({}, ["temp"]) },
      ]),
    }).report;
    expect(report.status).toBe("passed");
    expect(counter.reads).toBe(1);
  });

  it("isError가 실패하면 그때 추출해 본문을 진단에 싣는다", async () => {
    const counter = { reads: 0 };
    const report = await runSuite({
      client: bodyClient(() => bodyResult("알 수 없는 도시: example", counter, { isError: true })),
      suite: bodySuite([{ type: "isError", expected: false }]),
    }).report;

    expect(report.cases[0]?.assertions[0]?.diagnostic?.notes).toEqual(["알 수 없는 도시: example"]);
    expect(counter.reads).toBe(1);
  });

  it("한 케이스의 isError 두 개가 같은 추출을 공유한다", async () => {
    const counter = { reads: 0 };
    const result = bodyResult("거절", counter, { isError: true });
    const report = await runSuite({
      client: bodyClient(() => result),
      suite: bodySuite([
        { type: "isError", expected: false },
        { type: "isError", expected: false },
      ]),
    }).report;

    expect(report.cases[0]?.assertions.map((item) => item.diagnostic?.notes)).toEqual([
      ["거절"],
      ["거절"],
    ]);
    expect(counter.reads).toBe(1);
  });

  it("isError가 실패해도 bodyMatchesSchema를 평가한다", async () => {
    const counter = { reads: 0 };
    const report = await runSuite({
      client: bodyClient(() => bodyResult('{"temperature":21}', counter)),
      suite: bodySuite([
        { type: "isError", expected: true },
        { type: "bodyMatchesSchema", schema: schemaOf({ temp: { type: "number" } }, ["temp"]) },
      ]),
    }).report;
    const assertions = report.cases[0]?.assertions ?? [];
    expect(assertions.map((item) => item.status)).toEqual(["failed", "failed"]);
  });

  it("MCP 호출이 실패하면 bodyMatchesSchema가 skipped다", async () => {
    const report = await runSuite({
      client: {
        listTools: async () => [],
        callTool: async () => {
          throw new Error("nope");
        },
        close: async () => undefined,
      },
      suite: bodySuite([
        { type: "bodyMatchesSchema", schema: schemaOf({ temp: { type: "number" } }, ["temp"]) },
      ]),
    }).report;
    expect(report.cases[0]?.assertions[0]?.status).toBe("skipped");
  });

  it("타임아웃이면 bodyMatchesSchema가 skipped다", async () => {
    vi.useFakeTimers();
    const execution = runSuite({
      client: {
        listTools: async () => [],
        callTool: () => new Promise(() => undefined),
        close: async () => undefined,
      },
      suite: bodySuite([
        { type: "bodyMatchesSchema", schema: schemaOf({ temp: { type: "number" } }, ["temp"]) },
      ]),
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const report = await execution.report;
    expect(report.cases[0]?.assertions[0]?.status).toBe("skipped");
  });

  it("위반 10건 케이스가 maxCaseBytes 안에 든다", async () => {
    const counter = { reads: 0 };
    const body = JSON.stringify(
      Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`f${index}`, "x"])),
    );
    const properties = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`f${index}`, { type: "number" }]),
    );
    const report = await runSuite({
      client: bodyClient(() => bodyResult(body, counter)),
      suite: bodySuite([{ type: "bodyMatchesSchema", schema: schemaOf(properties, []) }]),
    }).report;
    const diagnostic = report.cases[0]?.assertions[0]?.diagnostic;
    expect(diagnostic?.violations).toHaveLength(10);
    expect(diagnostic?.totalViolations).toBe(25);
    expect(byteLength(report.cases[0])).toBeLessThan(65_536);
  });

  it("큰 객체 위반 10건도 maxCaseBytes 안에 든다", async () => {
    const counter = { reads: 0 };
    const big = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`k${index}`, "가".repeat(200)]),
    );
    const body = JSON.stringify(
      Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`f${index}`, big])),
    );
    const properties = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`f${index}`, { type: "number" }]),
    );
    const report = await runSuite({
      client: bodyClient(() => bodyResult(body, counter)),
      suite: bodySuite([{ type: "bodyMatchesSchema", schema: schemaOf(properties, []) }]),
    }).report;
    const violations = report.cases[0]?.assertions[0]?.diagnostic?.violations ?? [];
    expect(violations).toHaveLength(10);
    for (const violation of violations)
      expect(violation.actual).toEqual({ kind: "object", keys: 200 });
    expect(byteLength(report.cases[0])).toBeLessThan(65_536);
  });

  /**
   * 거절 근거 확인 (#89 · 설계 문서 §4.2). `rejectionBasis` 는 판정을 바꾸지 않는다.
   * 아래 케이스들은 전부 `status: "passed"` 이고, 그 사실도 함께 단언한다.
   */
  describe("rejectionBasis", () => {
    /** 거절을 기대하는 케이스 하나짜리 스위트. 본문만 바꿔 가며 분류를 본다. */
    const rejectionSuite = (id: string): TestSuiteSpec => ({
      schemaVersion: 1,
      id,
      name: id,
      defaultTimeoutMs: 1_000,
      cases: [
        {
          id: "reject",
          name: "reject",
          operation: { type: "callTool", tool: "get_weather", input: { city: 123 } },
          assertions: [{ type: "isError", expected: true }],
        },
      ],
    });

    const respondWith = (text: string, isError = true): McpClient => ({
      listTools: async () => [{ name: "get_weather", inputSchema: {} }],
      callTool: async () => ({ content: [{ type: "text", text }], isError, raw: null }),
      close: async () => undefined,
    });

    it("거절을 기대한 케이스의 응답 본문으로 rejectionBasis 를 채운다", async () => {
      const report = await runSuite({
        client: respondWith(
          "MCP error -32602: Input validation error: Invalid arguments for tool get_weather: Invalid input: expected string, received number at city",
        ),
        suite: rejectionSuite("verified"),
      }).report;
      expect(report.cases[0]?.rejectionBasis).toBe("verified");
      expect(report.cases[0]?.status).toBe("passed");
      expect(report.summary.rejectionUnverified).toBe(0);
    });

    it("지문에 안 걸리면 unverified 다", async () => {
      const report = await runSuite({
        client: respondWith("→ 'city' 는 문자열이어야 합니다."),
        suite: rejectionSuite("unverified"),
      }).report;
      expect(report.cases[0]?.rejectionBasis).toBe("unverified");
      // 판정은 안 바뀐다. 확인 못 한 것이 실패가 되면 서버 11개 중 2개가 통째로 빨개진다(§4.3).
      expect(report.cases[0]?.status).toBe("passed");
      expect(report.summary.rejectionUnverified).toBe(1);
    });

    /**
     * 승인 화면(§5.2)이 "이 응답이 정상 거절인지 내부 오류인지" 를 사람에게 보여주려면 본문이
     * 필요한데 판정만으로는 그 자리를 못 채운다. 확인 못 한 케이스에만 싣는다.
     */
    it("unverified 케이스에만 응답 본문을 싣는다", async () => {
      const report = await runSuite({
        client: respondWith("→ 'city' 는 문자열이어야 합니다."),
        suite: rejectionSuite("body"),
      }).report;
      expect(report.cases[0]?.rejectionBody).toBe("→ 'city' 는 문자열이어야 합니다.");
    });

    it("verified 케이스에는 본문 키가 아예 없다", async () => {
      const report = await runSuite({
        client: respondWith("Input validation error: 'city' is a required property"),
        suite: rejectionSuite("no-body"),
      }).report;
      expect(report.cases[0]?.rejectionBasis).toBe("verified");
      expect(report.cases[0]).not.toHaveProperty("rejectionBody");
    });

    /**
     * 지문 대조에서 JSON 을 뺀 것을 표시에서까지 빼면, 서버가 분명히 보낸 본문이 승인 화면에
     * "(본문 없음)" 으로 찍힌다. 사용자에게 거짓을 말하는 것이고, JSON 오류 본문은 사람이
     * 판단하기에 오히려 좋은 재료다.
     */
    it("JSON 오류 본문도 직렬화해서 싣는다", async () => {
      const report = await runSuite({
        client: respondWith('{"error":"city must be a string","code":"BAD_INPUT"}'),
        suite: rejectionSuite("json-body"),
      }).report;
      // 지문 대조에는 안 쓴다. 여전히 확인 못 한 것이 맞다.
      expect(report.cases[0]?.rejectionBasis).toBe("unverified");
      expect(report.cases[0]?.rejectionBody).toBe(
        '{"error":"city must be a string","code":"BAD_INPUT"}',
      );
    });

    it("본문이 없으면 키를 만들지 않는다", async () => {
      const report = await runSuite({
        client: {
          listTools: async () => [{ name: "get_weather", inputSchema: {} }],
          // content 가 비면 추출이 실패한다. 확인은 못 했지만 실을 본문도 없다.
          callTool: async () => ({ content: [], isError: true, raw: null }),
          close: async () => undefined,
        },
        suite: rejectionSuite("empty"),
      }).report;
      expect(report.cases[0]?.rejectionBasis).toBe("unverified");
      expect(report.cases[0]).not.toHaveProperty("rejectionBody");
    });

    it("긴 본문은 진단 값과 같은 상한에서 잘린다", async () => {
      const long = "가".repeat(MAX_VALUE_STRING_CHARS + 80);
      const report = await runSuite({
        client: respondWith(long),
        suite: rejectionSuite("long"),
      }).report;
      const body = report.cases[0]?.rejectionBody ?? "";
      expect(body).toContain(`…(총 ${MAX_VALUE_STRING_CHARS + 80}자)`);
      expect(body.startsWith("가".repeat(MAX_VALUE_STRING_CHARS))).toBe(true);
    });

    it("본문에 redaction 이 적용된다", async () => {
      const report = await runSuite({
        client: respondWith("sk-live-secret"),
        suite: rejectionSuite("redact"),
        redaction: { sensitiveValues: ["sk-live-secret"] },
      }).report;
      expect(report.cases[0]?.rejectionBody).toBe("[REDACTED]");
    });

    it("거절을 기대하지 않는 케이스는 notApplicable 이다", async () => {
      const suite: TestSuiteSpec = {
        schemaVersion: 1,
        id: "happy",
        name: "happy",
        defaultTimeoutMs: 1_000,
        cases: [
          {
            id: "ok",
            name: "ok",
            operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
            assertions: [{ type: "isError", expected: false }],
          },
        ],
      };
      const report = await runSuite({ client: respondWith("맑음", false), suite }).report;
      expect(report.cases[0]?.rejectionBasis).toBe("notApplicable");
      expect(report.summary.rejectionUnverified).toBe(0);
    });

    it("listTools 케이스는 notApplicable 이다", async () => {
      const suite: TestSuiteSpec = {
        schemaVersion: 1,
        id: "tools",
        name: "tools",
        defaultTimeoutMs: 1_000,
        cases: [
          {
            id: "tools",
            name: "tools",
            operation: { type: "listTools" },
            assertions: [{ type: "toolExists", tool: "get_weather" }],
          },
        ],
      };
      const report = await runSuite({ client: respondWith("x"), suite }).report;
      expect(report.cases[0]?.rejectionBasis).toBe("notApplicable");
    });

    it("요약이 unverified 건수를 센다", async () => {
      const suite: TestSuiteSpec = {
        schemaVersion: 1,
        id: "mixed",
        name: "mixed",
        defaultTimeoutMs: 1_000,
        cases: [
          {
            id: "verified",
            name: "verified",
            operation: { type: "callTool", tool: "get_weather", input: { city: 1 } },
            assertions: [{ type: "isError", expected: true }],
          },
          {
            id: "unverified",
            name: "unverified",
            operation: { type: "callTool", tool: "get_weather", input: { city: 2 } },
            assertions: [{ type: "isError", expected: true }],
          },
          {
            id: "happy",
            name: "happy",
            operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
            assertions: [{ type: "isError", expected: false }],
          },
        ],
      };
      const report = await runSuite({
        client: {
          listTools: async () => [{ name: "get_weather", inputSchema: {} }],
          callTool: async (_name, args) => {
            const city = (args as { city?: unknown }).city;
            if (city === 1)
              return {
                content: [{ type: "text", text: "Input validation error: 'city' is not a string" }],
                isError: true,
                raw: null,
              };
            if (city === 2)
              return {
                content: [{ type: "text", text: "→ 'city' 는 문자열이어야 합니다." }],
                isError: true,
                raw: null,
              };
            return { content: [{ type: "text", text: "맑음" }], isError: false, raw: null };
          },
          close: async () => undefined,
        },
        suite,
      }).report;
      expect(report.cases.map((item) => item.rejectionBasis)).toEqual([
        "verified",
        "unverified",
        "notApplicable",
      ]);
      expect(report.summary.rejectionUnverified).toBe(1);
      expect(report.summary.passed).toBe(3);
    });

    /**
     * 실행되지 않은 케이스는 `notApplicable` 이다. 본문이 없으니 `unverified` 로 볼 수도 있으나,
     * 그러면 중단된 실행에서 안 돈 케이스 전부가 요약의 "확인하지 못했습니다" 에 실린다.
     * 안 돈 케이스는 초록으로 찍히지도 않아 크래시가 숨을 자리가 없다. 소음만 남는다(ADR-0015).
     */
    it("실행되지 않은 케이스는 notApplicable 이다", async () => {
      const suite: TestSuiteSpec = {
        schemaVersion: 1,
        id: "aborted",
        name: "aborted",
        defaultTimeoutMs: 1_000,
        cases: [
          {
            id: "boom",
            name: "boom",
            operation: { type: "callTool", tool: "get_weather", input: { city: 1 } },
            assertions: [{ type: "isError", expected: true }],
          },
          {
            id: "never",
            name: "never",
            operation: { type: "callTool", tool: "get_weather", input: { city: 2 } },
            assertions: [{ type: "isError", expected: true }],
          },
        ],
      };
      const controller = new AbortController();
      const report = await runSuite({
        client: {
          listTools: async () => [{ name: "get_weather", inputSchema: {} }],
          callTool: async () => {
            controller.abort();
            return {
              content: [{ type: "text", text: "→ 손으로 쓴 거절" }],
              isError: true,
              raw: null,
            };
          },
          close: async () => undefined,
        },
        suite,
        signal: controller.signal,
      }).report;
      const never = report.cases.find((item) => item.spec.id === "never");
      expect(never?.status).toBe("notRun");
      expect(never?.rejectionBasis).toBe("notApplicable");
    });
  });

  it("기존 isError 전용 스위트의 보고서가 변하지 않는다", async () => {
    const legacy: TestSuiteSpec = {
      schemaVersion: 1,
      id: "legacy",
      name: "legacy",
      defaultTimeoutMs: 1_000,
      cases: [
        {
          id: "tools",
          name: "tools",
          operation: { type: "listTools" },
          assertions: [{ type: "toolExists", tool: "get_weather" }],
        },
        {
          id: "call",
          name: "call",
          operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
          assertions: [{ type: "isError", expected: false }],
        },
      ],
    };
    const report = await runSuite({
      client: {
        listTools: async () => [{ name: "get_weather", inputSchema: {} }],
        callTool: async () => ({
          content: [{ type: "text", text: '{"temp":21}' }],
          isError: false,
          raw: null,
        }),
        close: async () => undefined,
      },
      suite: legacy,
    }).report;
    // 이 문자열은 bodyMatchesSchema 도입 전(HEAD 323ce2e)에 같은 fixture로 얻은 보고서에
    // 거절 근거 확인(#89)의 **추가 필드 둘**을 더한 것이다. 갱신한 것은 그 둘뿐이다 —
    // `cases[].rejectionBasis` 와 `summary.rejectionUnverified`. 기존 키의 값은 하나도 안 바뀌고
    // 특히 두 케이스의 `status` 가 그대로 `passed` 다. 그래서 `schemaVersion` 은 1 을 유지한다.
    // 이 두 케이스가 `notApplicable` 인 것도 사양이다. 거절을 기대하지 않으므로 응답 본문을
    // 읽지 않는다(설계 문서 §4.2).
    expect(JSON.stringify(report)).toBe(
      '{"schemaVersion":1,"suite":{"id":"legacy","name":"legacy","defaultTimeoutMs":1000},"status":"passed","cases":[{"spec":{"id":"tools","name":"tools","operation":{"type":"listTools"},"assertions":[{"type":"toolExists","tool":"get_weather"}]},"status":"passed","operation":{"status":"completed","timeoutMs":1000},"assertions":[{"spec":{"type":"toolExists","tool":"get_weather"},"status":"passed"}],"rejectionBasis":"notApplicable"},{"spec":{"id":"call","name":"call","operation":{"type":"callTool","tool":"get_weather","input":{"city":"서울"}},"assertions":[{"type":"isError","expected":false}]},"status":"passed","operation":{"status":"completed","timeoutMs":1000},"assertions":[{"spec":{"type":"isError","expected":false},"status":"passed"}],"rejectionBasis":"notApplicable"}],"summary":{"total":2,"passed":2,"failed":0,"timedOut":0,"cancelled":0,"notRun":0,"rejectionUnverified":0}}',
    );
  });
});

describe("runSuite와 연결 상실", () => {
  /** core 의 McpClientError 모양만 흉내 낸다. instanceof 에 기대지 않는 것을 함께 증명한다. */
  const coreError = (code: string, diagnostics?: unknown): unknown =>
    Object.assign(new Error("MCP error -32000: Connection closed"), {
      code,
      phase: "process",
      ...(diagnostics === undefined ? {} : { diagnostics }),
    });

  const stdio = (exitCode: number | null, signal: string | null) => ({
    transport: "stdio",
    stderr: "치명적: 내부 상태가 깨졌습니다 (일부러 낸 오류)",
    stderrTruncated: false,
    exitCode,
    signal,
  });

  const call = (id: string, expected: boolean): TestSuiteSpec["cases"][number] => ({
    id,
    name: id,
    operation: { type: "callTool", tool: "add", input: { a: 1, b: 2 } },
    assertions: [{ type: "isError", expected }],
  });

  /** 이슈 #279 의 재현 형태를 줄인 것. 첫 tools/call 에서 서버가 죽는다. */
  const dying: TestSuiteSpec = {
    schemaVersion: 1,
    id: "dies",
    name: "중간에 죽는 서버",
    defaultTimeoutMs: 2_000,
    cases: [call("add-success", false), call("add-missing-a", true), call("add-type-a", true)],
  };

  /** 첫 호출부터 error 를 던지는 client. 부른 횟수를 records 로 센다. */
  const throwing = (records: unknown[], error: unknown): McpClient => ({
    listTools: async () => [{ name: "add", inputSchema: {} }],
    callTool: async (name, args) => {
      records.push({ name, args });
      throw error;
    },
    close: async () => {
      records.push({ type: "close" });
    },
  });

  it("서버 프로세스가 죽으면 남은 케이스를 호출하지 않는다", async () => {
    const records: unknown[] = [];
    const client = throwing(records, coreError("PROCESS_EXITED", stdio(42, null)));

    const report = await runSuite({ client, suite: dying }).report;

    expect(report.stopReason).toEqual({
      type: "connectionLost",
      caseId: "add-success",
      cause: "processExited",
      exitCode: 42,
    });
    expect(records).toHaveLength(1);
  });

  it("죽은 케이스는 failed 로 남고 나머지는 not run 이다", async () => {
    // 이슈 #279 가 요구하는 형태. 원인 1건이 실패 1건으로 보이고 나머지는 안 돈 것으로 갈린다.
    const report = await runSuite({
      client: throwing([], coreError("PROCESS_EXITED", stdio(42, null))),
      suite: dying,
    }).report;

    expect(report.cases.map((item) => item.status)).toEqual(["failed", "notRun", "notRun"]);
    expect(report.summary).toMatchObject({ total: 3, failed: 1, notRun: 2 });
    // aborted 는 사용자가 요청한 취소의 뜻이다. 서버가 죽은 것은 실패다.
    expect(report.status).toBe("failed");
  });

  it("시그널로 죽으면 종료 코드 대신 시그널을 싣는다", async () => {
    const report = await runSuite({
      client: throwing([], coreError("PROCESS_EXITED", stdio(null, "SIGKILL"))),
      suite: dying,
    }).report;

    expect(report.stopReason).toEqual({
      type: "connectionLost",
      caseId: "add-success",
      cause: "processExited",
      signal: "SIGKILL",
    });
    expect(Object.keys(report.stopReason ?? {})).not.toContain("exitCode");
  });

  it("전송 실패와 세션 상실도 멈춘다", async () => {
    const transport = await runSuite({
      client: throwing([], coreError("TRANSPORT_FAILED")),
      suite: dying,
    }).report;
    const session = await runSuite({
      client: throwing([], coreError("HTTP_SESSION_LOST")),
      suite: dying,
    }).report;

    expect(transport.stopReason).toMatchObject({ cause: "transportFailed" });
    expect(session.stopReason).toMatchObject({ cause: "httpSessionLost" });
    expect(transport.summary.notRun).toBe(2);
    expect(session.summary.notRun).toBe(2);
  });

  it("서버가 살아 있는 작업 실패는 멈추지 않는다", async () => {
    // 여기서 멈추면 툴 하나가 오류를 낼 때마다 나머지 케이스가 통째로 안 돌게 된다.
    const records: unknown[] = [];
    const client = throwing(records, coreError("OPERATION_FAILED"));

    const report = await runSuite({ client, suite: dying }).report;

    expect(report.stopReason).toBeUndefined();
    expect(records).toHaveLength(3);
    expect(report.summary).toMatchObject({ failed: 3, notRun: 0 });
  });

  it("코드가 없는 오류는 멈추지 않는다", async () => {
    const records: unknown[] = [];

    const report = await runSuite({
      client: throwing(records, new Error("nope")),
      suite: dying,
    }).report;

    expect(report.stopReason).toBeUndefined();
    expect(records).toHaveLength(3);
  });

  it("타임아웃이 연결 상실보다 먼저다", async () => {
    vi.useFakeTimers();
    const client: McpClient = {
      listTools: async () => [],
      callTool: () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(coreError("PROCESS_EXITED", stdio(42, null))), 5_000);
        }),
      close: async () => undefined,
    };

    const execution = runSuite({ client, suite: dying });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(execution.report).resolves.toMatchObject({
      stopReason: { type: "timeout", caseId: "add-success" },
    });
  });

  it("취소가 연결 상실보다 먼저다", async () => {
    const controller = new AbortController();
    const client: McpClient = {
      listTools: async () => [],
      callTool: () => {
        controller.abort();
        return Promise.reject(coreError("PROCESS_EXITED", stdio(42, null)));
      },
      close: async () => undefined,
    };

    const report = await runSuite({ client, suite: dying, signal: controller.signal }).report;

    expect(report.stopReason).toEqual({ type: "abortSignal", caseId: "add-success" });
    expect(report.status).toBe("aborted");
  });

  it("안 돈 케이스는 거절 근거 미확인에 실리지 않는다", async () => {
    // 이슈 #279 의 곁다리. 거절을 기대한 2건이 not run 이 되면서 §5.1 경고에서 빠진다.
    // 죽은 케이스가 성공을 기대했으므로 0 이다.
    const report = await runSuite({
      client: throwing([], coreError("PROCESS_EXITED", stdio(42, null))),
      suite: dying,
    }).report;

    expect(report.summary.rejectionUnverified).toBe(0);
    expect(report.cases.map((item) => item.rejectionBasis)).toEqual([
      "notApplicable",
      "notApplicable",
      "notApplicable",
    ]);
  });
});

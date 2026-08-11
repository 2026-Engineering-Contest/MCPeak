import type { McpClient } from "@ohmymcp/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RunnerEvent,
  runSuite,
  SuiteValidationError,
  type TestSuiteSpec,
} from "../src/index.js";

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

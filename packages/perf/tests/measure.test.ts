import type { ToolResult } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import { measure } from "../src/measure.js";
import type { PerfCall, PerfMeasurement, PerfPlan } from "../src/types.js";

const OK: ToolResult = { content: [{ type: "text", text: "맑음" }], isError: false, raw: {} };

type Responder = (name: string, args: unknown, index: number) => Promise<ToolResult>;

interface SleepRecord {
  readonly ms: number;
  readonly signal: AbortSignal | undefined;
}

/**
 * 계획서 §5.3 의 fake 들. now 는 부를 때마다 1 씩 오른다. sleep 은 기록만 한다.
 * signal 없는 sleep(간격)은 바로 resolve 하고, signal 있는 sleep(타임아웃 경쟁)은
 * timeoutAt 에 든 순번(0 부터)일 때만 바로 resolve 하고 나머지는 끝나지 않는다.
 */
function harness(options: { respond?: Responder; timeoutAt?: readonly number[] } = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const sleeps: SleepRecord[] = [];
  let clock = 0;
  let raceIndex = 0;
  const respond = options.respond ?? (async () => OK);
  const timeoutAt = new Set(options.timeoutAt ?? []);
  return {
    calls,
    sleeps,
    client: {
      callTool(name: string, args: unknown): Promise<ToolResult> {
        calls.push({ name, args });
        return respond(name, args, calls.length - 1);
      },
    },
    now: () => {
      clock += 1;
      return clock;
    },
    sleep: (ms: number, signal?: AbortSignal): Promise<void> => {
      sleeps.push({ ms, signal });
      if (signal === undefined) return Promise.resolve();
      const index = raceIndex;
      raceIndex += 1;
      if (timeoutAt.has(index)) return Promise.resolve();
      return new Promise<void>(() => {});
    },
  };
}

function perfCall(caseId: string, tool: string, timeoutMs = 10_000): PerfCall {
  return { caseId, tool, input: { city: caseId }, timeoutMs };
}

function plan(calls: readonly PerfCall[], repeat: number, intervalMs: number): PerfPlan {
  return { calls, repeat, intervalMs };
}

const never = () => new Promise<ToolResult>(() => {});

describe("measure", () => {
  it("케이스를 명세 순서대로 repeat 회 연속 부르고 사이에 간격 sleep 을 한다", async () => {
    const h = harness();
    const result = await measure({
      client: h.client,
      availableTools: new Set(["a", "b"]),
      plan: plan([perfCall("A", "a"), perfCall("B", "b")], 3, 25),
      now: h.now,
      sleep: h.sleep,
    });
    expect(h.calls.map((c) => c.name)).toEqual(["a", "a", "a", "b", "b", "b"]);
    expect(h.calls[0]?.args).toEqual({ city: "A" });
    expect(result.map((m) => [m.caseId, m.iteration])).toEqual([
      ["A", 0],
      ["A", 1],
      ["A", 2],
      ["B", 0],
      ["B", 1],
      ["B", 2],
    ]);
    const intervals = h.sleeps.filter((s) => s.signal === undefined);
    expect(intervals).toHaveLength(2 * 3 - 1);
    expect(intervals.every((s) => s.ms === 25)).toBe(true);
  });

  it("intervalMs 0 이면 signal 없는 sleep 을 부르지 않는다", async () => {
    const h = harness();
    await measure({
      client: h.client,
      availableTools: new Set(["a", "b"]),
      plan: plan([perfCall("A", "a"), perfCall("B", "b")], 3, 0),
      now: h.now,
      sleep: h.sleep,
    });
    expect(h.sleeps.filter((s) => s.signal === undefined)).toHaveLength(0);
    expect(h.calls).toHaveLength(6);
  });

  it("간격 sleep 은 호출 앞에 오고 t0 는 그 뒤, t1 은 경쟁 직후다", async () => {
    const events: string[] = [];
    let clock = 0;
    const result = await measure({
      client: {
        async callTool() {
          events.push("call");
          return OK;
        },
      },
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a")], 2, 5),
      now: () => {
        clock += 1;
        events.push(`now${clock}`);
        return clock;
      },
      sleep: (_ms, signal) => {
        events.push(signal === undefined ? "interval" : "race");
        return signal === undefined ? Promise.resolve() : new Promise<void>(() => {});
      },
    });
    expect(events).toEqual([
      "now1",
      "call",
      "race",
      "now2",
      "interval",
      "now3",
      "call",
      "race",
      "now4",
    ]);
    expect(result.map((m) => [m.t0, m.t1])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("타임아웃 경쟁의 sleep 은 signal 을 받고, 호출이 먼저 끝나면 그 signal 이 abort 된다", async () => {
    const h = harness();
    await measure({
      client: h.client,
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a", 1234)], 2, 0),
      now: h.now,
      sleep: h.sleep,
    });
    const races = h.sleeps.filter((s) => s.signal !== undefined);
    expect(races).toHaveLength(2);
    expect(races.every((s) => s.ms === 1234)).toBe(true);
    expect(races.every((s) => s.signal?.aborted === true)).toBe(true);
  });

  it("isError·empty·threw 를 분류한다", async () => {
    const results: (ToolResult | Error)[] = [
      { content: [{ type: "text", text: "x" }], isError: true, raw: {} },
      { content: [], isError: false, raw: {} },
      { content: [{ type: "text", text: "  " }], isError: false, raw: {} },
      { content: [], isError: false, raw: { structuredContent: {} } },
      new Error("연결이 끊겼습니다"),
      OK,
      { content: "문자열", isError: false, raw: {} },
      {
        content: [
          { type: "text", text: " " },
          { type: "image", data: "", mimeType: "image/png" },
        ],
        isError: false,
        raw: {},
      },
      { content: [], isError: false, raw: null },
    ];
    const h = harness({
      respond: async (_name, _args, index) => {
        const r = results[index];
        if (r instanceof Error) throw r;
        if (r === undefined) throw new Error("응답 목록을 넘었다");
        return r;
      },
    });
    const measured = await measure({
      client: h.client,
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a")], results.length, 0),
      now: h.now,
      sleep: h.sleep,
    });
    expect(measured.map((m) => m.outcome)).toEqual([
      "isError",
      "empty",
      "empty",
      "ok",
      "threw",
      "ok",
      "empty",
      "ok",
      "ok",
    ]);
    expect(measured[4]?.detail).toBe("연결이 끊겼습니다");
    expect(measured[4]?.timedOut).toBeUndefined();
    expect(measured.filter((m) => m.outcome !== "threw").every((m) => !("detail" in m))).toBe(true);
  });

  it("타임아웃이면 threw 이고 남은 호출은 케이스와 무관하게 전부 skipped 로 부르지 않는다", async () => {
    const h = harness({
      respond: async (_name, _args, index) => (index === 1 ? never() : OK),
      timeoutAt: [1],
    });
    const measured = await measure({
      client: h.client,
      availableTools: new Set(["a", "b"]),
      plan: plan([perfCall("A", "a", 10), perfCall("B", "b", 10)], 5, 0),
      now: h.now,
      sleep: h.sleep,
    });
    const outcomes = (caseId: string) =>
      measured.filter((m) => m.caseId === caseId).map((m) => m.outcome);
    expect(outcomes("A")).toEqual(["ok", "threw", "skipped", "skipped", "skipped"]);
    expect(outcomes("B")).toEqual(["skipped", "skipped", "skipped", "skipped", "skipped"]);
    expect(h.calls).toHaveLength(2);
    expect(measured[1]?.timedOut).toBe(true);
    expect(measured[1]?.detail).toBe("호출이 10ms 안에 끝나지 않았습니다");
    expect(measured.filter((m) => m.outcome === "skipped").every((m) => m.t0 === m.t1)).toBe(true);
    expect(measured.filter((m, i) => i !== 1).every((m) => m.timedOut === undefined)).toBe(true);
  });

  it("타임아웃 뒤 늦게 거부된 호출이 처리되지 않은 거부로 새지 않는다", async () => {
    let rejectLate: (error: Error) => void = () => {};
    const h = harness({
      respond: () =>
        new Promise<ToolResult>((_resolve, reject) => {
          rejectLate = reject;
        }),
      timeoutAt: [0],
    });
    const measured = await measure({
      client: h.client,
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a", 10)], 1, 0),
      now: h.now,
      sleep: h.sleep,
    });
    rejectLate(new Error("늦은 거부"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(measured[0]?.outcome).toBe("threw");
    expect(measured[0]?.timedOut).toBe(true);
  });

  it("목록에 없는 도구는 부르지 않고 missingTool 로 둔다", async () => {
    const h = harness();
    const measured = await measure({
      client: h.client,
      availableTools: new Set(["b"]),
      plan: plan([perfCall("A", "a"), perfCall("B", "b")], 2, 7),
      now: h.now,
      sleep: h.sleep,
    });
    expect(measured.map((m) => m.outcome)).toEqual(["missingTool", "missingTool", "ok", "ok"]);
    expect(h.calls.map((c) => c.name)).toEqual(["b", "b"]);
    expect(measured.slice(0, 2).every((m) => m.t0 === m.t1)).toBe(true);
    // 첫 실제 호출 앞에는 간격이 없다. 그래서 간격 sleep 은 한 번이다.
    expect(h.sleeps.filter((s) => s.signal === undefined)).toHaveLength(1);
  });

  it("오류 detail 은 첫 줄, URL 표기, 200자", async () => {
    const errors: unknown[] = [
      new Error("GET https://u:p@h.example/x?key=SECRET_7c1 failed\nstack"),
      new Error("x".repeat(250)),
      "문자열 거부\r\n둘째 줄",
      new Error("a http://h.example/a?q=1 와 https://k.example/b 둘"),
    ];
    const h = harness({
      respond: async (_name, _args, index) => {
        throw errors[index];
      },
    });
    const measured = await measure({
      client: h.client,
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a")], errors.length, 0),
      now: h.now,
      sleep: h.sleep,
    });
    expect(measured.map((m) => m.detail)).toEqual([
      "GET h.example/x?key=… failed",
      `${"x".repeat(200)}…`,
      "문자열 거부",
      "a h.example/a?q=… 와 k.example/b 둘",
    ]);
    expect(measured.every((m) => !(m.detail ?? "").includes("SECRET_7c1"))).toBe(true);
  });

  it("callTool 이 동기로 던져도 threw 로 센다", async () => {
    const measured = await measure({
      client: {
        callTool() {
          throw new Error("동기 오류");
        },
      },
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a")], 1, 0),
      now: () => 0,
      sleep: () => new Promise<void>(() => {}),
    });
    expect(measured[0]?.outcome).toBe("threw");
    expect(measured[0]?.detail).toBe("동기 오류");
  });

  it("onProgress 는 측정 하나마다 부르고 total 은 calls × repeat 다", async () => {
    const progress: [number, number][] = [];
    const h = harness({
      respond: async (_n, _a, index) => (index === 0 ? never() : OK),
      timeoutAt: [0],
    });
    await measure({
      client: h.client,
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a"), perfCall("B", "a")], 2, 0),
      now: h.now,
      sleep: h.sleep,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it("측정값은 케이스·도구·반복 번호를 싣는다", async () => {
    const h = harness();
    const measured: readonly PerfMeasurement[] = await measure({
      client: h.client,
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a")], 1, 0),
      now: h.now,
      sleep: h.sleep,
    });
    expect(measured).toEqual([
      { caseId: "A", tool: "a", iteration: 0, t0: 1, t1: 2, outcome: "ok" },
    ]);
  });
});

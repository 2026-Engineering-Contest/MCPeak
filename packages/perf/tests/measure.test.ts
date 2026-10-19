import { McpClientError, type ToolResult } from "@mcpeak/core";
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

  it("오류 detail 은 cause 사슬의 가장 안쪽 Error 의 문장이다", async () => {
    // core 의 McpClientError 는 고정 문장을 message 로 두고 SDK 사유를 cause 에 싣는다(설계 §5.4, 계획 E24).
    const rejection = (cause?: unknown) =>
      new McpClientError({
        code: "OPERATION_FAILED",
        phase: "callTool",
        diagnostics: { stderr: "", stderrTruncated: false, exitCode: null, signal: null },
        ...(cause === undefined ? {} : { cause }),
      });
    const looped = new Error("바깥 고리");
    const inner = new Error("안쪽 고리", { cause: looped });
    (looped as { cause?: unknown }).cause = inner;
    const errors: unknown[] = [
      rejection(new Error("MCP error -32602: Output validation error: bad\nstack")),
      rejection(new Error("connect postgres://user:pw@db.example:5432/x?token=S refused")),
      rejection(),
      // cause 가 Error 가 아니면 거기서 멈추고 그 앞 Error 의 문장을 쓴다.
      new Error("바깥 문장", { cause: "문자열 원인" }),
      looped,
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
      "MCP error -32602: Output validation error: bad",
      "connect db.example:5432/x?token=… refused",
      "MCP 작업이 protocol 오류로 거절되었습니다.",
      "바깥 문장",
      // 순환이면 이미 본 Error 를 다시 만나는 자리에서 멈춘다. 그 직전이 가장 안쪽이다.
      "안쪽 고리",
    ]);
    expect(measured.every((m) => !(m.detail ?? "").includes("pw"))).toBe(true);
  });

  it("OPERATION_FAILED 밖의 McpClientError 는 분류 문장 뒤에 원인을 잇는다", async () => {
    // 서버 종료·전송 실패는 분류가 원인보다 중요하다(설계 §5.4, 계획 E31). 원인만 실으면
    // "Connection closed" 만 남아 서버가 죽은 줄 모른다.
    const diagnostics = { stderr: "", stderrTruncated: false, exitCode: 1, signal: null };
    const errors: unknown[] = [
      new McpClientError({
        code: "PROCESS_EXITED",
        phase: "process",
        diagnostics,
        cause: new Error("MCP error -32000: Connection closed"),
      }),
      new McpClientError({ code: "PROCESS_EXITED", phase: "process", diagnostics }),
      new McpClientError({
        code: "OPERATION_FAILED",
        phase: "callTool",
        diagnostics,
        cause: new Error("MCP error -32603: boom"),
      }),
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
      "요청 완료 전 MCP 서버가 종료되었습니다: MCP error -32000: Connection closed",
      "요청 완료 전 MCP 서버가 종료되었습니다.",
      "MCP error -32603: boom",
    ]);
  });

  it("맨 앞에서 연달아 반복된 MCP error 머리말은 하나만 남긴다", async () => {
    // 저수준 Server 가 McpError 를 던지면 서버 문장에 이미 머리말이 있고 클라이언트 SDK 가 다시 붙인다.
    const diagnostics = { stderr: "", stderrTruncated: false, exitCode: null, signal: null };
    const twice = "MCP error -32602: MCP error -32602: Output validation error: bad";
    const errors: unknown[] = [
      new McpClientError({
        code: "OPERATION_FAILED",
        phase: "callTool",
        diagnostics,
        cause: new Error(twice),
      }),
      // 접두를 잇는 경우는 안쪽 문장에 먼저 적용한다.
      new McpClientError({
        code: "PROCESS_EXITED",
        phase: "process",
        diagnostics,
        cause: new Error("MCP error -32000: MCP error -32000: MCP error -32000: Connection closed"),
      }),
      // 번호가 다르거나 맨 앞이 아니면 그대로다.
      new Error("MCP error -32602: MCP error -32603: x"),
      new Error("wrapped MCP error 1: MCP error 1: y"),
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
      "MCP error -32602: Output validation error: bad",
      "요청 완료 전 MCP 서버가 종료되었습니다: MCP error -32000: Connection closed",
      "MCP error -32602: MCP error -32603: x",
      "wrapped MCP error 1: MCP error 1: y",
    ]);
  });

  it("흔한 비밀 모양을 가린다", async () => {
    const errors: unknown[] = [
      new Error(
        "upstream 401: Invalid API key sk-live-ABCDEF1234567890 (Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.SECRETPAYLOAD)",
      ),
      new Error("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl expired"),
      // 키는 숫자가 섞이고 12자 이상 영숫자 조각이 있어야 가린다(계획 E35).
      new Error("keys pk-ABCDEFGH12345678 and rk-0123456789abcdef_- and sk-short1 ok"),
      // 16자 미만 Bearer 값은 숫자가 섞여야 가린다(계획 E35).
      new Error("Bearer\tabc1.def rejected"),
      new Error("OpenAI 401: sk-proj-Ab3dEfGhIjKlMnOpQrStUvWx_yz-0123 is invalid"),
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
      // Bearer 값은 token68 문자까지라 뒤의 닫는 괄호는 남는다.
      "upstream 401: Invalid API key … (Authorization: Bearer …)",
      "token … expired",
      // 12자 이상 영숫자 조각이 없는 키는 그대로다(설계 §5.4 의 한계).
      "keys … and … and sk-short1 ok",
      "Bearer … rejected",
      "OpenAI 401: … is invalid",
    ]);
    for (const secret of [
      "sk-live",
      "SECRETPAYLOAD",
      "eyJ",
      "ABCDEFGH12345678",
      "abc1.def",
      "sk-proj",
    ])
      expect(measured.every((m) => !(m.detail ?? "").includes(secret))).toBe(true);
  });

  it("비밀 모양을 닮은 정상 문장은 그대로 둔다", async () => {
    // 3차 검토 실측(계획 E35): 인증 안내 문장과 제약·인덱스 이름이 가려져 원인을 읽을 수 없었다.
    const sentences = [
      "Bearer token required",
      "Missing Bearer authentication header",
      "unique constraint pk-orders-customer-region-idx",
      "index rk-2024-shard-assignment-table not found",
    ];
    const h = harness({
      respond: async (_name, _args, index) => {
        throw new Error(sentences[index]);
      },
    });
    const measured = await measure({
      client: h.client,
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a")], sentences.length, 0),
      now: h.now,
      sleep: h.sleep,
    });
    expect(measured.map((m) => m.detail)).toEqual(sentences);
  });

  it("비밀 가림은 URL 가림 뒤이고 200자 자르기 앞이다", async () => {
    const h = harness({
      respond: async () => {
        throw new Error(`GET https://h.example/x?k=v Bearer ${"t".repeat(300)} 끝`);
      },
    });
    const measured = await measure({
      client: h.client,
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a")], 1, 0),
      now: h.now,
      sleep: h.sleep,
    });
    expect(measured[0]?.detail).toBe("GET h.example/x?k=… Bearer … 끝");
  });

  it("http(s) 밖 스킴의 URL 도 가린다", async () => {
    const h = harness({
      respond: async () => {
        throw new Error("redis://:hunter2@cache.example:6379/0 와 ftp://f.example/p?k=v");
      },
    });
    const measured = await measure({
      client: h.client,
      availableTools: new Set(["a"]),
      plan: plan([perfCall("A", "a")], 1, 0),
      now: h.now,
      sleep: h.sleep,
    });
    expect(measured[0]?.detail).toBe("cache.example:6379/0 와 f.example/p?k=…");
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

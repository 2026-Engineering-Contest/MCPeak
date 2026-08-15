import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpClient, ToolDef, ToolResult } from "@ohmymcp/core";
import { describe, expect, it } from "vitest";
import {
  type Cassette,
  cassetteClient,
  loadCassette,
  matchKey,
  redact,
  saveCassette,
  snapshotContract,
  stableStringify,
} from "../src/index.js";

const TOOLS: ToolDef[] = [
  {
    name: "get_weather",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
];

const ok = (raw: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(raw) }],
  isError: false,
  raw,
});

function fakeClient(results: ToolResult[]): McpClient & {
  calls: { listTools: number; callTool: number; close: number };
} {
  const calls = { listTools: 0, callTool: 0, close: 0 };
  return {
    calls,
    async listTools() {
      calls.listTools++;
      return TOOLS;
    },
    async callTool() {
      calls.callTool++;
      const result = results.shift();
      if (result === undefined) throw new Error("no result");
      return result;
    },
    async close() {
      calls.close++;
    },
  };
}

describe("stableStringify", () => {
  it("객체 키 순서가 달라도 같은 문자열을 만든다", () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("배열 순서는 의미 있게 유지한다", () => {
    expect(stableStringify(["a", "b"])).not.toBe(stableStringify(["b", "a"]));
  });

  it("객체의 undefined 필드는 제거하고 배열의 undefined 자리는 null 로 보존한다", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("순환 참조와 sparse array를 거절한다", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(TypeError);
    const sparse = [1, undefined, 3];
    delete sparse[1];
    expect(() => stableStringify(sparse)).toThrow(TypeError);
  });
});

describe("matchKey", () => {
  it("같은 툴과 의미상 같은 args 는 같은 해시 키를 만든다", () => {
    const left = matchKey("search_docs", { query: "mcp", limit: 3 });
    const right = matchKey("search_docs", { limit: 3, query: "mcp" });
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });

  it("툴 이름이 다르면 키도 다르고 args 원문 비밀값이 노출되지 않는다", () => {
    const key = matchKey("fetch_data", { apiKey: "sk-live-abc123", id: 7 });
    expect(key).not.toBe(matchKey("fetch_other", { apiKey: "sk-live-abc123", id: 7 }));
    expect(key).not.toContain("sk-live-abc123");
    expect(key).not.toContain("apiKey");
  });
});

describe("redact / snapshotContract", () => {
  it("비밀값 이름을 중첩 객체까지 마스킹한다", () => {
    expect(
      redact({
        headers: { authorization: "Bearer secret" },
        apiKey: "sk-live",
        tokenCount: 42,
        nested: [{ refresh_token: "refresh" }],
      }),
    ).toStrictEqual({
      headers: { authorization: "[redacted]" },
      apiKey: "[redacted]",
      tokenCount: "[redacted]",
      nested: [{ refresh_token: "[redacted]" }],
    });
  });

  it("마스킹 중 sparse array를 거절한다", () => {
    const sparse = [1, undefined, 3];
    delete sparse[1];

    expect(() => redact(sparse)).toThrow("카세트 JSON에는 sparse array를 사용할 수 없습니다.");
  });

  it("비결정 필드는 제거하고 계약 변경 필드는 남긴다", () => {
    const snapshot = snapshotContract(
      ok({
        id: "run-1",
        requestId: "req-1",
        timestamp: "2026-08-14T00:00:00Z",
        data: { name: "weather", updatedAt: "now", fields: ["city"] },
        auth: { token: "secret" },
      }),
    );

    expect(snapshot).toStrictEqual({
      data: { name: "weather", fields: ["city"] },
      auth: { token: "[redacted]" },
    });
  });
});

describe("cassetteClient", () => {
  it("replay 모드에서 callTool 은 inner 를 호출하지 않고 카세트 응답을 돌려준다", async () => {
    const cassette = cassetteWith({
      toolName: "get_weather",
      args: { city: "Seoul" },
      result: ok({ temp: 21 }),
    });
    const inner = fakeClient([ok({ temp: 99 })]);
    const client = cassetteClient(inner, { cassette, mode: "replay" });

    await expect(client.callTool("get_weather", { city: "Seoul" })).resolves.toStrictEqual(
      ok({ temp: 21 }),
    );
    expect(inner.calls.callTool).toBe(0);
  });

  it("auto 모드에서 miss 난 호출만 inner 에 위임하고 close 때 flush 한다", async () => {
    const cassette = cassetteWith({
      toolName: "get_weather",
      args: { city: "Seoul" },
      result: ok({ temp: 21 }),
    });
    const flushed: Cassette[] = [];
    const inner = fakeClient([ok({ temp: 27 })]);
    const client = cassetteClient(inner, {
      cassette,
      mode: "auto",
      onFlush: async (next) => {
        flushed.push(next);
      },
    });

    await expect(client.callTool("get_weather", { city: "Seoul" })).resolves.toStrictEqual(
      ok({ temp: 21 }),
    );
    await expect(client.callTool("get_weather", { city: "Busan" })).resolves.toStrictEqual(
      ok({ temp: 27 }),
    );
    await client.close();

    expect(inner.calls.callTool).toBe(1);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.interactions).toHaveLength(2);
  });

  it("기본 auto 모드는 miss 뒤 hit 응답 원문을 유지하고 flush 는 마스킹한다", async () => {
    const result = ok({ id: "run-1", token: "secret-token", value: 7 });
    const flushed: Cassette[] = [];
    const inner = fakeClient([result]);
    const client = cassetteClient(inner, {
      cassette: null,
      onFlush: async (next) => {
        flushed.push(next);
      },
    });

    await expect(client.callTool("get_secret", { id: 1, apiKey: "secret-input" })).resolves.toBe(
      result,
    );
    await expect(
      client.callTool("get_secret", { id: 1, apiKey: "secret-input" }),
    ).resolves.toStrictEqual(result);
    await client.close();

    expect(inner.calls.callTool).toBe(1);
    expect(flushed[0]?.interactions[0]?.request.args).toStrictEqual({
      id: 1,
      apiKey: "[redacted]",
    });
    expect(flushed[0]?.interactions[0]?.response.raw).toStrictEqual({
      id: "run-1",
      token: "[redacted]",
      value: 7,
    });
  });

  it("녹화할 수 없는 응답은 호출 성공과 녹화 실패를 분리한다", async () => {
    const result: ToolResult = {
      content: [],
      isError: false,
      raw: { createdAt: new Date("2026-08-15T00:00:00.000Z") },
    };
    const flushed: Cassette[] = [];
    const inner = fakeClient([result]);
    const client = cassetteClient(inner, {
      cassette: null,
      mode: "auto",
      onFlush: async (next) => {
        flushed.push(next);
      },
    });

    await expect(client.callTool("get_time", { id: 1 })).resolves.toBe(result);

    let error: unknown;
    try {
      await client.close();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("카세트 녹화에 실패했습니다: get_time");
    expect((error as Error).message).toContain("실제 MCP 호출은 성공했습니다.");
    expect((error as Error).message).toContain("response.raw.createdAt");
    expect((error as Error).message).toContain("값 종류: Date");
    expect(flushed).toStrictEqual([]);
    expect(inner.calls.callTool).toBe(1);
    expect(inner.calls.close).toBe(1);
  });

  it.each(["record", "auto"] as const)(
    "%s 모드에서 녹화할 수 없는 args 가 실제 호출을 막지 않는다",
    async (mode) => {
      const result = ok({ events: [] });
      const flushed: Cassette[] = [];
      const inner = fakeClient([result]);
      const client = cassetteClient(inner, {
        cassette: null,
        mode,
        onFlush: async (next) => {
          flushed.push(next);
        },
      });

      await expect(
        client.callTool("get_events", { since: new Date("2026-08-15T00:00:00.000Z") }),
      ).resolves.toBe(result);

      let error: unknown;
      try {
        await client.close();
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "카세트 녹화에 실패했습니다: get_events(<표시할 수 없는 인자>)",
      );
      expect((error as Error).message).toContain("실제 MCP 호출은 성공했습니다.");
      expect((error as Error).message).toContain("기록할 수 없는 값: args.since");
      expect((error as Error).message).toContain("값 종류: Date");
      expect(flushed).toStrictEqual([]);
      expect(inner.calls.callTool).toBe(1);
      expect(inner.calls.close).toBe(1);
    },
  );

  it("replay 모드에서 녹화할 수 없는 args 는 조회 불가 원인을 설명한다", async () => {
    const inner = fakeClient([]);
    const client = cassetteClient(inner, {
      cassette: null,
      cassettePath: "fixtures/events.cassette.json",
      mode: "replay",
    });

    let error: unknown;
    try {
      await client.callTool("get_events", { since: new Date("2026-08-15T00:00:00.000Z") });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "이 args 로는 카세트를 조회할 수 없습니다: get_events(<표시할 수 없는 인자>)",
    );
    expect((error as Error).message).toContain(
      "카세트: fixtures/events.cassette.json (상호작용 0개)",
    );
    expect((error as Error).message).toContain("조회할 수 없는 값: args.since");
    expect((error as Error).message).toContain("값 종류: Date");
    expect(inner.calls.callTool).toBe(0);
  });

  it("replay miss 는 카세트 갱신 안내를 포함한 오류를 낸다", async () => {
    const cassette = cassetteWith({
      toolName: "get_stock",
      args: { ticker: "MSFT" },
      result: ok({ price: 330 }),
    });
    const inner = fakeClient([]);
    const client = cassetteClient(inner, {
      cassette,
      cassettePath: "fixtures/stock.cassette.json",
      mode: "replay",
    });

    await expect(client.callTool("get_stock", { ticker: "AAPL" })).rejects.toThrow(
      "카세트에 없는 호출입니다",
    );
    await expect(client.callTool("get_stock", { ticker: "AAPL" })).rejects.toThrow(
      "카세트: fixtures/stock.cassette.json (상호작용 1개)",
    );
    await expect(client.callTool("get_stock", { ticker: "AAPL" })).rejects.toThrow(
      '비슷한 키: get_stock({"ticker":"MSFT"})',
    );
    expect(inner.calls.callTool).toBe(0);
  });

  it("listTools 도 카세트에서 재생한다", async () => {
    const inner = fakeClient([]);
    const client = cassetteClient(inner, {
      cassette: { version: 1, interactions: [], tools: TOOLS },
      mode: "replay",
    });

    await expect(client.listTools()).resolves.toStrictEqual(TOOLS);
    expect(inner.calls.listTools).toBe(0);
  });

  it("같은 키에 다른 응답을 record 하면 경고하고 카세트는 첫 응답을 유지한다", async () => {
    const warnings: string[] = [];
    const flushed: Cassette[] = [];
    const inner = fakeClient([ok({ price: 187.4 }), ok({ price: 187.9 })]);
    const client = cassetteClient(inner, {
      cassette: null,
      mode: "record",
      onWarning: (message) => warnings.push(message),
      onFlush: async (cassette) => {
        flushed.push(cassette);
      },
    });

    await client.callTool("get_stock", { ticker: "AAPL" });
    await client.callTool("get_stock", { ticker: "AAPL" });
    await client.close();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("같은 요청에 다른 응답");
    expect(warnings[0]).toContain("1회차 raw.price: 187.4 / 2회차 raw.price: 187.9");
    expect(warnings[0]).not.toContain("기존 응답:");
    expect(flushed[0]?.interactions).toHaveLength(1);
    expect(flushed[0]?.interactions[0]?.response.raw).toStrictEqual({ price: 187.4 });
  });

  it("close 는 flush 후 inner.close 를 호출한다", async () => {
    const events: string[] = [];
    const inner: McpClient = {
      async listTools() {
        return [];
      },
      async callTool() {
        return ok({});
      },
      async close() {
        events.push("close");
      },
    };
    const client = cassetteClient(inner, {
      cassette: null,
      mode: "record",
      onFlush: async () => {
        events.push("flush");
      },
    });

    await client.close();
    expect(events).toStrictEqual(["flush", "close"]);
  });

  it("onFlush 가 실패해도 inner.close 는 실행된다", async () => {
    const events: string[] = [];
    const flushError = new Error("flush 실패");
    const inner: McpClient = {
      async listTools() {
        return [];
      },
      async callTool() {
        return ok({});
      },
      async close() {
        events.push("close");
      },
    };
    const client = cassetteClient(inner, {
      cassette: null,
      mode: "record",
      onFlush: async () => {
        events.push("flush");
        throw flushError;
      },
    });

    await expect(client.close()).rejects.toBe(flushError);
    expect(events).toStrictEqual(["flush", "close"]);
  });

  it("inner.close 가 실패하면 그 오류가 전달된다", async () => {
    const events: string[] = [];
    const closeError = new Error("close 실패");
    const inner: McpClient = {
      async listTools() {
        return [];
      },
      async callTool() {
        return ok({});
      },
      async close() {
        events.push("close");
        throw closeError;
      },
    };
    const client = cassetteClient(inner, {
      cassette: null,
      mode: "record",
      onFlush: async () => {
        events.push("flush");
      },
    });

    await expect(client.close()).rejects.toBe(closeError);
    expect(events).toStrictEqual(["flush", "close"]);
  });

  it("onFlush 와 inner.close 가 동시에 실패하면 inner.close 의 오류가 우선한다", async () => {
    const events: string[] = [];
    const flushError = new Error("flush 실패");
    const closeError = new Error("close 실패");
    const inner: McpClient = {
      async listTools() {
        return [];
      },
      async callTool() {
        return ok({});
      },
      async close() {
        events.push("close");
        throw closeError;
      },
    };
    const client = cassetteClient(inner, {
      cassette: null,
      mode: "record",
      onFlush: async () => {
        events.push("flush");
        throw flushError;
      },
    });

    await expect(client.close()).rejects.toBe(closeError);
    expect(events).toStrictEqual(["flush", "close"]);
  });
});

describe("cassette IO", () => {
  it("없는 파일은 null 로 읽는다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmymcp-record-"));
    try {
      await expect(loadCassette(join(dir, "missing.json"))).resolves.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("같은 카세트는 같은 바이트로 저장하고 비밀값을 마스킹한다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmymcp-record-"));
    const path = join(dir, "stock.cassette.json");
    const cassette = cassetteWith({
      toolName: "get_stock",
      args: { ticker: "AAPL", apiKey: "sk-live-abc123" },
      result: ok({ price: 187.4, token: "secret" }),
    });
    cassette.tools = [
      {
        name: "fetch_data",
        inputSchema: {
          type: "object",
          properties: {
            apiKey: { type: "string", default: "sk-schema-secret" },
            ticker: { type: "string" },
          },
        },
      },
    ];

    try {
      await saveCassette(path, cassette);
      const first = await readFile(path, "utf8");
      await saveCassette(path, cassette);
      const second = await readFile(path, "utf8");
      const loaded = await loadCassette(path);

      expect(first).toBe(second);
      expect(first).not.toContain("sk-live-abc123");
      expect(first).not.toContain("sk-schema-secret");
      expect(first).not.toContain("secret");
      expect(loaded?.interactions[0]?.request.args).toStrictEqual({
        ticker: "AAPL",
        apiKey: "[redacted]",
      });
      const loadedSchema = loaded?.tools?.[0]?.inputSchema as
        | { properties?: Record<string, unknown> }
        | undefined;
      expect(loadedSchema?.properties?.apiKey).toBe("[redacted]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function cassetteWith(options: { toolName: string; args: unknown; result: ToolResult }): Cassette {
  return {
    version: 1,
    interactions: [
      {
        key: matchKey(options.toolName, options.args),
        request: {
          toolName: options.toolName,
          args: redact(options.args),
        },
        response: {
          content: options.result.content,
          isError: options.result.isError,
          raw: options.result.raw,
        },
      },
    ],
    tools: TOOLS,
  };
}

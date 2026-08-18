import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpClient, ToolDef, ToolResult } from "@ohmymcp-hsu/core";
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

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected promise to reject");
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
      // token 을 포함하지만 개수다. ADR-0039 로 접미 규칙이 되면서 마스킹 대상에서 빠졌다.
      tokenCount: 42,
      nested: [{ refresh_token: "[redacted]" }],
    });
  });

  it("Cookie 와 Set-Cookie 를 마스킹한다", () => {
    expect(
      redact({
        Cookie: "session=abc123",
        "Set-Cookie": "session=def456; HttpOnly",
        SET_COOKIE: "x=1",
        setCookie: "y=2",
      }),
    ).toStrictEqual({
      Cookie: "[redacted]",
      "Set-Cookie": "[redacted]",
      SET_COOKIE: "[redacted]",
      setCookie: "[redacted]",
    });
  });

  it("이름에 민감 단어가 들어 있어도 머리가 아니면 마스킹하지 않는다", () => {
    expect(
      redact({
        tokenCount: 42,
        passwordPolicy: { minLength: 8 },
        secretariat: "office",
        cookieCount: 3,
      }),
    ).toStrictEqual({
      tokenCount: 42,
      passwordPolicy: { minLength: 8 },
      secretariat: "office",
      cookieCount: 3,
    });
  });

  it("구분자와 대소문자가 어떻든 민감 키는 계속 마스킹한다", () => {
    expect(
      redact({
        accessToken: "a",
        sessionToken: "b",
        "X-Api-Key": "c",
        APIKey: "d",
        refresh_token: "e",
        authorization: "f",
        secret: "g",
        password: "h",
      }),
    ).toStrictEqual({
      accessToken: "[redacted]",
      sessionToken: "[redacted]",
      "X-Api-Key": "[redacted]",
      APIKey: "[redacted]",
      refresh_token: "[redacted]",
      authorization: "[redacted]",
      secret: "[redacted]",
      password: "[redacted]",
    });
  });

  it("번호가 붙은 민감 키도 계속 마스킹한다", () => {
    // 꼬리 숫자를 떼지 않으면 apiKey0 의 마지막 단어가 "key0" 이 되어 목록과 안 맞는다.
    expect(redact({ apiKey0: "a", token2: "b", cookieCount2: 3 })).toStrictEqual({
      apiKey0: "[redacted]",
      token2: "[redacted]",
      cookieCount2: 3,
    });
  });

  it("복수형 민감 키를 마스킹한다", () => {
    // 목록은 단수형만 담고 sensitiveKey 가 꼬리 s 를 흡수한다(ADR-0045). 토큰·비밀값이
    // 배열로 오는 응답이 흔한데, 단수형만 보던 규칙은 그 배열을 통째로 흘렸다.
    expect(
      redact({
        tokens: ["a"],
        secrets: { x: "b" },
        passwords: "c",
        cookies: "d",
        apiKeys: ["e"],
        refreshTokens: ["f"],
      }),
    ).toStrictEqual({
      tokens: "[redacted]",
      secrets: "[redacted]",
      passwords: "[redacted]",
      cookies: "[redacted]",
      apiKeys: "[redacted]",
      refreshTokens: "[redacted]",
    });
  });

  it("복수형 규칙이 일반 복수 명사를 새로 잡지 않는다", () => {
    // 꼬리 s 완화의 회귀 고정. 머리 명사가 목록에 없으면 복수형이어도 통과해야 한다.
    // 이게 깨지면 ADR-0039 가 좁힌 접미 규칙이 도로 넓어진 것이다.
    expect(
      redact({
        tokenCounts: 2,
        secretariats: ["office"],
        cookieCounts: 3,
        keys: ["a"],
        credentialTypes: ["oauth"],
        addresses: ["seoul"],
      }),
    ).toStrictEqual({
      tokenCounts: 2,
      secretariats: ["office"],
      cookieCounts: 3,
      keys: ["a"],
      credentialTypes: ["oauth"],
      addresses: ["seoul"],
    });
  });

  it("key 로 끝나는 비밀값 합성어를 마스킹한다", () => {
    // secretKey 는 secret 이 목록에 있어도 접미 조합이 key · secretkey 라 어디에도
    // 걸리지 않았다. apikey 를 따로 열거해야 했던 것과 같은 구멍이다.
    expect(
      redact({
        privateKey: "a",
        private_key: "b",
        secretKey: "c",
        signingKey: "d",
        sessionKey: "e",
        credential: "f",
        credentials: "g",
        passwd: "h",
      }),
    ).toStrictEqual({
      privateKey: "[redacted]",
      private_key: "[redacted]",
      secretKey: "[redacted]",
      signingKey: "[redacted]",
      sessionKey: "[redacted]",
      credential: "[redacted]",
      credentials: "[redacted]",
      passwd: "[redacted]",
    });
  });

  it("목록에 넣지 않기로 한 인접어는 계속 통과한다", () => {
    // auth 를 넣으면 하위 트리가 통째로 사라져 구조를 못 본다. pwd 는 파일시스템 서버의
    // 작업 디렉터리와 겹친다. bearer 는 bearerToken 이 token 으로 이미 걸린다. ADR-0045.
    expect(
      redact({
        auth: { token: "s", type: "oauth" },
        pwd: "/home/x",
        bearer: "b",
        authMethod: "basic",
      }),
    ).toStrictEqual({
      auth: { token: "[redacted]", type: "oauth" },
      pwd: "/home/x",
      bearer: "b",
      authMethod: "basic",
    });
  });

  it("비결정 키 판정은 접미 규칙과 무관하게 그대로다", () => {
    // sensitiveKey 만 바뀌었고 normalizeKey 는 NONDETERMINISTIC_KEYS 조회와 공유하므로
    // 건드리지 않았다. 두 판정이 서로 새지 않는지 고정한다.
    const snapshot = snapshotContract(ok({ createdAt: "x", created_at: "y", cookieCount: 3 }));

    expect(snapshot).toStrictEqual({ cookieCount: 3 });
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

  it("auto 모드는 miss 뒤 hit 응답에도 flush 와 같은 마스킹을 적용한다 (ADR-0041)", async () => {
    const result = ok({ id: "run-1", token: "secret-token", value: 7 });
    const masked = ok({ id: "run-1", token: "[redacted]", value: 7 });
    const flushed: Cassette[] = [];
    const inner = fakeClient([result]);
    const client = cassetteClient(inner, {
      cassette: null,
      onFlush: async (next) => {
        flushed.push(next);
      },
    });

    // 1회차(miss, 실호출)와 2회차(hit, 카세트) 모두 caller 가 보는 값은 이미 마스킹돼 있다.
    // 이 값이 record 실행과 이후 replay 실행에서 같아야 한다는 것이 ADR-0041 의 핵심이다.
    await expect(
      client.callTool("get_secret", { id: 1, apiKey: "secret-input" }),
    ).resolves.toStrictEqual(masked);
    await expect(
      client.callTool("get_secret", { id: 1, apiKey: "secret-input" }),
    ).resolves.toStrictEqual(masked);
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

  it("record 실행과 저장된 카세트의 replay 실행은 같은 값을 돌려준다 (ADR-0041)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmymcp-record-"));
    const path = join(dir, "roundtrip.cassette.json");
    try {
      const liveResult = ok({ city: "Seoul", sessionToken: "abc", tokenCount: 42 });
      const inner = fakeClient([liveResult]);
      const recorder = cassetteClient(inner, {
        cassette: null,
        mode: "record",
        cassettePath: path,
        onFlush: (next) => saveCassette(path, next),
      });

      const recordedReturn = await recorder.callTool("get_weather", { city: "Seoul" });
      await recorder.close();

      // 비밀 아닌 필드(tokenCount)는 record 실행에서도 그대로 보이고, 비밀 필드는 이미
      // 마스킹돼 있다 — flush 를 기다릴 필요가 없다.
      const recordedRaw = recordedReturn.raw as Record<string, unknown>;
      expect(recordedRaw.tokenCount).toBe(42);
      expect(recordedRaw.sessionToken).toBe("[redacted]");

      const deadClient: McpClient = {
        listTools: async () => {
          throw new Error("replay 가 서버를 호출했다");
        },
        callTool: async () => {
          throw new Error("replay 가 서버를 호출했다");
        },
        close: async () => {},
      };
      const loaded = await loadCassette(path);
      const replayer = cassetteClient(deadClient, {
        cassette: loaded,
        mode: "replay",
        cassettePath: path,
      });
      const replayedReturn = await replayer.callTool("get_weather", { city: "Seoul" });

      // record 실행 1회차와, 그 카세트를 파일로 저장했다가 다시 읽은 replay 실행이 caller 에게
      // 완전히 같은 값(타입 포함)을 돌려준다. 이게 어긋나면 같은 케이스가 record 에서는
      // 통과하고 replay 에서는 실패(또는 TypeError)할 수 있다.
      expect(replayedReturn).toStrictEqual(recordedReturn);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("listTools() record 경로는 반환 즉시 민감 스키마 default 를 마스킹한다 (ADR-0041)", async () => {
    const sensitiveTools: ToolDef[] = [
      {
        name: "search",
        inputSchema: {
          type: "object",
          properties: { apiKey: { type: "string", default: "sk-live-1234" } },
        },
      },
    ];
    const inner: McpClient = {
      listTools: async () => sensitiveTools,
      callTool: async () => ok({}),
      close: async () => {},
    };
    const client = cassetteClient(inner, { cassette: null, mode: "record" });

    const tools = await client.listTools();

    expect(tools[0]?.inputSchema).toStrictEqual({
      type: "object",
      properties: { apiKey: { type: "string", default: "[redacted]" } },
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

    const error = await rejection(client.callTool("get_stock", { ticker: "AAPL" }));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("카세트에 없는 호출입니다");
    expect((error as Error).message).toContain(
      "카세트: fixtures/stock.cassette.json (상호작용 1개)",
    );
    expect((error as Error).message).toContain(
      '가장 가까운 저장 요청: get_stock({"ticker":"MSFT"})',
    );
    expect((error as Error).message).toContain(
      '요청 args.ticker: "AAPL" / 저장 args.ticker: "MSFT"',
    );
    expect(inner.calls.callTool).toBe(0);
  });

  it("replay miss 의 비밀값 차이가 마스킹되면 key 로 원인을 구분한다", async () => {
    const recordedArgs = { apiKey: "secret-1", ticker: "AAPL" };
    const requestedArgs = { apiKey: "secret-2", ticker: "AAPL" };
    const cassette = cassetteWith({
      toolName: "get_stock",
      args: recordedArgs,
      result: ok({ price: 330 }),
    });
    const inner = fakeClient([]);
    const client = cassetteClient(inner, { cassette, mode: "replay" });

    const error = await rejection(client.callTool("get_stock", requestedArgs));
    const message = (error as Error).message;

    expect(message).toContain(
      '카세트에 없는 호출입니다: get_stock({"apiKey":"[redacted]","ticker":"AAPL"})',
    );
    expect(message).toContain(
      '가장 가까운 저장 요청: get_stock({"apiKey":"[redacted]","ticker":"AAPL"})',
    );
    expect(message).toContain(
      "표시상 동일합니다. 마스킹된 비밀값이 다르거나 카세트의 key가 어긋났습니다.",
    );
    expect(message).toContain(
      `요청 key: ${matchKey("get_stock", requestedArgs).slice(0, 8)} / 저장 key: ${matchKey(
        "get_stock",
        recordedArgs,
      ).slice(0, 8)}`,
    );
    expect(message).not.toContain("secret-1");
    expect(message).not.toContain("secret-2");
    expect(inner.calls.callTool).toBe(0);
  });

  it("replay miss 는 같은 툴의 저장 요청 중 차이가 가장 적은 항목을 보여준다", async () => {
    const farther = cassetteWith({
      toolName: "get_stock",
      args: { market: "NYSE", ticker: "MSFT" },
      result: ok({ price: 330 }),
    });
    const nearer = cassetteWith({
      toolName: "get_stock",
      args: { market: "NASDAQ", ticker: "AAPL" },
      result: ok({ price: 331 }),
    });
    const cassette: Cassette = {
      ...farther,
      interactions: [...farther.interactions, ...nearer.interactions],
    };
    const inner = fakeClient([]);
    const client = cassetteClient(inner, { cassette, mode: "replay" });

    const error = await rejection(
      client.callTool("get_stock", { currency: "USD", market: "NASDAQ", ticker: "AAPL" }),
    );
    const message = (error as Error).message;

    expect(message).toContain(
      '가장 가까운 저장 요청: get_stock({"market":"NASDAQ","ticker":"AAPL"})',
    );
    expect(message).toContain('요청 args.currency: "USD" / 저장 args.currency: <없음>');
    expect(inner.calls.callTool).toBe(0);
  });

  it("replay miss 후보 선택은 전체 차이 수를 쓰고 표시는 5개로 제한한다", async () => {
    const farther = cassetteWith({
      toolName: "compare",
      args: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 },
      result: ok({ candidate: "farther" }),
    });
    const nearer = cassetteWith({
      toolName: "compare",
      args: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 0 },
      result: ok({ candidate: "nearer" }),
    });
    const cassette: Cassette = {
      ...farther,
      interactions: [...farther.interactions, ...nearer.interactions],
    };
    const inner = fakeClient([]);
    const client = cassetteClient(inner, { cassette, mode: "replay" });

    const error = await rejection(
      client.callTool("compare", { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0 }),
    );
    const message = (error as Error).message;

    expect(message).toContain(
      '가장 가까운 저장 요청: compare({"a":1,"b":1,"c":1,"d":1,"e":1,"f":1,"g":0})',
    );
    expect(message.match(/^ {2}요청 args\./gm)).toHaveLength(5);
    expect(inner.calls.callTool).toBe(0);
  });

  it("replay miss 의 표시 인자가 같아도 저장 key가 어긋났음을 보여준다", async () => {
    const args = { ticker: "AAPL" };
    const cassette = cassetteWith({
      toolName: "get_stock",
      args,
      result: ok({ price: 330 }),
    });
    const interaction = cassette.interactions[0];
    if (interaction === undefined) throw new Error("interaction missing");
    interaction.key = "f".repeat(64);
    const inner = fakeClient([]);
    const client = cassetteClient(inner, { cassette, mode: "replay" });

    const error = await rejection(client.callTool("get_stock", args));
    const message = (error as Error).message;

    expect(message).toContain(
      "표시상 동일합니다. 마스킹된 비밀값이 다르거나 카세트의 key가 어긋났습니다.",
    );
    expect(message).toContain(
      `요청 key: ${matchKey("get_stock", args).slice(0, 8)} / 저장 key: ffffffff`,
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

  /** 같은 요청에 두 응답을 녹화해 중복 경고를 얻는다. */
  const duplicateWarning = async (first: unknown, second: unknown): Promise<string[]> => {
    const warnings: string[] = [];
    const inner = fakeClient([ok(first), ok(second)]);
    const client = cassetteClient(inner, {
      cassette: null,
      mode: "record",
      onWarning: (message) => warnings.push(message),
      onFlush: async () => {},
    });

    await client.callTool("get_stock", { ticker: "AAPL" });
    await client.callTool("get_stock", { ticker: "AAPL" });
    await client.close();
    return warnings;
  };

  it("중복 응답 경고는 비밀값 원문 대신 마스킹된 값을 보여준다", async () => {
    const warnings = await duplicateWarning({ token: "secret-a" }, { token: "secret-b" });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('1회차 raw.token: "[redacted]" / 2회차 raw.token: "[redacted]"');
    // 이 두 줄이 회귀의 본체다. 경고는 stderr 로 나간다.
    expect(warnings[0]).not.toContain("secret-a");
    expect(warnings[0]).not.toContain("secret-b");
    expect(warnings[0]).toContain("위 값은 마스킹되어 표시됩니다");
  });

  it("비밀값이 같으면 중복 경고를 내지 않는다", async () => {
    // 마스킹한 값으로 비교하면 secret-a 와 secret-b 도 같아진다. 반대로 민감 키를 무조건
    // 차이로 보고하면 이 케이스가 깨진다. 판정이 원문 기준이라는 것을 이 둘이 함께 고정한다.
    const warnings = await duplicateWarning({ token: "secret-a" }, { token: "secret-a" });

    expect(warnings).toStrictEqual([]);
  });

  it("민감하지 않은 필드의 차이는 값을 그대로 보여준다", async () => {
    const warnings = await duplicateWarning(
      { token: "secret-a", city: "Seoul" },
      { token: "secret-a", city: "Busan" },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('1회차 raw.city: "Seoul" / 2회차 raw.city: "Busan"');
    expect(warnings[0]).not.toContain("raw.token");
    expect(warnings[0]).not.toContain("위 값은 마스킹되어 표시됩니다");
  });

  it("중첩된 비밀값도 경로를 유지한 채 마스킹된다", async () => {
    const warnings = await duplicateWarning(
      { auth: { token: "secret-a" } },
      { auth: { token: "secret-b" } },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      '1회차 raw.auth.token: "[redacted]" / 2회차 raw.auth.token: "[redacted]"',
    );
    expect(warnings[0]).not.toContain("secret-a");
  });

  it("객체 단위 차이는 안쪽 비밀값만 지우고 형제 필드는 보여준다", async () => {
    const warnings = await duplicateWarning({ data: { token: "secret-a", city: "Seoul" } }, {});

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      '1회차 raw.data: {"city":"Seoul","token":"[redacted]"} / 2회차 raw.data: <없음>',
    );
    expect(warnings[0]).not.toContain("secret-a");
  });

  it("중복 응답 경고가 Set-Cookie 값을 노출하지 않는다", async () => {
    const warnings = await duplicateWarning(
      { "Set-Cookie": "session=live-a" },
      { "Set-Cookie": "session=live-b" },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("live-a");
    expect(warnings[0]).not.toContain("live-b");
    expect(warnings[0]).toContain("위 값은 마스킹되어 표시됩니다");
  });

  it("표시 상한은 차이 판정을 바꾸지 않는다", async () => {
    const long = (fill: string): string => fill.repeat(200);
    const warnings = await duplicateWarning({ note: long("x") }, { note: long("y") });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("1회차 raw.note:");
    expect(warnings[0]).toContain("…");
    expect(warnings[0]).not.toContain(long("x"));
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
      // ADR-0040. properties.apiKey 의 정의 객체 자체는 선언이라 살아남고, 값이 든
      // default 만 가려진다.
      expect(loadedSchema?.properties?.apiKey).toStrictEqual({
        type: "string",
        default: "[redacted]",
      });
      expect(loadedSchema?.properties?.ticker).toStrictEqual({ type: "string" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("스키마는 재귀하며 프로퍼티 이름으로만 민감도를 판정한다 (ADR-0040)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmymcp-record-"));
    const path = join(dir, "schema.cassette.json");
    const cassette = cassetteWith({
      toolName: "get_secret",
      args: { id: 1 },
      result: ok({ value: "x" }),
    });
    cassette.tools = [
      {
        name: "get_secret",
        description: "비밀값을 돌려준다",
        inputSchema: {
          type: "object",
          properties: {
            auth: {
              type: "object",
              properties: {
                token: { type: "string", default: "nested-secret", const: "nested-secret" },
              },
            },
            token: {
              type: "array",
              items: { type: "string", default: "array-secret" },
            },
            secret: { type: "string", enum: ["admin-secret", "guest"] },
            password: { type: "string", examples: ["hint-secret"] },
            note: { type: "string", default: "안 가려짐" },
            authSecret: {
              anyOf: [{ type: "string", default: "안-가려짐-대상-아님" }],
            },
            authorization: {
              type: "object",
              properties: {
                value: { type: "string", default: "Bearer inherited-secret" },
              },
            },
          },
        },
      },
    ];

    try {
      await saveCassette(path, cassette);
      const loaded = await loadCassette(path);
      const tool = loaded?.tools?.[0] as {
        name: string;
        description?: string;
        inputSchema: {
          properties: {
            auth: { properties: { token: Record<string, unknown> } };
            token: { items: Record<string, unknown> };
            secret: { enum: unknown[] };
            password: { examples: unknown[] };
            note: Record<string, unknown>;
            authSecret: { anyOf: unknown[] };
            authorization: { properties: { value: Record<string, unknown> } };
          };
        };
      };

      // 선언 대상인 이름과 name·description 은 손대지 않는다.
      expect(tool.name).toBe("get_secret");
      expect(tool.description).toBe("비밀값을 돌려준다");

      // properties 재귀 — 안쪽 token 의 민감도는 그 이름으로 새로 판정한다.
      expect(tool.inputSchema.properties.auth.properties.token).toStrictEqual({
        type: "string",
        default: "[redacted]",
        const: "[redacted]",
      });

      // items 재귀 — 민감도는 부모 프로퍼티 이름(token)에서 물려받는다.
      expect(tool.inputSchema.properties.token.items).toStrictEqual({
        type: "string",
        default: "[redacted]",
      });

      // enum 은 원소마다 가린다. secret 이라는 이름 자체는 값이 아니므로 프로퍼티 키로는
      // 남는다.
      expect(tool.inputSchema.properties.secret.enum).toStrictEqual(["[redacted]", "[redacted]"]);

      // examples 도 원소마다 가린다.
      expect(tool.inputSchema.properties.password.examples).toStrictEqual(["[redacted]"]);

      // 민감하지 않은 이름의 default 는 그대로 남는다.
      expect(tool.inputSchema.properties.note).toStrictEqual({
        type: "string",
        default: "안 가려짐",
      });

      // 민감한 이름(authSecret) 아래라도 ADR-0004 가 해석하지 않는 anyOf 는 재귀도
      // 마스킹도 하지 않는다.
      expect(tool.inputSchema.properties.authSecret).toStrictEqual({
        anyOf: [{ type: "string", default: "안-가려짐-대상-아님" }],
      });

      // 민감도는 properties 를 타고 내려가며 상속된다. value 라는 이름 자체는 민감하지
      // 않지만, authorization 아래 있으므로 그 default 도 비밀값이다.
      expect(tool.inputSchema.properties.authorization.properties.value).toStrictEqual({
        type: "string",
        default: "[redacted]",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("복수형·key 합성어 비밀값이 카세트 파일에 남지 않는다", async () => {
    // 이 구멍의 결과가 "평문이 파일로 굳어 커밋된다" 였으므로, 단위 함수가 아니라 저장된
    // 바이트로 고정한다. args · content(문자열 안 JSON) · raw 세 자리를 한 번에 덮는다.
    const dir = await mkdtemp(join(tmpdir(), "ohmymcp-record-"));
    const path = join(dir, "secrets.cassette.json");
    const cassette = cassetteWith({
      toolName: "list_credentials",
      args: { apiKeys: ["ak-live-1"], passwd: "pw-live-2" },
      result: ok({
        tokens: ["tk-live-3"],
        refreshTokens: ["rt-live-4"],
        secrets: { inner: "sc-live-5" },
        cookies: "sid=ck-live-6",
        privateKey: "pk-live-7",
        secretKey: "sk-live-8",
        credentials: { user: "u", password: "pw-live-9" },
        tokenCounts: 2,
      }),
    });

    try {
      await saveCassette(path, cassette);
      const text = await readFile(path, "utf8");

      for (const secret of [
        "ak-live-1",
        "pw-live-2",
        "tk-live-3",
        "rt-live-4",
        "sc-live-5",
        "ck-live-6",
        "pk-live-7",
        "sk-live-8",
        "pw-live-9",
      ]) {
        expect(text).not.toContain(secret);
      }

      // 과잉 마스킹이 아니라는 것도 같은 파일에서 확인한다. 값을 지우는 쪽으로 틀리면
      // 테스트가 그 필드를 영영 못 본다(ADR-0041).
      expect(text).toContain('"tokenCounts":2');
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

import type { McpClient, ToolDef, ToolResult } from "@ohmymcp-hsu/core";
import { describe, expect, it } from "vitest";
import {
  type Cassette,
  type CassetteInteraction,
  matchKey,
  redact,
  saveCassette,
  verifyCassette,
} from "../src/index.js";

/**
 * `auto` 모드는 히트하면 서버를 부르지 않으므로 카세트가 낡아도 영원히 모른다. 이 스펙은 그
 * 드리프트를 **비파괴로** 확인하는 경로를 고정한다. `verifyCassette` 는 카세트를 고치지도
 * 저장하지도 않는다.
 */

const ok = (raw: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(raw) }],
  isError: false,
  raw,
});

/**
 * 파일에 저장된 카세트와 같은 모양을 만든다. `saveCassette` 가 거는 마스킹을 그대로 태워야
 * 실제 사용 조건과 같아진다 — 실서버는 원문을 주고 카세트는 마스킹돼 있다는 것이 요점이다.
 */
const storedInteraction = (
  toolName: string,
  args: unknown,
  raw: unknown,
  isError = false,
): CassetteInteraction => ({
  key: matchKey(toolName, args),
  request: { toolName, args: redact(args) },
  response: {
    content: redact([{ type: "text", text: JSON.stringify(raw) }]),
    isError,
    raw: redact(raw),
  },
});

const cassetteOf = (...interactions: CassetteInteraction[]): Cassette => ({
  version: 1,
  interactions,
});

interface FakeServer extends McpClient {
  readonly calls: string[];
  readonly closed: () => number;
}

/** 툴 이름 → 응답. 없으면 던진다. */
function fakeServer(
  responses: Record<string, ToolResult | (() => never)>,
  tools?: ToolDef[],
): FakeServer {
  const calls: string[] = [];
  let closes = 0;
  return {
    calls,
    closed: () => closes,
    async listTools() {
      calls.push("listTools");
      if (tools === undefined) throw new Error("이 서버는 listTools 를 지원하지 않습니다");
      return tools;
    },
    async callTool(name) {
      calls.push(name);
      const response = responses[name];
      if (response === undefined) throw new Error(`알 수 없는 툴: ${name}`);
      if (typeof response === "function") return response();
      return response;
    },
    async close() {
      closes++;
    },
  };
}

describe("verifyCassette", () => {
  it("전부 일치하면 matched 만 차고 나머지는 비어 있다", async () => {
    const cassette = cassetteOf(
      storedInteraction("get_weather", { city: "서울" }, { temp: 21 }),
      storedInteraction("add", { a: 1, b: 2 }, { sum: 3 }),
    );
    const server = fakeServer({ get_weather: ok({ temp: 21 }), add: ok({ sum: 3 }) });

    const result = await verifyCassette(server, cassette);

    expect(result.matched).toBe(2);
    expect(result.mismatched).toStrictEqual([]);
    expect(result.failed).toStrictEqual([]);
    expect(result.skipped).toStrictEqual([]);
  });

  it("응답이 바뀐 것만 mismatched 에 담는다", async () => {
    const cassette = cassetteOf(
      storedInteraction("get_weather", { city: "서울" }, { temp: 21 }),
      storedInteraction("add", { a: 1, b: 2 }, { sum: 3 }),
    );
    // get_weather 만 값이 바뀌었다.
    const server = fakeServer({ get_weather: ok({ temp: 25 }), add: ok({ sum: 3 }) });

    const result = await verifyCassette(server, cassette);

    expect(result.matched).toBe(1);
    expect(result.mismatched).toHaveLength(1);
    expect(result.mismatched[0]?.toolName).toBe("get_weather");
  });

  it("어느 필드가 어떻게 다른지 메시지에 나온다", async () => {
    const cassette = cassetteOf(storedInteraction("get_weather", { city: "서울" }, { temp: 21 }));
    // 필드 이름이 바뀐 경우 — CLAUDE.md 가 예시로 든 드리프트다.
    const server = fakeServer({ get_weather: ok({ temperature: 21 }) });

    const result = await verifyCassette(server, cassette);
    const message = result.mismatched[0]?.message ?? "";

    expect(message).toContain("카세트와 실서버 응답이 다릅니다");
    expect(message).toContain('get_weather({"city":"서울"})');
    expect(message).toContain("raw.temp");
    expect(message).toContain("raw.temperature");
    expect(message).toContain("--record");
  });

  it("JSON 문자열 안의 차이를 필드 단위로 보여준다", async () => {
    // MCP 응답의 실제 페이로드는 content[].text 안에 JSON 문자열로 들어 있다. 문자열째로
    // 보여 주면 이스케이프된 두 줄을 눈으로 대조하라는 메시지가 되고, 길면 잘려서 못 본다.
    const payload = (body: unknown): ToolResult => ({
      content: [{ type: "text", text: JSON.stringify(body) }],
      isError: false,
      raw: { content: [{ type: "text", text: JSON.stringify(body) }] },
    });
    const stored = payload({ city: "서울", temperature: 21, condition: "맑음" });
    const cassette = cassetteOf({
      key: matchKey("get_weather", { city: "서울" }),
      request: { toolName: "get_weather", args: { city: "서울" } },
      response: { content: stored.content, isError: false, raw: stored.raw },
    });
    // 서버가 temperature 를 temp 로 바꿨다.
    const server = fakeServer({
      get_weather: payload({ city: "서울", temp: 21, condition: "맑음" }),
    });

    const message = (await verifyCassette(server, cassette)).mismatched[0]?.message ?? "";

    expect(message).toContain("raw.content[0].text.temp:");
    expect(message).toContain("raw.content[0].text.temperature:");
    expect(message).toContain("<없음>");
  });

  it("실서버가 던지면 failed 에 들어가고 mismatched 와 섞이지 않는다", async () => {
    const cassette = cassetteOf(storedInteraction("get_weather", { city: "서울" }, { temp: 21 }));
    const server = fakeServer({
      get_weather: () => {
        throw new Error("연결이 끊겼습니다");
      },
    });

    const result = await verifyCassette(server, cassette);

    expect(result.mismatched).toStrictEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.message).toContain("연결이 끊겼습니다");
    expect(result.matched).toBe(0);
  });

  it("비밀값이 든 응답은 거짓 불일치를 내지 않는다", async () => {
    // 카세트에는 마스킹된 채로 저장돼 있고, 실서버는 원문을 준다. 마스킹 후 비교해야 같다.
    const cassette = cassetteOf(
      storedInteraction("login", { user: "kim" }, { token: "sk-live-AAAA", ok: true }),
    );
    // 비밀값이 실제로 바뀌었지만 나머지는 그대로다.
    const server = fakeServer({ login: ok({ token: "sk-live-BBBB", ok: true }) });

    const result = await verifyCassette(server, cassette);

    expect(result.matched).toBe(1);
    expect(result.mismatched).toStrictEqual([]);
  });

  it("비밀값 옆의 일반 필드가 바뀌면 잡는다", async () => {
    const cassette = cassetteOf(
      storedInteraction("login", { user: "kim" }, { token: "sk-live-AAAA", ok: true }),
    );
    const server = fakeServer({ login: ok({ token: "sk-live-BBBB", ok: false }) });

    const result = await verifyCassette(server, cassette);

    expect(result.mismatched).toHaveLength(1);
    expect(result.mismatched[0]?.message).toContain("raw.ok");
  });

  it("args 가 마스킹돼 있으면 서버를 부르지 않고 skipped 로 보고한다", async () => {
    const cassette = cassetteOf(
      storedInteraction("login", { user: "kim", apiKey: "sk-live-1234" }, { ok: true }),
    );
    const server = fakeServer({ login: ok({ ok: true }) });

    const result = await verifyCassette(server, cassette);

    // 마스킹된 값을 실서버에 그대로 보내면 안 된다.
    expect(server.calls).toStrictEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.message).toContain("마스킹된 args");
    expect(result.matched).toBe(0);
  });

  it("cassette.tools 가 있으면 listTools 도 비교한다", async () => {
    const tools: ToolDef[] = [{ name: "get_weather", inputSchema: { type: "object" } }];
    const cassette: Cassette = { ...cassetteOf(), tools };
    const changed: ToolDef[] = [{ name: "get_weather", inputSchema: { type: "string" } }];

    const same = await verifyCassette(fakeServer({}, tools), cassette);
    expect(same.toolsChanged).toBe(false);
    expect(same.failed).toStrictEqual([]);

    const drifted = await verifyCassette(fakeServer({}, changed), cassette);
    expect(drifted.toolsChanged).toBe(true);
    expect(drifted.failed[0]?.message).toContain("툴 스키마가 카세트와 다릅니다");
  });

  it("cassette.tools 가 없으면 listTools 를 부르지 않는다", async () => {
    const server = fakeServer({ get_weather: ok({ temp: 21 }) });
    await verifyCassette(server, cassetteOf(storedInteraction("get_weather", {}, { temp: 21 })));

    expect(server.calls).toStrictEqual(["get_weather"]);
  });

  it("카세트를 수정하지 않는다", async () => {
    const cassette = cassetteOf(storedInteraction("get_weather", { city: "서울" }, { temp: 21 }));
    const before = JSON.stringify(cassette);
    await verifyCassette(fakeServer({ get_weather: ok({ temp: 99 }) }), cassette);

    expect(JSON.stringify(cassette)).toBe(before);
  });

  it("client.close() 를 부르지 않는다 — 연결 소유권은 호출자에게 있다", async () => {
    const server = fakeServer({ get_weather: ok({ temp: 21 }) });
    await verifyCassette(
      server,
      cassetteOf(storedInteraction("get_weather", { city: "서울" }, { temp: 21 })),
    );

    expect(server.closed()).toBe(0);
  });

  it("상호작용이 0개면 서버를 부르지 않고 빈 결과를 준다", async () => {
    const server = fakeServer({});
    const result = await verifyCassette(server, cassetteOf());

    expect(server.calls).toStrictEqual([]);
    expect(result).toStrictEqual({
      matched: 0,
      mismatched: [],
      failed: [],
      skipped: [],
      toolsChanged: false,
    });
  });

  it("실제 파일을 거쳐 온 카세트에도 거짓 불일치가 없다", async () => {
    // storedInteraction 이 흉내낸 마스킹이 saveCassette 의 실제 동작과 같은지 확인한다.
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadCassette } = await import("../src/index.js");

    const dir = await mkdtemp(join(tmpdir(), "ohmymcp-verify-"));
    try {
      const path = join(dir, "c.json");
      await saveCassette(path, cassetteOf(storedInteraction("login", {}, { token: "sk-A", v: 1 })));
      const loaded = await loadCassette(path);
      if (loaded === null) throw new Error("카세트를 읽지 못했습니다");

      const result = await verifyCassette(
        fakeServer({ login: ok({ token: "sk-B", v: 1 }) }),
        loaded,
      );

      expect(result.matched).toBe(1);
      expect(result.mismatched).toStrictEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

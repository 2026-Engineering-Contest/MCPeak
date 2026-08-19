import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDef } from "@ohmymcp-hsu/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANY, createMockServer, type MockOptions, type MockServer } from "../src/index.js";

const { tools } = JSON.parse(
  readFileSync(new URL("../../../fixtures/tools-list.sample.json", import.meta.url), "utf8"),
) as { tools: ToolDef[] };

/** 테스트가 끝나면 열린 서버를 반드시 닫는다 — 안 닫으면 vitest 가 종료되지 않는다. */
const opened: MockServer[] = [];

async function start(): Promise<MockServer> {
  const server = await createMockServer({ tools });
  opened.push(server);
  return server;
}

async function connect(server: MockServer): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  return client;
}

/**
 * 툴 응답의 텍스트 본문을 꺼낸다.
 * `callTool` 반환 타입은 구버전 호환 형태(`toolResult`)와의 유니온이라 `unknown` 으로 받는다.
 */
function text(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  const first = content?.[0]?.text;
  if (first === undefined) throw new Error("응답에 텍스트 content 가 없습니다.");
  return first;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => s.close()));
});

describe("@ohmymcp-hsu/mock", () => {
  it("url 을 돌려주고 그 주소로 붙을 수 있다", async () => {
    const server = await start();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const client = await connect(server);
    await client.close();
  });

  it("listTools 가 주어진 툴을 JSON Schema 그대로 노출한다", async () => {
    const server = await start();
    const client = await connect(server);

    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(["get_weather", "add"]);
    expect(listed.tools.find((t) => t.name === "get_weather")?.inputSchema).toEqual(
      tools.find((t) => t.name === "get_weather")?.inputSchema,
    );

    await client.close();
  });

  it("같은 툴을 인자에 따라 다르게 응답한다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    server.on("add", { a: 10, b: 20 }, { sum: 30 });
    const client = await connect(server);

    const small = await client.callTool({ name: "add", arguments: { a: 1, b: 2 } });
    const large = await client.callTool({ name: "add", arguments: { a: 10, b: 20 } });
    expect(JSON.parse(text(small))).toEqual({ sum: 3 });
    expect(JSON.parse(text(large))).toEqual({ sum: 30 });

    await client.close();
  });

  it("인자의 키 순서가 달라도 같은 응답을 찾는다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    const result = await client.callTool({ name: "add", arguments: { b: 2, a: 1 } });
    expect(JSON.parse(text(result))).toEqual({ sum: 3 });

    await client.close();
  });

  it("값이 undefined 인 키는 없는 것으로 친다", async () => {
    const server = await start();
    // 와이어를 건너온 인자에는 undefined 가 없다. 주입에서만 생길 수 있고,
    // 그것을 키에 남기면 실제 호출과 영영 만나지 못한다.
    server.on("add", { a: 1, b: undefined }, { sum: 1 });
    const client = await connect(server);

    const result = await client.callTool({ name: "add", arguments: { a: 1 } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({ sum: 1 });

    await client.close();
  });

  it("같은 호출 3회가 바이트 단위로 동일하다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    const runs: string[] = [];
    for (let i = 0; i < 3; i++) {
      runs.push(JSON.stringify(await client.callTool({ name: "add", arguments: { a: 1, b: 2 } })));
    }
    expect(new Set(runs).size).toBe(1);

    await client.close();
  });

  it("주입되지 않은 호출은 무엇이 등록돼 있는지 알려준다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    const result = await client.callTool({ name: "add", arguments: { a: 5, b: 7 } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("주입된 응답이 없습니다");
    expect(text(result)).toContain('{"a":1,"b":2}');
    expect(text(result)).toContain("mock.on(");

    await client.close();
  });

  it("close() 이후에는 연결되지 않는다", async () => {
    const server = await createMockServer({ tools });
    const { url } = server;
    await server.close();

    const client = new Client({ name: "test", version: "0.0.0" });
    await expect(client.connect(new StreamableHTTPClientTransport(new URL(url)))).rejects.toThrow();
  });

  it("키로 만들 수 없는 인자를 주입하면 진입점과 위치를 알려준다", async () => {
    const server = await start();
    expect(() => server.on("add", { a: 1, b: NaN }, { sum: 1 })).toThrow(
      "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 유한하지 않은 수",
    );
    expect(() => server.on("add", { a: 1, b: NaN }, { sum: 1 })).toThrow(
      "→ 위치: args.b — 발견: NaN",
    );
  });

  it("ANY 는 심볼이지만 거부되지 않는다", async () => {
    const server = await start();
    expect(() => server.on("add", ANY, { sum: 0 })).not.toThrow();
    const client = await connect(server);

    const result = await client.callTool({ name: "add", arguments: { a: 7, b: 7 } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({ sum: 0 });

    await client.close();
  });

  it("인자 지정본이 ANY 보다 우선한다", async () => {
    const server = await start();
    server.on("add", ANY, { sum: 0 });
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    expect(
      JSON.parse(text(await client.callTool({ name: "add", arguments: { a: 1, b: 2 } }))),
    ).toEqual({ sum: 3 });
    expect(
      JSON.parse(text(await client.callTool({ name: "add", arguments: { a: 9, b: 9 } }))),
    ).toEqual({ sum: 0 });

    await client.close();
  });

  it("정의 파일의 responses 도 같은 판정을 받는다", async () => {
    await expect(
      createMockServer({
        tools,
        responses: [{ tool: "add", args: { a: NaN }, result: { sum: 0 } }],
      }),
    ).rejects.toThrow(
      "→ 정의 파일의 responses[0] 의 인자로 매칭 키를 만들 수 없습니다: 유한하지 않은 수",
    );
  });

  it("너무 깊은 호출 인자는 서버를 죽이지 않고 오류 응답이 된다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    // 루트가 깊이 0. 상한을 넘기려면 상한 + 2 단계가 필요하다.
    let deep: unknown = null;
    for (let i = 0; i < 514; i++) deep = { a: deep };

    const result = await client.callTool({ name: "add", arguments: { deep } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      "→ 툴 'add' 의 호출 인자로 매칭 키를 만들 수 없습니다: 중첩이 상한 512 단계를 넘었습니다",
    );
    expect(text(result)).toContain(
      "→ 목은 이 인자를 주입된 어떤 응답과도 비교할 수 없습니다. 호출 쪽 인자를 줄이세요.",
    );

    // 서버가 살아 있어야 한다 — 이 갈래를 만든 이유가 그것이다.
    const after = await client.callTool({ name: "add", arguments: { a: 1, b: 2 } });
    expect(after.isError).toBeFalsy();
    expect(JSON.parse(text(after))).toEqual({ sum: 3 });

    await client.close();
  });

  it("깊은 배열 사슬도 같은 오류 응답이 된다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    // 객체가 아니라 배열로 사슬을 만든다. stableKey 의 배열 분기가 map 콜백에
    // 인덱스를 depth 로 흘리면 가드가 안 걸리고 스택이 터진다 — 그 회귀를 잡는다.
    let deep: unknown = null;
    for (let i = 0; i < 514; i++) deep = [deep];

    const result = await client.callTool({ name: "add", arguments: { deep } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("중첩이 상한 512 단계를 넘었습니다");

    // 서버가 살아 있어야 한다.
    const after = await client.callTool({ name: "add", arguments: { a: 1, b: 2 } });
    expect(after.isError).toBeFalsy();
    expect(JSON.parse(text(after))).toEqual({ sum: 3 });

    await client.close();
  });

  it("주입 깊이 경계에서 상한 이하는 통과하고 초과는 설계된 문장으로 거부한다", async () => {
    const server = await start();
    const nest = (n: number): unknown => {
      let value: unknown = null;
      for (let i = 0; i < n; i++) value = { a: value };
      return value;
    };

    // 상한과 같은 깊이는 통과한다.
    expect(() => server.on("add", { deep: nest(511) }, { sum: 1 })).not.toThrow();

    // 넘으면 raw KeyDepthError 가 아니라 진입점이 붙은 설계된 문장이어야 한다.
    // 두 깊이 검사(주입: findKeyViolation, 조회: stableKey)가 어긋나면 여기서 잡힌다.
    expect(() => server.on("add", { deep: nest(513) }, { sum: 1 })).toThrow(
      "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 중첩이 너무 깊습니다",
    );
  });
});

/**
 * inputSchema 로 호출 인자를 검사한다 (ADR-0048, #181).
 *
 * 판정 자체는 tests/input-validation.test.ts 가 전량 고정한다. 여기서는 **순서**를 본다 —
 * 주입된 응답이 검사보다 우선하고, 검사는 주입이 없을 때만 돈다.
 */
describe("@ohmymcp-hsu/mock — inputSchema 검사", () => {
  const schemaTools: ToolDef[] = [
    {
      name: "get_weather",
      description: "스키마 검사용 (목).",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string" },
          unit: { type: "string", enum: ["c", "f"] },
          days: { type: "integer", minimum: 1, maximum: 7 },
        },
        required: ["city"],
      },
    },
    {
      name: "opaque",
      description: "해석할 수 없는 스키마 (목).",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        anyOf: [{ required: ["city"] }],
      },
    },
  ];

  async function startWith(options: Partial<MockOptions> = {}): Promise<MockServer> {
    const server = await createMockServer({ tools: schemaTools, ...options });
    opened.push(server);
    return server;
  }

  it("주입이 전혀 없으면 스키마 위반이 미스 진단문 대신 위반 진단문으로 거절된다", async () => {
    const client = await connect(await startWith());
    const result = await client.callTool({ name: "get_weather", arguments: { city: 0 } });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("'city' 은(는) string 이어야 합니다. 받은 값: 0 (number)");
    // 미스 진단문으로 새면 사용자가 "주입을 안 했나" 로 잘못 읽는다. 원인이 다르다.
    expect(text(result)).not.toContain("주입된 응답이 없습니다");
    await client.close();
  });

  it("ANY 폴백이 있어도 스키마 위반은 거절된다 — ANY 가 위반 인자를 먹지 않는다", async () => {
    const server = await startWith();
    server.on("get_weather", ANY, { tempC: 21 });
    const client = await connect(server);

    const result = await client.callTool({ name: "get_weather", arguments: { city: 0 } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("string 이어야 합니다");
    await client.close();
  });

  it("인자를 지정한 주입이 스키마 검사보다 우선한다 (ADR-0048 §2)", async () => {
    // 이 테스트가 이번 결정의 회귀 테스트다. 검사를 lookup 앞으로 옮기면 여기서 깨진다.
    const server = await startWith();
    server.on("get_weather", { city: 0 }, "도시 이름이 잘못됐습니다");
    const client = await connect(server);

    const result = await client.callTool({ name: "get_weather", arguments: { city: 0 } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toBe("도시 이름이 잘못됐습니다");
    await client.close();
  });

  it("스키마를 지킨 인자는 ANY 로 통과한다 — 기존 동작이 유지된다", async () => {
    const server = await startWith();
    server.on("get_weather", ANY, { tempC: 21 });
    const client = await connect(server);

    const result = await client.callTool({
      name: "get_weather",
      arguments: { city: "서울", unit: "c", days: 3 },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({ tempC: 21 });
    await client.close();
  });

  it("네 축을 전부 검사한다 — required · type · enum · range", async () => {
    const client = await connect(await startWith());

    const missing = await client.callTool({ name: "get_weather", arguments: { unit: "c" } });
    expect(text(missing)).toContain("필수 필드 'city' 이(가) 없습니다");

    const badEnum = await client.callTool({
      name: "get_weather",
      arguments: { city: "서울", unit: "k" },
    });
    expect(text(badEnum)).toContain('선언된 값 중 하나여야 합니다: "c", "f". 받은 값: "k"');

    const badRange = await client.callTool({
      name: "get_weather",
      arguments: { city: "서울", days: 99 },
    });
    expect(text(badRange)).toContain("7 이하여야 합니다. 받은 값: 99");
    await client.close();
  });

  it("위반이 여럿이면 전부 내고 안내 줄은 한 번만 붙는다", async () => {
    const client = await connect(await startWith());
    const result = await client.callTool({
      name: "get_weather",
      arguments: { unit: "k", days: 0 },
    });

    const lines = text(result).split("\n");
    expect(lines[0]).toContain("필수 필드 'city' 이(가) 없습니다");
    expect(lines[1]).toContain("'unit'");
    expect(lines[2]).toContain("'days'");
    expect(lines.filter((l) => l.includes("responses 에 이 인자를 넣어"))).toHaveLength(1);
    await client.close();
  });

  it("해석할 수 없는 스키마의 툴은 위반 인자도 검사하지 않는다", async () => {
    const server = await startWith();
    server.on("opaque", ANY, { ok: true });
    const client = await connect(server);

    const result = await client.callTool({ name: "opaque", arguments: { city: 0 } });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("해석할 수 없는 툴을 띄울 때 stderr 로 한 번 고지한다", async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    });
    try {
      await startWith();
    } finally {
      spy.mockRestore();
    }

    const notice = written.join("");
    expect(notice).toContain("인자 검사를 건너뜁니다");
    expect(notice).toContain("'opaque'");
    expect(notice).toContain("anyOf");
    // 해석 가능한 툴은 고지에 없어야 한다.
    expect(notice).not.toContain("'get_weather'");
  });
});

describe("isError 응답 주입 (#180)", () => {
  it("isError: true 로 주입하면 응답이 거절로 표시된다", async () => {
    const server = await start();
    server.on(
      "get_weather",
      { city: "없는도시" },
      { error: "→ '없는도시' 를 찾을 수 없습니다" },
      { isError: true },
    );
    const client = await connect(server);
    const result = await client.callTool({ name: "get_weather", arguments: { city: "없는도시" } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result))).toEqual({ error: "→ '없는도시' 를 찾을 수 없습니다" });
  });

  it("주입한 거절과 매칭 미스의 거절은 본문으로 구분된다", async () => {
    const server = await start();
    server.on("get_weather", { city: "없는도시" }, { error: "설계된 거절" }, { isError: true });
    const client = await connect(server);

    const designed = await client.callTool({
      name: "get_weather",
      arguments: { city: "없는도시" },
    });
    const miss = await client.callTool({ name: "get_weather", arguments: { city: "주입안함" } });

    expect(designed.isError).toBe(true);
    expect(miss.isError).toBe(true);
    // 둘 다 isError 지만 본문이 다르다. 설계된 거절은 사용자가 쓴 값이 그대로 나온다.
    expect(JSON.parse(text(designed))).toEqual({ error: "설계된 거절" });
    expect(text(miss)).toContain("주입된 응답이 없습니다");
  });

  it("options 를 생략하면 기존과 같이 성공 응답이다", async () => {
    const server = await start();
    server.on("get_weather", { city: "서울" }, { temperature: 28 });
    const client = await connect(server);
    const result = await client.callTool({ name: "get_weather", arguments: { city: "서울" } });
    expect(result.isError).toBeFalsy();
  });

  it("isError: false 를 명시해도 성공 응답이다", async () => {
    const server = await start();
    server.on("get_weather", { city: "서울" }, { temperature: 28 }, { isError: false });
    const client = await connect(server);
    const result = await client.callTool({ name: "get_weather", arguments: { city: "서울" } });
    expect(result.isError).toBeFalsy();
  });

  it("ANY 에도 거절을 주입할 수 있다", async () => {
    const server = await start();
    server.on("get_weather", ANY, { error: "이 툴은 항상 거절한다" }, { isError: true });
    const client = await connect(server);
    const result = await client.callTool({ name: "get_weather", arguments: { city: "아무거나" } });
    expect(result.isError).toBe(true);
  });

  it("인자 지정 거절이 ANY 성공보다 우선한다", async () => {
    const server = await start();
    server.on("get_weather", ANY, { temperature: 0 });
    server.on("get_weather", { city: "없는도시" }, { error: "거절" }, { isError: true });
    const client = await connect(server);

    const rejected = await client.callTool({
      name: "get_weather",
      arguments: { city: "없는도시" },
    });
    const ok = await client.callTool({ name: "get_weather", arguments: { city: "서울" } });

    expect(rejected.isError).toBe(true);
    expect(ok.isError).toBeFalsy();
  });

  it("정의 파일의 responses 에서도 isError 가 동작한다", async () => {
    const server = await createMockServer({
      tools,
      responses: [
        {
          tool: "get_weather",
          args: { city: "없는도시" },
          result: { error: "없음" },
          isError: true,
        },
        { tool: "get_weather", result: { temperature: 0 } },
      ],
    });
    opened.push(server);
    const client = await connect(server);

    const rejected = await client.callTool({
      name: "get_weather",
      arguments: { city: "없는도시" },
    });
    const ok = await client.callTool({ name: "get_weather", arguments: { city: "서울" } });

    expect(rejected.isError).toBe(true);
    expect(ok.isError).toBeFalsy();
  });

  it("같은 거절 호출 3회가 바이트 단위로 동일하다", async () => {
    const server = await start();
    server.on("get_weather", ANY, { error: "거절" }, { isError: true });
    const client = await connect(server);
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = await client.callTool({ name: "get_weather", arguments: { city: "서울" } });
      seen.add(JSON.stringify({ isError: r.isError, body: text(r) }));
    }
    expect(seen.size).toBe(1);
  });
});

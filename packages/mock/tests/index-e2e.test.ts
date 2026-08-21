import { readFileSync } from "node:fs";
import { connectHttp, type ToolDef, type ToolResult } from "@mcpeak/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANY, createMockServer, type MockOptions, type MockServer } from "../src/index.js";

const { tools } = JSON.parse(
  readFileSync(new URL("../../../fixtures/tools-list.sample.json", import.meta.url), "utf8"),
) as { tools: ToolDef[] };

/** 테스트가 끝나면 열린 서버를 반드시 닫는다 — 안 닫으면 vitest 가 종료되지 않는다. */
const opened: MockServer[] = [];
/**
 * 테스트가 close 를 빠뜨려도 남은 연결을 정리한다. 안 닫으면 vitest 가 종료되지 않는다.
 *
 * 실패를 삼키지 않는다. 이미 닫힌 연결을 다시 닫아도 core 는 던지지 않으므로 가릴 이유가
 * 없고, teardown 이 조용히 실패하면 연결 누수를 아무도 못 본다. 다만 하나가 실패해도
 * 나머지 정리는 끝까지 시도한다 — afterEach 참조.
 */
const openedClients: Array<{ close(): Promise<void> }> = [];

async function start(): Promise<MockServer> {
  const server = await createMockServer({ tools });
  opened.push(server);
  return server;
}

/**
 * HTTP 목에 **우리 클라이언트**(`core.connectHttp`)로 붙는다.
 *
 * 전에는 벤더 SDK 의 `Client` 로 직접 붙었다. 그러면 `core` 의 HTTP 경로가 깨져도 이 파일은
 * 초록이라, 두 진입점 중 stdio 쪽에서만 "우리 도구로 우리를 검증한다"(CLAUDE.md)가
 * 성립했다. stdio 목 테스트는 이미 `core.connect()` 를 쓴다.
 *
 * 반환 모양은 벤더 `Client` 의 것을 유지한다 — 호출부 36곳을 바꾸지 않기 위해서다.
 * 인자 모양만 옮기고 실제 요청은 전부 `core` 를 지난다.
 */
async function connect(server: MockServer) {
  const conn = await connectHttp({ url: server.url });
  openedClients.push(conn);
  return {
    callTool: (req: { name: string; arguments?: unknown }): Promise<ToolResult> =>
      conn.client.callTool(req.name, req.arguments),
    listTools: async (): Promise<{ tools: ToolDef[] }> => ({
      tools: [...(await conn.client.listTools())],
    }),
    close: () => conn.close(),
  };
}

/**
 * 벤더 SDK 로 직접 붙는다. **인자를 보내기 전에 검증하지 않는 클라이언트**가 필요한
 * 테스트 전용이다.
 *
 * `core` 는 `assertToolArguments` 로 깊이 100 단계를 넘는 인자를 보내기 전에 거절한다
 * (`packages/core/src/client.ts:5`, `MAX_JSON_DEPTH = 100`). 목의 상한은 512 라
 * (ADR-0029), 목이 자기 상한을 어떻게 방어하는지는 우리 클라이언트로 **도달할 수 없다.**
 * 실제 사용자 중에는 그런 검증을 안 하는 클라이언트도 있으므로 그 경로를 계속 검증한다.
 *
 * 그 외 테스트는 전부 `connect()` — 즉 `core.connectHttp` 를 쓴다.
 */
async function rawConnect(server: MockServer): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  // connect() 와 같이 등록한다. 중간 단언이 실패하면 테스트의 close() 줄에 도달하지
  // 못하므로, 등록하지 않으면 그 연결이 남아 vitest 가 종료되지 않는다.
  openedClients.push(client);
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
  // Promise.all 은 첫 실패에서 끊긴다. 클라이언트 하나가 못 닫히면 남은 클라이언트도,
  // 그 아래 서버 정리도 통째로 건너뛰어 리소스가 남는다. 전부 시도한 뒤 실패를 모아 낸다.
  const results = [
    ...(await Promise.allSettled(openedClients.splice(0).map((c) => c.close()))),
    ...(await Promise.allSettled(opened.splice(0).map((s) => s.close()))),
  ];
  const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, `정리 중 ${failures.length}건이 실패했습니다.`);
  }
});

describe("@mcpeak/mock", () => {
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

    await expect(connectHttp({ url })).rejects.toThrow();
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
    const client = await rawConnect(server);

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
    const client = await rawConnect(server);

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
  /**
   * 정의 파일 경로(`assertMockDefinition`)는 미지의 툴 이름을 잡는데 `on()` 은 안 잡았다.
   * 오타 주입이 성공한 것처럼 보이고, 사용자는 실제 호출이 미스로 떨어져 진단문을 볼 때까지
   * 아무 신호도 못 받았다. 두 진입점이 같은 규칙을 쓴다는 README 의 계약과도 어긋났다.
   *
   * `toThrow("문장")` 은 chai 가 부분 일치로 보므로 뒤에 무엇이 붙어도 통과한다.
   * `new Error(전문)` 으로 완전 일치를 건다.
   */
  it("on() 이 tools 에 없는 툴 이름을 거절한다", async () => {
    const server = await start();

    expect(() => server.on("get_weatherr", { city: "서울" }, { temp: 21 })).toThrow(
      new Error(
        `mock.on('get_weatherr', ...) 의 툴 'get_weatherr' 이 tools 에 없습니다. 있는 툴: ${tools
          .map((t) => t.name)
          .join(", ")}`,
      ),
    );
  });

  it("on() 이 선언된 툴은 그대로 받는다", async () => {
    const server = await start();
    const name = tools[0]?.name as string;

    expect(() => server.on(name, ANY, { ok: true })).not.toThrow();
  });
});

/**
 * inputSchema 로 호출 인자를 검사한다 (ADR-0048, #181).
 *
 * 판정 자체는 tests/input-validation.test.ts 가 전량 고정한다. 여기서는 **순서**를 본다 —
 * 주입된 응답이 검사보다 우선하고, 검사는 주입이 없을 때만 돈다.
 */
describe("@mcpeak/mock — inputSchema 검사", () => {
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

  /**
   * 이 두 줄을 **계약 후보로 미리 고정한다.**
   *
   * 현재 `runner` 의 `classifyRejectionBasis` 는 이 문장을 보지 않는다. TS·Python SDK 의
   * 접두어 화이트리스트만 보므로 목의 거절은 전부 `unverified` 로 떨어진다 — 그것이
   * #221 이 보고한 결함이다. `runner` 가 이 문장을 지문으로 채택할지는 그 이슈에서 정한다.
   *
   * 채택된다면 단방향 의존(cli → runner/generate/record/mock → core) 때문에 `runner` 는
   * `@mcpeak/mock` 을 import 할 수 없어 문장을 자기 쪽에 하드코딩할 수밖에 없다. 그러면
   * 드리프트를 잡을 수 있는 자리가 여기뿐이 된다. 그래서 결정을 기다리는 동안 문장이
   * 흔들리지 않도록 먼저 못 박는다 — 채택 시점에 문장이 이미 바뀌어 있으면 늦다.
   *
   * **부분 일치로 걸면 안 된다** — 뒤에 줄이 붙거나 조사가 바뀌어도 통과해서 목은
   * 초록인 채로 문장만 흘러간다. 완전 일치로 건다.
   *
   * 이 테스트가 깨지면 문장을 되돌리거나, `runner` 오너와 상의해 양쪽을 같이 바꾼다.
   */
  const REJECTION_CONTRACT = [
    "→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.",
    "→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.",
  ] as const;

  it("스키마 위반 거절문의 끝 두 줄이 고정돼 있다 (#221 계약 후보)", async () => {
    const client = await connect(await startWith());
    const result = await client.callTool({ name: "get_weather", arguments: { city: 0 } });

    // 문장과 isError 는 계약의 양쪽이다. runner 는 isError 로 거절 여부를 먼저 가르고
    // 그 다음 문장으로 근거를 판별한다. 하나만 검사하면 나머지 절반이 조용히 깨진다.
    expect(result.isError).toBe(true);
    const lines = text(result).split("\n");
    expect(lines.slice(-2)).toEqual([...REJECTION_CONTRACT]);
    await client.close();
  });

  it("위반이 여럿이어도 고정된 두 줄은 끝에 한 번만 붙는다", async () => {
    const client = await connect(await startWith());
    const result = await client.callTool({
      name: "get_weather",
      arguments: { unit: "k", days: 0 },
    });

    expect(result.isError).toBe(true);
    const lines = text(result).split("\n");
    expect(lines.slice(-2)).toEqual([...REJECTION_CONTRACT]);
    // 위반 줄마다 붙으면 읽을 수 없다. 전체에서 각각 정확히 한 번이다.
    for (const line of REJECTION_CONTRACT) expect(lines.filter((l) => l === line)).toHaveLength(1);
    await client.close();
  });

  /**
   * 매칭 미스는 스키마 근거 거절이 **아니다**. 둘 다 `isError: true` 라 본문으로만
   * 구분되므로, 미스 진단문에 그 두 줄이 새면 runner 가 "서버가 스키마 근거로
   * 거절했다" 로 잘못 읽는다. ADR-0048 이 없애려던 "우연히 통과" 가 초록으로 숨는다.
   */
  it("매칭 미스 진단문에는 고정된 두 줄이 섞이지 않는다", async () => {
    const server = await startWith();
    server.on("get_weather", { city: "서울" }, { temp: 21 });
    const client = await connect(server);

    const result = await client.callTool({
      name: "get_weather",
      arguments: { city: "부산" },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("주입된 응답이 없습니다");
    for (const line of REJECTION_CONTRACT) expect(text(result)).not.toContain(line);
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

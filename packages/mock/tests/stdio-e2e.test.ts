import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpClient, ToolDef } from "@mcpeak/core";
import { connect } from "@mcpeak/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertMockDefinition } from "../src/index.js";

// CI 는 빌드 없이 `pnpm test` 를 돌리므로 @mcpeak/core 의 dist 가 없다.
// 워크스페이스 패키지를 소스로 돌려 해결한다 (packages/cli 도 같은 방식).
vi.mock("@mcpeak/core", async () => import("../../core/src/index.js"));

/**
 * 이 파일이 검증하는 것은 하나다 — **우리 도구로 우리 목 서버를 검증할 수 있는가**
 * (CONTRIBUTING §6). `core.connect()` 로 stdio 목에 붙는다.
 */

const TOOLS: ToolDef[] = [
  {
    name: "get_weather",
    description: "지정한 도시의 현재 날씨를 반환한다.",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
  {
    name: "add",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
];

const entry = fileURLToPath(new URL("./fixtures/stdio-entry.mjs", import.meta.url));
/**
 * `src/` 는 저장소 관례대로 ".js" 로 형제 모듈을 부르는데 Node 의 ESM 리졸버는 그것을
 * ".ts" 로 매핑하지 않는다. 이 훅이 그 한 칸을 메운다 (ADR-0055). 빠뜨리면 자식이
 * ERR_MODULE_NOT_FOUND 로 즉시 죽는다.
 *
 * **`--import` 에는 원시 경로가 아니라 URL 을 넘긴다.** Windows 절대경로를 그대로 주면 ESM
 * 로더가 드라이브 문자를 스킴으로 읽어 `ERR_UNSUPPORTED_ESM_URL_SCHEME` 로 자식이 시작조차
 * 못 한다 (#246). 경로에 공백이 있는 경우도 `.href` 가 인코딩해 준다. `record` 의 자식
 * 부트스트랩(`external/coordinator.ts`)이 같은 형태다 — 같은 함정을 두 번 밟은 자리다.
 *
 * 위의 `entry` 는 `--import` 가 아니라 일반 argv 라서 원시 경로 그대로가 맞다.
 */
const tsResolve = new URL("./fixtures/register-ts-resolve.mjs", import.meta.url).href;
const opened: McpClient[] = [];

/** stdio 목을 띄우고 core.connect() 로 붙는다. */
async function connectMock(
  definition: unknown,
  options?: { omitPath?: boolean },
): Promise<McpClient> {
  const dir = mkdtempSync(join(tmpdir(), "mcpeak-mock-"));
  const path = join(dir, "definition.json");
  writeFileSync(path, JSON.stringify(definition), "utf8");

  const client = await connect({
    command: process.execPath,
    args: ["--experimental-strip-types", "--no-warnings", "--import", tsResolve, entry, path],
    // 경로를 안 넘긴 `serveStdio(definition)` 호출을 재현한다. 배포 진입점은 늘 경로를 주므로
    // 이 갈래는 여기서만 만들 수 있다.
    ...(options?.omitPath === true ? { env: { MOCK_OMIT_PATH: "1" } } : {}),
  });
  opened.push(client);
  return client;
}

/** 툴 응답의 텍스트 본문. */
function text(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  const first = content?.[0]?.text;
  if (first === undefined) throw new Error("응답에 텍스트 content 가 없습니다.");
  return first;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.close()));
});

describe("@mcpeak/mock stdio", () => {
  it("core.connect() 로 붙어 정의한 툴을 그대로 노출한다", async () => {
    const client = await connectMock({ tools: TOOLS });

    const listed = await client.listTools();
    expect(listed.map((t) => t.name)).toEqual(["get_weather", "add"]);
    expect(listed.find((t) => t.name === "get_weather")?.inputSchema).toEqual(
      TOOLS.find((t) => t.name === "get_weather")?.inputSchema,
    );
  });

  it("인자를 지정한 응답이 그 인자에만 나간다", async () => {
    const client = await connectMock({
      tools: TOOLS,
      responses: [
        { tool: "get_weather", args: { city: "서울" }, result: { temp: -10 } },
        { tool: "get_weather", args: { city: "부산" }, result: { temp: 5 } },
      ],
    });

    expect(JSON.parse(text(await client.callTool("get_weather", { city: "서울" })))).toEqual({
      temp: -10,
    });
    expect(JSON.parse(text(await client.callTool("get_weather", { city: "부산" })))).toEqual({
      temp: 5,
    });
  });

  it("args 를 생략하면 인자를 가리지 않는다", async () => {
    const client = await connectMock({
      tools: TOOLS,
      responses: [{ tool: "get_weather", result: { temp: 0 } }],
    });

    for (const city of ["서울", "도쿄", "없는도시"]) {
      expect(JSON.parse(text(await client.callTool("get_weather", { city })))).toEqual({ temp: 0 });
    }
  });

  it("인자를 지정한 응답이 args 생략본보다 우선한다", async () => {
    const client = await connectMock({
      tools: TOOLS,
      responses: [
        { tool: "get_weather", result: { temp: 0 } },
        { tool: "get_weather", args: { city: "서울" }, result: { temp: -10 } },
      ],
    });

    expect(JSON.parse(text(await client.callTool("get_weather", { city: "서울" })))).toEqual({
      temp: -10,
    });
    expect(JSON.parse(text(await client.callTool("get_weather", { city: "부산" })))).toEqual({
      temp: 0,
    });
  });

  it("주입되지 않은 호출은 무엇이 등록돼 있는지 알려준다", async () => {
    const client = await connectMock({
      tools: TOOLS,
      responses: [{ tool: "get_weather", args: { city: "서울" }, result: { temp: -10 } }],
    });

    const result = await client.callTool("get_weather", { city: "제주" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("주입된 응답이 없습니다");
    expect(text(result)).toContain('{"city":"서울"}');
  });

  it("같은 호출 3회가 바이트 단위로 동일하다", async () => {
    const client = await connectMock({
      tools: TOOLS,
      responses: [{ tool: "add", args: { a: 1, b: 2 }, result: { sum: 3 } }],
    });

    const runs: string[] = [];
    for (let i = 0; i < 3; i++) {
      runs.push(JSON.stringify(await client.callTool("add", { a: 1, b: 2 })));
    }
    expect(new Set(runs).size).toBe(1);
  });

  it("인자의 키 순서가 달라도 같은 응답을 찾는다", async () => {
    const client = await connectMock({
      tools: TOOLS,
      responses: [{ tool: "add", args: { a: 1, b: 2 }, result: { sum: 3 } }],
    });

    expect(JSON.parse(text(await client.callTool("add", { b: 2, a: 1 })))).toEqual({ sum: 3 });
  });
});

describe("assertMockDefinition — 정의 파일 검증", () => {
  /** 사람이 손으로 쓰는 파일이므로 오류가 읽혀야 한다. 실패 메시지가 곧 제품이다. */
  const rejects = (value: unknown): string => {
    try {
      assertMockDefinition(value, "weather.mock.json");
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("잘못된 정의인데 통과했다.");
  };

  it("tools 가 없으면 무엇이 빠졌는지와 올바른 형식을 함께 알려준다", () => {
    const message = rejects({ responses: [] });
    expect(message).toContain("weather.mock.json");
    expect(message).toContain("'tools' 가 배열이 아닙니다");
    expect(message).toContain('"responses"');
  });

  it("responses 가 tools 에 없는 툴을 가리키면 있는 툴을 알려준다", () => {
    const message = rejects({ tools: TOOLS, responses: [{ tool: "없는툴", result: {} }] });
    expect(message).toContain("tools 에 없습니다");
    expect(message).toContain("get_weather, add");
  });

  it("result 가 빠지면 몇 번째 항목인지 알려준다", () => {
    expect(rejects({ tools: TOOLS, responses: [{ tool: "add" }] })).toContain(
      "responses[0] 에 'result' 가 없습니다",
    );
  });

  it("inputSchema 가 없는 툴을 거른다", () => {
    // 없으면 클라이언트에 인자 없는 툴로 보인다. ToolDef 가 요구하는 필드다.
    expect(rejects({ tools: [{ name: "add" }] })).toContain(
      "tools[0] ('add') 에 'inputSchema' 가 없습니다",
    );
  });

  it("올바른 정의는 통과한다", () => {
    expect(() =>
      assertMockDefinition({ tools: TOOLS, responses: [{ tool: "add", result: { sum: 3 } }] }),
    ).not.toThrow();
    expect(() => assertMockDefinition({ tools: [] })).not.toThrow();
  });

  it("선언조차 없는 툴 호출은 stdio 에서도 '선언 안 됨' 으로 답한다", async () => {
    // buildServer 를 HTTP 와 공유하므로 두 진입점에서 같은 판정이 나오는지 고정한다.
    const client = await connectMock({
      tools: [
        { name: "add", inputSchema: { type: "object", properties: { a: { type: "number" } } } },
      ],
      responses: [{ tool: "add", args: { a: 1 }, result: { sum: 1 } }],
    });

    const result = await client.callTool("subtract", { a: 1 });

    expect((result as { isError?: boolean }).isError).toBe(true);
    const body = text(result);
    expect(body).toContain("선언한 툴이 아닙니다");
    expect(body).toContain("add");
    expect(body).not.toContain("주입된 응답이 없습니다");
  });

  it("stdio 미스 진단문은 mock.on 이 아니라 정의 파일의 responses 를 가리킨다", async () => {
    // 정의 파일로 쓰는 사람 화면에는 mock.on 이라는 코드가 없다. README 에도 안 나온다.
    // 시키는 대로 할 수 없는 안내를 주면 안 된다.
    const client = await connectMock({
      tools: [
        { name: "add", inputSchema: { type: "object", properties: { a: { type: "number" } } } },
      ],
      responses: [{ tool: "add", args: { a: 1 }, result: { sum: 1 } }],
    });

    const body = text(await client.callTool("add", { a: 9 }));

    expect(body).toContain("주입된 응답이 없습니다");
    expect(body).toContain("responses");
    expect(body).toContain("definition.json");
    expect(body).not.toContain("mock.on(");
  });

  it("경로 없이 serveStdio 를 부르면 가리킬 파일이 없는 문장을 내지 않는다", async () => {
    // `buildServer` 에 `origin`("정의 파일")을 넘기면 "정의 파일 의 responses" 처럼 가리킬
    // 파일이 없는 문장이 나간다. 실제로 한 번 그렇게 냈고 리뷰에서 잡혔다.
    const client = await connectMock(
      {
        tools: [
          { name: "add", inputSchema: { type: "object", properties: { a: { type: "number" } } } },
        ],
        responses: [{ tool: "add", args: { a: 1 }, result: { sum: 1 } }],
      },
      { omitPath: true },
    );

    const body = text(await client.callTool("add", { a: 9 }));

    expect(body).toContain("주입된 응답이 없습니다");
    expect(body).not.toMatch(/정의 파일 의/);
    expect(body).toContain("mock.on(");
  });
});

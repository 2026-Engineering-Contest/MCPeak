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
const opened: McpClient[] = [];

/**
 * 아래 묶음은 소스를 자식 프로세스로 띄우기 위해 `--experimental-strip-types` 를 쓰는데,
 * 그 플래그는 Node 22.6 부터 있다. Node 20 에서는 자식이 즉시 죽는다.
 *
 * **테스트 하네스의 제약이지 배포되는 코드의 제약이 아니다.** 빌드 산출물
 * (`dist/stdio.mjs`)은 순수 JS 라 Node 20 에서 정상 동작한다. verify 매트릭스의
 * Node 20 은 나머지 테스트로 사용자 환경 호환성을 계속 보증한다 (CONTRIBUTING §6).
 *
 * `assertMockDefinition` 묶음은 자식 프로세스를 쓰지 않으므로 모든 버전에서 돈다.
 */
const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split(".").map(Number);
const canStripTypes = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 6);

/** stdio 목을 띄우고 core.connect() 로 붙는다. */
async function connectMock(definition: unknown): Promise<McpClient> {
  const dir = mkdtempSync(join(tmpdir(), "mcpeak-mock-"));
  const path = join(dir, "definition.json");
  writeFileSync(path, JSON.stringify(definition), "utf8");

  const client = await connect({
    command: process.execPath,
    args: ["--experimental-strip-types", "--no-warnings", entry, path],
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

describe.skipIf(!canStripTypes)("@mcpeak/mock stdio", () => {
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
});

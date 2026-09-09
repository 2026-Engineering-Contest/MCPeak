import { spawn } from "node:child_process";
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

/**
 * **배포되는 진입점 그 자체**(`src/stdio.ts`)를 자식 프로세스로 띄우고 나온 것을 돌려준다.
 *
 * `connectMock` 이 쓰는 `stdio-entry.mjs` 는 파일 읽기와 파싱을 스스로 해서 `serveStdio` 를
 * 직접 부른다. 즉 `main()` 을 통째로 건너뛴다 — 사용자가 가장 자주 밟는 오류 경로(경로 오타,
 * 깨진 JSON, --help)가 그 배선으로는 도달 불가다.
 *
 * `main()` 을 import 해서 부를 수는 없다. `stdio.ts` 는 맨 아래에서 스스로를 실행하므로
 * import 하는 순간 vitest 의 argv 로 돌아 프로세스를 죽인다. 실행 파일에 self-execute
 * 가드를 넣는 방법도 있지만, 이 패키지는 cjs 도 함께 빌드해서(같은 이유로 top-level await 도
 * 안 쓴다) 배포 산출물의 구조를 테스트 때문에 바꾸는 셈이 된다. 그래서 진짜로 실행한다.
 */
function runEntry(
  args: readonly string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      tsResolve,
      fileURLToPath(new URL("../src/stdio.ts", import.meta.url)),
      ...args,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** `main()` 이 인자 없이·--help 로 찍는 사용법. 전문을 고정한다. */
const USAGE = [
  "사용법: mcpeak-mock <definition.json>",
  '  definition.json 형식: { "tools": [...], "responses": [{ "tool": ..., "result": ... }] }',
  "  responses 의 args 를 생략하면 인자를 가리지 않습니다.",
].join("\n");

/** 정의 파일을 임시 디렉터리에 쓰고 경로를 돌려준다. 내용은 문자열 그대로 — 깨진 JSON 용. */
function writeRaw(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mcpeak-mock-"));
  const path = join(dir, "definition.json");
  writeFileSync(path, contents, "utf8");
  return path;
}

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

/**
 * 배포 진입점의 오류 경로(#416).
 *
 * 정상 경로는 `packages/cli/tests/dist-cli-e2e.mjs` 가 빌드 산출물로 덮는다. 오류 경로는
 * 어디에서도 실행되지 않아, 사용자가 가장 자주 보는 네 문장이 무검증으로 남아 있었다.
 *
 * **우리가 쓴 줄만 전문 일치를 건다.** Node 가 만든 줄(`ENOENT: ...`,
 * `Unexpected end of JSON input`)은 버전에 따라 문구가 움직이므로 조각만 확인한다. 전문으로
 * 걸면 Node 를 올릴 때 애먼 자리에서 빨간불이 난다.
 *
 * 네 케이스 모두 **stdout 이 비어 있는지**를 함께 본다. `src/stdio.ts` 머리말이 "stdout 에
 * 아무것도 쓰지 않는다 — 그 채널로 JSON-RPC 를 주고받는다" 를 계약으로 적어 두었는데 지금까지
 * 아무도 검사하지 않았다. 여기에 console.log 가 하나 섞이면 붙어 있는 클라이언트가 깨진다.
 */
describe("@mcpeak/mock stdio 진입점 오류 경로", () => {
  it("경로를 안 주면 무엇이 필요한지와 사용법을 함께 낸다", async () => {
    const { code, stdout, stderr } = await runEntry([]);

    expect(stderr).toBe(`→ 목 정의 파일 경로가 필요합니다.\n${USAGE}\n`);
    expect(code).toBe(1);
    expect(stdout).toBe("");
  });

  /**
   * 종료 코드가 0 이어야 한다. 1 이면 스크립트에서 `mcpeak-mock --help` 가 실패로 잡힌다 —
   * 도움말을 물어본 것은 오류가 아니다.
   */
  it("--help 와 -h 는 사용법만 내고 0 으로 끝난다", async () => {
    for (const flag of ["--help", "-h"]) {
      const { code, stdout, stderr } = await runEntry([flag]);

      expect(stderr).toBe(`${USAGE}\n`);
      expect(code).toBe(0);
      expect(stdout).toBe("");
    }
  });

  it("읽을 수 없는 경로는 그 경로와 원인을 함께 낸다", async () => {
    const missing = join(mkdtempSync(join(tmpdir(), "mcpeak-mock-")), "없는파일.json");
    const { code, stdout, stderr } = await runEntry([missing]);

    const [first, second] = stderr.split("\n");
    expect(first).toBe(`→ 목 정의 파일을 읽을 수 없습니다: ${missing}`);
    // 둘째 줄은 Node 가 만든 문장이라 조각만 본다. 어느 경로가 없는지는 사용자가 봐야 한다.
    expect(second).toContain("ENOENT");
    expect(second).toContain(missing);
    expect(code).toBe(1);
    expect(stdout).toBe("");
  });

  /**
   * "파일이 깨졌다" 와 "형식이 틀렸다" 를 갈라 적는다. 뭉치면 사용자가 콤마를 찾아야 할지
   * 스키마를 봐야 할지 모른다 — 형식 위반은 `assertMockDefinition` 이 따로 말한다.
   */
  it("올바르지 않은 JSON 은 파싱 실패임을 밝힌다", async () => {
    const path = writeRaw('{ "tools": [');
    const { code, stdout, stderr } = await runEntry([path]);

    const [first, second] = stderr.split("\n");
    expect(first).toBe(`→ 목 정의 파일이 올바른 JSON 이 아닙니다: ${path}`);
    expect(second).toMatch(/^→ /);
    expect(code).toBe(1);
    expect(stdout).toBe("");
  });
});

import { constants } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDef } from "@ohmymcp/core";
import * as runner from "@ohmymcp/runner";
import { afterEach, describe, expect, it } from "vitest";
import { deepFreeze } from "../src/canonical.js";
import {
  canonicalJson,
  createBaselineSuite,
  GenerateTestsError,
  generateTests,
  sha256,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

async function temporaryOutDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ohmymcp-generate-"));
  temporaryDirectories.push(directory);
  return join(directory, "generated");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("canonical 재수출", () => {
  // 구현이 두 벌이 되면 저장 시점과 실행 시점의 지문이 조용히 갈린다. 같은 함수 참조여야 한다.
  it("generate 의 sha256 이 runner 의 sha256 과 같은 함수다", () => {
    expect(sha256).toBe(runner.sha256);
  });

  it("canonicalJson · deepFreeze 도 runner 의 것과 같은 함수다", () => {
    expect(canonicalJson).toBe(runner.canonicalJson);
    expect(deepFreeze).toBe(runner.deepFreeze);
  });
});

describe("generateTests", () => {
  it("기존 파일 생성과 baseline case 합성 규칙을 공유한다", async () => {
    const tool: ToolDef = {
      name: "get_weather",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    };
    const [path] = await generateTests([tool], { outDir: await temporaryOutDir() });
    const source = await readFile(path as string, "utf8");
    const matched = source.match(/defineMcpSuite\((\{[\s\S]*\})\);/);
    // 폴백을 두면 정규식 불일치가 엉뚱한 TypeError로 바뀌어 진짜 원인이 가려진다.
    expect(matched?.[1]).toBeTypeOf("string");
    const generatedCase = JSON.parse(matched?.[1] as string).cases[0];

    expect(generatedCase).toEqual(
      createBaselineSuite([tool], { suiteId: "server", suiteName: "서버" }).suite.cases[0],
    );
  });
  it("도구마다 client 연결이 없는 선언형 Runner suite를 생성한다", async () => {
    const outDir = await temporaryOutDir();
    const tools: ToolDef[] = [
      {
        name: "get_weather",
        description: "도시의 현재 날씨를 반환한다.",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string", description: "도시 이름" },
            units: { type: "string", default: "metric" },
          },
          required: ["city", "units"],
        },
      },
      {
        name: "add",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number" },
            b: { type: "integer", examples: [2] },
          },
          required: ["a", "b"],
        },
      },
    ];

    const paths = await generateTests(tools, { outDir });

    expect(paths).toEqual([
      join(outDir, "get-weather.generated.ts"),
      join(outDir, "add.generated.ts"),
    ]);
    const weather = await readFile(paths[0] as string, "utf8");
    expect(weather).toContain('import { defineMcpSuite } from "@ohmymcp/runner";');
    expect(weather).toContain("export const generatedSuite = defineMcpSuite(");
    expect(weather).toContain("직접 수정하지 마세요");
    expect(weather).toContain('"tool": "get_weather"');
    expect(weather).toContain('"city": "example"');
    expect(weather).toContain('"units": "metric"');
    expect(weather).toContain('"expected": false');
    expect(weather).not.toContain("McpClient");
    expect(weather).not.toContain("vitest");
    expect(weather).not.toContain("connect(");

    const add = await readFile(paths[1] as string, "utf8");
    expect(add).toContain('"a": 0');
    expect(add).toContain('"b": 2');
  });

  it("const, default, examples[0], enum[0], 타입 기본값 순서로 입력을 선택한다", async () => {
    const outDir = await temporaryOutDir();
    const [path] = await generateTests(
      [
        {
          name: "priority",
          inputSchema: {
            type: "object",
            required: ["byConst", "byDefault", "byExample", "byEnum", "byFallback", "nested"],
            properties: {
              byConst: { type: "string", const: "const-value", default: "ignored" },
              byDefault: { type: "number", default: 3, examples: [4], enum: [3, 4] },
              byExample: { type: "boolean", examples: [false] },
              byEnum: { type: "string", enum: ["first", "second"] },
              byFallback: { type: "null" },
              nested: {
                type: "array",
                items: {
                  type: "object",
                  required: ["value"],
                  properties: { value: { type: "integer" } },
                },
              },
            },
          },
        },
      ],
      { outDir },
    );

    const source = await readFile(path as string, "utf8");
    expect(source).toContain('"byConst": "const-value"');
    expect(source).toContain('"byDefault": 3');
    expect(source).toContain('"byExample": false');
    expect(source).toContain('"byEnum": "first"');
    expect(source).toContain('"byFallback": null');
    expect(source).toContain('"value": 0');
  });

  it("파일명을 안전하게 만들고 같은 이름에는 결정론적 접미사를 붙인다", async () => {
    const outDir = await temporaryOutDir();
    const schema = { type: "object", properties: {}, required: [] };

    const paths = await generateTests(
      [
        { name: "Weather / Current", inputSchema: schema },
        { name: "weather-current", inputSchema: schema },
        { name: "한글 도구", inputSchema: schema },
      ],
      { outDir },
    );

    expect(paths.map((path) => path.slice(outDir.length + 1))).toEqual([
      "weather-current-c34dac28.generated.ts",
      "weather-current-411bd031.generated.ts",
      "tool-080a6f09.generated.ts",
    ]);
  });

  it("접미사가 도구 이름과 다시 충돌해도 경로와 suite id를 고유하게 만든다", async () => {
    const outDir = await temporaryOutDir();
    const schema = { type: "object", properties: {}, required: [] };

    const paths = await generateTests(
      [
        { name: "a", inputSchema: schema },
        { name: "a", inputSchema: schema },
        { name: "a-2", inputSchema: schema },
      ],
      { outDir },
    );

    expect(paths.map((path) => path.slice(outDir.length + 1))).toEqual([
      "a.generated.ts",
      "a-2.generated.ts",
      "a-2-2.generated.ts",
    ]);
    expect(new Set(paths).size).toBe(paths.length);

    const sources = await Promise.all(paths.map((path) => readFile(path, "utf8")));
    const suiteIds = sources.map((source) => source.match(/"id": "([^"]+-generated)"/)?.[1]);
    expect(suiteIds).not.toContain(undefined);
    expect(new Set(suiteIds).size).toBe(suiteIds.length);
  });

  it.each(["properties", "required"] as const)(
    "명시적으로 null인 %s를 누락된 키처럼 취급하지 않는다",
    async (keyword) => {
      const outDir = await temporaryOutDir();

      await expect(
        generateTests(
          [
            {
              name: `null-${keyword}`,
              inputSchema: { type: "object", [keyword]: null },
            },
          ],
          { outDir },
        ),
      ).rejects.toMatchObject({
        code: "UNSUPPORTED_SCHEMA",
        path: `tools[0].inputSchema.${keyword}`,
      });
      await expect(readdir(outDir)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("지원하지 않는 스키마가 있으면 어떤 파일도 쓰기 전에 경로와 이유를 보고한다", async () => {
    const outDir = await temporaryOutDir();

    const generation = generateTests(
      [
        {
          name: "valid",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
        {
          name: "unsupported",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", minLength: 1 } },
            required: ["query"],
          },
        },
      ],
      { outDir },
    );

    await expect(generation).rejects.toBeInstanceOf(GenerateTestsError);
    await expect(generation).rejects.toMatchObject({
      code: "UNSUPPORTED_SCHEMA",
      path: "tools[1].inputSchema.properties.query.minLength",
      hint: expect.stringContaining("description, title"),
    });
    await expect(readdir(outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("루트가 객체가 아니거나 후보값이 제약을 만족하지 못하면 명확히 실패한다", async () => {
    const outDir = await temporaryOutDir();

    await expect(
      generateTests([{ name: "bad", inputSchema: { type: "string" } }], { outDir }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_SCHEMA",
      path: "tools[0].inputSchema.type",
    });

    await expect(
      generateTests(
        [
          {
            name: "bad-default",
            inputSchema: {
              type: "object",
              properties: { count: { type: "number", default: "not-a-number" } },
              required: ["count"],
            },
          },
        ],
        { outDir },
      ),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_SCHEMA",
      path: "tools[0].inputSchema.properties.count",
    });
  });

  it("빈 도구 목록에는 디렉터리나 파일을 만들지 않고 빈 배열을 반환한다", async () => {
    const outDir = await temporaryOutDir();

    await expect(generateTests([], { outDir })).resolves.toEqual([]);
    await expect(readdir(outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("기존 생성 파일을 기본적으로 덮어쓰지 않는다", async () => {
    const outDir = await temporaryOutDir();
    const existingPath = join(outDir, "existing.generated.ts");
    await mkdir(outDir, { recursive: true });
    await writeFile(existingPath, "사용자가 보존할 내용", "utf8");

    await expect(
      generateTests(
        [
          {
            name: "new-tool",
            inputSchema: { type: "object", properties: {}, required: [] },
          },
          {
            name: "existing",
            inputSchema: { type: "object", properties: {}, required: [] },
          },
        ],
        { outDir },
      ),
    ).rejects.toMatchObject({ code: "OUTPUT_FILE_EXISTS", path: existingPath });

    await expect(readFile(existingPath, "utf8")).resolves.toBe("사용자가 보존할 내용");
    await expect(readFile(join(outDir, "new-tool.generated.ts"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.runIf(typeof constants.O_NOFOLLOW === "number")(
    "overwrite를 명시하면 기존 생성 파일을 교체한다",
    async () => {
      const outDir = await temporaryOutDir();
      const tool: ToolDef = {
        name: "replace-me",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      };
      const path = join(outDir, "replace-me.generated.ts");
      await mkdir(outDir, { recursive: true });
      await writeFile(path, "이전 내용", "utf8");

      await expect(generateTests([tool], { outDir, overwrite: true })).resolves.toEqual([path]);
      const source = await readFile(path, "utf8");
      expect(source).not.toContain("이전 내용");
      expect(source).toContain('"value": "example"');
    },
  );

  it.runIf(typeof constants.O_NOFOLLOW !== "number")(
    "안전한 파일 열기를 지원하지 않는 플랫폼에서는 overwrite를 거절하고 원본을 보존한다",
    async () => {
      const outDir = await temporaryOutDir();
      const tool: ToolDef = {
        name: "replace-me",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      };
      const path = join(outDir, "replace-me.generated.ts");
      await mkdir(outDir, { recursive: true });
      await writeFile(path, "이전 내용", "utf8");

      await expect(generateTests([tool], { outDir, overwrite: true })).rejects.toMatchObject({
        code: "GENERATED_SUITE_INVALID",
        path,
      });
      await expect(readFile(path, "utf8")).resolves.toBe("이전 내용");
    },
  );

  it.runIf(typeof constants.O_NOFOLLOW === "number")(
    "overwrite에서도 기존 심볼릭 링크를 따라가지 않는다",
    async () => {
      const outDir = await temporaryOutDir();
      const outsidePath = join(outDir, "..", "outside.ts");
      const generatedPath = join(outDir, "linked.generated.ts");
      await mkdir(outDir, { recursive: true });
      await writeFile(outsidePath, "외부 파일", "utf8");
      await symlink(outsidePath, generatedPath, "file");

      await expect(
        generateTests(
          [{ name: "linked", inputSchema: { type: "object", properties: {}, required: [] } }],
          { outDir, overwrite: true },
        ),
      ).rejects.toMatchObject({ code: "GENERATED_SUITE_INVALID", path: generatedPath });

      await expect(readFile(outsidePath, "utf8")).resolves.toBe("외부 파일");
    },
  );

  it.runIf(typeof constants.O_NOFOLLOW === "number")(
    "동시에 심볼릭 링크로 교체되어도 링크 대상은 수정하지 않는다",
    async () => {
      const outDir = await temporaryOutDir();
      const outsidePath = join(outDir, "..", "outside-race.ts");
      const generatedPath = join(outDir, "racing.generated.ts");
      await mkdir(outDir, { recursive: true });
      await writeFile(outsidePath, "외부 파일", "utf8");
      await writeFile(generatedPath, "기존 생성 파일", "utf8");

      const tool: ToolDef = {
        name: "racing",
        description: "x".repeat(128 * 1024),
        inputSchema: { type: "object", properties: {}, required: [] },
      };
      const generations = Array.from({ length: 20 }, () =>
        generateTests([tool], { outDir, overwrite: true }).catch((error: unknown) => error),
      );
      const replacement = (async () => {
        for (let index = 0; index < 20; index++) {
          await rm(generatedPath, { force: true });
          try {
            await symlink(outsidePath, generatedPath, "file");
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
              throw error;
            }
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
          await rm(generatedPath, { force: true });
          await writeFile(generatedPath, "경쟁 중 일반 파일", "utf8");
        }
      })();

      const results = await Promise.all(generations);
      await replacement;
      for (const result of results) {
        if (result instanceof Error) {
          expect(result).toMatchObject({ code: "GENERATED_SUITE_INVALID", path: generatedPath });
        } else {
          expect(result).toEqual([generatedPath]);
        }
      }
      await expect(readFile(outsidePath, "utf8")).resolves.toBe("외부 파일");
    },
  );

  it("overwrite 옵션은 boolean만 허용한다", async () => {
    const outDir = await temporaryOutDir();

    await expect(
      generateTests([], { outDir, overwrite: "yes" } as unknown as { outDir: string }),
    ).rejects.toMatchObject({ code: "INVALID_OPTIONS", path: "options.overwrite" });
  });

  it("keeps fallback filenames stable when tool order changes", async () => {
    const firstOutDir = await temporaryOutDir();
    const secondOutDir = await temporaryOutDir();
    const schema = { type: "object", properties: {}, required: [] };
    const names = [
      "\ud55c\uae00 \ub3c4\uad6c",
      "\u4e2d\u6587\u5de5\u5177",
      "CON",
      "\uac00",
      "\u1100\u1161",
    ];

    const first = await generateTests(
      names.map((name) => ({ name, inputSchema: schema })),
      { outDir: firstOutDir },
    );
    const second = await generateTests(
      [...names].reverse().map((name) => ({ name, inputSchema: schema })),
      { outDir: secondOutDir },
    );
    const relativeNames = (paths: string[], outDir: string) =>
      paths.map((path) => path.slice(outDir.length + 1)).sort();
    const namesByTool = (toolNames: string[], paths: string[], outDir: string) =>
      Object.fromEntries(
        toolNames.map((name, index) => [name, paths[index]?.slice(outDir.length + 1)]),
      );

    expect(relativeNames(first, firstOutDir)).toEqual([
      "tool-080a6f09.generated.ts",
      "tool-5574b135.generated.ts",
      "tool-64ee5293-64ee5293.generated.ts",
      "tool-64ee5293-a0d2271e.generated.ts",
      "tool-a3dbc4b6.generated.ts",
    ]);
    expect(relativeNames(second, secondOutDir)).toEqual(relativeNames(first, firstOutDir));
    expect(namesByTool([...names].reverse(), second, secondOutDir)).toEqual(
      namesByTool(names, first, firstOutDir),
    );
  });

  it("requires schema properties to be owned rather than inherited", async () => {
    const outDir = await temporaryOutDir();

    await expect(
      generateTests(
        [
          {
            name: "inherited-required",
            inputSchema: { type: "object", properties: {}, required: ["constructor"] },
          },
        ],
        { outDir },
      ),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_SCHEMA",
      path: "tools[0].inputSchema.required[0]",
    });

    await expect(
      generateTests(
        [
          {
            name: "inherited-candidate-required",
            inputSchema: {
              type: "object",
              properties: { constructor: { type: "string" } },
              required: ["constructor"],
              default: {},
            },
          },
        ],
        { outDir },
      ),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_SCHEMA",
      path: "tools[0].inputSchema",
    });
  });

  it("does not treat inherited object keys as candidate properties", async () => {
    const outDir = await temporaryOutDir();
    const [path] = await generateTests(
      [
        {
          name: "inherited-candidate",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            default: { toString: "owned-value" },
          },
        },
      ],
      { outDir },
    );

    await expect(readFile(path as string, "utf8")).resolves.toContain('"toString": "owned-value"');
  });
});

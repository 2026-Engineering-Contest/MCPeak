import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDef } from "@ohmymcp/core";
import { afterEach, describe, expect, it } from "vitest";
import { createBaselineSuite, GenerateTestsError, generateTests } from "../src/index.js";

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
    const generatedCase = JSON.parse(source.match(/defineMcpSuite\((\{[\s\S]*\})\);/)?.[1] ?? "{}")
      .cases[0];

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
      "weather-current.generated.ts",
      "weather-current-2.generated.ts",
      "tool-3.generated.ts",
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
});

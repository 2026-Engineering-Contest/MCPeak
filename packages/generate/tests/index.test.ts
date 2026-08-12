import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDef } from "@ohmymcp/core";
import { afterEach, describe, expect, it } from "vitest";
import { GenerateTestsError, generateTests } from "../src/index.js";

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

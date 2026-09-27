import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDef } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import { normalizeSchema, normalizeTool, type StagedTool } from "../src/normalize.js";
import { optimize } from "../src/optimize.js";
import { promoteCommonParameters } from "../src/promote.js";
import { cleanToolDescription, stripNoise } from "../src/strip-noise.js";
import type { OptimizeInput } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);
const repoFixture = (name: string) => join(here, "..", "..", "..", "fixtures", name);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function syntheticInput(): OptimizeInput {
  return {
    tools: readJson<{ tools: ToolDef[] }>(fixture("synthetic.tools.json")).tools,
    instructions: readFileSync(fixture("synthetic.instructions.txt"), "utf8"),
    otherCapabilities: [],
  };
}

const VERSION = readJson<{ version: string }>(join(here, "..", "package.json")).version;

function staged(tool: ToolDef): StagedTool {
  return { ...tool, changes: [] };
}

/** 최상위 속성 하나에 description 을 단 도구. 승격 테스트용. */
function toolWith(name: string, properties: Record<string, unknown>): StagedTool {
  return staged({ name, description: `${name} tool`, inputSchema: { type: "object", properties } });
}

function propertiesOf(tool: StagedTool): Record<string, Record<string, unknown>> {
  return (tool.inputSchema as { properties: Record<string, Record<string, unknown>> }).properties;
}

describe("normalizeSchema (변환 A)", () => {
  it("$schema·$id·$comment·title 을 모든 깊이에서 지운다", () => {
    const { schema, changes } = normalizeSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "urn:x",
      $comment: "메모",
      title: "Root",
      type: "object",
      properties: {
        a: { type: "array", title: "A", items: { title: "Item", $comment: "c", type: "string" } },
      },
      $defs: { D: { $id: "urn:d", title: "D", type: "number" } },
    });
    expect(schema).toEqual({
      type: "object",
      properties: { a: { type: "array", items: { type: "string" } } },
      $defs: { D: { type: "number" } },
    });
    expect(changes).toEqual([
      { kind: "schema-key-removed", path: "inputSchema", key: "$schema" },
      { kind: "schema-key-removed", path: "inputSchema", key: "$id" },
      { kind: "schema-key-removed", path: "inputSchema", key: "$comment" },
      { kind: "schema-key-removed", path: "inputSchema", key: "title" },
      { kind: "schema-key-removed", path: "inputSchema.properties.a", key: "title" },
      { kind: "schema-key-removed", path: "inputSchema.properties.a.items", key: "title" },
      { kind: "schema-key-removed", path: "inputSchema.properties.a.items", key: "$comment" },
      { kind: "schema-key-removed", path: "inputSchema.$defs.D", key: "$id" },
      { kind: "schema-key-removed", path: "inputSchema.$defs.D", key: "title" },
    ]);
  });

  it("additionalProperties 가 true 일 때만 지우고 false 와 객체는 남긴다", () => {
    const { schema } = normalizeSchema({
      type: "object",
      additionalProperties: true,
      properties: {
        closed: { type: "object", additionalProperties: false, properties: { x: {} } },
        typed: { type: "object", additionalProperties: { type: "string" } },
      },
    });
    expect(schema).toEqual({
      type: "object",
      properties: {
        closed: { type: "object", additionalProperties: false, properties: { x: {} } },
        typed: { type: "object", additionalProperties: { type: "string" } },
      },
    });
  });

  it("빈 required 를 지우고 비어 있지 않은 required 는 순서까지 그대로 둔다", () => {
    const { schema } = normalizeSchema({
      type: "object",
      properties: { b: { type: "string" }, a: { type: "object", required: [] } },
      required: ["b", "a"],
    });
    expect(schema).toEqual({
      type: "object",
      properties: { b: { type: "string" }, a: { type: "object" } },
      required: ["b", "a"],
    });
  });

  it("빈 properties 는 지우되 additionalProperties:false 와 함께 있으면 남긴다", () => {
    const { schema } = normalizeSchema({
      type: "object",
      properties: {
        open: { type: "object", properties: {} },
        closed: { type: "object", properties: {}, additionalProperties: false },
      },
    });
    expect(schema).toEqual({
      type: "object",
      properties: {
        open: { type: "object" },
        closed: { type: "object", properties: {}, additionalProperties: false },
      },
    });
  });

  it("default·enum·const·pattern·format·minimum 을 건드리지 않는다", () => {
    const input = {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["a", "b"], default: "a" },
        kind: { const: "fixed" },
        code: { type: "string", pattern: "^[A-Z]{3}$", format: "iso-4217" },
        count: { type: "integer", minimum: 0, maximum: 10, exclusiveMinimum: -1 },
        // 데이터 값 안의 title·$comment 는 스키마 키워드가 아니라 사용자의 값이다.
        options: { type: "object", default: { title: "기본", $comment: "값" } },
      },
    };
    const { schema, changes } = normalizeSchema(input);
    expect(schema).toEqual(input);
    expect(changes).toEqual([]);
  });

  it("키 순서를 바꾸지 않는다", () => {
    const { schema } = normalizeSchema({
      type: "object",
      title: "지워질 키",
      required: ["z"],
      properties: { z: { type: "string" }, a: { type: "number" }, m: { type: "boolean" } },
      description: "끝",
    });
    expect(Object.keys(schema as object)).toEqual([
      "type",
      "required",
      "properties",
      "description",
    ]);
    expect(Object.keys((schema as { properties: object }).properties)).toEqual(["z", "a", "m"]);
  });

  it("루트 description 이 도구 description 과 같으면 루트 것을 지운다", () => {
    const same = normalizeTool(
      staged({
        name: "t",
        description: "Delete an item.",
        inputSchema: { type: "object", description: "  Delete an item.\n" },
      }),
    );
    expect(same.inputSchema).toEqual({ type: "object" });
    expect(same.changes).toEqual([
      {
        kind: "description-removed",
        path: "inputSchema.description",
        before: "  Delete an item.\n",
        reason: "duplicate-of-tool-description",
      },
    ]);

    const different = normalizeTool(
      staged({
        name: "t",
        description: "Delete an item.",
        inputSchema: { type: "object", description: "Arguments for deletion." },
      }),
    );
    expect(different.inputSchema).toEqual({
      type: "object",
      description: "Arguments for deletion.",
    });
    expect(different.changes).toEqual([]);
  });
});

describe("stripNoise (변환 B)", () => {
  it("도구 설명의 URL 을 괄호까지 지운다", () => {
    expect(
      cleanToolDescription(
        "Fetch an item (https://docs.example.com/items). See https://x.io/a now.",
      ),
    ).toBe("Fetch an item. See now.");
  });

  it("도구 설명의 'Example:' 이하를 지우되 'e.g.' 는 남긴다", () => {
    expect(
      cleanToolDescription("Search items, e.g. by label.\n\nExample: search({q: 'x'})\nmore"),
    ).toBe("Search items, e.g. by label.");
    expect(cleanToolDescription("Run it.   Twice\t\tnow.\n\n\n\nDone.")).toBe(
      "Run it. Twice now.\n\nDone.",
    );
  });

  it("파라미터 설명의 'e.g.' 이하는 지운다", () => {
    const out = stripNoise(
      staged({
        name: "t",
        description: "d",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search text, e.g.: 'foo bar'" },
            // 계획서 §3.2 B-2 의 정규식은 `e.g.` 뒤에 `[:.]` 를 한 번 더 요구한다.
            // 그래서 공백이 바로 오는 흔한 형태는 남는다. 정규식을 글자 그대로 따른 결과다.
            label: { type: "string", description: "Display label shown, e.g. 'red'" },
          },
        },
      }),
    );
    expect(propertiesOf(out).query).toEqual({ type: "string", description: "Search text," });
    expect(propertiesOf(out).label).toEqual({
      type: "string",
      description: "Display label shown, e.g. 'red'",
    });
    expect(out.changes).toEqual([
      {
        kind: "description-cleaned",
        path: "inputSchema.properties.query.description",
        before: "Search text, e.g.: 'foo bar'",
        after: "Search text,",
      },
    ]);
  });

  it("3단어 이하이고 이름을 포함하는 파라미터 설명을 지운다: database/'Database name'", () => {
    const out = stripNoise(
      staged({
        name: "t",
        description: "d",
        inputSchema: {
          type: "object",
          properties: { database: { type: "string", description: "Database name" } },
        },
      }),
    );
    expect(propertiesOf(out).database).toEqual({ type: "string" });
    expect(out.changes).toEqual([
      {
        kind: "description-removed",
        path: "inputSchema.properties.database.description",
        before: "Database name",
        reason: "restates-name",
      },
    ]);
  });

  it("4단어 이상이면 이름을 포함해도 남긴다: connection/'The connection to use'", () => {
    const out = stripNoise(
      staged({
        name: "t",
        description: "d",
        inputSchema: {
          type: "object",
          properties: { connection: { type: "string", description: "The connection to use" } },
        },
      }),
    );
    expect(propertiesOf(out).connection).toEqual({
      type: "string",
      description: "The connection to use",
    });
    expect(out.changes).toEqual([]);
  });

  it("$defs·items 안의 설명은 URL·예시만 지우고 이름 되풀이 판정은 하지 않는다", () => {
    const out = stripNoise(
      staged({
        name: "t",
        description: "d",
        inputSchema: {
          type: "object",
          properties: {
            tags: { type: "array", items: { type: "string", description: "Tags" } },
          },
          $defs: {
            Label: { type: "string", description: "Label (https://x.io/label). Example: 'red'" },
          },
        },
      }),
    );
    expect(out.inputSchema).toEqual({
      type: "object",
      properties: { tags: { type: "array", items: { type: "string", description: "Tags" } } },
      $defs: { Label: { type: "string", description: "Label." } },
    });
  });

  it("정리 후 빈 설명은 키를 지운다", () => {
    const out = stripNoise(
      staged({
        name: "t",
        description: "d",
        inputSchema: {
          type: "object",
          properties: { q: { type: "string", description: "  https://x.io/q  " } },
        },
      }),
    );
    expect(propertiesOf(out).q).toEqual({ type: "string" });
    expect(out.changes).toEqual([
      {
        kind: "description-removed",
        path: "inputSchema.properties.q.description",
        before: "  https://x.io/q  ",
        reason: "empty",
      },
    ]);
  });
});

describe("promoteCommonParameters (변환 C)", () => {
  const WS = { type: "string", description: "Workspace that owns the item being used." };

  it("같은 이름·같은 설명이 3개 이상 도구에 있으면 승격하고 각 도구에서 설명을 지운다", () => {
    const result = promoteCommonParameters(
      [toolWith("a", { ws: WS }), toolWith("b", { ws: WS }), toolWith("c", { ws: WS })],
      "",
    );
    expect(result.promoted).toEqual([{ name: "ws", description: WS.description }]);
    for (const tool of result.tools) {
      expect(propertiesOf(tool).ws).toEqual({ type: "string" });
      expect(tool.changes).toEqual([
        {
          kind: "description-removed",
          path: "inputSchema.properties.ws.description",
          before: WS.description,
          reason: "promoted",
        },
      ]);
    }
  });

  it("2개 도구에만 있으면 승격하지 않는다", () => {
    const result = promoteCommonParameters(
      [toolWith("a", { ws: WS }), toolWith("b", { ws: WS }), toolWith("c", {})],
      "",
    );
    expect(result.promoted).toEqual([]);
    expect(propertiesOf(result.tools[0] as StagedTool).ws).toEqual(WS);
  });

  it("설명 길이 20 미만은 승격하지 않는다", () => {
    const short = { type: "string", description: "Nineteen chars long" };
    expect(short.description).toHaveLength(19);
    const result = promoteCommonParameters(
      [toolWith("a", { s: short }), toolWith("b", { s: short }), toolWith("c", { s: short })],
      "",
    );
    expect(result.promoted).toEqual([]);
  });

  it("같은 이름이라도 설명이 다른 속성은 건드리지 않는다", () => {
    const other = { type: "string", description: "A different workspace description." };
    const result = promoteCommonParameters(
      [
        toolWith("a", { ws: WS }),
        toolWith("b", { ws: WS }),
        toolWith("c", { ws: WS }),
        toolWith("d", { ws: other }),
      ],
      "",
    );
    expect(result.promoted).toEqual([{ name: "ws", description: WS.description }]);
    expect(propertiesOf(result.tools[3] as StagedTool).ws).toEqual(other);
    expect(result.tools[3]?.changes).toEqual([]);
  });

  it("사전 항목 순서는 첫 등장 도구 순서다", () => {
    const zeta = { type: "string", description: "Zeta parameter shared by tools" };
    const alpha = { type: "string", description: "Alpha parameter shared by tools" };
    const result = promoteCommonParameters(
      [
        toolWith("a", { zeta }),
        toolWith("b", { alpha, zeta }),
        toolWith("c", { alpha, zeta }),
        toolWith("d", { alpha }),
      ],
      "",
    );
    expect(result.promoted.map((p) => p.name)).toEqual(["zeta", "alpha"]);
    expect(result.instructions).toBe(
      "Common parameters (shared by several tools):\n" +
        "- zeta: Zeta parameter shared by tools\n" +
        "- alpha: Alpha parameter shared by tools",
    );
  });

  it("원본 instructions 뒤에 빈 줄 하나를 두고 사전을 붙인다", () => {
    const result = promoteCommonParameters(
      [toolWith("a", { ws: WS }), toolWith("b", { ws: WS }), toolWith("c", { ws: WS })],
      "Line one.\nLine two.\n",
    );
    expect(result.instructions).toBe(
      "Line one.\nLine two.\n\nCommon parameters (shared by several tools):\n" +
        "- ws: Workspace that owns the item being used.",
    );
  });

  it("공통 파라미터가 없으면 instructions 를 원본 그대로 둔다", () => {
    const result = promoteCommonParameters([toolWith("a", { ws: WS })], "원본 그대로\n");
    expect(result.instructions).toBe("원본 그대로\n");
    expect(result.promoted).toEqual([]);
  });
});

describe("optimize (전체)", () => {
  it("synthetic 픽스처의 결과가 expected.overlay.json 과 바이트 단위로 같다", () => {
    // 기대 파일은 biome 이 들여쓰기를 다시 맞춘다. 그래서 파일 글자가 아니라 compact 직렬화를
    // 비교한다. JSON.parse 는 키 순서를 보존하므로 키 순서·값은 바이트 단위로 고정된다.
    const actual = JSON.stringify(optimize(syntheticInput(), VERSION));
    const expected = JSON.stringify(readJson<unknown>(fixture("synthetic.expected.overlay.json")));
    expect(actual).toBe(expected);
  });

  it("두 번 실행한 결과가 바이트 단위로 같다", () => {
    const first = JSON.stringify(optimize(syntheticInput(), VERSION));
    const second = JSON.stringify(optimize(syntheticInput(), VERSION));
    expect(second).toBe(first);
  });

  it("fixtures/tools-list.sample.json 을 넣으면 도구 수·이름·순서가 같다", () => {
    const { tools } = readJson<{ tools: ToolDef[] }>(repoFixture("tools-list.sample.json"));
    const overlay = optimize({ tools, instructions: "", otherCapabilities: [] }, VERSION);
    expect(overlay.tools.map((t) => t.name)).toEqual(tools.map((t) => t.name));
    expect(overlay.source.toolCount).toBe(tools.length);
  });

  it("outputSchema 를 깊은 비교로 그대로 둔다", () => {
    const input = syntheticInput();
    const overlay = optimize(input, VERSION);
    const original = input.tools.find((t) => t.name === "delete_item");
    const optimized = overlay.tools.find((t) => t.name === "delete_item");
    expect(original?.outputSchema).toBeDefined();
    expect(optimized?.outputSchema).toEqual(original?.outputSchema);
  });

  it("changes 에 모든 변경이 종류·경로와 함께 기록된다 (synthetic 의 기대 개수와 같다)", () => {
    const overlay = optimize(syntheticInput(), VERSION);
    const summary = overlay.tools.map((t) => [
      t.name,
      t.changes.map(
        (c) => `${c.kind} ${c.path}${c.kind === "schema-key-removed" ? `#${c.key}` : ""}`,
      ),
    ]);
    expect(summary).toEqual([
      [
        "get_item",
        [
          "schema-key-removed inputSchema#$schema",
          "schema-key-removed inputSchema#title",
          "schema-key-removed inputSchema.properties.id#title",
          "schema-key-removed inputSchema#required",
          "schema-key-removed inputSchema#additionalProperties",
          "description-cleaned description",
          "description-removed inputSchema.properties.id.description",
          "description-removed inputSchema.properties.workspaceId.description",
          "description-removed inputSchema.properties.note.description",
        ],
      ],
      [
        "list_items",
        [
          "description-cleaned inputSchema.properties.limit.description",
          "description-removed inputSchema.properties.workspaceId.description",
        ],
      ],
      [
        "update_item",
        [
          "schema-key-removed inputSchema.$defs.ItemPatch#title",
          "description-cleaned inputSchema.$defs.ItemPatch.description",
          "description-removed inputSchema.properties.workspaceId.description",
          "description-removed inputSchema.properties.note.description",
        ],
      ],
      [
        "delete_item",
        [
          "description-removed inputSchema.description",
          "description-removed inputSchema.properties.workspaceId.description",
          "description-removed inputSchema.properties.note.description",
        ],
      ],
      ["archive_item", ["description-removed inputSchema.properties.workspaceId.description"]],
    ]);
    expect(overlay.tools.flatMap((t) => t.changes)).toHaveLength(19);
    expect(overlay.totals.promotedParameters).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import type { JsonValue } from "../../src/api-types.js";
import { buildMockDefinition, serializeMockDefinition } from "../src/mock-builder/draft.js";
import { draftFromDefinition } from "../src/mock-builder/from-definition.js";

/** 손으로 쓴 파일 모양. 키 순서 · 기본값 명시 · 보존 키가 섞여 있다. */
const HANDWRITTEN = {
  $comment: "손으로 적은 메모",
  tools: [
    {
      name: "get_weather",
      description: "도시의 현재 날씨",
      inputSchema: {
        type: "object",
        required: ["city"],
        properties: { city: { type: "string" } },
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "search",
      inputSchema: { type: "object", properties: { filter: { type: "object" } } },
    },
  ],
  responses: [
    {
      tool: "get_weather",
      args: { city: "Seoul" },
      result: { temperature: 21.5 },
      isError: false,
      note: "녹화에서 가져옴",
    },
    { tool: "get_weather", result: { temperature: 0 } },
    { tool: "search", args: null, result: [], isError: true },
  ],
} as const;

/** 위 파일을 열어 손대지 않고 저장했을 때의 정규화된 모양. */
const NORMALIZED = {
  tools: [
    {
      name: "get_weather",
      description: "도시의 현재 날씨",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "search",
      inputSchema: { type: "object", properties: { filter: { type: "object" } } },
    },
  ],
  responses: [
    {
      tool: "get_weather",
      args: { city: "Seoul" },
      result: { temperature: 21.5 },
      note: "녹화에서 가져옴",
    },
    { tool: "get_weather", result: { temperature: 0 } },
    { tool: "search", args: null, result: [], isError: true },
  ],
  $comment: "손으로 적은 메모",
};

function saveBytes(definition: JsonValue): string {
  const built = buildMockDefinition(draftFromDefinition(definition));
  if (!built.ok) throw new Error(built.errors.join("\n"));
  return serializeMockDefinition(built.definition);
}

describe("draftFromDefinition", () => {
  const draft = draftFromDefinition(HANDWRITTEN);

  it("평면 스키마는 필드 폼으로, 아니면 JSON 모드로 연다", () => {
    expect(draft.tools[0]).toMatchObject({
      name: "get_weather",
      description: "도시의 현재 날씨",
      schemaMode: "fields",
      fields: [{ name: "city", type: "string", required: true }],
    });
    expect(draft.tools[1]).toMatchObject({
      name: "search",
      description: "",
      schemaMode: "json",
      fields: [],
      schemaJson: JSON.stringify(HANDWRITTEN.tools[1]?.inputSchema, null, 2),
    });
  });

  it("args 키가 없으면 인자 무관, null 이면 null 인자다", () => {
    expect(draft.responses.map((r) => [r.anyArgs, r.argsJson])).toEqual([
      [false, JSON.stringify({ city: "Seoul" }, null, 2)],
      [true, "{}"],
      [false, "null"],
    ]);
  });

  it("폼에 칸이 없는 키를 도구 · 응답 · 최상위에 보존한다. 불러온 응답은 녹화 응답이 아니다", () => {
    expect(draft.tools[0]?.extra).toEqual({ annotations: { readOnlyHint: true } });
    expect(draft.responses[0]?.extra).toEqual({ note: "녹화에서 가져옴" });
    expect(draft.extra).toEqual({ $comment: "손으로 적은 메모" });
    expect(draft.responses.every((r) => r.origin === "manual")).toBe(true);
  });

  it("문자열이 아닌 description 은 보존 키로 남긴다", () => {
    const odd = draftFromDefinition({
      tools: [{ name: "t", description: 42, inputSchema: { type: "object" } }],
    });
    expect(odd.tools[0]?.description).toBe("");
    expect(odd.tools[0]?.extra).toEqual({ description: 42 });
  });

  it("열어서 그대로 저장하면 정규화된 모양이 나오고, 두 번째부터는 바이트가 같다", () => {
    const first = saveBytes(HANDWRITTEN);
    expect(first).toBe(`${JSON.stringify(NORMALIZED, null, 2)}\n`);
    expect(saveBytes(JSON.parse(first) as JsonValue)).toBe(first);
  });
});

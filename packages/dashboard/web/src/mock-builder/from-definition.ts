import type { JsonValue } from "../../../src/api-types.js";
import type { MockDraft, ResponseDraft, ToolDraft } from "./draft.js";
import { type JsonObject, schemaToFields } from "./schema-fields.js";

/**
 * 목 정의 파일 → 폼 초안. 입력은 서버가 `assertMockDefinition` 으로 검증한 JSON 이다.
 * 그래도 모양을 믿고 캐스트만 하지 않는다 — 기대와 다른 값은 빈 값으로 두고 원래 키는
 * 보존 키로 남긴다. 사라지는 것이 없어야 저장했을 때 놀라지 않는다.
 *
 * 폼에 칸이 있는 키만 폼으로 옮기고 나머지는 전부 `extra` 다(설계 §기존 목 열기).
 */

const TOP_KEYS = ["tools", "responses"];
const RESPONSE_KEYS = ["tool", "args", "result", "isError"];

function asObject(value: JsonValue | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? (value as readonly JsonValue[]) : [];
}

/** `known` 에 없는 키만 원래 순서로. */
function without(object: JsonObject, known: readonly string[]): JsonObject {
  const extra: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(object)) {
    if (!known.includes(key)) extra[key] = value;
  }
  return extra;
}

const pretty = (value: JsonValue): string => JSON.stringify(value, null, 2);

function toToolDraft(tool: JsonObject): ToolDraft {
  const description = typeof tool.description === "string" ? tool.description : null;
  const known =
    description === null ? ["name", "inputSchema"] : ["name", "description", "inputSchema"];
  const inputSchema = tool.inputSchema ?? null;
  const flat = schemaToFields(inputSchema);
  return {
    name: typeof tool.name === "string" ? tool.name : "",
    description: description ?? "",
    schemaMode: flat.ok ? "fields" : "json",
    fields: flat.ok ? flat.fields : [],
    schemaJson: flat.ok ? "" : pretty(inputSchema),
    extra: without(tool, known),
  };
}

function toResponseDraft(response: JsonObject): ResponseDraft {
  // `"args": null` 은 인자가 null 인 응답이다. 키가 없을 때만 인자 무관이다.
  const hasArgs = Object.hasOwn(response, "args");
  return {
    tool: typeof response.tool === "string" ? response.tool : "",
    anyArgs: !hasArgs,
    argsJson: hasArgs ? pretty(response.args ?? null) : "{}",
    resultJson: pretty(response.result ?? null),
    isError: response.isError === true,
    // 파일에서 읽은 값은 어디서 왔는지 모른다. "녹화 때 가려지지 않는 자리" 라고 말하지 않는다.
    origin: "manual",
    extra: without(response, RESPONSE_KEYS),
  };
}

export function draftFromDefinition(definition: JsonValue): MockDraft {
  const top = asObject(definition);
  return {
    tools: asArray(top.tools).map((tool) => toToolDraft(asObject(tool))),
    responses: asArray(top.responses).map((response) => toResponseDraft(asObject(response))),
    extra: without(top, TOP_KEYS),
  };
}

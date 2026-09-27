import type { ToolDef } from "@mcpeak/core";
import type { ToolChange } from "./types.js";

/** 변환 단계 사이를 오가는 도구. 원본 모양에 지금까지 쌓인 변경 기록을 붙인 것이다. */
export interface StagedTool extends ToolDef {
  readonly changes: readonly ToolChange[];
}

export type JsonObject = Record<string, unknown>;

/** 계획서 §3.1: 검증에 쓰이지 않는 메타데이터·주석 키워드. 값과 무관하게 지운다. */
const META_KEYS: ReadonlySet<string> = new Set(["$schema", "$id", "$comment", "title"]);

/**
 * 값이 "이름 → 스키마" 사전인 키워드. 사전의 키는 속성 이름·정의 이름이라 계약이므로
 * 키워드로 취급하지 않고, 값 스키마에만 재귀한다(계획서 §3.1 "속성 이름은 계약이다").
 * `patternProperties`·`dependentSchemas` 는 §3.1 표에 없지만 같은 모양이라 함께 둔다.
 * 빼면 이름이 `title` 인 패턴 키가 메타 키로 오인돼 지워진다.
 */
export const NAME_MAP_KEYS: ReadonlySet<string> = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

/**
 * 값이 스키마가 아니라 사용자 데이터인 키워드. 안으로 들어가지 않는다. 계획서 §3.4 가
 * `default`·`enum`·`const` 의 변경을 금지하는데, 재귀하면 `default: { title: ... }` 같은 값의
 * `title` 이 메타 키로 오인돼 지워진다.
 */
export const DATA_KEYS: ReadonlySet<string> = new Set([
  "default",
  "enum",
  "const",
  "examples",
  "example",
]);

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function joinPath(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

/** 변환 A 가 이 키를 지워야 하는가. 게이트 A(§4)의 허용 차이 1~3과 같은 조건이다. */
export function isLosslessRemoval(key: string, value: unknown, parent: JsonObject): boolean {
  if (META_KEYS.has(key)) return true;
  if (key === "additionalProperties") return value === true;
  if (key === "required") return Array.isArray(value) && value.length === 0;
  if (key === "properties") {
    return (
      isJsonObject(value) &&
      Object.keys(value).length === 0 &&
      parent.additionalProperties !== false
    );
  }
  return false;
}

function normalizeNode(node: unknown, path: string, changes: ToolChange[]): unknown {
  if (Array.isArray(node)) {
    return node.map((item, index) => normalizeNode(item, joinPath(path, String(index)), changes));
  }
  if (!isJsonObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (isLosslessRemoval(key, value, node)) {
      changes.push({ kind: "schema-key-removed", path, key });
      continue;
    }
    if (DATA_KEYS.has(key)) {
      out[key] = value;
    } else if (NAME_MAP_KEYS.has(key) && isJsonObject(value)) {
      const map: JsonObject = {};
      const mapPath = joinPath(path, key);
      for (const [name, schema] of Object.entries(value)) {
        map[name] = normalizeNode(schema, joinPath(mapPath, name), changes);
      }
      out[key] = map;
    } else {
      out[key] = normalizeNode(value, joinPath(path, key), changes);
    }
  }
  return out;
}

/** 변환 A(계획서 §3.1). 순수 함수. 키 순서는 입력 순서를 유지한다. */
export function normalizeSchema(
  schema: unknown,
  path = "inputSchema",
): { schema: unknown; changes: ToolChange[] } {
  const changes: ToolChange[] = [];
  return { schema: normalizeNode(schema, path, changes), changes };
}

/** 변환 A 를 도구 하나에 적용한다. 루트 description 이 도구 description 과 같으면 루트 것을 지운다. */
export function normalizeTool(tool: StagedTool): StagedTool {
  const { schema, changes } = normalizeSchema(tool.inputSchema);
  let inputSchema = schema;
  if (
    isJsonObject(inputSchema) &&
    typeof inputSchema.description === "string" &&
    typeof tool.description === "string" &&
    inputSchema.description.trim() === tool.description.trim()
  ) {
    const { description, ...rest } = inputSchema;
    inputSchema = rest;
    changes.push({
      kind: "description-removed",
      path: "inputSchema.description",
      before: description as string,
      reason: "duplicate-of-tool-description",
    });
  }
  return { ...tool, inputSchema, changes: [...tool.changes, ...changes] };
}

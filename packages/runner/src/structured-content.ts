import type { ToolResult } from "@mcpeak/core";
import { plainObject, typeName } from "./schema-match.js";
import type { JsonValue } from "./spec/types.js";

export type StructuredContentExtractionFailure = {
  code: "RAW_NOT_OBJECT" | "MISSING" | "INVALID_JSON";
  actual: string;
};

export type StructuredContentExtraction =
  | { ok: true; value: JsonValue }
  | { ok: false; failure: StructuredContentExtractionFailure };

function isJsonValue(root: unknown): root is JsonValue {
  const ancestors = new Set<object>();
  const stack: { value: unknown; leave?: object }[] = [{ value: root }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current.leave !== undefined) {
      ancestors.delete(current.leave);
      continue;
    }
    const value = current.value;
    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (typeof value === "number" && Number.isFinite(value)) continue;
    if ((!Array.isArray(value) && !plainObject(value)) || typeof value !== "object") return false;
    if (Array.isArray(value) && Object.keys(value).length !== value.length) return false;
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    stack.push({ value: undefined, leave: value });
    for (const child of Object.values(value)) stack.push({ value: child });
  }
  return true;
}

/** 기존 content 본문 규칙과 섞지 않고 MCP 원본 응답의 structuredContent만 꺼낸다. */
export function extractStructuredContent(result: ToolResult): StructuredContentExtraction {
  if (!plainObject(result.raw))
    return {
      ok: false,
      failure: { code: "RAW_NOT_OBJECT", actual: typeName(result.raw) },
    };
  if (!Object.hasOwn(result.raw, "structuredContent"))
    return { ok: false, failure: { code: "MISSING", actual: "undefined" } };
  const value = result.raw.structuredContent;
  if (!isJsonValue(value))
    return { ok: false, failure: { code: "INVALID_JSON", actual: typeName(value) } };
  return { ok: true, value };
}

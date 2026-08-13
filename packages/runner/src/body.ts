import type { ToolResult } from "@ohmymcp/core";
import { plainObject, typeName } from "./schema-match.js";
import type { JsonValue } from "./spec/types.js";

export type BodyForm = "json" | "text";

export type BodyExtractionFailure =
  | { code: "CONTENT_NOT_ARRAY"; actual: string }
  | { code: "CONTENT_BLOCK_COUNT"; actual: number }
  | { code: "CONTENT_BLOCK_NOT_TEXT"; actual: string };

export type BodyExtraction =
  | { ok: true; body: JsonValue; form: BodyForm }
  | { ok: false; failure: BodyExtractionFailure };

/**
 * ToolResult에서 검사 대상 본문을 꺼낸다. 설계 문서 §5.1의 여섯 규칙 그대로다.
 * JSON 객체나 배열이면 구조로 보고, 그 외는 문자열로 본다.
 */
export function extractResponseBody(result: ToolResult): BodyExtraction {
  const content = result.content;
  if (!Array.isArray(content))
    return { ok: false, failure: { code: "CONTENT_NOT_ARRAY", actual: typeName(content) } };
  if (content.length !== 1)
    return { ok: false, failure: { code: "CONTENT_BLOCK_COUNT", actual: content.length } };

  const block = content[0];
  if (!plainObject(block) || block.type !== "text")
    return {
      ok: false,
      failure: {
        code: "CONTENT_BLOCK_NOT_TEXT",
        actual: plainObject(block) ? String(block.type) : typeName(block),
      },
    };
  if (typeof block.text !== "string")
    return {
      ok: false,
      failure: { code: "CONTENT_BLOCK_NOT_TEXT", actual: typeName(block.text) },
    };

  const text = block.text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: true, body: text, form: "text" };
  }
  // 스칼라는 구조로 해석하지 않는다. 설계 문서 §5.2.
  if (Array.isArray(parsed) || plainObject(parsed))
    return { ok: true, body: parsed as JsonValue, form: "json" };
  return { ok: true, body: text, form: "text" };
}

import type { ToolResult } from "@ohmymcp-hsu/core";
import { plainObject, typeName } from "./schema-match.js";
import type { JsonValue } from "./spec/types.js";

export type BodyForm = "json" | "text";

export type BodyExtractionFailure =
  | { code: "CONTENT_NOT_ARRAY"; actual: string }
  | { code: "CONTENT_BLOCK_COUNT"; actual: number }
  | { code: "CONTENT_BLOCK_NOT_TEXT"; actual: string }
  /** 블록 type은 text가 맞는데 text 필드가 없거나 문자열이 아닌 경우. */
  | { code: "CONTENT_TEXT_MISSING"; actual: string };

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
  // 여기까지 왔으면 블록 type은 text가 맞다. text 필드 문제를 블록 type 문제로 보고하면
  // 읽는 사람을 엉뚱한 필드로 보내므로 전용 코드를 쓴다.
  if (typeof block.text !== "string")
    return {
      ok: false,
      failure: { code: "CONTENT_TEXT_MISSING", actual: typeName(block.text) },
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

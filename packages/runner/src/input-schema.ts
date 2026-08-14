/**
 * 서버가 선언한 툴 입력 스키마를 우리가 이해하는 구조로 줄인다.
 *
 * 이 파일은 패키지 내부 전용이다. `index.ts` 로 내보내지 않는다. 여기 담긴 판단(부분 성공은
 * 없다, type 이 배열이면 그 필드를 통째로 포기한다)은 ADR-0015 의 결정이고 공개 API 가 되면
 * 고칠 수 없다.
 */

import { byCodeUnit } from "./ordering.js";
import { matchResponseSchema, plainObject } from "./schema-match.js";
import type { JsonValue, ResponseSchema } from "./spec/types.js";

export type DeclaredType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

export interface NormalizedField {
  /** 선언된 타입. 판정하지 않기로 한 필드는 null이다. */
  readonly type: DeclaredType | null;
  /** 선언된 enum. 없거나 판정하지 않기로 했으면 null이다. */
  readonly enumValues: readonly JsonValue[] | null;
}

export interface NormalizedInputSchema {
  readonly fields: ReadonlyMap<string, NormalizedField>;
  readonly required: readonly string[];
  /** additionalProperties가 정확히 false일 때만 true. */
  readonly rejectsUndeclared: boolean;
}

export interface InputSchemaAnalysis {
  /** 해석하지 못했으면 null 이다. 부분 성공은 없다. */
  readonly schema: NormalizedInputSchema | null;
  /** 해석을 포기한 사유. 해석했으면 null 이다. */
  readonly unanalyzableReason: string | null;
  /** 스키마는 읽었지만 요구할 근거를 못 만든 필드. 코드 단위 오름차순이다. */
  readonly unanalyzedFields: readonly string[];
}

/**
 * 이것이 하나라도 있으면 해석을 포기한다. 조합자·참조 계열은 "이 필드는 없어도 된다" 를
 * 말하고 있을 수 있고, 무시하면 스키마의 뜻이 뒤집혀 오탐이 된다. ADR-0015 참고.
 * 루트에 있으면 그 툴 전체를, 필드 안에 있으면 그 필드만 포기한다.
 */
const BLOCKING_KEYWORDS = [
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "$ref",
  "$dynamicRef",
  "patternProperties",
  "dependentSchemas",
  "dependentRequired",
  "propertyNames",
  "unevaluatedProperties",
] as const;

const DECLARED_TYPES = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
] as const;

const hasBlockingKeyword = (schema: Record<string, unknown>): boolean =>
  BLOCKING_KEYWORDS.some((keyword) => Object.hasOwn(schema, keyword));

const declaredType = (value: unknown): DeclaredType | null =>
  DECLARED_TYPES.includes(value as DeclaredType) ? (value as DeclaredType) : null;

/**
 * 서버가 선언한 임의의 JSON Schema 를 우리가 이해하는 구조로 줄인다.
 * 줄이면서 정보를 잃으면 그 부분의 검사를 포기한다. 부분 성공은 없고 해석 불가면 schema 가
 * null 이다. 설계 §4.2 · §4.3, ADR-0015.
 */
export function analyzeInputSchema(schema: unknown): InputSchemaAnalysis {
  const fail = (reason: string): InputSchemaAnalysis => ({
    schema: null,
    unanalyzableReason: reason,
    unanalyzedFields: [],
  });
  if (!plainObject(schema)) return fail("schema");
  // BLOCKING_KEYWORDS 배열 순서로 첫 것을 고른다. Object.keys 순서를 쓰면 사유가 흔들린다.
  const blocking = BLOCKING_KEYWORDS.find((keyword) => Object.hasOwn(schema, keyword));
  if (blocking !== undefined) return fail(blocking);
  // MCP 의 툴 입력은 객체지만 서버가 다르게 선언할 자유가 있다. 객체가 아니면 대조할 수 없다.
  if (schema.type !== "object") return fail("type");
  const properties = schema.properties;
  if (!plainObject(properties)) return fail("properties");

  const fields = new Map<string, NormalizedField>();
  const unanalyzedFields: string[] = [];
  for (const name of Object.keys(properties).sort(byCodeUnit)) {
    const field = properties[name];
    // 필드 스키마가 객체가 아니거나 차단 키워드를 쓰면 그 필드만 포기한다. required 검사는 계속한다.
    // type 이 배열이면(["string","null"]) 합집합이라 그 필드를 통째로 포기한다.
    // type 만 끄고 enum 을 남기면 { type: ["string","null"], enum: ["x"] } 에 3 을 넣었을 때
    // ENUM_MISMATCH 가 난다. 합집합의 다른 갈래가 그 값을 허용할 수 있으므로 오탐이다.
    if (!plainObject(field) || hasBlockingKeyword(field) || Array.isArray(field.type)) {
      fields.set(name, { type: null, enumValues: null });
      unanalyzedFields.push(name);
      continue;
    }
    const type = declaredType(field.type);
    const rawEnum = field.enum;
    const enumValues =
      Array.isArray(rawEnum) && rawEnum.length > 0 ? (rawEnum as readonly JsonValue[]) : null;
    fields.set(name, { type, enumValues });
    // type 도 enum 도 못 읽었으면 이 필드에는 요구할 근거가 없다. 축을 못 만드는 필드다.
    if (type === null && enumValues === null) unanalyzedFields.push(name);
  }

  const rawRequired = schema.required;
  const required = Array.isArray(rawRequired)
    ? rawRequired.filter((name): name is string => typeof name === "string")
    : [];

  return {
    schema: { fields, required, rejectsUndeclared: schema.additionalProperties === false },
    unanalyzableReason: null,
    unanalyzedFields,
  };
}

/**
 * 선언한 type 과 enum 판정을 schema-match.ts 에 위임한다. 두 벌을 두면 null·배열 판정과
 * 깊은 비교가 갈라진다. 위임하면 type 위반 시 enum 을 보지 않는 단락 순서까지 그대로 따른다.
 */
export function judgeField(
  field: NormalizedField,
  value: JsonValue,
): "TYPE_MISMATCH" | "ENUM_MISMATCH" | null {
  const probe: ResponseSchema = {};
  if (field.type !== null) probe.type = field.type;
  if (field.enumValues !== null) probe.enum = [...field.enumValues];
  if (probe.type === undefined && probe.enum === undefined) return null;

  const violation = matchResponseSchema(probe, value).violations[0];
  if (violation === undefined) return null;
  return violation.code === "TYPE_MISMATCH" ? "TYPE_MISMATCH" : "ENUM_MISMATCH";
}

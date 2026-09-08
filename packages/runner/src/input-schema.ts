/**
 * 서버가 선언한 툴 입력 스키마를 우리가 이해하는 구조로 줄인다.
 *
 * 이 파일은 패키지 내부 전용이다. `index.ts` 로 내보내지 않는다. 여기 담긴 판단(부분 성공은
 * 없다, type 이 배열이면 그 필드를 통째로 포기한다)은 ADR-0015 의 결정이고 공개 API 가 되면
 * 고칠 수 없다.
 */

import type { ContractRange } from "./contract-range.js";
import { readContractRange } from "./contract-range.js";
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
  /** 선언된 범위. 없거나 판정하지 않기로 했으면 null 이다. */
  readonly range: ContractRange | null;
  /**
   * nullable 형태(`anyOf`/`oneOf` 의 null 갈래 + 값 갈래 하나)를 풀어 읽은 필드인지.
   *
   * true 면 `null` 은 이 필드의 어떤 축도 어기지 않는다. 선언상 유효한 값이기 때문이다.
   * 이것을 안 들고 다니면 `{ note: null }` 을 TYPE_MISMATCH 로 잡는 오탐이 난다(#426).
   */
  readonly nullable: boolean;
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
 * nullable 형태만 푼 유효 필드 스키마. 그 형태가 아니면 null 이고 호출자가 종전대로 포기한다.
 *
 * **유니온 전반을 풀지 않는 이유.** `anyOf: [string, number]` 에서 첫 갈래의 타입 위반값 `0` 을
 * 둘째 갈래가 받아들이면, 우리가 만든 거절 기대 케이스에 서버가 정상 응답해 오탐이 된다.
 * ADR-0015 는 오탐 1건이 미탐 1건보다 비싸다고 정했다. 값 갈래가 정확히 하나일 때만 그런 자리가
 * 없다. 실측(#426)의 대상은 전부 Python 의 `Optional[X]`, 즉 `[X, { type: "null" }]` 이다.
 *
 * 값 갈래가 하나뿐이므로 `generate` 가 선언 순서 첫 성공 갈래를 고르는 규칙(ADR-0086)과 여기서
 * 고르는 갈래가 항상 같다. 두 패키지가 다른 스키마를 가정하는 자리가 생기지 않는다.
 */
function resolveNullableField(field: Record<string, unknown>): Record<string, unknown> | null {
  const present = BLOCKING_KEYWORDS.filter((keyword) => Object.hasOwn(field, keyword));
  const key = present[0];
  // 차단 키워드가 정확히 하나여야 한다. anyOf 와 oneOf 가 함께 있거나 다른 것이 섞이면 포기다.
  if (present.length !== 1 || (key !== "anyOf" && key !== "oneOf")) return null;

  const branches = field[key];
  if (!Array.isArray(branches) || branches.length < 2) return null;
  if (!branches.every((branch) => plainObject(branch))) return null;

  const valueBranches = branches.filter(
    (branch) => (branch as Record<string, unknown>).type !== "null",
  );
  // null 갈래가 없으면 풀지 않는다. 갈래 하나짜리 anyOf 를 굳이 풀 이유가 없고 규칙이 단순해진다.
  if (valueBranches.length !== 1 || valueBranches.length === branches.length) return null;

  const branch = valueBranches[0] as Record<string, unknown>;
  if (hasBlockingKeyword(branch) || Array.isArray(branch.type)) return null;

  const outer = { ...field };
  delete outer[key];
  // 값 갈래가 이긴다. 바깥에 남은 description 같은 키는 그대로 딸려 온다.
  return { ...outer, ...branch };
}

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
    const raw = properties[name];
    // nullable 형태면 값 갈래를 유효 스키마로 삼는다. 그 밖의 조합은 종전대로 포기한다(#426).
    const resolved = plainObject(raw) ? resolveNullableField(raw) : null;
    const field = resolved ?? raw;
    // 필드 스키마가 객체가 아니거나 차단 키워드를 쓰면 그 필드만 포기한다. required 검사는 계속한다.
    // type 이 배열이면(["string","null"]) 합집합이라 그 필드를 통째로 포기한다.
    // type 만 끄고 enum 을 남기면 { type: ["string","null"], enum: ["x"] } 에 3 을 넣었을 때
    // ENUM_MISMATCH 가 난다. 합집합의 다른 갈래가 그 값을 허용할 수 있으므로 오탐이다.
    if (!plainObject(field) || hasBlockingKeyword(field) || Array.isArray(field.type)) {
      fields.set(name, { type: null, enumValues: null, range: null, nullable: false });
      unanalyzedFields.push(name);
      continue;
    }
    const type = declaredType(field.type);
    const rawEnum = field.enum;
    const enumValues =
      Array.isArray(rawEnum) && rawEnum.length > 0 ? (rawEnum as readonly JsonValue[]) : null;
    // 범위 키워드는 BLOCKING_KEYWORDS 에 없어 지금까지 조용히 무시되고 있었다. 읽기만 한다.
    const range = readContractRange(field);
    fields.set(name, { type, enumValues, range, nullable: resolved !== null });
    // type 도 enum 도 범위도 못 읽었으면 이 필드에는 요구할 근거가 없다. 축을 못 만드는 필드다.
    if (type === null && enumValues === null && range === null) unanalyzedFields.push(name);
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
  if (nullSatisfiesField(field, value)) return null;
  const probe: ResponseSchema = {};
  if (field.type !== null) probe.type = field.type;
  if (field.enumValues !== null) probe.enum = [...field.enumValues];
  if (probe.type === undefined && probe.enum === undefined) return null;

  const violation = matchResponseSchema(probe, value).violations[0];
  if (violation === undefined) return null;
  return violation.code === "TYPE_MISMATCH" ? "TYPE_MISMATCH" : "ENUM_MISMATCH";
}

/**
 * `null` 이 이 필드의 선언을 지키는지. nullable 로 푼 필드에서만 참이다.
 *
 * 범위 판정은 `judgeField` 를 거치지 않고 따로 돌므로 그쪽도 이 함수를 봐야 한다. 손으로 쓴
 * 명세가 `{ note: null }` 을 보내는 것은 정당한 입력이고, 그것을 위반으로 잡으면 오탐이다.
 */
export const nullSatisfiesField = (field: NormalizedField, value: JsonValue): boolean =>
  value === null && field.nullable;

import type { JsonValue } from "../../../src/api-types.js";

/**
 * 목 만들기 폼의 평면 입력 필드. 중첩 object · array · enum 은 다루지 않는다 — 그런 스키마는
 * "JSON 으로 편집" 으로 넘긴다(설계 §화면 흐름). 평면 폼이 스키마의 일부를 조용히 버리면
 * 사용자는 저장한 목이 왜 인자를 다르게 검사하는지 알 수 없다. 그래서 되돌릴 때는
 * 옮길 수 없는 것이 하나라도 있으면 통째로 거절하고 이유를 준다.
 */
export type FieldType = "string" | "number" | "integer" | "boolean";

export const FIELD_TYPES: readonly FieldType[] = ["string", "number", "integer", "boolean"];

export interface FieldDraft {
  readonly name: string;
  readonly type: FieldType;
  readonly required: boolean;
}

export type JsonObject = { readonly [key: string]: JsonValue };

/** 필드 순서가 곧 properties 키 순서다. 같은 필드면 같은 바이트가 나온다. */
export function fieldsToSchema(fields: readonly FieldDraft[]): JsonObject {
  const properties: Record<string, JsonValue> = {};
  for (const field of fields) properties[field.name] = { type: field.type };
  const required = fields.filter((field) => field.required).map((field) => field.name);
  return required.length === 0
    ? { type: "object", properties }
    : { type: "object", properties, required };
}

export type FlattenResult =
  | { readonly ok: true; readonly fields: readonly FieldDraft[] }
  | { readonly ok: false; readonly reason: string };

const TOP_KEYS = new Set(["type", "properties", "required"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

/** 스키마를 평면 필드로 되돌린다. 하나라도 옮길 수 없으면 첫 이유를 준다. */
export function schemaToFields(schema: unknown): FlattenResult {
  if (!isRecord(schema) || schema.type !== "object") {
    return { ok: false, reason: '최상위 type 이 "object" 가 아닙니다.' };
  }
  for (const key of Object.keys(schema)) {
    if (!TOP_KEYS.has(key)) {
      return { ok: false, reason: `최상위 키 '${key}' 는 평면 폼에 자리가 없습니다.` };
    }
  }
  const properties = schema.properties ?? {};
  if (!isRecord(properties)) return { ok: false, reason: "properties 가 객체가 아닙니다." };
  const required = schema.required ?? [];
  if (!Array.isArray(required) || !required.every((name) => typeof name === "string")) {
    return { ok: false, reason: "required 가 문자열 배열이 아닙니다." };
  }
  const requiredNames = required as string[];
  for (const name of requiredNames) {
    // `in` 은 `toString` 같은 상속 키에 참이 된다. 자기 키만 본다.
    if (!Object.hasOwn(properties, name)) {
      return { ok: false, reason: `required 의 '${name}' 이(가) properties 에 없습니다.` };
    }
  }
  const fields: FieldDraft[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (!isRecord(property)) {
      return { ok: false, reason: `필드 '${name}' 의 정의가 객체가 아닙니다.` };
    }
    for (const key of Object.keys(property)) {
      if (key !== "type") {
        return {
          ok: false,
          reason: `필드 '${name}' 의 '${key}' 은(는) 평면 폼에 자리가 없습니다.`,
        };
      }
    }
    if (property.type === undefined) {
      return { ok: false, reason: `필드 '${name}' 에 type 이 없습니다.` };
    }
    if (!isFieldType(property.type)) {
      return {
        ok: false,
        reason: `필드 '${name}' 의 타입 ${JSON.stringify(property.type)} 은(는) 평면 폼이 다루지 않습니다 (string · number · integer · boolean 만).`,
      };
    }
    fields.push({ name, type: property.type, required: requiredNames.includes(name) });
  }
  return { ok: true, fields };
}

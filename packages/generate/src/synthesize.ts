import { fail, type JsonSchema, type JsonValue, plainObject, type SchemaType } from "./schema.js";

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index] as JsonValue))
    );
  }
  if (plainObject(left) && plainObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && jsonEqual(left[key] as JsonValue, right[key] as JsonValue),
      )
    );
  }
  return false;
}

function valueMatchesSchema(value: JsonValue, schema: JsonSchema): boolean {
  const type = schema.type as SchemaType;
  const typeMatches =
    type === "null"
      ? value === null
      : type === "array"
        ? Array.isArray(value)
        : type === "object"
          ? plainObject(value)
          : type === "integer"
            ? typeof value === "number" && Number.isInteger(value)
            : type === "number"
              ? typeof value === "number" && Number.isFinite(value)
              : typeof value === type;
  if (!typeMatches) return false;
  if ("const" in schema && !jsonEqual(value, schema.const as JsonValue)) return false;
  if (
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    !schema.enum.some((candidate) => jsonEqual(value, candidate as JsonValue))
  ) {
    return false;
  }
  if (type === "object" && plainObject(value)) {
    const properties = ("properties" in schema ? schema.properties : {}) as Record<
      string,
      JsonSchema
    >;
    const required = ("required" in schema ? schema.required : []) as string[];
    if (required.some((key) => !Object.hasOwn(value, key))) return false;
    return Object.keys(value).every(
      (key) =>
        !Object.hasOwn(properties, key) ||
        valueMatchesSchema(value[key] as JsonValue, properties[key] as JsonSchema),
    );
  }
  if (type === "array" && Array.isArray(value)) {
    return value.every((item) => valueMatchesSchema(item, schema.items as JsonSchema));
  }
  return true;
}

/** 검증된 JSON Schema에서 결정론적인 입력값 하나를 합성한다. */
export function synthesizeValue(schema: JsonSchema, path: string): JsonValue {
  let value: JsonValue;
  if ("const" in schema) value = schema.const as JsonValue;
  else if ("default" in schema) value = schema.default as JsonValue;
  else if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    value = schema.examples[0] as JsonValue;
  } else if (Array.isArray(schema.enum)) value = schema.enum[0] as JsonValue;
  else {
    switch (schema.type as SchemaType) {
      case "string":
        value = "example";
        break;
      case "number":
      case "integer":
        value = 0;
        break;
      case "boolean":
        value = true;
        break;
      case "null":
        value = null;
        break;
      case "array":
        value = [synthesizeValue(schema.items as JsonSchema, `${path}.items`)];
        break;
      case "object": {
        const properties = ("properties" in schema ? schema.properties : {}) as Record<
          string,
          JsonSchema
        >;
        const required = ("required" in schema ? schema.required : []) as string[];
        value = Object.fromEntries(
          required.map((key) => [
            key,
            synthesizeValue(properties[key] as JsonSchema, `${path}.properties.${key}`),
          ]),
        );
        break;
      }
    }
  }

  if (!valueMatchesSchema(value, schema)) {
    fail(
      "UNSUPPORTED_SCHEMA",
      path,
      `선택한 입력 후보가 스키마 제약을 만족하지 않습니다: ${path}`,
      "const, default, examples[0], enum[0] 또는 타입 제약을 확인하세요.",
    );
  }
  return value;
}

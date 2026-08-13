import type { ReadonlyJsonObject } from "../../src/index.js";
export interface SchemaEvaluationError {
  code: "INVALID_SCHEMA" | "UNRESOLVED_REF" | "ONE_OF_MATCH_COUNT" | "INSTANCE_MISMATCH";
  instancePath: string;
  schemaPath: string;
  message: string;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
/**
 * enum 후보 비교용 깊은 동등성. 이 평가기는 우리가 고정한 메타 스키마만 평가하고
 * $defs의 후보 값은 전부 문자열 리터럴이므로 JSON.stringify 비교로 충분하다.
 * const 판정은 기존 Object.is 동작을 유지한다.
 */
const deepEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
export function evaluateSchema(
  rootSchema: ReadonlyJsonObject,
  instance: unknown,
): { valid: boolean; errors: SchemaEvaluationError[] } {
  const errors: SchemaEvaluationError[] = [];
  const fail = (
    code: SchemaEvaluationError["code"],
    instancePath: string,
    schemaPath: string,
    message: string,
  ) => errors.push({ code, instancePath, schemaPath, message });
  const walk = (schema: unknown, value: unknown, ip: string, sp: string): boolean => {
    const entryErrorCount = errors.length;
    if (!record(schema)) {
      fail("INVALID_SCHEMA", ip, sp, "Schema must be an object.");
      return false;
    }
    if ("$ref" in schema) {
      if (
        Object.keys(schema).length !== 1 ||
        typeof schema.$ref !== "string" ||
        !schema.$ref.startsWith("#/$defs/")
      ) {
        fail("UNRESOLVED_REF", ip, sp, "Unsupported reference.");
        return false;
      }
      const name = schema.$ref.slice(8).replaceAll("~1", "/").replaceAll("~0", "~");
      const defs = rootSchema.$defs;
      if (!record(defs) || !(name in defs)) {
        fail("UNRESOLVED_REF", ip, sp, "Reference target was not found.");
        return false;
      }
      return walk(defs[name], value, ip, `#/$defs/${name}`);
    }
    const allowed = new Set([
      "oneOf",
      "type",
      "const",
      "enum",
      "maxLength",
      "required",
      "properties",
      "additionalProperties",
      "items",
      "minItems",
      "minLength",
      "pattern",
      "minimum",
      "maximum",
      "$schema",
      "$id",
      "$defs",
    ]);
    for (const key of Object.keys(schema))
      if (!allowed.has(key)) {
        fail("INVALID_SCHEMA", ip, sp, `Unsupported keyword: ${key}`);
        return false;
      }
    if (Array.isArray(schema.oneOf)) {
      let matches = 0;
      for (let i = 0; i < schema.oneOf.length; i++) {
        const before = errors.length;
        walk(schema.oneOf[i], value, ip, `${sp}/oneOf/${i}`);
        const branchErrors = errors.splice(before);
        const ok = branchErrors.length === 0;
        errors.push(
          ...branchErrors.filter(
            (error) => error.code === "INVALID_SCHEMA" || error.code === "UNRESOLVED_REF",
          ),
        );
        if (ok) matches++;
      }
      if (matches !== 1) {
        fail("ONE_OF_MATCH_COUNT", ip, sp, "oneOf must match exactly one branch.");
        return false;
      }
    }
    if ("const" in schema && !Object.is(value, schema.const)) {
      fail("INSTANCE_MISMATCH", ip, sp, "const mismatch");
      return false;
    }
    if (Array.isArray(schema.enum)) {
      const matched = schema.enum.some((candidate) => deepEqual(candidate, value));
      if (!matched) {
        fail("INSTANCE_MISMATCH", ip, sp, "enum mismatch");
        return false;
      }
    }
    if (typeof schema.type === "string") {
      const ok =
        schema.type === "null"
          ? value === null
          : schema.type === "array"
            ? Array.isArray(value)
            : schema.type === "object"
              ? record(value)
              : schema.type === "number"
                ? typeof value === "number" && Number.isFinite(value)
                : schema.type === "integer"
                  ? typeof value === "number" && Number.isInteger(value)
                  : typeof value === schema.type;
      if (!ok) {
        fail("INSTANCE_MISMATCH", ip, sp, "type mismatch");
        return false;
      }
    }
    if (Array.isArray(schema.required) && record(value))
      for (const key of schema.required)
        if (typeof key === "string" && !(key in value))
          fail("INSTANCE_MISMATCH", ip, sp, "required property missing");
    if (record(value) && record(schema.properties))
      for (const key of Object.keys(schema.properties))
        if (key in value)
          walk(schema.properties[key], value[key], `${ip}.${key}`, `${sp}/properties/${key}`);
    if (record(value) && schema.additionalProperties === false && record(schema.properties))
      for (const key of Object.keys(value))
        if (!(key in schema.properties))
          fail("INSTANCE_MISMATCH", `${ip}.${key}`, sp, "additional property");
    if (record(value) && record(schema.additionalProperties))
      for (const key of Object.keys(value))
        if (!record(schema.properties) || !(key in schema.properties))
          walk(
            schema.additionalProperties,
            value[key],
            `${ip}.${key}`,
            `${sp}/additionalProperties`,
          );
    if (Array.isArray(value) && schema.items !== undefined)
      value.forEach((item, i) => {
        walk(schema.items, item, `${ip}[${i}]`, `${sp}/items`);
      });
    if (
      Array.isArray(value) &&
      typeof schema.minItems === "number" &&
      value.length < schema.minItems
    )
      fail("INSTANCE_MISMATCH", ip, sp, "minItems mismatch");
    if (
      typeof value === "string" &&
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    )
      fail("INSTANCE_MISMATCH", ip, sp, "minLength mismatch");
    if (
      typeof value === "string" &&
      typeof schema.maxLength === "number" &&
      value.length > schema.maxLength
    )
      fail("INSTANCE_MISMATCH", ip, sp, "maxLength mismatch");
    if (
      typeof value === "string" &&
      typeof schema.pattern === "string" &&
      !new RegExp(schema.pattern).test(value)
    )
      fail("INSTANCE_MISMATCH", ip, sp, "pattern mismatch");
    if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum)
      fail("INSTANCE_MISMATCH", ip, sp, "minimum mismatch");
    if (typeof value === "number" && typeof schema.maximum === "number" && value > schema.maximum)
      fail("INSTANCE_MISMATCH", ip, sp, "maximum mismatch");
    return errors.length === entryErrorCount;
  };
  walk(rootSchema, instance, "$", "#");
  return { valid: errors.length === 0, errors };
}

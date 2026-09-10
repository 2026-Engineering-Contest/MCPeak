import type { ResponseSchema } from "@mcpeak/runner";
import { plainObject } from "./schema.js";

const IGNORED_ANNOTATIONS = new Set([
  "$schema",
  "$id",
  "$defs",
  "definitions",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
]);
const SUPPORTED = new Set([
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
]);
const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

export type OutputSchemaConversion =
  | { readonly supported: true; readonly schema: ResponseSchema }
  | { readonly supported: false; readonly path: string; readonly message: string };

const unsupported = (path: string, message: string): OutputSchemaConversion => ({
  supported: false,
  path,
  message,
});

function isJsonValue(root: unknown): boolean {
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

function convertNode(input: unknown, path: string): OutputSchemaConversion {
  if (!plainObject(input)) return unsupported(path, "출력 스키마가 객체가 아닙니다.");
  for (const key of Object.keys(input).sort()) {
    if (!SUPPORTED.has(key) && !IGNORED_ANNOTATIONS.has(key))
      return unsupported(
        `${path}.${key}`,
        `출력 계약 키워드 '${key}'는 의미를 보존해 변환할 수 없습니다.`,
      );
  }

  const output: ResponseSchema = {};
  if ("type" in input) {
    if (typeof input.type !== "string" || !TYPES.has(input.type))
      return unsupported(`${path}.type`, "출력 스키마 type은 지원하는 단일 타입이어야 합니다.");
    output.type = input.type as ResponseSchema["type"];
  }
  for (const key of ["const", "enum"] as const) {
    if (!(key in input)) continue;
    const value = input[key];
    if (!isJsonValue(value) || (key === "enum" && (!Array.isArray(value) || value.length === 0)))
      return unsupported(`${path}.${key}`, `'${key}'가 유효한 JSON 값 계약이 아닙니다.`);
    if (key === "const") output.const = value as ResponseSchema["const"];
    else output.enum = value as ResponseSchema["enum"];
  }
  if ("required" in input) {
    if (!Array.isArray(input.required) || input.required.some((value) => typeof value !== "string"))
      return unsupported(`${path}.required`, "required는 문자열 배열이어야 합니다.");
    output.required = [...input.required] as string[];
  }
  if ("properties" in input) {
    if (!plainObject(input.properties))
      return unsupported(`${path}.properties`, "properties는 스키마 객체의 맵이어야 합니다.");
    const properties: Record<string, ResponseSchema> = {};
    for (const key of Object.keys(input.properties).sort()) {
      const converted = convertNode(input.properties[key], `${path}.properties.${key}`);
      if (!converted.supported) return converted;
      properties[key] = converted.schema;
    }
    output.properties = properties;
  }
  if ("additionalProperties" in input) {
    if (typeof input.additionalProperties === "boolean")
      output.additionalProperties = input.additionalProperties;
    else {
      const converted = convertNode(input.additionalProperties, `${path}.additionalProperties`);
      if (!converted.supported) return converted;
      output.additionalProperties = converted.schema;
    }
  }
  if ("items" in input) {
    const converted = convertNode(input.items, `${path}.items`);
    if (!converted.supported) return converted;
    output.items = converted.schema;
  }
  for (const key of ["minItems", "minLength", "maxLength"] as const) {
    if (!(key in input)) continue;
    const value = input[key];
    if (!Number.isSafeInteger(value) || (value as number) < 0)
      return unsupported(`${path}.${key}`, `'${key}'는 0 이상의 안전한 정수여야 합니다.`);
    output[key] = value as number;
  }
  for (const key of ["minimum", "maximum"] as const) {
    if (!(key in input)) continue;
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value))
      return unsupported(`${path}.${key}`, `'${key}'는 유한한 수여야 합니다.`);
    output[key] = value;
  }

  const requiredTypes = new Map<string, readonly ResponseSchema["type"][]>([
    ["required", ["object"]],
    ["properties", ["object"]],
    ["additionalProperties", ["object"]],
    ["items", ["array"]],
    ["minItems", ["array"]],
    ["minLength", ["string"]],
    ["maxLength", ["string"]],
    ["minimum", ["number", "integer"]],
    ["maximum", ["number", "integer"]],
  ]);
  for (const [key, types] of requiredTypes) {
    if (key in input && (output.type === undefined || !types.includes(output.type)))
      return unsupported(
        `${path}.${key}`,
        `'${key}'의 의미를 보존하려면 type이 ${types.join(" 또는 ")}이어야 합니다.`,
      );
  }
  return { supported: true, schema: output };
}

/** Runner가 같은 의미로 재실행할 수 있는 출력 계약 부분집합만 변환한다. */
export function convertOutputSchema(input: unknown, path: string): OutputSchemaConversion {
  return convertNode(input, path);
}

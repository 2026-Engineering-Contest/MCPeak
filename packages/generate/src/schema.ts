export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;
export type SchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export type GenerateTestsErrorCode =
  | "INVALID_OPTIONS"
  | "INVALID_TOOL"
  | "UNSUPPORTED_SCHEMA"
  | "GENERATED_SUITE_INVALID";

/** 생성 전에 발견한 입력 또는 스키마 오류. */
export class GenerateTestsError extends Error {
  override readonly name = "GenerateTestsError";

  constructor(
    readonly code: GenerateTestsErrorCode,
    readonly path: string,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

const SCHEMA_TYPES = new Set<SchemaType>([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

const SUPPORTED_SCHEMA_KEYS = new Set([
  "type",
  "required",
  "properties",
  "items",
  "enum",
  "const",
  "default",
  "examples",
  // 설명용 annotation은 입력값 합성에 영향을 주지 않으므로 안전하게 무시한다.
  "description",
  "title",
]);

export const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function fail(
  code: GenerateTestsErrorCode,
  path: string,
  message: string,
  hint: string,
): never {
  throw new GenerateTestsError(code, path, message, hint);
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  type Frame = { value: unknown; path: string; leave?: object };
  const active = new Set<object>();
  const frames: Frame[] = [{ value, path }];

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    if (frame.leave !== undefined) {
      active.delete(frame.leave);
      continue;
    }

    const current = frame.value;
    if (current === null || typeof current === "string" || typeof current === "boolean") continue;
    if (typeof current === "number" && Number.isFinite(current)) continue;
    if (!Array.isArray(current) && !plainObject(current)) {
      fail(
        "UNSUPPORTED_SCHEMA",
        frame.path,
        `JSON으로 표현할 수 없는 스키마 값이 있습니다: ${frame.path}`,
        "문자열, 유한한 숫자, boolean, null, 배열 또는 일반 객체를 사용하세요.",
      );
    }
    if (active.has(current)) {
      fail(
        "UNSUPPORTED_SCHEMA",
        frame.path,
        `순환 참조가 있는 스키마 값은 생성할 수 없습니다: ${frame.path}`,
        "순환 참조를 제거하고 JSON 값으로 전달하세요.",
      );
    }

    active.add(current);
    frames.push({ value: undefined, path: frame.path, leave: current });
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) {
        if (!(index in current)) {
          fail(
            "UNSUPPORTED_SCHEMA",
            `${frame.path}[${index}]`,
            `비어 있는 배열 슬롯은 JSON 입력값으로 사용할 수 없습니다: ${frame.path}[${index}]`,
            "배열의 모든 위치에 JSON 값을 지정하세요.",
          );
        }
        frames.push({ value: current[index], path: `${frame.path}[${index}]` });
      }
    } else {
      const keys = Object.keys(current).sort().reverse();
      for (const key of keys) {
        frames.push({ value: current[key], path: `${frame.path}.${key}` });
      }
    }
  }
}

function schemaType(schema: JsonSchema, path: string): SchemaType {
  const type = schema.type;
  if (typeof type !== "string" || !SCHEMA_TYPES.has(type as SchemaType)) {
    return fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.type`,
      `지원하는 단일 JSON Schema type이 필요합니다: ${path}.type`,
      "string, number, integer, boolean, object, array, null 중 하나를 지정하세요.",
    );
  }
  return type as SchemaType;
}

export function validateSchema(
  schema: unknown,
  path: string,
  active: Set<object> = new Set(),
): asserts schema is JsonSchema {
  if (!plainObject(schema)) {
    fail(
      "UNSUPPORTED_SCHEMA",
      path,
      `스키마가 일반 객체가 아닙니다: ${path}`,
      "JSON Schema 객체를 전달하세요.",
    );
  }
  if (active.has(schema)) {
    fail(
      "UNSUPPORTED_SCHEMA",
      path,
      `순환 참조가 있는 스키마는 지원하지 않습니다: ${path}`,
      "$ref 대신 첫 버전이 지원하는 인라인 스키마를 사용하세요.",
    );
  }

  active.add(schema);
  try {
    const unsupported = Object.keys(schema)
      .filter((key) => !SUPPORTED_SCHEMA_KEYS.has(key))
      .sort()[0];
    if (unsupported !== undefined) {
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.${unsupported}`,
        `지원하지 않는 JSON Schema 키워드 '${unsupported}'가 있습니다.`,
        `첫 버전은 ${[...SUPPORTED_SCHEMA_KEYS].join(", ")}를 지원합니다.`,
      );
    }

    const type = schemaType(schema, path);
    validateAnnotations(schema, path);
    validateCandidates(schema, path);
    validateObjectKeywords(schema, type, path, active);
    validateArrayKeywords(schema, type, path, active);
  } finally {
    active.delete(schema);
  }
}

function validateAnnotations(schema: JsonSchema, path: string): void {
  for (const annotation of ["description", "title"] as const) {
    if (annotation in schema && typeof schema[annotation] !== "string") {
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.${annotation}`,
        `'${annotation}' annotation은 문자열이어야 합니다.`,
        `문자열 ${annotation}을 사용하거나 해당 필드를 제거하세요.`,
      );
    }
  }
}

function validateCandidates(schema: JsonSchema, path: string): void {
  for (const candidate of ["const", "default"] as const) {
    if (candidate in schema) assertJsonValue(schema[candidate], `${path}.${candidate}`);
  }
  for (const candidates of ["examples", "enum"] as const) {
    if (!(candidates in schema)) continue;
    const value = schema[candidates];
    if (!Array.isArray(value)) {
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.${candidates}`,
        `'${candidates}'는 배열이어야 합니다.`,
        `JSON 값 배열로 ${candidates}을 지정하세요.`,
      );
    }
    if (candidates === "enum" && value.length === 0) {
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.enum`,
        "빈 enum에서는 실행 가능한 값을 선택할 수 없습니다.",
        "enum에 한 개 이상의 JSON 값을 지정하세요.",
      );
    }
    assertJsonValue(value, `${path}.${candidates}`);
  }
}

function validateObjectKeywords(
  schema: JsonSchema,
  type: SchemaType,
  path: string,
  active: Set<object>,
): void {
  if (type !== "object") {
    if ("properties" in schema || "required" in schema) {
      const keyword = "properties" in schema ? "properties" : "required";
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.${keyword}`,
        `'${keyword}'는 object 스키마에서만 사용할 수 있습니다.`,
        `type을 object로 변경하거나 '${keyword}'를 제거하세요.`,
      );
    }
    return;
  }

  if ("items" in schema) {
    fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.items`,
      "object 스키마에는 items를 사용할 수 없습니다.",
      "items는 array 스키마에서만 사용하세요.",
    );
  }
  const properties = "properties" in schema ? schema.properties : {};
  if (!plainObject(properties)) {
    fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.properties`,
      "properties는 스키마 객체의 맵이어야 합니다.",
      "각 프로퍼티 이름에 JSON Schema 객체를 지정하세요.",
    );
  }
  for (const key of Object.keys(properties).sort()) {
    validateSchema(properties[key], `${path}.properties.${key}`, active);
  }

  const required = "required" in schema ? schema.required : [];
  if (!Array.isArray(required) || required.some((key) => typeof key !== "string")) {
    fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.required`,
      "required는 프로퍼티 이름 문자열의 배열이어야 합니다.",
      "필수 프로퍼티 이름만 required에 지정하세요.",
    );
  }
  const seen = new Set<string>();
  for (let index = 0; index < required.length; index++) {
    const key = required[index] as string;
    if (seen.has(key) || !(key in properties)) {
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.required[${index}]`,
        `필수 프로퍼티 '${key}'를 결정론적으로 생성할 수 없습니다.`,
        "required 이름을 중복 없이 properties에 선언하세요.",
      );
    }
    seen.add(key);
  }
}

function validateArrayKeywords(
  schema: JsonSchema,
  type: SchemaType,
  path: string,
  active: Set<object>,
): void {
  if (type === "array") {
    if (!("items" in schema)) {
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.items`,
        "array 입력값을 생성하려면 items 스키마가 필요합니다.",
        "생성할 배열 원소의 스키마를 items에 지정하세요.",
      );
    }
    validateSchema(schema.items, `${path}.items`, active);
  } else if ("items" in schema) {
    fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.items`,
      "items는 array 스키마에서만 사용할 수 있습니다.",
      "type을 array로 변경하거나 items를 제거하세요.",
    );
  }
}

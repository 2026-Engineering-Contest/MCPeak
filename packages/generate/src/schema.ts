import { compositionKey, expandComposition } from "./composition.js";
import { assertConstraints } from "./constraints.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;
export type SchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export type GenerateTestsErrorCode =
  | "INVALID_OPTIONS"
  | "INVALID_TOOL"
  | "OUTPUT_FILE_EXISTS"
  | "UNSUPPORTED_SCHEMA"
  | "INVALID_SCHEMA_CONSTRAINT" // 제약 키워드의 값이 깨졌거나 서로 모순이다
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
  // 방언 선언용 annotation. 값이 무엇이든 합성될 입력이 달라지지 않으므로 위 둘과 같은 범주다.
  // TypeScript SDK가 zod에서 스키마를 뽑을 때 기본으로 붙이므로, 이 키를 막으면 그 SDK로 만든
  // 서버의 툴이 통째로 거절된다. 순서 주의 — hint 문자열이 이 Set의 삽입 순서로 만들어진다.
  "$schema",
  // 제약 키워드. 값은 assertConstraints 가 따로 검증한다(ADR-0004 개정, 설계서 §3.1).
  // 위 annotation 들 뒤에 붙인다. 사이에 끼우면 "description, title, $schema" 표기가 끊긴다.
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "format",
  // 값이 boolean 이거나 스키마 객체면 받는다. 우리는 선언 밖 프로퍼티를 만들지 않으므로 객체
  // 형태의 값 안쪽 키워드는 합성값을 바꾸지 않는다(설계 §5.1). 후보 검사에만 쓴다.
  "additionalProperties",
  // 키의 제약이다. 값의 스키마인 additionalProperties 와 짝이라 붙여 둔다. 우리는 선언된 키만
  // 만들므로 합성값에 영향이 없고, 후보값의 선언 밖 키 이름을 검사할 때만 쓴다(ADR-0087).
  "propertyNames",
  // 값 검증은 assertConstraints 가, 값 합성은 pattern.ts 가 한다(설계 §5.2).
  "pattern",
  // 조합·참조 키워드. 해석은 composition.ts 가 한다(설계 §5.3).
  // $defs · definitions 안의 스키마는 **참조될 때만** 검증한다. 참조되지 않는 정의에 미지원
  // 키워드가 있어도 합성값과 무관하다.
  "$ref",
  "$defs",
  "definitions",
  "anyOf",
  "oneOf",
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
  root: JsonSchema = schema as JsonSchema,
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
        `지원하는 키워드: ${[...SUPPORTED_SCHEMA_KEYS].join(", ")}. 그 밖의 키워드가 있는 툴은 건너뛰고 나머지 툴을 생성합니다.`,
      );
    }

    // 조합 키는 미지원 키워드 검사 뒤, type 검사 앞이다. $ref 만 든 스키마에는 type 이 없다.
    if (compositionKey(schema) !== null) {
      validateComposition(schema, path, active, root);
      return;
    }

    const type = schemaType(schema, path);
    validateAnnotations(schema, path);
    // 미지원 키워드 검사보다 뒤, 후보 검사보다 앞이다. 깨진 제약을 들고 값을 고르면
    // "후보가 제약을 만족하지 않는다" 로 잘못 보고된다.
    assertConstraints(schema, path);
    validateCandidates(schema, path);
    validateObjectKeywords(schema, type, path, active, root);
    validateArrayKeywords(schema, type, path, active, root);
  } finally {
    active.delete(schema);
  }
}

/**
 * 조합 키를 한 겹 풀고 유효 스키마를 검증한다.
 *
 * 활성 집합에는 `$ref` 로 해석한 **대상 객체**를 넣는다. 병합 결과는 매번 새 객체라 동일성으로
 * 잡을 수 없다. 이미 활성인 대상은 조용히 건너뛴다. 그 대상은 스택 위에서 검증 중이고, 여기
 * 도달하는 순환은 선택 필드에 든 재귀(zod 의 `kids`)라 툴이 살아남아야 한다. 합성 쪽은 필수
 * 경로만 따라가므로 같은 자리에서 거절한다(설계 §5.3).
 */
function validateComposition(
  schema: JsonSchema,
  path: string,
  active: Set<object>,
  root: JsonSchema,
): void {
  const key = compositionKey(schema);
  const expanded = expandComposition(schema, root, path);
  if (key === "$ref") {
    for (const one of expanded) {
      if (one.target !== null && active.has(one.target)) continue;
      if (one.target === null) {
        validateSchema(one.schema, one.path, active, root);
        continue;
      }
      active.add(one.target);
      try {
        validateSchema(one.schema, one.path, active, root);
      } finally {
        active.delete(one.target);
      }
    }
    return;
  }

  // 갈래 하나라도 통과하면 그 툴은 살아 있다. 우리가 못 읽는 갈래가 섞여 있을 뿐이다.
  let firstError: GenerateTestsError | null = null;
  for (const branch of expanded) {
    try {
      validateSchema(branch.schema, branch.path, active, root);
      return;
    } catch (error) {
      // 깨진 선언(INVALID_SCHEMA_CONSTRAINT)은 갈래 단위로 삼키지 않는다. 삼키면 그 툴이
      // 조용히 다른 갈래로 넘어가고 사용자는 자기 선언이 모순이라는 사실을 영영 못 본다.
      if (!(error instanceof GenerateTestsError) || error.code !== "UNSUPPORTED_SCHEMA")
        throw error;
      firstError ??= error;
    }
  }
  failAllBranches(schema, key as "anyOf" | "oneOf", path, firstError);
}

/** 문안 7. 갈래 수는 **선언된** 개수다. 병합에서 빠진 갈래도 사용자에게는 갈래다. */
export function failAllBranches(
  schema: JsonSchema,
  key: "anyOf" | "oneOf",
  path: string,
  firstError: GenerateTestsError | null,
): never {
  const declared = Array.isArray(schema[key]) ? (schema[key] as unknown[]).length : 0;
  const cause = firstError?.message ?? "만들 수 있는 값이 없습니다.";
  return fail(
    "UNSUPPORTED_SCHEMA",
    `${path}.${key}`,
    `'${key}' 의 갈래 ${declared}개를 모두 생성할 수 없습니다: ${path}.${key}. 첫 원인: ${cause}`,
    firstError?.hint ?? "갈래 중 하나는 지원하는 키워드만 쓰도록 선언하세요.",
  );
}

function validateAnnotations(schema: JsonSchema, path: string): void {
  for (const annotation of ["description", "title", "$schema"] as const) {
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
  root: JsonSchema,
): void {
  // object 가 아닌 type 에 붙어 있어도 거절하지 않는다. 뜻이 없을 뿐 합성값이 달라지지 않아
  // annotation 과 같은 범주다. 값 형식만 본다(설계 §5.1).
  if ("additionalProperties" in schema) {
    const additional = schema.additionalProperties;
    if (typeof additional !== "boolean" && !plainObject(additional)) {
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.additionalProperties`,
        `'additionalProperties' 는 boolean 또는 스키마 객체여야 합니다: ${path}.additionalProperties`,
        "false, true 또는 JSON Schema 객체를 지정하세요.",
      );
    }
  }
  // propertyNames 도 값 형식만 본다. 안쪽은 validateSchema 로 검증하지 않는다. 우리가 그 키를
  // 만들지 않아 합성값에 영향이 없고, 검증하면 쓰지도 않는 선언의 모순 제약이
  // INVALID_SCHEMA_CONSTRAINT 로 전체 생성을 중단시킨다(ADR-0087, ADR-0086 과 같은 근거).
  if ("propertyNames" in schema && !plainObject(schema.propertyNames)) {
    fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.propertyNames`,
      `'propertyNames' 는 스키마 객체여야 합니다: ${path}.propertyNames`,
      "키 이름에 적용할 JSON Schema 객체를 지정하세요.",
    );
  }

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
    validateSchema(properties[key], `${path}.properties.${key}`, active, root);
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
    if (seen.has(key) || !Object.hasOwn(properties, key)) {
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
  root: JsonSchema,
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
    validateSchema(schema.items, `${path}.items`, active, root);
  } else if ("items" in schema) {
    fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.items`,
      "items는 array 스키마에서만 사용할 수 있습니다.",
      "type을 array로 변경하거나 items를 제거하세요.",
    );
  }
}

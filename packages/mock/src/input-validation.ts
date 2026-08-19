/**
 * 호출 인자를 툴의 `inputSchema` 로 검사하는 계층. ADR-0048.
 *
 * `index.ts` 에서 떼어낸 이유는 `key-violation.ts` 와 같다 — 테스트가 판정 함수를 직접
 * 부르려면 export 가 필요한데 `index.ts` 는 패키지 진입점이라 그것이 곧 공개 API 가 된다.
 *
 * `runner` 의 `checkInputContract` 와 **의미론을 맞추되 import 하지 않는다.** 의존 방향이
 * `mock → core` 만 허용하기 때문이다. 갈릴 위험은 ADR-0048 의 "결과" 에 적어 두었다.
 *
 * 검사 축은 넷이다 — `required` · `type` · `enum` · `range`. `generate` 의 `buildViolationCases`
 * 가 만드는 축이 정확히 이 넷이고, JSON Schema 평가기를 들이면 의존성 원칙이 흔들린다.
 * **최상위 필드만 본다.** 중첩 객체와 배열 원소 내부는 어떤 스키마에서도 검사하지 않는다.
 */

/** 인자가 `inputSchema` 를 어긴 지점 하나. 판별 유니온이라 문장이 쓰는 필드가 kind 마다 정해진다. */
export type SchemaViolation =
  | { kind: "requiredMissing"; field: string }
  | { kind: "typeMismatch"; field: string; declared: string; found: string }
  | { kind: "enumMismatch"; field: string; allowed: readonly unknown[]; found: unknown }
  | { kind: "rangeMismatch"; field: string; keyword: RangeKeyword; limit: number; found: number };

/** `found` 가 값 그 자체인 것과 길이·개수인 것이 갈린다. 문장 함수가 이것으로 구분한다. */
export type RangeKeyword =
  | "minimum"
  | "maximum"
  | "exclusiveMinimum"
  | "exclusiveMaximum"
  | "minLength"
  | "maxLength"
  | "minItems"
  | "maxItems";

/**
 * 이것이 있으면 스키마의 뜻을 우리가 못 읽는다. ADR-0015 와 같은 목록이다.
 *
 * 우리가 못 읽은 키워드가 바로 "이 필드는 없어도 된다" 를 말하고 있을 수 있고, 무시하면
 * 스키마의 뜻이 뒤집혀 정상 호출을 거절하게 된다. 오탐 1건이 미탐 1건보다 비싸다.
 */
const UNREADABLE_KEYWORDS = ["anyOf", "oneOf", "allOf", "not", "$ref", "if"] as const;

/** plain object 인가. 배열과 null 을 거른다. */
function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 툴 전체의 인자 검사를 건너뛰는 이유. 해석 가능하면 `undefined`.
 *
 * 서버를 띄울 때 이 문장을 stderr 로 한 번 고지한다. 목에는 `runner` 의
 * `SCHEMA_NOT_ANALYZABLE` 같은 finding 채널이 없고, stdout 은 stdio 트랜스포트의
 * JSON-RPC 채널이라 쓸 수 없다.
 */
export function unanalyzableReason(inputSchema: unknown): string | undefined {
  if (!plainObject(inputSchema)) return "inputSchema 가 객체가 아닙니다";

  const declared = inputSchema.type;
  // type 생략은 JSON Schema 에서 흔하다. 그것까지 포기하면 미탐이 지나치게 넓어진다.
  // 배열 type("object" 이거나 "null")은 어느 쪽으로 읽어야 할지 정보가 없어 포기한다.
  if (Array.isArray(declared)) return "루트 type 이 배열입니다";
  if (declared !== undefined && declared !== "object") {
    return `루트 type 이 "object" 가 아닙니다 (${String(declared)})`;
  }

  const found = UNREADABLE_KEYWORDS.filter((keyword) => keyword in inputSchema);
  if (found.length > 0) return `해석할 수 없는 키워드: ${found.join(", ")}`;
  return undefined;
}

/** 선언 type 을 지키는 값인가. 모르는 type 은 침묵한다 — 우리가 못 읽은 것으로 거절하지 않는다. */
function matchesType(declared: string, value: unknown): boolean {
  switch (declared) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return plainObject(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

/** 문장에 넣을 JSON 타입 이름. 수는 정수·소수를 가리지 않고 "number" 다 — 선언 쪽이 이미 말한다. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * 범위 위반 하나. 없으면 `undefined`.
 *
 * 제약은 그 타입의 값에만 적용한다 — `minLength` 가 걸린 필드에 배열이 와도 길이를 재지 않는다.
 * 타입이 어긋난 것은 type 축이 볼 일이고, 두 축이 같은 값을 두고 다른 문장을 내면 모순으로 읽힌다.
 *
 * 문자열 길이는 **코드 포인트**로 센다. `String.length` 는 UTF-16 단위라 "😀" 를 2 로 세고,
 * 그러면 `maxLength: 1` 을 지킨 값을 거절하는 오탐이 된다. JSON Schema 의 length 는 문자 수다.
 */
function rangeViolation(
  field: string,
  fieldSchema: Record<string, unknown>,
  value: unknown,
): SchemaViolation | undefined {
  const limit = (keyword: RangeKeyword): number | undefined => {
    const raw = fieldSchema[keyword];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  };
  const at = (keyword: RangeKeyword, bound: number, found: number): SchemaViolation => ({
    kind: "rangeMismatch",
    field,
    keyword,
    limit: bound,
    found,
  });

  if (typeof value === "number" && Number.isFinite(value)) {
    const min = limit("minimum");
    if (min !== undefined && value < min) return at("minimum", min, value);
    const max = limit("maximum");
    if (max !== undefined && value > max) return at("maximum", max, value);
    const exMin = limit("exclusiveMinimum");
    if (exMin !== undefined && value <= exMin) return at("exclusiveMinimum", exMin, value);
    const exMax = limit("exclusiveMaximum");
    if (exMax !== undefined && value >= exMax) return at("exclusiveMaximum", exMax, value);
    return undefined;
  }

  if (typeof value === "string") {
    const length = [...value].length;
    const min = limit("minLength");
    if (min !== undefined && length < min) return at("minLength", min, length);
    const max = limit("maxLength");
    if (max !== undefined && length > max) return at("maxLength", max, length);
    return undefined;
  }

  if (Array.isArray(value)) {
    const min = limit("minItems");
    if (min !== undefined && value.length < min) return at("minItems", min, value.length);
    const max = limit("maxItems");
    if (max !== undefined && value.length > max) return at("maxItems", max, value.length);
  }
  return undefined;
}

/**
 * 필드 하나의 위반. **type → enum → range 중 첫 하나만** 낸다 (ADR-0048 §5).
 *
 * 타입이 어긋난 값에 enum 포함 여부나 범위를 따지는 것은 의미가 없고, 문장이 서로 모순돼 보인다.
 */
function fieldViolation(
  field: string,
  fieldSchema: Record<string, unknown>,
  value: unknown,
): SchemaViolation | undefined {
  const declared = fieldSchema.type;
  if (typeof declared === "string" && !matchesType(declared, value)) {
    return { kind: "typeMismatch", field, declared, found: jsonTypeOf(value) };
  }

  const allowed = fieldSchema.enum;
  // enum 에 객체·배열이 섞이면 동등 비교 규칙을 여기서 정해야 하는데, 정하면 오탐이 난다.
  // 그런 enum 은 실제로 거의 없으므로 침묵한다.
  if (
    Array.isArray(allowed) &&
    allowed.every((member) => member === null || typeof member !== "object") &&
    !allowed.includes(value)
  ) {
    return { kind: "enumMismatch", field, allowed, found: value };
  }

  return rangeViolation(field, fieldSchema, value);
}

/**
 * 인자가 스키마를 어긴 지점 전량. 어기지 않았거나 스키마를 해석할 수 없으면 빈 배열.
 *
 * 던지지 않는 순수 함수다 — 판정과 문장을 분리해야 판정을 테스트로 전량 고정할 수 있다.
 * `key-violation.ts` 의 `findKeyViolation` 과 같은 형태다.
 *
 * 순서는 ADR-0048 §5 로 고정한다. `required` 누락 전부(선언 순서) → `properties` 선언 순서로
 * 필드당 한 건. 결정론성 때문에 못 박는다.
 */
export function findSchemaViolations(
  inputSchema: unknown,
  args: unknown,
): readonly SchemaViolation[] {
  if (unanalyzableReason(inputSchema) !== undefined) return [];
  const schema = inputSchema as Record<string, unknown>;
  // 인자 생략은 빈 객체와 같다. lookup 의 `args ?? {}` 와 같은 규칙이다.
  const values = plainObject(args) ? args : {};
  const violations: SchemaViolation[] = [];

  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const name of required) {
    // required 는 키의 존재만 본다. 값이 null 이어도 있는 것이다.
    if (typeof name === "string" && !Object.hasOwn(values, name)) {
      violations.push({ kind: "requiredMissing", field: name });
    }
  }

  const properties = plainObject(schema.properties) ? schema.properties : {};
  for (const [name, fieldSchema] of Object.entries(properties)) {
    if (!Object.hasOwn(values, name)) continue; // 없는 것은 required 검사가 본다
    if (!plainObject(fieldSchema)) continue;
    // 필드에 조합자가 있으면 그 필드만 건너뛴다. 나머지 필드와 required 검사는 계속한다.
    if (UNREADABLE_KEYWORDS.some((keyword) => keyword in fieldSchema)) continue;
    // 필드 type 이 배열이면 루트와 같은 규칙으로 그 필드를 통째로 포기한다. 타입 축만 빼고
    // enum·range 를 계속 보면 반쯤 검사된 필드가 남아 "못 읽으면 침묵" 규칙이 갈린다.
    if (Array.isArray(fieldSchema.type)) continue;
    const found = fieldViolation(name, fieldSchema, values[name]);
    if (found !== undefined) violations.push(found);
  }
  return violations;
}

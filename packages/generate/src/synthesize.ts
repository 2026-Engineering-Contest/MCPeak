import {
  FORMAT_VALUES,
  integerLowerBound,
  integerUpperBound,
  isKnownFormat,
} from "./constraints.js";
import { fail, type JsonSchema, type JsonValue, plainObject, type SchemaType } from "./schema.js";

/** 제약이 없을 때 문자열에 넣는 값. 종전과 같다. */
const PLACEHOLDER_STRING = "example";

/** 선언된 숫자 제약을 읽는다. 값 검증은 assertConstraints 가 이미 끝냈다. */
const numberAt = (schema: JsonSchema, key: string): number | null =>
  typeof schema[key] === "number" && Number.isFinite(schema[key]) ? (schema[key] as number) : null;

/** 표에 있는 format 이면 그 값. 아니면 null. */
function knownFormatValue(schema: JsonSchema): string | null {
  const format = schema.format;
  if (typeof format !== "string" || !isKnownFormat(format)) return null;
  return FORMAT_VALUES.get(format) as string;
}

/**
 * 하한 경계값을 고른다. **하한이 상한보다 우선한다.**
 *
 * 중간값을 쓰지 않는 이유: 한쪽 경계만 선언된 경우(`minimum: 1` 만 있고 상한 없음)에 규칙이
 * 정의되지 않는다. `+1` 인지 `+100` 인지 근거가 없고, 근거 없는 매직넘버는 나중에 아무도 못
 * 고친다. 하한 규칙은 어느 조합에서도 정의된다.
 *
 * `exclusive` 는 정수 단위로 한 칸 옮긴다. 임의의 엡실론은 부동소수 재현성이 나쁘다. 그 한 칸이
 * 상한을 넘는 좁은 범위만 예외로 중점을 쓴다(`steppedFromExclusiveMinimum`).
 */
function boundedNumber(schema: JsonSchema, type: SchemaType): number {
  const minimum = numberAt(schema, "minimum");
  const maximum = numberAt(schema, "maximum");
  const exclusiveMinimum = numberAt(schema, "exclusiveMinimum");
  const exclusiveMaximum = numberAt(schema, "exclusiveMaximum");
  if (type === "integer") {
    const lower = integerLowerBound(minimum, exclusiveMinimum);
    if (lower !== null) return lower;
    const upper = integerUpperBound(maximum, exclusiveMaximum);
    return upper ?? 0;
  }
  if (minimum !== null) return minimum;
  if (exclusiveMinimum !== null)
    return steppedFromExclusiveMinimum(exclusiveMinimum, maximum, exclusiveMaximum);
  if (maximum !== null) return maximum;
  if (exclusiveMaximum !== null) return exclusiveMaximum - 1;
  return 0;
}

/**
 * `exclusiveMinimum` 만 하한일 때의 값. 기본은 한 칸 옮긴 `+1` 이다.
 *
 * 그 값이 상한을 넘으면 두 경계의 중점을 쓴다. `0 < x < 1` 은 확률·비율 파라미터에서 흔한
 * 선언인데 `+1` 이 곧 상한 위반이라, 우리가 만든 값이 우리 검사에 걸려 `UNSUPPORTED_SCHEMA`
 * 로 툴 전체가 건너뛰어졌다. 중점은 두 경계가 다 선언된 경우에만 쓰므로 규칙이 정의되지
 * 않는 자리가 없고, 경계에서만 유도되므로 매직넘버가 아니다.
 */
function steppedFromExclusiveMinimum(
  exclusiveMinimum: number,
  maximum: number | null,
  exclusiveMaximum: number | null,
): number {
  const stepped = exclusiveMinimum + 1;
  const fits =
    (maximum === null || stepped <= maximum) &&
    (exclusiveMaximum === null || stepped < exclusiveMaximum);
  if (fits) return stepped;
  // assertNoContradiction 이 exclusiveMinimum < 두 상한 을 이미 보장한다. 중점은 항상 안쪽이다.
  const bounds: number[] = [];
  if (maximum !== null) bounds.push(maximum);
  if (exclusiveMaximum !== null) bounds.push(exclusiveMaximum);
  return (exclusiveMinimum + Math.min(...bounds)) / 2;
}

/**
 * 길이 제약을 지키는 문자열. `"example"`(7자)에서 시작해 모자라면 `"x"` 로 늘리고 넘치면
 * 앞에서 자른다. `minLength > maxLength` 는 assertConstraints 가 이미 거절했다.
 */
function boundedString(schema: JsonSchema): string {
  const minLength = numberAt(schema, "minLength");
  const maxLength = numberAt(schema, "maxLength");
  let value = PLACEHOLDER_STRING;
  if (minLength !== null && value.length < minLength) value = value.padEnd(minLength, "x");
  if (maxLength !== null && value.length > maxLength) value = value.slice(0, maxLength);
  return value;
}

/** 원소 개수. `max(minItems, 1)` 을 쓰되 상한을 넘지 않는다. `maxItems: 0` 이면 빈 배열이다. */
function itemCount(schema: JsonSchema): number {
  const minItems = numberAt(schema, "minItems");
  const maxItems = numberAt(schema, "maxItems");
  let count = Math.max(minItems ?? 1, 1);
  if (maxItems !== null && count > maxItems) count = maxItems;
  return count;
}

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

/**
 * 값이 선언된 범위 제약을 지키는지. `const` · `default` · `examples[0]` 후보가 자기 제약을
 * 어기면 종전대로 `UNSUPPORTED_SCHEMA` 로 떨어진다.
 *
 * 표에 있는 `format` 이 있으면 길이 제약을 보지 않는다. 합성 규칙이 format 값을 그대로 쓰기로
 * 했으므로(설계서 §3.3) 여기서 길이를 따지면 우리가 만든 값이 우리 검사에 걸린다.
 */
function valueMatchesConstraints(value: JsonValue, schema: JsonSchema, type: SchemaType): boolean {
  if (typeof value === "number" && (type === "number" || type === "integer")) {
    const minimum = numberAt(schema, "minimum");
    const maximum = numberAt(schema, "maximum");
    const exclusiveMinimum = numberAt(schema, "exclusiveMinimum");
    const exclusiveMaximum = numberAt(schema, "exclusiveMaximum");
    if (minimum !== null && value < minimum) return false;
    if (maximum !== null && value > maximum) return false;
    if (exclusiveMinimum !== null && value <= exclusiveMinimum) return false;
    if (exclusiveMaximum !== null && value >= exclusiveMaximum) return false;
    return true;
  }
  if (typeof value === "string" && type === "string") {
    if (knownFormatValue(schema) !== null) return true;
    const minLength = numberAt(schema, "minLength");
    const maxLength = numberAt(schema, "maxLength");
    const length = Array.from(value).length;
    if (minLength !== null && length < minLength) return false;
    if (maxLength !== null && length > maxLength) return false;
    return true;
  }
  if (Array.isArray(value) && type === "array") {
    const minItems = numberAt(schema, "minItems");
    const maxItems = numberAt(schema, "maxItems");
    if (minItems !== null && value.length < minItems) return false;
    if (maxItems !== null && value.length > maxItems) return false;
    return true;
  }
  return true;
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
  if (!valueMatchesConstraints(value, schema, type)) return false;
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
        // format 이 있으면 그 값을 그대로 쓴다. 자르면 형식이 깨져 길이와 형식 둘 다 못 지킨다.
        value = knownFormatValue(schema) ?? boundedString(schema);
        break;
      case "number":
      case "integer":
        value = boundedNumber(schema, schema.type as SchemaType);
        break;
      case "boolean":
        value = true;
        break;
      case "null":
        value = null;
        break;
      case "array":
        // 원소는 전부 같은 값이다. 인덱스마다 다른 값을 넣으면 지문이 원소 개수에 따라 흔들린다.
        value = Array.from({ length: itemCount(schema) }, () =>
          synthesizeValue(schema.items as JsonSchema, `${path}.items`),
        );
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

import { compositionKey, type ExpandedSchema, expandComposition } from "./composition.js";
import {
  FORMAT_VALUES,
  integerLowerBound,
  integerUpperBound,
  isKnownFormat,
} from "./constraints.js";
import { compilePattern, synthesizePatternString, tryCompilePattern } from "./pattern.js";
import {
  fail,
  failAllBranches,
  GenerateTestsError,
  type JsonSchema,
  type JsonValue,
  plainObject,
  type SchemaType,
  validateSchema,
} from "./schema.js";

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

/**
 * 문자열 합성. 설계 §5.2 의 순서다. 후보(`const` 등)는 호출부가 이미 처리했다.
 *
 * 표에 있는 `format` 값은 `pattern` 이 함께 있으면 **그 값이 pattern 을 통과할 때만** 쓴다.
 * zod 가 붙이는 `uuid`·`date-time`·`email` 의 pattern 은 여기서 끝난다. 통과하지 못하면
 * 부분집합 생성기로 내려간다. format 값을 잘라 쓰지 않는 이유는 종전과 같다(형식이 깨진다).
 */
function synthesizeString(schema: JsonSchema, path: string): string {
  const formatValue = knownFormatValue(schema);
  const pattern = schema.pattern;
  if (typeof pattern !== "string") return formatValue ?? boundedString(schema);

  const regex = compilePattern(pattern, path);
  if (formatValue !== null && regex.test(formatValue)) return formatValue;
  return synthesizePatternString(
    pattern,
    { minLength: numberAt(schema, "minLength"), maxLength: numberAt(schema, "maxLength") },
    path,
  );
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
    // 알려진 format 이 있어도 pattern 은 본다. 건너뛰는 것은 길이뿐이다(설계 §5.2).
    const pattern = schema.pattern;
    if (typeof pattern === "string") {
      const regex = tryCompilePattern(pattern);
      // 컴파일 실패는 assertConstraints 가 이미 INVALID_SCHEMA_CONSTRAINT 로 걸렀다.
      if (regex !== null && !regex.test(value)) return false;
    }
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

/**
 * 후보값이 스키마를 만족하는지. `active` 에는 해석 중인 `$ref` 대상 객체가 담긴다.
 *
 * 값만 따라 내려가는 것으로는 부족하다. `{ $defs: { A: { $ref: "#/$defs/A" } } }` 처럼 값을
 * 소비하지 않고 도는 참조가 있으면 같은 값으로 무한히 재귀한다. 그러면 스택이 터지고, 그
 * `RangeError` 를 위쪽 catch 가 삼켜 "안 맞음" 으로 돌아오므로 **결과가 우연히 맞는다.**
 * 재방문을 여기서 false 로 끊어야 판정의 근거가 스택 한계가 아니게 된다. 합성 쪽이 같은
 * 자리에서 문안 6 으로 거절하는 것과 갈리는 점은, 후보 검사는 던지지 않는다는 것뿐이다.
 */
function valueMatchesSchema(
  value: JsonValue,
  schema: JsonSchema,
  root: JsonSchema,
  active: Set<object> = new Set(),
): boolean {
  // 후보 검사도 조합을 한 겹 푼다. $ref 만 든 스키마에는 type 이 없어 그냥 보면 전부 불일치다.
  const key = compositionKey(schema);
  if (key !== null) {
    const expanded = expandCompositionOrNull(schema, root);
    if (expanded === null) return false;
    if (key === "$ref") {
      const first = expanded[0];
      if (first === undefined) return true;
      if (first.target !== null && active.has(first.target)) return false;
      const next = first.target === null ? active : new Set(active).add(first.target);
      return valueMatchesSchema(value, first.schema, root, next);
    }
    const matched = countMatchingBranches(value, expanded, root, active);
    return key === "oneOf" ? matched === 1 : matched > 0;
  }
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
    // additionalProperties: false 는 선언 밖 키를 금지한다. const · default · examples[0] 후보가
    // 그런 키를 들고 오면 불일치다(설계 §5.1).
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some((key) => !Object.hasOwn(properties, key))
    ) {
      return false;
    }
    // 선언 밖 키는 additionalProperties 가 스키마 객체면 그 스키마로 본다. 우리는 그런 키를
    // 만들지 않으므로 합성은 그대로고, 후보값(default · examples[0] · const)만 여기서 걸린다.
    const additional = plainObject(schema.additionalProperties)
      ? (schema.additionalProperties as JsonSchema)
      : null;
    return Object.keys(value).every((key) =>
      Object.hasOwn(properties, key)
        ? valueMatchesSchema(value[key] as JsonValue, properties[key] as JsonSchema, root, active)
        : additional === null ||
          valueMatchesSchema(value[key] as JsonValue, additional, root, active),
    );
  }
  if (type === "array" && Array.isArray(value)) {
    return value.every((item) =>
      valueMatchesSchema(item, schema.items as JsonSchema, root, active),
    );
  }
  return true;
}

/**
 * 검증된 JSON Schema에서 결정론적인 입력값 하나를 합성한다.
 *
 * `root` 는 `$ref` 를 푸는 기준이고 기본값이 자기 자신이라 기존 호출부가 그대로 컴파일된다.
 * `active` 에는 해석한 `$ref` 대상 객체만 담는다.
 */
export function synthesizeValue(
  schema: JsonSchema,
  path: string,
  root: JsonSchema = schema,
  active: Set<object> = new Set(),
): JsonValue {
  if (compositionKey(schema) !== null) return synthesizeComposition(schema, path, root, active);

  let value: JsonValue;
  if ("const" in schema) value = schema.const as JsonValue;
  else if ("default" in schema) value = schema.default as JsonValue;
  else if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    value = schema.examples[0] as JsonValue;
  } else if (Array.isArray(schema.enum)) value = schema.enum[0] as JsonValue;
  else {
    switch (schema.type as SchemaType) {
      case "string":
        value = synthesizeString(schema, path);
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
          synthesizeValue(schema.items as JsonSchema, `${path}.items`, root, active),
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
            synthesizeValue(
              properties[key] as JsonSchema,
              `${path}.properties.${key}`,
              root,
              active,
            ),
          ]),
        );
        break;
      }
    }
  }

  if (!valueMatchesSchema(value, schema, root)) {
    fail(
      "UNSUPPORTED_SCHEMA",
      path,
      `선택한 입력 후보가 스키마 제약을 만족하지 않습니다: ${path}`,
      "const, default, examples[0], enum[0] 또는 타입 제약을 확인하세요.",
    );
  }
  return value;
}

/**
 * 조합 키를 한 겹 풀고 유효 스키마로 합성한다.
 *
 * 이미 활성인 `$ref` 대상에 다시 닿으면 거절한다. 합성은 필수 경로만 따라가므로 여기 도달한
 * 순환은 유한한 값이 없는 순환이다. 검증 쪽이 같은 자리를 조용히 건너뛰는 것과 갈린다(§5.3).
 */
function synthesizeComposition(
  schema: JsonSchema,
  path: string,
  root: JsonSchema,
  active: Set<object>,
): JsonValue {
  const key = compositionKey(schema) as "$ref" | "anyOf" | "oneOf";
  const expanded = expandComposition(schema, root, path);
  if (key !== "$ref") return synthesizeBranches(schema, key, expanded, path, root, active);

  const first = expanded[0] as ExpandedSchema;
  if (first.target === null) return synthesizeValue(first.schema, first.path, root, active);
  if (active.has(first.target)) {
    return fail(
      "UNSUPPORTED_SCHEMA",
      path,
      `필수 경로에 순환 참조가 있어 유한한 입력값을 만들 수 없습니다: ${path}.$ref = ${JSON.stringify(schema.$ref)}`,
      "순환하는 필드를 required 에서 빼거나 default 로 끝나는 값을 선언하세요.",
    );
  }
  return synthesizeValue(first.schema, first.path, root, new Set(active).add(first.target));
}

/**
 * 후보 검사용. 해석에 실패하면 그 값은 이 스키마를 만족한다고 볼 수 없다.
 *
 * 삼키는 것은 `GenerateTestsError` 뿐이다. 그 밖의 오류까지 삼키면 우리 결함이 "안 맞음" 으로
 * 위장돼 결과가 우연히 맞는 상태가 조용히 유지된다.
 */
function expandCompositionOrNull(
  schema: JsonSchema,
  root: JsonSchema,
): readonly ExpandedSchema[] | null {
  try {
    return expandComposition(schema, root, "");
  } catch (error) {
    if (error instanceof GenerateTestsError) return null;
    throw error;
  }
}

/**
 * 갈래를 선언 순서대로 시도해 첫 성공값을 쓴다.
 *
 * 갈래마다 `validateSchema` 를 먼저 돌린다. 합성기는 미지원 키워드를 보지 않으므로 그것 없이는
 * 우리가 못 읽는 갈래로도 값이 나온다(설계 §5.4 "실패 조건은 검증과 같다"). `oneOf` 는 만든
 * 값이 **정확히 한 갈래만** 만족하는지 세고 아니면 다음 갈래로 간다.
 */
function synthesizeBranches(
  schema: JsonSchema,
  key: "anyOf" | "oneOf",
  expanded: readonly ExpandedSchema[],
  path: string,
  root: JsonSchema,
  active: Set<object>,
): JsonValue {
  let firstError: GenerateTestsError | null = null;
  let exclusivityFailed = false;
  for (const branch of expanded) {
    try {
      validateSchema(branch.schema, branch.path, new Set(), root);
      const candidate = synthesizeValue(branch.schema, branch.path, root, active);
      if (key === "oneOf" && countMatchingBranches(candidate, expanded, root, active) !== 1) {
        exclusivityFailed = true;
        continue;
      }
      return candidate;
    } catch (error) {
      // 깨진 선언은 갈래 단위로 삼키지 않는다. 검증 쪽과 같은 규칙이다.
      if (!(error instanceof GenerateTestsError) || error.code !== "UNSUPPORTED_SCHEMA")
        throw error;
      firstError ??= error;
    }
  }
  if (key === "oneOf" && exclusivityFailed) {
    return fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.oneOf`,
      `'oneOf' 의 어느 갈래로 만든 값도 정확히 한 갈래만 만족하지 않습니다: ${path}.oneOf`,
      "갈래를 서로 배타적으로 선언하거나 anyOf 로 바꾸세요.",
    );
  }
  return failAllBranches(schema, key, path, firstError);
}

/** 값이 만족하는 갈래 수. `oneOf` 의 배타 판정과 후보 검사가 같은 계산을 쓴다. */
function countMatchingBranches(
  value: JsonValue,
  expanded: readonly ExpandedSchema[],
  root: JsonSchema,
  active: Set<object>,
): number {
  return expanded.filter((branch) => valueMatchesSchema(value, branch.schema, root, active)).length;
}

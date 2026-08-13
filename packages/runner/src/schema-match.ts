import type { JsonValue, ResponseSchema } from "./spec/types.js";

/** 한 번의 평가에서 목록에 담는 위반의 최대 개수. 총합은 totalViolations가 따로 센다. */
export const MAX_SCHEMA_VIOLATIONS = 10;

export type SchemaViolationCode =
  | "TYPE_MISMATCH"
  | "CONST_MISMATCH"
  | "ENUM_MISMATCH"
  | "REQUIRED_MISSING"
  | "ADDITIONAL_PROPERTY"
  | "MIN_ITEMS"
  | "MIN_LENGTH"
  | "MAX_LENGTH"
  | "STRING_CONTAINS"
  | "MINIMUM"
  | "MAXIMUM";

/** expected·actual·observedKeys는 가공하지 않은 원본이다. sanitize와 요약은 diagnostics.ts가 한다. */
export interface SchemaViolation {
  code: SchemaViolationCode;
  path: string;
  expected: JsonValue;
  actual: JsonValue;
  observedKeys?: string[];
}

export interface SchemaMatchResult {
  violations: SchemaViolation[];
  totalViolations: number;
}

export const plainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

export const typeName = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

/** UTF-16 코드 단위 안정 비교. 로캘에 의존하지 않는다. assertions.ts의 assertToolExists와 같다. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 문자열 길이는 코드 포인트로 센다. JSON Schema의 minLength 정의가 코드 포인트 기준이다. */
const charCount = (value: string): number => Array.from(value).length;

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((v, i) => jsonEqual(v, right[i] as JsonValue))
    );
  if (plainObject(left) && plainObject(right)) {
    const l = Object.keys(left).sort();
    const r = Object.keys(right).sort();
    return (
      l.length === r.length &&
      l.every((k, i) => k === r[i] && jsonEqual(left[k] as JsonValue, right[k] as JsonValue))
    );
  }
  return false;
}

/** 선언한 type이 값과 맞는지 본다. number는 유한수만 인정한다. */
const matchesType = (type: string, value: JsonValue): boolean =>
  type === "null"
    ? value === null
    : type === "array"
      ? Array.isArray(value)
      : type === "object"
        ? plainObject(value)
        : type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : type === "integer"
            ? typeof value === "number" && Number.isInteger(value)
            : typeof value === type;

/**
 * 프레임 스택의 원소. `node`는 스키마 한 개로 값 한 개를 평가한다.
 * `additionalFalse`는 `additionalProperties: false`의 위반 키를 순서대로 보고한다.
 * 두 종류로 나눈 이유는 위반 순서 때문이다. 하위 순회 순서가
 * required, properties, additionalProperties, items 로 고정돼야 하는데,
 * additionalProperties의 위반을 부모 노드에서 바로 내면 properties 하위 위반보다 앞서게 된다.
 */
type Frame =
  | { kind: "node"; schema: ResponseSchema; value: JsonValue; path: string }
  | { kind: "additionalFalse"; keys: string[]; value: Record<string, JsonValue>; path: string };

/**
 * 응답 본문을 ResponseSchema로 평가해 위반 목록을 만든다. 문장은 만들지 않는다.
 * 순회는 재귀가 아니라 명시적 프레임 스택이라 깊게 중첩한 응답에서도 스택이 넘치지 않는다.
 */
export function matchResponseSchema(schema: ResponseSchema, body: JsonValue): SchemaMatchResult {
  const violations: SchemaViolation[] = [];
  let totalViolations = 0;

  /** 상한을 넘으면 목록에 담지 않지만 순회는 끝까지 진행해 총합을 센다. */
  const record = (violation: SchemaViolation): void => {
    totalViolations++;
    if (violations.length < MAX_SCHEMA_VIOLATIONS) violations.push(violation);
  };

  const frames: Frame[] = [{ kind: "node", schema, value: body, path: "$" }];

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;

    if (frame.kind === "additionalFalse") {
      for (const key of frame.keys)
        record({
          code: "ADDITIONAL_PROPERTY",
          path: `${frame.path}.${key}`,
          expected: null,
          actual: frame.value[key] as JsonValue,
        });
      continue;
    }

    const { schema: node, value, path } = frame;

    // 1. type. 위반이면 이 노드를 종료한다.
    if (node.type !== undefined && !matchesType(node.type, value)) {
      record({ code: "TYPE_MISMATCH", path, expected: node.type, actual: value });
      continue;
    }

    // 2. const. 위반이면 이 노드를 종료한다.
    if (node.const !== undefined && !jsonEqual(node.const, value)) {
      record({ code: "CONST_MISMATCH", path, expected: node.const, actual: value });
      continue;
    }

    // 3. enum. 위반이면 이 노드를 종료한다.
    if (node.enum !== undefined && !node.enum.some((candidate) => jsonEqual(candidate, value))) {
      record({ code: "ENUM_MISMATCH", path, expected: node.enum, actual: value });
      continue;
    }

    // 4. 타입별 제약.
    if (typeof value === "string") {
      if (node.minLength !== undefined && charCount(value) < node.minLength)
        record({ code: "MIN_LENGTH", path, expected: node.minLength, actual: charCount(value) });
      if (node.maxLength !== undefined && charCount(value) > node.maxLength)
        record({ code: "MAX_LENGTH", path, expected: node.maxLength, actual: charCount(value) });
      if (node.stringContains !== undefined && !value.includes(node.stringContains))
        record({
          code: "STRING_CONTAINS",
          path,
          expected: node.stringContains,
          actual: value,
        });
    }
    if (typeof value === "number") {
      if (node.minimum !== undefined && value < node.minimum)
        record({ code: "MINIMUM", path, expected: node.minimum, actual: value });
      if (node.maximum !== undefined && value > node.maximum)
        record({ code: "MAXIMUM", path, expected: node.maximum, actual: value });
    }
    if (Array.isArray(value) && node.minItems !== undefined && value.length < node.minItems)
      record({ code: "MIN_ITEMS", path, expected: node.minItems, actual: value.length });

    // 5-1. required. 스펙의 배열 순서대로 본다. in 대신 Object.hasOwn을 써 자기 키만 본다.
    if (plainObject(value) && node.required !== undefined) {
      const observedKeys = Object.keys(value).sort(byCodeUnit);
      for (const key of node.required)
        if (!Object.hasOwn(value, key))
          record({
            code: "REQUIRED_MISSING",
            path,
            expected: key,
            actual: null,
            observedKeys,
          });
    }

    // 5-2 이후는 역순으로 push해 pop 순서가 properties, additionalProperties, items 가 되게 한다.
    if (Array.isArray(value) && node.items !== undefined) {
      const items = node.items;
      for (let index = value.length - 1; index >= 0; index--)
        frames.push({
          kind: "node",
          schema: items,
          value: value[index] as JsonValue,
          path: `${path}[${index}]`,
        });
    }

    if (plainObject(value) && node.additionalProperties !== undefined) {
      const declared = node.properties;
      const extras = Object.keys(value)
        .filter((key) => declared === undefined || !Object.hasOwn(declared, key))
        .sort(byCodeUnit);
      if (node.additionalProperties === false) {
        if (extras.length > 0)
          frames.push({
            kind: "additionalFalse",
            keys: extras,
            value: value as Record<string, JsonValue>,
            path,
          });
      } else if (node.additionalProperties !== true) {
        const additional = node.additionalProperties;
        for (let index = extras.length - 1; index >= 0; index--) {
          const key = extras[index];
          if (key !== undefined)
            frames.push({
              kind: "node",
              schema: additional,
              value: value[key] as JsonValue,
              path: `${path}.${key}`,
            });
        }
      }
    }

    if (plainObject(value) && node.properties !== undefined) {
      const declared = node.properties;
      const keys = Object.keys(declared);
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index];
        if (key !== undefined && Object.hasOwn(value, key))
          frames.push({
            kind: "node",
            schema: declared[key] as ResponseSchema,
            value: value[key] as JsonValue,
            path: `${path}.${key}`,
          });
      }
    }
  }

  return { violations, totalViolations };
}

import type { BodyExtractionFailure } from "./body.js";
import { type RunnerRedactionOptions, sanitizeJsonValue } from "./sanitization.js";
import {
  plainObject,
  type SchemaMatchResult,
  type SchemaViolation,
  type SchemaViolationCode,
  typeName,
} from "./schema-match.js";
import type { JsonObject, JsonValue } from "./spec/types.js";

export type RunnerDiagnosticCode =
  | "TOOL_NOT_FOUND"
  | "IS_ERROR_MISMATCH"
  | "OPERATION_FAILED"
  | "OPERATION_RESULT_UNAVAILABLE"
  | "CASE_TIMEOUT"
  | "RUN_ABORTED"
  | "BODY_SCHEMA_MISMATCH"
  | "BODY_EXTRACTION_FAILED";

/** 진단에 담는 문자열 값의 최대 코드 포인트 수. 넘으면 자르고 원본 길이를 따로 남긴다. */
export const MAX_VALUE_STRING_CHARS = 200;
/** REQUIRED_MISSING의 발견된 필드 목록에 담는 최대 키 수. */
export const MAX_OBSERVED_KEYS = 20;

export interface SchemaViolationDiagnostic {
  code: SchemaViolationCode;
  path: string;
  /** sanitize와 요약을 거친 값. 원본이 아니다. */
  expected: JsonValue;
  actual: JsonValue;
  /** actual이 잘린 문자열일 때만. 원본 코드 포인트 길이. */
  actualChars?: number;
  /** REQUIRED_MISSING 전용. 정렬 후 MAX_OBSERVED_KEYS까지. */
  observedKeys?: string[];
  /** observedKeys가 잘렸을 때만. 원본 키 개수. */
  observedKeysTotal?: number;
  message: string;
}

export interface RunnerDiagnostic {
  code: RunnerDiagnosticCode;
  message: string;
  expected?: JsonValue;
  actual?: JsonValue;
  hint: string;
  violations?: SchemaViolationDiagnostic[];
  totalViolations?: number;
}

export type NormalizedThrownValue =
  | { type: "error"; name: string; message: string }
  | { type: "thrown"; value: string | number | boolean | null }
  | { type: "number"; value: string }
  | { type: "undefined" }
  | { type: "bigint"; value: string }
  | { type: "symbol"; description: string | null }
  | { type: "function"; name: string | null }
  | { type: "object" };

export function normalizeThrownValue(value: unknown): NormalizedThrownValue {
  if (value instanceof Error) {
    return { type: "error", name: value.name, message: value.message };
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { type: "thrown", value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { type: "thrown", value }
      : { type: "number", value: String(value) };
  }
  if (typeof value === "undefined") return { type: "undefined" };
  if (typeof value === "bigint") return { type: "bigint", value: value.toString() };
  if (typeof value === "symbol") {
    return { type: "symbol", description: value.description ?? null };
  }
  if (typeof value === "function") return { type: "function", name: value.name || null };
  return { type: "object" };
}

export function toolNotFoundDiagnostic(expected: string, actual: string[]): RunnerDiagnostic {
  return {
    code: "TOOL_NOT_FOUND",
    message: `툴 '${expected}'를 찾을 수 없습니다.`,
    expected,
    actual,
    hint: "서버의 tools/list 응답과 테스트 명세를 확인하세요.",
  };
}

export function isErrorMismatchDiagnostic(expected: boolean, actual: boolean): RunnerDiagnostic {
  return {
    code: "IS_ERROR_MISMATCH",
    message: expected
      ? "오류 응답을 기대했지만 정상 응답을 받았습니다."
      : "정상 응답을 기대했지만 오류 응답을 받았습니다.",
    expected,
    actual,
    hint: "툴 입력값과 서버의 오류 응답을 확인하세요.",
  };
}

export function operationFailedDiagnostic(error: unknown): RunnerDiagnostic {
  return {
    code: "OPERATION_FAILED",
    message: "MCP 작업 실행이 실패했습니다.",
    actual: normalizeThrownValue(error),
    hint: "MCP 서버 연결과 작업 입력값을 확인하세요.",
  };
}

/**
 * 진단에 넣을 값을 만든다. sanitize를 먼저 하고 자르기를 나중에 한다.
 * 순서를 뒤집으면 잘린 조각이 sensitiveValues 일치 검사를 통과하지 못해 [REDACTED]가 적용되지 않는다.
 *
 * key는 이 값이 응답 객체에서 어떤 키에 있었는지다. 민감 키 규칙은 객체의 키를 보고 판정하므로
 * 스칼라 하나만 넘기면 적용되지 않는다. 키를 알 때는 그 키를 붙여 sanitize한 뒤 다시 꺼낸다.
 */
function summarizeValue(
  value: JsonValue,
  options?: RunnerRedactionOptions,
  key?: string,
): { value: JsonValue; chars?: number } {
  const safe =
    key === undefined
      ? sanitizeJsonValue(value, options)
      : ((sanitizeJsonValue({ [key]: value }, options) as JsonObject)[key] as JsonValue);
  if (safe === null || typeof safe === "number" || typeof safe === "boolean")
    return { value: safe };
  if (typeof safe === "string") {
    // 코드 포인트 기준으로 자른다. slice는 서로게이트 페어를 쪼갠다.
    const points = Array.from(safe);
    if (points.length <= MAX_VALUE_STRING_CHARS) return { value: safe };
    return {
      value: points.slice(0, MAX_VALUE_STRING_CHARS).join(""),
      chars: points.length,
    };
  }
  if (Array.isArray(safe)) return { value: { kind: "array", items: safe.length } };
  return { value: { kind: "object", keys: Object.keys(safe).length } };
}

/**
 * expected는 스펙에서 온 값이라 sanitize하지 않고 자르기만 적용한다.
 * enum의 후보 배열은 문장에 원소별로 들어가므로 배열은 원소마다 적용한다.
 */
function truncateExpected(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    const points = Array.from(value);
    return points.length <= MAX_VALUE_STRING_CHARS
      ? value
      : points.slice(0, MAX_VALUE_STRING_CHARS).join("");
  }
  if (Array.isArray(value)) return value.map(truncateExpected);
  if (plainObject(value)) return { kind: "object", keys: Object.keys(value).length };
  return value;
}

/** 문자열은 큰따옴표로 감싸고 나머지는 그대로 적는다. */
const renderValue = (value: JsonValue): string =>
  typeof value === "string" ? `"${value}"` : JSON.stringify(value);

/** 요약값이면 종류와 개수를 돌려준다. 아니면 undefined다. */
const asSummary = (value: JsonValue): { kind: string; count: number } | undefined => {
  if (!plainObject(value)) return undefined;
  if (value.kind === "object" && typeof value.keys === "number")
    return { kind: "object", count: value.keys };
  if (value.kind === "array" && typeof value.items === "number")
    return { kind: "array", count: value.items };
  return undefined;
};

/** TYPE_MISMATCH 문장의 `실제:` 뒤에 붙는 타입 이름과 꼬리말을 만든다. */
const describeActual = (value: JsonValue): string => {
  const summary = asSummary(value);
  if (summary?.kind === "object") return `object (키 ${summary.count}개)`;
  if (summary?.kind === "array") return `array (원소 ${summary.count}개)`;
  return `${typeName(value)} (${renderValue(value)})`;
};

/** 경로의 마지막 객체 키를 꺼낸다. 배열 인덱스로 끝나거나 루트면 undefined다. */
const leafKey = (path: string): string | undefined => {
  const matched = /\.([^.[\]]+)$/.exec(path);
  return matched?.[1];
};

function violationMessage(
  violation: SchemaViolation,
  path: string,
  expected: JsonValue,
  actual: JsonValue,
  observedKeys: string[] | undefined,
  observedKeysTotal: number | undefined,
): string {
  switch (violation.code) {
    case "TYPE_MISMATCH":
      return `${path}: 타입이 다릅니다. 기대: ${String(expected)}, 실제: ${describeActual(actual)}`;
    case "CONST_MISMATCH":
      return `${path}: 값이 다릅니다. 기대: ${renderValue(expected)}, 실제: ${renderValue(actual)}`;
    case "ENUM_MISMATCH": {
      const candidates = (Array.isArray(expected) ? expected : [expected])
        .map(renderValue)
        .join(" | ");
      return `${path}: 기대한 값 중 하나가 아닙니다. 기대: ${candidates}, 실제: ${renderValue(actual)}`;
    }
    case "REQUIRED_MISSING": {
      const keys = (observedKeys ?? []).map((key) => `'${key}'`).join(", ");
      const suffix =
        observedKeysTotal === undefined
          ? ""
          : ` 외 ${observedKeysTotal - (observedKeys ?? []).length}개`;
      return `${path}: 필수 필드가 없습니다. 발견된 필드: ${keys}${suffix}`;
    }
    case "ADDITIONAL_PROPERTY":
      return `${path}: 스키마에 없는 필드입니다.`;
    case "MIN_ITEMS":
      return `${path}: 배열 원소가 부족합니다. 기대: ${renderValue(expected)}개 이상, 실제: ${renderValue(actual)}개`;
    case "MIN_LENGTH":
      return `${path}: 문자열이 너무 짧습니다. 기대: ${renderValue(expected)}자 이상, 실제: ${renderValue(actual)}자`;
    case "MAX_LENGTH":
      return `${path}: 문자열이 너무 깁니다. 기대: ${renderValue(expected)}자 이하, 실제: ${renderValue(actual)}자`;
    case "STRING_CONTAINS":
      return `${path}: 응답 문자열에 기대한 내용이 없습니다. 기대: ${renderValue(expected)} 포함, 실제: ${renderValue(actual)}`;
    case "MINIMUM":
      return `${path}: 값이 범위를 벗어납니다. 기대: ${renderValue(expected)} 이상, 실제: ${renderValue(actual)}`;
    default:
      return `${path}: 값이 범위를 벗어납니다. 기대: ${renderValue(expected)} 이하, 실제: ${renderValue(actual)}`;
  }
}

function toViolationDiagnostic(
  violation: SchemaViolation,
  options?: RunnerRedactionOptions,
): SchemaViolationDiagnostic {
  // REQUIRED_MISSING의 path는 빠진 키를 가진 객체를 가리킨다. 문장은 빠진 필드를 가리켜야 한다.
  const path =
    violation.code === "REQUIRED_MISSING" && typeof violation.expected === "string"
      ? `${violation.path}.${violation.expected}`
      : violation.path;
  const expected = truncateExpected(violation.expected);
  const summarized = summarizeValue(violation.actual, options, leafKey(violation.path));
  const observedKeysTotal =
    violation.observedKeys !== undefined && violation.observedKeys.length > MAX_OBSERVED_KEYS
      ? violation.observedKeys.length
      : undefined;
  const observedKeys =
    violation.observedKeys === undefined
      ? undefined
      : violation.observedKeys.slice(0, MAX_OBSERVED_KEYS);

  return {
    code: violation.code,
    path,
    expected,
    actual: summarized.value,
    ...(summarized.chars === undefined ? {} : { actualChars: summarized.chars }),
    ...(observedKeys === undefined ? {} : { observedKeys }),
    ...(observedKeysTotal === undefined ? {} : { observedKeysTotal }),
    message: violationMessage(
      violation,
      path,
      expected,
      summarized.value,
      observedKeys,
      observedKeysTotal,
    ),
  };
}

export function bodySchemaMismatchDiagnostic(
  result: SchemaMatchResult,
  options?: RunnerRedactionOptions,
): RunnerDiagnostic {
  const truncated = result.totalViolations > result.violations.length;
  return {
    code: "BODY_SCHEMA_MISMATCH",
    message: truncated
      ? `응답이 기대 스키마와 다릅니다. 위반 ${result.totalViolations}건 중 ${result.violations.length}건을 표시합니다.`
      : `응답이 기대 스키마와 다릅니다. 위반 ${result.totalViolations}건.`,
    hint: truncated
      ? "표시된 위반을 고친 뒤 나머지를 다시 확인하세요."
      : "스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.",
    violations: result.violations.map((violation) => toViolationDiagnostic(violation, options)),
    totalViolations: result.totalViolations,
  };
}

export function bodyExtractionFailedDiagnostic(failure: BodyExtractionFailure): RunnerDiagnostic {
  const prefix = "응답에서 검사할 본문을 정할 수 없습니다.";
  if (failure.code === "CONTENT_NOT_ARRAY")
    return {
      code: "BODY_EXTRACTION_FAILED",
      message: `${prefix} content가 배열이 아닙니다. 실제 타입: ${failure.actual}`,
      actual: failure.actual,
      hint: "bodyMatchesSchema는 text 블록 1개짜리 응답에만 쓸 수 있습니다.",
    };
  if (failure.code === "CONTENT_BLOCK_COUNT")
    return {
      code: "BODY_EXTRACTION_FAILED",
      message: `${prefix} content 블록이 ${failure.actual}개입니다. 1개여야 합니다.`,
      actual: failure.actual,
      hint: "서버 응답 구조를 확인하거나 이 단언을 제거하세요.",
    };
  return {
    code: "BODY_EXTRACTION_FAILED",
    message: `${prefix} content 블록이 text가 아닙니다. 실제 type: ${failure.actual}`,
    actual: failure.actual,
    hint: "bodyMatchesSchema는 text 블록에만 쓸 수 있습니다.",
  };
}

/** 선행 MCP 작업 결과가 없어 단언을 검사할 수 없을 때의 진단. */
export function operationResultUnavailableDiagnostic(): RunnerDiagnostic {
  return {
    code: "OPERATION_RESULT_UNAVAILABLE",
    message: "MCP 작업 결과가 없어 assertion을 검사할 수 없습니다.",
    hint: "먼저 MCP 작업 실패 원인을 해결하세요.",
  };
}

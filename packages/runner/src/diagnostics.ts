import type { BodyExtraction, BodyExtractionFailure } from "./body.js";
import { canonicalJson } from "./canonical.js";
import {
  DEFAULT_SENSITIVE_KEYS,
  isSensitiveKey,
  normalizeSensitiveKey,
  REDACTED,
  type RunnerRedactionOptions,
  sanitizeJsonValue,
} from "./sanitization.js";
import {
  plainObject,
  type SchemaMatchResult,
  type SchemaViolation,
  type SchemaViolationCode,
  typeName,
} from "./schema-match.js";
import type { JsonValue } from "./spec/types.js";

export type RunnerDiagnosticCode =
  | "TOOL_NOT_FOUND"
  | "IS_ERROR_MISMATCH"
  | "OPERATION_FAILED"
  | "OPERATION_RESULT_UNAVAILABLE"
  | "CASE_TIMEOUT"
  | "RUN_ABORTED"
  | "BODY_SCHEMA_MISMATCH"
  | "BODY_EXTRACTION_FAILED"
  | "STRUCTURED_CONTENT_SCHEMA_MISMATCH"
  | "STRUCTURED_CONTENT_EXTRACTION_FAILED";

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
  /**
   * 단언 줄에 덧붙일 사실 그대로의 줄. 리포터가 `violations` 와 같은 `→ ` 형식으로 찍는다.
   * 우리가 만든 판정 문장이 아니라 서버가 준 값을 옮기는 자리다. ADR-0027.
   */
  notes?: string[];
  /** 기대와 실제를 나란히 놓은 줄. 이미 가림 처리가 끝난 값이다. 없으면 키가 없다. */
  diff?: string[];
}

export type NormalizedThrownValue =
  | { type: "error"; name: string; message: string; cause?: NormalizedThrownValue }
  | { type: "thrown"; value: string | number | boolean | null }
  | { type: "number"; value: string }
  | { type: "undefined" }
  | { type: "bigint"; value: string }
  | { type: "symbol"; description: string | null }
  | { type: "function"; name: string | null }
  | { type: "object" };

/**
 * cause 체인을 따라 내려가는 상한. 순환 cause 에서 무한히 내려가는 것을 막는다.
 * 실측 체인은 2단계다(core 의 McpClientError → SDK 의 McpError). 3이면 여유다.
 */
const MAX_CAUSE_DEPTH = 3;

export function normalizeThrownValue(value: unknown): NormalizedThrownValue {
  return normalizeWithDepth(value, 0);
}

function normalizeWithDepth(value: unknown, depth: number): NormalizedThrownValue {
  if (value instanceof Error) {
    // cause 를 버리면 안 된다. 서버가 준 거절 이유(예: `requires task augmentation`)는
    // core 가 cause 에 보존하는데, 여기서 떨어뜨리면 화면이 우리 사전 문장까지만 말하게
    // 된다(adoption.md §2.5 넷째). 키는 값이 있을 때만 만든다 — undefined 로 넣으면
    // 기존 보고서의 JSON 바이트가 흔들린다.
    return {
      type: "error",
      name: value.name,
      message: value.message,
      ...(value.cause !== undefined && depth < MAX_CAUSE_DEPTH
        ? { cause: normalizeWithDepth(value.cause, depth + 1) }
        : {}),
    };
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
  const discovered = actual.length === 0 ? "(없음)" : actual.map((tool) => `'${tool}'`).join(", ");
  return {
    code: "TOOL_NOT_FOUND",
    message: `툴 '${expected}'을(를) 찾을 수 없습니다. 발견된 툴: ${discovered}`,
    expected,
    actual,
    hint: "서버의 tools/list 응답과 테스트 명세를 확인하세요.",
  };
}

/**
 * 문장 **안에 섞인** 민감값을 치환한다.
 *
 * `sanitizeJsonValue` 는 값 전체가 `sensitiveValues` 와 같을 때만 치환한다. 명세의 입력값처럼
 * 값 하나가 필드 하나인 자리에서는 그것으로 충분하다. 그런데 서버 오류 문장은 값이 문장 속에
 * 박혀 나온다(`토큰 abc123 이 만료되었습니다`). 그 줄은 화면에 찍힐 뿐 아니라 교정 제안
 * 요청에 실려 외부 provider 로 나가므로, 여기서만 부분 일치까지 치환한다. ADR-0027.
 *
 * 빈 문자열은 건너뛴다. 모든 자리에 끼어들어 문장을 통째로 지운다.
 */
const redactSubstrings = (text: string, options?: RunnerRedactionOptions): string => {
  let result = text;
  for (const secret of options?.sensitiveValues ?? [])
    if (secret !== "") result = result.split(secret).join(REDACTED);
  return result;
};

/**
 * 응답 본문을 진단 줄로 만든다. ADR-0027.
 *
 * 라벨을 붙이지 않는다. 이 줄은 cli 의 교정 요청 문안에 그대로 실리는데, 거기에 이미
 * `서버 응답: ` 이 붙어 있어 라벨을 여기서 또 붙이면 두 번 나온다.
 *
 * `text` 는 사람이 읽을 문장이므로 따옴표 없이 그대로 옮기고 줄마다 항목 하나로 나눈다.
 * `json` 은 구조가 보여야 하므로 compact JSON 한 줄로 적는다. 두 경로 모두 승인 화면과
 * 같은 redaction 을 거치고, 그 위에 문장 안에 섞인 민감값까지 치환한 뒤
 * `MAX_VALUE_STRING_CHARS` 에서 잘린다.
 */
function responseBodyNotes(
  extraction: BodyExtraction,
  options?: RunnerRedactionOptions,
): string[] | undefined {
  if (!extraction.ok) return undefined;
  // JSON 은 한 줄이다. structuralValue 의 compact JSON 에는 개행이 없다.
  if (extraction.form === "json")
    return [redactSubstrings(structuralValue(extraction.body, [], options).text, options)];
  // text 형식의 본문은 항상 문자열이다. body.ts 가 그렇게만 만든다.
  const safe = sanitizeJsonValue(extraction.body, options);
  if (typeof safe !== "string") return undefined;
  // 자르기는 나누기 전 본문 전체에 건다. 줄마다 따로 자르면 긴 응답에서 총량이 안 잡힌다.
  // 치환을 자르기보다 먼저 한다. 잘라 놓고 치환하면 경계에 걸린 민감값이 남는다.
  const { text, chars } = cut(redactSubstrings(safe, options));
  // 줄을 나눠 담는다. 한 줄로 뭉치면 개행이 이스케이프되어 리포터의 들여쓰기 밖으로 튄다.
  // 줄 안의 글자는 손대지 않는다. 서버가 `→` 를 글머리로 쓰면 그것도 그대로 나온다.
  const lines = withEllipsis(text, chars)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  return lines.length === 0 ? undefined : lines;
}

export function isErrorMismatchDiagnostic(
  expected: boolean,
  actual: boolean,
  extraction?: BodyExtraction,
  options?: RunnerRedactionOptions,
): RunnerDiagnostic {
  const notes = extraction === undefined ? undefined : responseBodyNotes(extraction, options);
  return {
    code: "IS_ERROR_MISMATCH",
    message: expected
      ? "오류 응답을 기대했지만 정상 응답을 받았습니다."
      : "정상 응답을 기대했지만 오류 응답을 받았습니다.",
    expected,
    actual,
    // 거절이 뚫린 쪽은 선언을 모른 채로도 맞는 문장이어야 한다. generate 와 dashboard 도
    // 이 hint 를 쓴다. 어떤 선언을 받아들였는지는 선언을 아는 cli 가 따로 말한다.
    hint: expected
      ? "서버가 거절을 기대한 입력을 받아들였습니다. 입력이 서버 선언을 어긴다면 서버의 입력 검증을, 어기지 않는다면 명세가 기대하는 거절 근거를 확인하세요."
      : "툴 입력값과 서버의 오류 응답을 확인하세요.",
    ...(notes === undefined ? {} : { notes }),
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

/** 진단에 넣을 값 하나. value는 보고서에 담고 text는 문장에 넣는다. */
interface RenderedValue {
  value: JsonValue;
  chars?: number;
  text: string;
}

/** 코드 포인트 기준으로 자른다. slice는 서로게이트 페어를 쪼갠다. */
const cut = (text: string): { text: string; chars?: number } => {
  const points = Array.from(text);
  if (points.length <= MAX_VALUE_STRING_CHARS) return { text };
  return { text: points.slice(0, MAX_VALUE_STRING_CHARS).join(""), chars: points.length };
};

/** 잘린 값에는 말줄임과 원본 길이를 붙인다. 붙이지 않으면 완전한 값으로 오해한다. */
const withEllipsis = (text: string, chars: number | undefined): string =>
  chars === undefined ? text : `${text}…(총 ${chars}자)`;

/**
 * 관찰한 문자열 하나를 보고서에 실을 형태로 만든다. 진단 값과 같은 상한·같은 말줄임을 쓴다.
 *
 * **치환이 먼저, 자르기가 나중이다.** 순서를 뒤집으면 잘린 조각이 `sensitiveValues` 일치 검사를
 * 통과하지 못해 `[REDACTED]` 가 적용되지 않는다. `renderedValue` 가 지키는 순서와 같다.
 *
 * `rejectionBody`(#89)가 이 함수를 쓴다. 규칙을 두 벌로 두면 같은 서버 응답이 자리에 따라 다르게
 * 잘린다.
 */
export function clampObservedText(text: string, options?: RunnerRedactionOptions): string {
  const sanitized = sanitizeJsonValue(text, options);
  if (typeof sanitized !== "string") return renderValue(sanitized);
  const { text: kept, chars } = cut(sanitized);
  return withEllipsis(kept, chars);
}

/**
 * 값을 문장에 적는다. 문자열은 JSON.stringify로 감싼다.
 * 직접 따옴표를 붙이면 값 안의 따옴표·개행·제어문자가 그대로 새어 나가 줄이 깨지거나
 * 문장이 스푸핑된다.
 */
const renderValue = (value: JsonValue): string => JSON.stringify(value) ?? "null";

/** 위반 경로의 객체 키를 앞에서부터 모은다. 배열 인덱스는 건너뛴다. */
const pathKeys = (path: string): string[] =>
  [...path.matchAll(/\.([^.[\]]+)/g)].map((matched) => matched[1] as string);

/**
 * 값의 조상 키 중 하나라도 민감 키면 값을 통째로 가린다.
 * sanitizeJsonValue는 객체의 직속 키만 보므로 {"token":{"value":"sk-abc"}}의
 * $.token.value 위반에서는 값을 가리지 못한다. 배열 인덱스를 거친 경로도 마찬가지다.
 *
 * `determinism.ts` 도 이 함수를 쓴다. 마스킹 정책을 두 벌로 두면 같은 응답이 단언 진단에서는
 * 가려지고 `--determinism` 비교에서는 그대로 찍힌다.
 */
export const redactByPath = (
  value: JsonValue,
  keys: readonly string[],
  options?: RunnerRedactionOptions,
): JsonValue => {
  const sensitive = new Set(DEFAULT_SENSITIVE_KEYS);
  for (const key of options?.sensitiveKeys ?? []) sensitive.add(normalizeSensitiveKey(key));
  if (keys.some((key) => isSensitiveKey(sensitive, key))) return REDACTED;
  return sanitizeJsonValue(value, options);
};

/**
 * 진단에 넣을 값을 만든다. sanitize를 먼저 하고 자르기를 나중에 한다.
 * 순서를 뒤집으면 잘린 조각이 sensitiveValues 일치 검사를 통과하지 못해 [REDACTED]가 적용되지 않는다.
 * 객체와 배열은 상한을 구조적으로 보장하려고 종류와 개수로 요약한다.
 */
function summarizeValue(
  value: JsonValue,
  keys: readonly string[],
  options?: RunnerRedactionOptions,
): RenderedValue {
  const safe = redactByPath(value, keys, options);
  if (safe === null || typeof safe === "number" || typeof safe === "boolean")
    return { value: safe, text: renderValue(safe) };
  if (typeof safe === "string") {
    const { text, chars } = cut(safe);
    return {
      value: text,
      ...(chars === undefined ? {} : { chars }),
      text: withEllipsis(renderValue(text), chars),
    };
  }
  if (Array.isArray(safe))
    return { value: { kind: "array", items: safe.length }, text: `array (원소 ${safe.length}개)` };
  const count = Object.keys(safe).length;
  return { value: { kind: "object", keys: count }, text: `object (키 ${count}개)` };
}

/**
 * CONST와 ENUM 전용. 이 두 문장은 무엇이 다른지 보여주는 것이 전부인데 객체·배열을
 * 종류와 개수로 요약하면 기대와 실제가 똑같이 찍혀 아무것도 알려주지 못한다.
 * 그래서 구조를 유지한 compact JSON으로 적고 상한에서 자른다.
 */
function structuralValue(
  value: JsonValue,
  keys: readonly string[] | undefined,
  options?: RunnerRedactionOptions,
): RenderedValue {
  const safe = keys === undefined ? value : redactByPath(value, keys, options);
  // 문자열은 따옴표를 뺀 원본 길이로 자른다. 요약 경로와 같은 기준이어야
  // 보고서의 actualChars와 잘린 값이 어긋나지 않는다.
  if (typeof safe === "string") {
    const { text, chars } = cut(safe);
    return {
      value: text,
      ...(chars === undefined ? {} : { chars }),
      text: withEllipsis(renderValue(text), chars),
    };
  }
  const { text, chars } = cut(renderValue(safe));
  if (chars === undefined) return { value: safe, text };
  // 잘린 JSON은 더 이상 그 값이 아니므로 보고서에도 잘린 텍스트를 담는다.
  return { value: text, chars, text: withEllipsis(text, chars) };
}

/** expected는 스펙에서 온 값이라 sanitize하지 않고 자르기만 적용한다. */
function truncateExpected(value: JsonValue): JsonValue {
  if (typeof value === "string") return cut(value).text;
  if (Array.isArray(value)) return value.map(truncateExpected);
  if (plainObject(value)) return { kind: "object", keys: Object.keys(value).length };
  return value;
}

function violationMessage(
  code: SchemaViolationCode,
  path: string,
  expected: string,
  actual: RenderedValue,
  observedKeys: string[] | undefined,
  observedKeysTotal: number | undefined,
): string {
  switch (code) {
    case "TYPE_MISMATCH": {
      // 요약값이면 종류와 개수로, 스칼라면 타입 이름과 값으로 적는다.
      const detail = plainObject(actual.value)
        ? actual.text
        : `${typeName(actual.value)} (${actual.text})`;
      return `${path}: 타입이 다릅니다. 기대: ${expected}, 실제: ${detail}`;
    }
    case "CONST_MISMATCH":
      return `${path}: 값이 다릅니다. 기대: ${expected}, 실제: ${actual.text}`;
    case "ENUM_MISMATCH":
      return `${path}: 기대한 값 중 하나가 아닙니다. 기대: ${expected}, 실제: ${actual.text}`;
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
      return `${path}: 배열 원소가 부족합니다. 기대: ${expected}개 이상, 실제: ${actual.text}개`;
    case "MIN_LENGTH":
      return `${path}: 문자열이 너무 짧습니다. 기대: ${expected}자 이상, 실제: ${actual.text}자`;
    case "MAX_LENGTH":
      return `${path}: 문자열이 너무 깁니다. 기대: ${expected}자 이하, 실제: ${actual.text}자`;
    case "STRING_CONTAINS":
      return `${path}: 응답 문자열에 기대한 내용이 없습니다. 기대: ${expected} 포함, 실제: ${actual.text}`;
    case "MINIMUM":
      return `${path}: 값이 범위를 벗어납니다. 기대: ${expected} 이상, 실제: ${actual.text}`;
    default:
      return `${path}: 값이 범위를 벗어납니다. 기대: ${expected} 이하, 실제: ${actual.text}`;
  }
}

/** expected를 보고서에 담을 값과 문장에 적을 글로 함께 만든다. */
function renderExpected(violation: SchemaViolation): { value: JsonValue; text: string } {
  if (violation.code === "CONST_MISMATCH") {
    const rendered = structuralValue(violation.expected, undefined);
    return { value: rendered.value, text: rendered.text };
  }
  if (violation.code === "ENUM_MISMATCH") {
    const candidates = Array.isArray(violation.expected)
      ? violation.expected
      : [violation.expected];
    const rendered = candidates.map((candidate) => structuralValue(candidate, undefined));
    return {
      value: rendered.map((entry) => entry.value),
      text: rendered.map((entry) => entry.text).join(" | "),
    };
  }
  const value = truncateExpected(violation.expected);
  // TYPE_MISMATCH의 기대는 타입 이름이므로 따옴표를 붙이지 않는다.
  return { value, text: violation.code === "TYPE_MISMATCH" ? String(value) : renderValue(value) };
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
  const expected = renderExpected(violation);
  const keys = pathKeys(violation.path);
  const actual =
    violation.code === "CONST_MISMATCH" || violation.code === "ENUM_MISMATCH"
      ? structuralValue(violation.actual, keys, options)
      : summarizeValue(violation.actual, keys, options);
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
    expected: expected.value,
    actual: actual.value,
    ...(actual.chars === undefined ? {} : { actualChars: actual.chars }),
    ...(observedKeys === undefined ? {} : { observedKeys }),
    ...(observedKeysTotal === undefined ? {} : { observedKeysTotal }),
    message: violationMessage(
      violation.code,
      path,
      expected.text,
      actual,
      observedKeys,
      observedKeysTotal,
    ),
  };
}

/**
 * 모양이 다르다는 위반. 이 밖의 코드는 모양은 같고 값이 다르다는 뜻이다(설계 §3.1).
 * 구조가 맞아야 값을 볼 수 있으므로, 하나라도 섞이면 구조 문구가 이긴다.
 */
const STRUCTURE_CODES: ReadonlySet<SchemaViolationCode> = new Set([
  "TYPE_MISMATCH",
  "REQUIRED_MISSING",
  "ADDITIONAL_PROPERTY",
]);

const TRUNCATED_HINT = "표시된 위반을 고친 뒤 나머지를 다시 확인하세요.";
const VALUE_HINT =
  "응답 형식은 같고 값만 다릅니다. 서버가 돌려준 값이 맞다면 테스트의 기대값을 고치고, 아니라면 서버 로직을 확인하세요. 값이 실행마다 바뀐다면 --determinism 으로 확인하세요.";

/**
 * 해결 문구를 고른다. 잘린 결과는 부류와 무관하게 기존 문구다. 판정은 **표시된** 위반만 본다.
 * 구조 문구는 통로마다 다르다. 구조화 응답은 원인(출력 계약)을 이미 가리키는 문장이 있어서다.
 */
function schemaMismatchHint(result: SchemaMatchResult, structureHint: string): string {
  if (result.totalViolations > result.violations.length) return TRUNCATED_HINT;
  return result.violations.some((violation) => STRUCTURE_CODES.has(violation.code))
    ? structureHint
    : VALUE_HINT;
}

/** diff 의 상한(줄). 넘으면 만들지 않는다. 위반 줄은 그대로 남으므로 정보는 잃지 않는다. */
const MAX_DIFF_LINES = 60;
/**
 * diff 의 상한(UTF-8 바이트). 줄 수만으로는 막지 못한다. 위반이 아닌 필드의 긴 문자열도 한 줄로
 * 통째로 실리기 때문이다. 케이스 예산(`DEFAULT_MAX_CASE_BYTES`, 64KiB)의 8분의 1이라 위반 줄·notes
 * 와 함께 실려도 예산을 넘기지 않는다. 넘으면 만들지 않는다. 줄 상한과 같은 이유로 잃는 것이 없다.
 */
const MAX_DIFF_BYTES = 8192;

type PathStep = { kind: "key"; key: string } | { kind: "index"; index: number };

const isScalar = (value: JsonValue): boolean => value === null || typeof value !== "object";

/**
 * schema-match 가 만든 경로(`$.a[0].b`)를 단계로 푼다. `pathKeys` 와 달리 배열 인덱스를 남긴다.
 * 키는 이스케이프되지 않고 경로에 들어가므로(`${path}.${key}`), 키에 `.`·`[`·`]` 가 있으면 경로가
 * 모호하다. 따라가는 동안 만나는 객체에 그런 키가 하나라도 있거나 길이 막히면 undefined 다.
 */
function resolvePath(body: JsonValue, path: string): PathStep[] | undefined {
  if (!path.startsWith("$")) return undefined;
  const steps: PathStep[] = [];
  const pattern = /\.([^.[\]]+)|\[(\d+)\]/y;
  pattern.lastIndex = 1;
  while (pattern.lastIndex < path.length) {
    const matched = pattern.exec(path);
    if (matched === null) return undefined;
    steps.push(
      matched[1] !== undefined
        ? { kind: "key", key: matched[1] }
        : { kind: "index", index: Number(matched[2]) },
    );
  }
  let current: JsonValue = body;
  for (const step of steps) {
    if (step.kind === "index") {
      if (!Array.isArray(current) || step.index >= current.length) return undefined;
      current = current[step.index] as JsonValue;
      continue;
    }
    if (!plainObject(current) || !Object.hasOwn(current, step.key)) return undefined;
    if (Object.keys(current).some((key) => /[.[\]]/.test(key))) return undefined;
    current = current[step.key] as JsonValue;
  }
  return steps;
}

/** 경로 위치의 값을 바꾼다. 경로는 `resolvePath` 가 이미 확인한 것이다. */
function replaceAt(root: JsonValue, steps: readonly PathStep[], value: JsonValue): void {
  let current = root as Record<string, JsonValue> | JsonValue[];
  steps.forEach((step, position) => {
    const last = position === steps.length - 1;
    if (step.kind === "index") {
      const array = current as JsonValue[];
      if (last) array[step.index] = value;
      else current = array[step.index] as Record<string, JsonValue> | JsonValue[];
      return;
    }
    const object = current as Record<string, JsonValue>;
    // `__proto__` 키에 대입하면 프로토타입 세터가 불린다. sanitization.ts 와 같은 이유다.
    if (last)
      Object.defineProperty(object, step.key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    else current = object[step.key] as Record<string, JsonValue> | JsonValue[];
  });
}

/** 키를 정렬해 2칸 들여쓴 JSON 줄. 서버가 키 순서를 바꿔도 같은 줄이 나온다. */
const canonicalLines = (value: JsonValue): string[] =>
  JSON.stringify(JSON.parse(canonicalJson(value)), null, 2).split("\n");

/**
 * 값 불일치가 여럿일 때 기대와 실제를 줄 단위로 맞댄다. 설계 §3.5 의 조건을 하나라도 못 맞추면
 * undefined 다. 못 만든 diff 는 위반 줄이 대신 말하므로 조용히 빠져도 잃는 것이 없다.
 *
 * 가림 대상 경로의 위반이 있으면 만들지 않는다. 키 기반 가림은 기대와 실제를 같은 표기로 만들어
 * 다른 값을 "같음" 으로 보이게 한다. 틀린 말을 하는 diff 는 없는 것보다 나쁘다.
 */
function constMismatchDiff(
  result: SchemaMatchResult,
  body: JsonValue,
  options?: RunnerRedactionOptions,
): string[] | undefined {
  const { violations } = result;
  if (result.totalViolations !== violations.length || violations.length < 2) return undefined;
  if (violations.some((violation) => violation.code !== "CONST_MISMATCH")) return undefined;
  if (isScalar(body)) return undefined;
  if (violations.some((violation) => !isScalar(violation.expected) || !isScalar(violation.actual)))
    return undefined;

  const actual = sanitizeJsonValue(body, options);
  const expected = JSON.parse(JSON.stringify(actual)) as JsonValue;
  for (const violation of violations) {
    const steps = resolvePath(body, violation.path);
    if (steps === undefined) return undefined;
    const keys = steps.flatMap((step) => (step.kind === "key" ? [step.key] : []));
    // null 은 값 가림에 안 걸리므로, REDACTED 가 나오면 경로의 키(조상 포함)가 가림 대상이다.
    if (redactByPath(null, keys, options) === REDACTED) return undefined;
    const expectedValue = sanitizeJsonValue(violation.expected, options);
    // 값 가림(sensitiveValues)이 양쪽을 같은 표기로 만든 경우도 같은 이유로 만들지 않는다.
    if (expectedValue === sanitizeJsonValue(violation.actual, options)) return undefined;
    replaceAt(expected, steps, expectedValue);
  }

  const expectedLines = canonicalLines(expected);
  const actualLines = canonicalLines(actual);
  // 조건 4(스칼라끼리)라 두 줄 수가 같다. 다르면 맞댈 수 없으므로 만들지 않는다.
  if (expectedLines.length !== actualLines.length) return undefined;
  const diff: string[] = [];
  // sanitization.ts 의 바이트 계산과 같은 도구를 쓴다.
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const [index, line] of expectedLines.entries()) {
    const other = actualLines[index] as string;
    for (const text of line === other ? [`  ${line}`] : [`- ${line}`, `+ ${other}`]) {
      // 줄바꿈 한 바이트를 포함해 센다. 화면과 JSON 어느 쪽에서도 줄마다 구분자가 붙는다.
      bytes += encoder.encode(text).byteLength + 1;
      if (bytes > MAX_DIFF_BYTES) return undefined;
      diff.push(text);
    }
  }
  return diff.length > MAX_DIFF_LINES ? undefined : diff;
}

/**
 * `body` 는 검사한 응답 본문이다. 주면 값 불일치가 여럿일 때 diff 를 만든다(설계 §3.5).
 * 안 주면 diff 키가 없다.
 */
export function bodySchemaMismatchDiagnostic(
  result: SchemaMatchResult,
  options?: RunnerRedactionOptions,
  body?: JsonValue,
): RunnerDiagnostic {
  const truncated = result.totalViolations > result.violations.length;
  const diff = body === undefined ? undefined : constMismatchDiff(result, body, options);
  return {
    code: "BODY_SCHEMA_MISMATCH",
    message: truncated
      ? `응답이 기대 스키마와 다릅니다. 위반 ${result.totalViolations}건 중 ${result.violations.length}건을 표시합니다.`
      : `응답이 기대 스키마와 다릅니다. 위반 ${result.totalViolations}건.`,
    hint: schemaMismatchHint(
      result,
      "응답의 형식이 기대와 다릅니다. 서버의 응답 형식 변경이 의도된 것이라면 테스트의 기대 스키마를 업데이트하세요.",
    ),
    violations: result.violations.map((violation) => toViolationDiagnostic(violation, options)),
    totalViolations: result.totalViolations,
    ...(diff === undefined ? {} : { diff }),
  };
}

export function structuredContentSchemaMismatchDiagnostic(
  result: SchemaMatchResult,
  expected: JsonValue,
  actual: JsonValue,
  options?: RunnerRedactionOptions,
): RunnerDiagnostic {
  const truncated = result.totalViolations > result.violations.length;
  return {
    code: "STRUCTURED_CONTENT_SCHEMA_MISMATCH",
    message: truncated
      ? `구조화된 응답이 저장된 출력 계약과 다릅니다. 위반 ${result.totalViolations}건 중 ${result.violations.length}건을 표시합니다.`
      : `구조화된 응답이 저장된 출력 계약과 다릅니다. 위반 ${result.totalViolations}건.`,
    expected: sanitizeJsonValue(expected, options),
    actual: sanitizeJsonValue(actual, options),
    hint: schemaMismatchHint(
      result,
      "서버의 outputSchema 또는 structuredContent 변경이 의도된 것인지 확인하세요.",
    ),
    violations: result.violations.map((violation) => toViolationDiagnostic(violation, options)),
    totalViolations: result.totalViolations,
  };
}

export function structuredContentExtractionFailedDiagnostic(failure: {
  code: "RAW_NOT_OBJECT" | "MISSING" | "INVALID_JSON";
  actual: string;
}): RunnerDiagnostic {
  if (failure.code === "RAW_NOT_OBJECT")
    return {
      code: "STRUCTURED_CONTENT_EXTRACTION_FAILED",
      message: `구조화된 응답을 읽을 수 없습니다. raw 응답이 객체가 아닙니다. 실제 타입: ${failure.actual}`,
      actual: failure.actual,
      hint: "MCP 클라이언트 어댑터가 원본 callTool 응답을 raw에 보존하는지 확인하세요.",
    };
  if (failure.code === "MISSING")
    return {
      code: "STRUCTURED_CONTENT_EXTRACTION_FAILED",
      message: "저장된 출력 계약을 검사할 structuredContent가 응답에 없습니다.",
      actual: failure.actual,
      hint: "서버가 outputSchema를 선언했다면 정상 응답에 structuredContent도 반환해야 합니다.",
    };
  return {
    code: "STRUCTURED_CONTENT_EXTRACTION_FAILED",
    message: `structuredContent가 JSON 값이 아닙니다. 실제 타입: ${failure.actual}`,
    actual: failure.actual,
    hint: "서버가 순환 참조나 JSON으로 표현할 수 없는 값을 반환하지 않는지 확인하세요.",
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
  // 블록 type은 text가 맞고 text 필드가 문제인 경우다. 블록 type 문제로 적으면
  // 읽는 사람이 엉뚱한 필드를 본다.
  if (failure.code === "CONTENT_TEXT_MISSING")
    return {
      code: "BODY_EXTRACTION_FAILED",
      message: `${prefix} content 블록의 text 필드가 문자열이 아닙니다. 실제 타입: ${failure.actual}`,
      actual: failure.actual,
      hint: "서버가 text 블록의 text에 문자열을 넣는지 확인하세요.",
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

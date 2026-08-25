import type { JsonObject, JsonValue, TestCaseSpec } from "./spec/types.js";

export const REDACTED = "[REDACTED]";
export const DEFAULT_MAX_CASE_BYTES = 65_536;
export const DEFAULT_MAX_REPORT_BYTES = 1_048_576;
/**
 * 보고서 크기가 상한의 이 비율 이상이면 `RunnerReport.payload` 를 만들어 알린다(#92).
 * 상한은 올릴 수 없고 넘으면 예외로 죽으므로, 닿기 전에 사용자가 조치할 여유를 준다. 80% 는
 * 케이스 하나가 더 붙어도 대개 안 넘는 여유이면서, 대부분의 실행에서는 조용한 값이다.
 */
export const REPORT_PAYLOAD_NOTICE_RATIO = 0.8;
/**
 * 기본 민감 키 목록. 항목은 `normalizeSensitiveKey` 를 거친 형태(소문자, 구분자 없음)다.
 *
 * `record` 의 `shared/sensitive-keys.mjs` 와 같은 목록·같은 판정 규칙(ADR-0039·0045)을
 * 쓴다. 의존 방향이 `runner` → `core` 뿐이라 import 는 못 하고 사본으로 둔다. **한쪽을 고치면
 * 다른 쪽도 같이 고쳐라.** 두 목록이 갈라지면 같은 응답이 카세트에서는 가려지고 실패 메시지에는
 * 원문으로 찍힌다(#183).
 *
 * `key` 단독을 넣지 않는 이유는 ADR-0039(`cacheKey`·`partitionKey` 가 전부 걸린다),
 * `auth`·`pwd`·`bearer` 를 뺀 이유는 ADR-0045 에 있다. `clientsecret` 은 record 목록에 없지만
 * `clientSecret` 은 접미 `secret` 으로 이미 걸리므로 있어도 판정이 달라지지 않는다.
 */
export const DEFAULT_SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "privatekey",
  "secretkey",
  "signingkey",
  "sessionkey",
  "credential",
]);

export interface RunnerRedactionOptions {
  sensitiveKeys?: readonly string[];
  sensitiveValues?: readonly string[];
}
export interface RunnerPayloadLimits {
  maxCaseBytes?: number;
  maxReportBytes?: number;
}
export class RunnerPayloadLimitError extends Error {
  override readonly name = "RunnerPayloadLimitError";
  readonly scope: "case" | "report";
  readonly limitBytes: number;
  readonly actualBytes: number;
  readonly caseId?: string;
  constructor(options: {
    scope: "case" | "report";
    limitBytes: number;
    actualBytes: number;
    caseId?: string;
  }) {
    super(`Runner ${options.scope} payload exceeds ${options.limitBytes} bytes.`);
    this.scope = options.scope;
    this.limitBytes = options.limitBytes;
    this.actualBytes = options.actualBytes;
    this.caseId = options.caseId;
  }
}
export function normalizeSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
/**
 * 키를 단어열로 쪼갠다. 구분자를 **지워서** 이어 붙이면 경계가 사라져 `tokenCount` 와
 * `accessToken` 을 구분할 수 없다. 그래서 지우지 않고 쪼갠다. 꼬리 숫자는 뗀다. `apiKey0` 은
 * 여전히 API 키이고, 머리 명사는 그대로라 `cookieCount2` 가 새로 걸리지도 않는다.
 */
const keyWords = (key: string): string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // 연속 대문자 뒤에 단어가 오는 경우. `APIKey` → `API Key`
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[-_ ]+/)
    .map((word) => word.toLowerCase().replace(/[0-9]+$/, ""))
    .filter((word) => word.length > 0);
/**
 * 키의 **접미 단어열**이 목록과 정확히 일치하면 민감으로 본다(ADR-0039).
 *
 * 영어 합성명사는 마지막 단어가 머리라서 `accessToken` 은 토큰의 일종이고 `tokenCount` 는 개수의
 * 일종이다. 정확 일치로 보면 `sessionToken` 이 새고, 부분 포함으로 보면 `tokenCount` 가 가려져
 * 테스트가 그 필드를 영영 못 본다. 접미로 보되 한 단어씩만 보지 않는 이유는 `X-Api-Key` 다.
 * 마지막 단어 `key` 는 목록에 없고 `apikey` 가 있다.
 *
 * 목록이 단수형만 담으므로 꼬리 `s` 를 뗀 형태도 조회한다(ADR-0045). 머리 명사는 건드리지
 * 않으므로 `tokenCounts` 는 계속 통과한다.
 */
export function isSensitiveKey(keys: ReadonlySet<string>, key: string): boolean {
  const words = keyWords(key);
  for (let start = words.length - 1; start >= 0; start -= 1) {
    const joined = words.slice(start).join("");
    if (keys.has(joined)) return true;
    if (joined.endsWith("s") && keys.has(joined.slice(0, -1))) return true;
  }
  return false;
}
export function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
export function resolvePayloadLimits(
  options: RunnerPayloadLimits | undefined,
): Required<RunnerPayloadLimits> {
  const caseLimit = options?.maxCaseBytes ?? DEFAULT_MAX_CASE_BYTES;
  const reportLimit = options?.maxReportBytes ?? DEFAULT_MAX_REPORT_BYTES;
  for (const [value, maximum] of [
    [caseLimit, DEFAULT_MAX_CASE_BYTES],
    [reportLimit, DEFAULT_MAX_REPORT_BYTES],
  ] as const)
    if (!Number.isInteger(value) || value < 1 || value > maximum)
      throw new RangeError("Payload limit must be a positive integer within the default limit.");
  return { maxCaseBytes: caseLimit, maxReportBytes: reportLimit };
}
function sanitizeValue(
  value: JsonValue,
  keys: ReadonlySet<string>,
  values: ReadonlySet<string>,
): JsonValue {
  if (typeof value === "string") return values.has(value) ? REDACTED : value;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, keys, values));
  const copy: JsonObject = {};
  // copy[key] 대입은 key가 "__proto__"일 때 Object.prototype 세터를 건드려 자기 속성을
  // 만들지 못한다. 그러면 응답에 있던 키가 조용히 사라진다.
  for (const [key, nestedValue] of Object.entries(value))
    Object.defineProperty(copy, key, {
      value: isSensitiveKey(keys, key) ? REDACTED : sanitizeValue(nestedValue, keys, values),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return copy;
}
export function sanitizeJsonValue(value: JsonValue, options?: RunnerRedactionOptions): JsonValue {
  const keys = new Set(DEFAULT_SENSITIVE_KEYS);
  for (const key of options?.sensitiveKeys ?? []) keys.add(normalizeSensitiveKey(key));
  return sanitizeValue(value, keys, new Set(options?.sensitiveValues ?? []));
}
export function sanitizeCase(
  caseSpec: TestCaseSpec,
  options?: RunnerRedactionOptions,
): TestCaseSpec {
  const copy = JSON.parse(JSON.stringify(caseSpec)) as TestCaseSpec;
  if (copy.operation.type === "callTool")
    copy.operation.input = sanitizeJsonValue(copy.operation.input, options) as JsonObject;
  return copy;
}

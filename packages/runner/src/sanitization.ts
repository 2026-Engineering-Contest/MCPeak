import type { JsonObject, JsonValue, TestCaseSpec } from "./spec/types.js";

export const REDACTED = "[REDACTED]";
export const DEFAULT_MAX_CASE_BYTES = 65_536;
export const DEFAULT_MAX_REPORT_BYTES = 1_048_576;
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
  for (const [key, nestedValue] of Object.entries(value))
    copy[key] = keys.has(normalizeSensitiveKey(key))
      ? REDACTED
      : sanitizeValue(nestedValue, keys, values);
  return copy;
}
export function sanitizeCase(
  caseSpec: TestCaseSpec,
  options?: RunnerRedactionOptions,
): TestCaseSpec {
  const keys = new Set(DEFAULT_SENSITIVE_KEYS);
  for (const key of options?.sensitiveKeys ?? []) keys.add(normalizeSensitiveKey(key));
  const values = new Set(options?.sensitiveValues ?? []);
  const copy = JSON.parse(JSON.stringify(caseSpec)) as TestCaseSpec;
  if (copy.operation.type === "callTool")
    copy.operation.input = sanitizeValue(copy.operation.input, keys, values) as JsonObject;
  return copy;
}

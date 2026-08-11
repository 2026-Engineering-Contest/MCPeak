import type { JsonValue } from "./spec/types.js";

export type RunnerDiagnosticCode =
  | "TOOL_NOT_FOUND"
  | "IS_ERROR_MISMATCH"
  | "OPERATION_FAILED"
  | "OPERATION_RESULT_UNAVAILABLE"
  | "CASE_TIMEOUT"
  | "RUN_ABORTED";

export interface RunnerDiagnostic {
  code: RunnerDiagnosticCode;
  message: string;
  expected?: JsonValue;
  actual?: JsonValue;
  hint: string;
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

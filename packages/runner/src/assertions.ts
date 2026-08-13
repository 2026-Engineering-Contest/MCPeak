import type { ToolDef, ToolResult } from "@ohmymcp/core";
import type { BodyExtraction } from "./body.js";
import {
  bodyExtractionFailedDiagnostic,
  bodySchemaMismatchDiagnostic,
  isErrorMismatchDiagnostic,
  operationResultUnavailableDiagnostic,
  type RunnerDiagnostic,
  toolNotFoundDiagnostic,
} from "./diagnostics.js";
import type { RunnerRedactionOptions } from "./sanitization.js";
import { matchResponseSchema } from "./schema-match.js";
import type {
  AssertionSpec,
  BodyMatchesSchemaAssertionSpec,
  IsErrorAssertionSpec,
  ToolExistsAssertionSpec,
} from "./spec/types.js";

export interface AssertionResult {
  spec: AssertionSpec;
  status: "passed" | "failed" | "skipped" | "notRun";
  diagnostic?: RunnerDiagnostic;
}

export function assertToolExists(
  tools: readonly ToolDef[],
  spec: ToolExistsAssertionSpec,
): AssertionResult {
  if (tools.some((tool) => tool.name === spec.tool)) {
    return { spec, status: "passed" };
  }

  const actual = [...new Set(tools.map((tool) => tool.name))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return { spec, status: "failed", diagnostic: toolNotFoundDiagnostic(spec.tool, actual) };
}

export function assertIsError(result: ToolResult, spec: IsErrorAssertionSpec): AssertionResult {
  if (result.isError === spec.expected) return { spec, status: "passed" };
  return {
    spec,
    status: "failed",
    diagnostic: isErrorMismatchDiagnostic(spec.expected, result.isError),
  };
}

/**
 * 응답 본문을 스키마로 검사한다. 추출은 executor가 케이스당 한 번 수행해 넘긴다.
 * extraction이 undefined면 선행 MCP 작업 결과가 없는 경우이므로 skipped다.
 */
export function assertBodyMatchesSchema(
  extraction: BodyExtraction | undefined,
  spec: BodyMatchesSchemaAssertionSpec,
  options?: { redaction?: RunnerRedactionOptions },
): AssertionResult {
  if (extraction === undefined)
    return { spec, status: "skipped", diagnostic: operationResultUnavailableDiagnostic() };
  if (!extraction.ok)
    return {
      spec,
      status: "failed",
      diagnostic: bodyExtractionFailedDiagnostic(extraction.failure),
    };

  const result = matchResponseSchema(spec.schema, extraction.body);
  if (result.totalViolations === 0) return { spec, status: "passed" };
  return {
    spec,
    status: "failed",
    diagnostic: bodySchemaMismatchDiagnostic(result, options?.redaction),
  };
}

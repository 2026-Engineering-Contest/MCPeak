import type { ToolDef, ToolResult } from "@ohmymcp/core";
import {
  isErrorMismatchDiagnostic,
  type RunnerDiagnostic,
  toolNotFoundDiagnostic,
} from "./diagnostics.js";
import type { AssertionSpec, IsErrorAssertionSpec, ToolExistsAssertionSpec } from "./spec/types.js";

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

import type { McpClient, ToolResult } from "@ohmymcp/core";

export type { AssertionResult } from "./assertions.js";
export {
  type BodyExtraction,
  type BodyExtractionFailure,
  type BodyForm,
  extractResponseBody,
} from "./body.js";
export type { RunnerDiagnostic, RunnerDiagnosticCode } from "./diagnostics.js";
export {
  type OperationResult,
  type RunnerDrainResult,
  type RunnerEvent,
  type RunnerExecution,
  type RunnerReport,
  type RunnerSummary,
  type RunSuiteOptions,
  runSuite,
  type TestCaseResult,
} from "./executor.js";
export {
  DEFAULT_MAX_CASE_BYTES,
  DEFAULT_MAX_REPORT_BYTES,
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
  RunnerPayloadLimitError,
  type RunnerPayloadLimits,
  type RunnerRedactionOptions,
} from "./sanitization.js";
export {
  MAX_SCHEMA_VIOLATIONS,
  matchResponseSchema,
  type SchemaMatchResult,
  type SchemaViolation,
  type SchemaViolationCode,
} from "./schema-match.js";
export {
  type FinalizeRunnerExecutionOptions,
  finalizeRunnerExecution,
  type McpClientShutdownController,
  type RunnerForceCloseReason,
  RunnerShutdownTimeoutError,
} from "./shutdown.js";
export { MCP_SUITE_JSON_SCHEMA } from "./spec/json-schema.js";
export type {
  AssertionSpec,
  BodyMatchesSchemaAssertionSpec,
  CallToolCaseSpec,
  IsErrorAssertionSpec,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ListToolsCaseSpec,
  ReadonlyJsonObject,
  ReadonlyJsonValue,
  ResponseSchema,
  SuiteValidationIssue,
  SuiteValidationIssueCode,
  SuiteValidationResult,
  TestCaseBase,
  TestCaseSpec,
  TestSuiteSpec,
  ToolExistsAssertionSpec,
  ToolListAssertionSpec,
  ToolResultAssertionSpec,
} from "./spec/types.js";
export { SuiteValidationError } from "./spec/types.js";
export { defineMcpSuite, validateMcpSuite } from "./spec/validation.js";

/** `createMcpTest` 에 넘기는 설정. */
export interface McpTestConfig {
  client: McpClient;
}

/** 각 테스트 본문에 전달되는 컨텍스트. */
export interface McpTestContext {
  client: McpClient;
}

export type TestBody = (ctx: McpTestContext) => void | Promise<void>;

/** matcher 가 반환하는 결과. `message` 는 실패 시 출력할 사람이 읽는 문장이다. */
export interface MatchResult {
  pass: boolean;
  message: () => string;
}

/**
 * MCP 서버에 대한 테스트 스위트를 정의한다.
 *
 * 아직 구현되지 않음 — `runner` 오너가 채운다.
 */
export function createMcpTest(config: McpTestConfig, body: TestBody): void {
  throw new Error("not implemented");
}

/**
 * matcher: 툴 목록에 주어진 이름의 툴이 있는지 단언한다.
 * 실패 메시지가 곧 제품이다 — 무엇이 왜 다른지 보여줘야 한다 (CLAUDE.md).
 *
 * 아직 구현되지 않음 — `runner` 오너가 채운다.
 */
export function toContainTool(result: ToolResult, name: string): MatchResult {
  throw new Error("not implemented");
}

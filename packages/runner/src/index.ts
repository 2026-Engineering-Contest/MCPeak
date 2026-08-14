import type { McpClient, ToolResult } from "@ohmymcp/core";

export { checkAssertionSubstance } from "./assertion-substance.js";
export { type AssertionResult, assertBodyMatchesSchema } from "./assertions.js";
export {
  type BodyExtraction,
  type BodyExtractionFailure,
  type BodyForm,
  extractResponseBody,
} from "./body.js";
export { canonicalJson, deepFreeze, sha256 } from "./canonical.js";
export {
  bodyExtractionFailedDiagnostic,
  bodySchemaMismatchDiagnostic,
  MAX_OBSERVED_KEYS,
  MAX_VALUE_STRING_CHARS,
  type RunnerDiagnostic,
  type RunnerDiagnosticCode,
  type SchemaViolationDiagnostic,
} from "./diagnostics.js";
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
export { suiteFingerprint } from "./fingerprint.js";
export { checkInputContract, type InputContractOptions } from "./input-contract.js";
export { type JUnitRenderOptions, renderJUnit } from "./junit.js";
export { type RenderReportOptions, renderReport } from "./reporter.js";
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
  SuiteApproval,
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
export {
  describeSpecFinding,
  MAX_FINDINGS_PER_CASE,
  type SpecFinding,
  type SpecFindingCode,
  type SpecFindingsResult,
} from "./spec-findings.js";

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
 * @deprecated ADR-0002 에 따라 구현하지 않는다. 선언형 {@link defineMcpSuite} 로 명세를
 * 만들고 {@link runSuite} 로 실행하라. 호출하면 `not implemented` 를 던지며 이는 의도된
 * 동작이다. minor 에서 제거하지 않고, 제거는 major 릴리스와 migration 문서를 동반한다.
 */
export function createMcpTest(config: McpTestConfig, body: TestBody): void {
  throw new Error("not implemented");
}

/**
 * matcher: 툴 목록에 주어진 이름의 툴이 있는지 단언한다.
 *
 * @deprecated ADR-0002 에 따라 구현하지 않는다. 툴 존재 검사는 선언형 명세의
 * `{ type: "toolExists", tool }` assertion 을 쓰고, 실패 진단은 `diagnostics.ts` 가
 * 소유한다. 호출하면 `not implemented` 를 던지며 이는 의도된 동작이다. 제거는 major
 * 릴리스와 migration 문서를 동반한다.
 */
export function toContainTool(result: ToolResult, name: string): MatchResult {
  throw new Error("not implemented");
}

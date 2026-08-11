export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ReadonlyJsonValue = JsonPrimitive | readonly ReadonlyJsonValue[] | ReadonlyJsonObject;
export type ReadonlyJsonObject = { readonly [key: string]: ReadonlyJsonValue };

export interface TestSuiteSpec {
  schemaVersion: 1;
  id: string;
  name: string;
  defaultTimeoutMs?: number;
  cases: TestCaseSpec[];
}
export interface TestCaseBase {
  id: string;
  name: string;
  timeoutMs?: number;
}
export interface ListToolsCaseSpec extends TestCaseBase {
  operation: { type: "listTools" };
  assertions: ToolExistsAssertionSpec[];
}
export interface CallToolCaseSpec extends TestCaseBase {
  operation: { type: "callTool"; tool: string; input: JsonObject };
  assertions: IsErrorAssertionSpec[];
}
export type TestCaseSpec = ListToolsCaseSpec | CallToolCaseSpec;
export interface ToolExistsAssertionSpec {
  type: "toolExists";
  tool: string;
}
export interface IsErrorAssertionSpec {
  type: "isError";
  expected: boolean;
}
export type ToolListAssertionSpec = ToolExistsAssertionSpec;
export type ToolResultAssertionSpec = IsErrorAssertionSpec;
export type AssertionSpec = ToolListAssertionSpec | ToolResultAssertionSpec;
export type SuiteValidationIssueCode =
  | "MISSING_REQUIRED_FIELD"
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "DUPLICATE_CASE_ID"
  | "EMPTY_CASES"
  | "EMPTY_ASSERTIONS"
  | "INCOMPATIBLE_ASSERTION"
  | "INVALID_JSON_VALUE"
  | "INVALID_TIMEOUT";
export interface SuiteValidationIssue {
  code: SuiteValidationIssueCode;
  path: string;
  message: string;
  hint: string;
}
export type SuiteValidationResult =
  | { valid: true; value: TestSuiteSpec }
  | { valid: false; issues: SuiteValidationIssue[] };
export class SuiteValidationError extends Error {
  override readonly name = "SuiteValidationError";
  readonly issues: SuiteValidationIssue[];
  constructor(issues: SuiteValidationIssue[]) {
    super("MCP 테스트 명세가 유효하지 않습니다.");
    this.issues = issues;
  }
}

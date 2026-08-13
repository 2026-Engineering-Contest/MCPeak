export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ReadonlyJsonValue = JsonPrimitive | readonly ReadonlyJsonValue[] | ReadonlyJsonObject;
export type ReadonlyJsonObject = { readonly [key: string]: ReadonlyJsonValue };

export interface SuiteApproval {
  /**
   * 승인 시점 명세의 sha256 hex 64자, 소문자.
   * 이 블록 자신은 지문 계산에서 제외된다. 계산 규칙은 suiteFingerprint 하나가 소유한다.
   */
  fingerprint: string;
}

export interface TestSuiteSpec {
  schemaVersion: 1;
  id: string;
  name: string;
  approval?: SuiteApproval;
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
  assertions: ToolResultAssertionSpec[];
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
/** 응답 본문 단언이 쓰는 JSON Schema 부분집합. 지원 범위는 ADR-0010에 있다. */
export interface ResponseSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  const?: JsonValue;
  enum?: JsonValue[];

  required?: string[];
  properties?: { [key: string]: ResponseSchema };
  additionalProperties?: boolean | ResponseSchema;

  items?: ResponseSchema;
  minItems?: number;

  minLength?: number;
  maxLength?: number;
  stringContains?: string;

  minimum?: number;
  maximum?: number;
}
export interface BodyMatchesSchemaAssertionSpec {
  type: "bodyMatchesSchema";
  schema: ResponseSchema;
}
export type ToolListAssertionSpec = ToolExistsAssertionSpec;
export type ToolResultAssertionSpec = IsErrorAssertionSpec | BodyMatchesSchemaAssertionSpec;
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
  | "INVALID_TIMEOUT"
  | "UNSUPPORTED_SCHEMA_KEYWORD"
  | "SCHEMA_KEYWORD_REQUIRES_TYPE";
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

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ReadonlyJsonValue = JsonPrimitive | readonly ReadonlyJsonValue[] | ReadonlyJsonObject;
export type ReadonlyJsonObject = { readonly [key: string]: ReadonlyJsonValue };

/**
 * 승인 시점에 사람이 케이스에 매긴 판정.
 * `serverDefect` 는 "케이스는 맞고 서버가 틀렸다" 는 뜻이다. 저장은 하되 실행 판정은 바꾸지
 * 않는다. 설계 문서 §9. 분류 셋 중 `specError` 는 파일에 남지 않는다. 설계 문서 §7.2.
 */
export type CaseApprovalStatus = "passed" | "serverDefect";

export interface SuiteCaseApproval {
  /** 대상 케이스의 id. `cases[].id` 와 같은 값이지만 실재 여부는 검증하지 않는다(§7.3). */
  readonly id: string;
  readonly status: CaseApprovalStatus;
}

export interface SuiteApproval {
  /**
   * 승인 시점 명세의 sha256 hex 64자, 소문자.
   * 이 블록 자신은 지문 계산에서 제외된다. 계산 규칙은 suiteFingerprint 하나가 소유한다.
   */
  readonly fingerprint: string;
  /**
   * 케이스별 판정. 시각·환경을 넣지 않는다. 결정론성 계약이 깨지고 "언제 승인했나" 는 git 이
   * 답한다. 설계 문서 §7.1.
   */
  readonly cases?: readonly SuiteCaseApproval[];
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

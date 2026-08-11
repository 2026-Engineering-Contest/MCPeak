# Runner Declarative Suite Implementation Plan

> **For agentic workers:** REQUIRED PROJECT SKILL: Use `plan-conventions` when changing this plan and `execution-conventions` when executing it. Implement each task with `superpowers:test-driven-development`; use `superpowers:systematic-debugging` for unexpected failures and `superpowers:verification-before-completion` before reporting completion.

**Goal:** Implement the first deterministic `TestSuiteSpec → RunnerEvent[] + RunnerReport` vertical slice in `@ohmymcp/runner`, with `toolExists`, `isError`, validation, timeout, cancellation, and a generate-ready public contract.

**Architecture:** Keep the JSON-compatible specification contract isolated under `src/spec/`, re-export it from the existing package root, and let a sequential executor consume only the frozen `McpClient` contract. Assertions return structured results rather than throwing. Runner keeps private operational inputs separate from sanitized observer snapshots, returns an independently completing report plus a bounded non-rejecting drain result, and retains each sanitized case specification and diagnostic so generate can later build reviewed single-case or batch repair requests.

**Tech Stack:** TypeScript 5.9, Vitest 4, tsdown, Biome, Node.js 20+, pnpm workspaces. Add no dependency.

## Global Constraints

- Modify only `packages/runner/**`, `.changeset/runner-declarative-suite.md`, and this Runner design/plan documentation.
- Do not modify `packages/core/src/types.ts`, another package, or root build configuration.
- Keep `@modelcontextprotocol/sdk` unchanged and add no dependency.
- Implement tests before production code and observe each intended RED failure before GREEN.
- Use in-memory fake clients and `fixtures/tools-list.sample.json`; do not start a real MCP server.
- Preserve specification order, event order, result order, and deterministic diagnostics.
- Do not add timestamps, measured durations, random IDs, or parallel execution.
- `runSuite` must not close the client. Only explicit caller-invoked `finalizeRunnerExecution` may use the supplied shutdown controller.
- Expose sanitized event/report snapshots only; actual MCP calls use the private original input.
- Return a non-rejecting bounded `drain` result. Default deadline is 5,000ms; caller range is integer `1..60_000ms`.
- CLI, Dashboard Node, and test adapters must provide an idempotent shutdown controller; `finalizeRunnerExecution` bounds graceful and forced transport close independently of pending MCP calls.
- Enforce default observer limits of 65,536 bytes per case and 1,048,576 bytes per report.
- Child agents and the main agent must not commit, merge, or push. The user performs each commit after a review gate.
- Do not revert unrelated user changes. The current `.gitignore` and `docs/2026-08-11-runner-session-handoff.md` changes are outside implementation ownership.
- Design source of truth: `docs/superpowers/specs/2026-08-11-runner-design.md`.

---

## 1. File Map

### Create

- `packages/runner/src/spec/types.ts` — JSON values, suite/case/assertion types, validation result types.
- `packages/runner/src/spec/json-schema.ts` — exported `MCP_SUITE_JSON_SCHEMA` only.
- `packages/runner/src/spec/validation.ts` — deterministic runtime validation and `SuiteValidationError`.
- `packages/runner/src/spec/index.ts` — side-effect-free spec contract exports.
- `packages/runner/src/diagnostics.ts` — stable diagnostic factories and thrown-value normalization.
- `packages/runner/src/assertions.ts` — pure `toolExists` and `isError` evaluation.
- `packages/runner/src/sanitization.ts` — observer redaction, UTF-8 payload sizing, and limit errors.
- `packages/runner/src/executor.ts` — sequential execution, event emission, report construction, timeout, abort.
- `packages/runner/src/shutdown.ts` — bounded drain/graceful/force-close finalization with lossless error aggregation.
- `packages/runner/tests/spec-validation.test.ts` — validator and helper tests.
- `packages/runner/tests/spec-schema.test.ts` — JSON Schema contract tests.
- `packages/runner/tests/helpers/schema-evaluator.ts` — dev-only evaluator for the exact public Schema keyword subset.
- `packages/runner/tests/assertions.test.ts` — assertion and message tests.
- `packages/runner/tests/sanitization.test.ts` — recursive masking and payload-limit tests.
- `packages/runner/tests/executor.test.ts` — execution, event, report, timeout, and abort tests.
- `packages/runner/tests/shutdown.test.ts` — permanently pending calls, bounded transport termination, idempotence, and error preservation.
- `.changeset/runner-declarative-suite.md` — minor release note for Runner.

### Modify

- `packages/runner/src/index.ts` — re-export the approved API while retaining deprecated public stub shims.
- `packages/runner/tests/index.test.ts` — preserve deprecated named-export compatibility assertions.
- `packages/runner/package.json` — replace the stub-oriented description only.
- `packages/runner/README.md` — document declarative authoring and execution.

### Must remain unchanged

- `packages/runner/tsdown.config.mjs`
- `packages/runner/tsconfig.json`
- `packages/core/src/types.ts`
- `fixtures/tools-list.sample.json`
- `tsconfig.base.json`, `vitest.config.ts`, `biome.json`, root `package.json`

## 2. Dependency Graph and Wave

```text
Task 1: specification contract and validation
  ↓ user review and commit SHA
Task 2: assertions and diagnostics
  ↓ user review and commit SHA
Task 3: sequential executor, events, and report
  ↓ user review and commit SHA
Task 4: timeout and AbortSignal
  ↓ user review and commit SHA
Task 5: package documentation, changeset, full verification
```

All tasks share the Runner public contract and root export, so they run sequentially in one feature worktree. The main session orchestrates one implementation child and one reviewer child at a time. It verifies each report, allowed-file diff, and test output itself before asking the user for a commit.

## 3. Shared Public Contract

Task 1 must establish these exact names. Later tasks consume them without renaming.

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ReadonlyJsonValue =
  | JsonPrimitive
  | readonly ReadonlyJsonValue[]
  | ReadonlyJsonObject;
export type ReadonlyJsonObject = {
  readonly [key: string]: ReadonlyJsonValue;
};

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
  operation: {
    type: "callTool";
    tool: string;
    input: JsonObject;
  };
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

export function defineMcpSuite<const T extends TestSuiteSpec>(spec: T): T;
export function validateMcpSuite(input: unknown): SuiteValidationResult;

export class SuiteValidationError extends Error {
  override readonly name = "SuiteValidationError";
  readonly issues: SuiteValidationIssue[];

  constructor(issues: SuiteValidationIssue[]) {
    super("MCP 테스트 명세가 유효하지 않습니다.");
    this.issues = issues;
  }
}
```

The JSON Schema implementation is this exact object:

```ts
export const MCP_SUITE_JSON_SCHEMA: ReadonlyJsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ohmymcp.dev/schemas/test-suite/v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "name", "cases"],
  properties: {
    schemaVersion: { const: 1 },
    id: { $ref: "#/$defs/nonEmptyString" },
    name: { $ref: "#/$defs/nonEmptyString" },
    defaultTimeoutMs: { $ref: "#/$defs/timeoutMs" },
    cases: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          { $ref: "#/$defs/listToolsCase" },
          { $ref: "#/$defs/callToolCase" },
        ],
      },
    },
  },
  $defs: {
    nonEmptyString: { type: "string", minLength: 1, pattern: "\\S" },
    timeoutMs: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    jsonValue: {
      oneOf: [
        { type: "null" },
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "array", items: { $ref: "#/$defs/jsonValue" } },
        {
          type: "object",
          additionalProperties: { $ref: "#/$defs/jsonValue" },
        },
      ],
    },
    toolExistsAssertion: {
      type: "object",
      additionalProperties: false,
      required: ["type", "tool"],
      properties: {
        type: { const: "toolExists" },
        tool: { $ref: "#/$defs/nonEmptyString" },
      },
    },
    isErrorAssertion: {
      type: "object",
      additionalProperties: false,
      required: ["type", "expected"],
      properties: {
        type: { const: "isError" },
        expected: { type: "boolean" },
      },
    },
    listToolsCase: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "operation", "assertions"],
      properties: {
        id: { $ref: "#/$defs/nonEmptyString" },
        name: { $ref: "#/$defs/nonEmptyString" },
        timeoutMs: { $ref: "#/$defs/timeoutMs" },
        operation: {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: { type: { const: "listTools" } },
        },
        assertions: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/toolExistsAssertion" },
        },
      },
    },
    callToolCase: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "operation", "assertions"],
      properties: {
        id: { $ref: "#/$defs/nonEmptyString" },
        name: { $ref: "#/$defs/nonEmptyString" },
        timeoutMs: { $ref: "#/$defs/timeoutMs" },
        operation: {
          type: "object",
          additionalProperties: false,
          required: ["type", "tool", "input"],
          properties: {
            type: { const: "callTool" },
            tool: { $ref: "#/$defs/nonEmptyString" },
            input: {
              type: "object",
              additionalProperties: { $ref: "#/$defs/jsonValue" },
            },
          },
        },
        assertions: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/isErrorAssertion" },
        },
      },
    },
  },
};
```

The final executor contract is:

```ts
export interface RunnerDiagnostic {
  code: RunnerDiagnosticCode;
  message: string;
  expected?: JsonValue;
  actual?: JsonValue;
  hint: string;
}

export type RunnerDiagnosticCode =
  | "TOOL_NOT_FOUND"
  | "IS_ERROR_MISMATCH"
  | "OPERATION_FAILED"
  | "OPERATION_RESULT_UNAVAILABLE"
  | "CASE_TIMEOUT"
  | "RUN_ABORTED";

export type OperationResult =
  | {
      status: "completed" | "failed" | "timedOut" | "cancelled";
      timeoutMs: number;
      diagnostic?: RunnerDiagnostic;
    }
  | { status: "notRun"; diagnostic?: RunnerDiagnostic };

export interface AssertionResult {
  spec: AssertionSpec;
  status: "passed" | "failed" | "skipped" | "notRun";
  diagnostic?: RunnerDiagnostic;
}

export interface TestCaseResult {
  spec: TestCaseSpec;
  status: "passed" | "failed" | "timedOut" | "cancelled" | "notRun";
  operation: OperationResult;
  assertions: AssertionResult[];
}

export interface RunnerSummary {
  total: number;
  passed: number;
  failed: number;
  timedOut: number;
  cancelled: number;
  notRun: number;
}

export interface RunnerReport {
  schemaVersion: 1;
  suite: { id: string; name: string; defaultTimeoutMs?: number };
  status: "passed" | "failed" | "aborted";
  stopReason?:
    | { type: "timeout"; caseId: string }
    | { type: "abortSignal"; caseId?: string };
  cases: TestCaseResult[];
  summary: RunnerSummary;
}

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
  });
}

export interface RunSuiteOptions {
  client: McpClient;
  suite: TestSuiteSpec;
  signal?: AbortSignal;
  onEvent?: (event: RunnerEvent) => void;
  redaction?: RunnerRedactionOptions;
  payloadLimits?: RunnerPayloadLimits;
  drainTimeoutMs?: number;
}

export interface RunnerExecution {
  report: Promise<RunnerReport>;
  drain: Promise<RunnerDrainResult>;
}

export type RunnerDrainResult =
  | { status: "settled" }
  | { status: "deadlineExceeded"; pendingOperations: 1 };

export type RunnerForceCloseReason =
  | "drainDeadlineExceeded"
  | "gracefulCloseDeadlineExceeded";

export interface McpClientShutdownController {
  client: McpClient;
  close(): Promise<void>;
  forceClose(reason: RunnerForceCloseReason): Promise<void>;
}

export interface FinalizeRunnerExecutionOptions {
  execution: RunnerExecution;
  shutdown: McpClientShutdownController;
  closeTimeoutMs?: number;
  forceCloseTimeoutMs?: number;
}

export class RunnerShutdownTimeoutError extends Error {
  override readonly name = "RunnerShutdownTimeoutError";
  readonly phase = "forceClose";
  readonly limitMs: number;
}

export function runSuite(options: RunSuiteOptions): RunnerExecution;
export function finalizeRunnerExecution(
  options: FinalizeRunnerExecutionOptions,
): Promise<RunnerReport>;

export type RunnerEvent =
  | SuiteStartedEvent
  | CaseStartedEvent
  | OperationStartedEvent
  | OperationCompletedEvent
  | AssertionCompletedEvent
  | CaseCompletedEvent
  | SuiteCompletedEvent;

export interface RunnerEventBase {
  sequence: number;
}

export interface SuiteStartedEvent extends RunnerEventBase {
  type: "suiteStarted";
  suite: { id: string; name: string };
  totalCases: number;
}

export interface CaseStartedEvent extends RunnerEventBase {
  type: "caseStarted";
  caseId: string;
  caseIndex: number;
  case: TestCaseSpec;
}

export interface OperationStartedEvent extends RunnerEventBase {
  type: "operationStarted";
  caseId: string;
  caseIndex: number;
  operation: TestCaseSpec["operation"];
  timeoutMs: number;
}

export interface OperationCompletedEvent extends RunnerEventBase {
  type: "operationCompleted";
  caseId: string;
  caseIndex: number;
  result: OperationResult;
}

export interface AssertionCompletedEvent extends RunnerEventBase {
  type: "assertionCompleted";
  caseId: string;
  caseIndex: number;
  assertionIndex: number;
  result: AssertionResult;
}

export interface CaseCompletedEvent extends RunnerEventBase {
  type: "caseCompleted";
  caseId: string;
  caseIndex: number;
  result: TestCaseResult;
}

export interface SuiteCompletedEvent extends RunnerEventBase {
  type: "suiteCompleted";
  report: RunnerReport;
}
```

---

### Task 1: Specification Types, JSON Schema, and Validator

**Model:** `gpt-5.6-terra`, reasoning effort `medium`. This task freezes the package boundary consumed later by generate; unresolved contract conflicts may trigger the project-policy escalation path.

**Files:**

- Create: `packages/runner/src/spec/types.ts`
- Create: `packages/runner/src/spec/json-schema.ts`
- Create: `packages/runner/src/spec/validation.ts`
- Create: `packages/runner/src/spec/index.ts`
- Create: `packages/runner/tests/spec-validation.test.ts`
- Create: `packages/runner/tests/spec-schema.test.ts`
- Create: `packages/runner/tests/helpers/schema-evaluator.ts`
- Modify: `packages/runner/src/index.ts`
- Modify: `packages/runner/tests/index.test.ts`

**Consumes:** Frozen `McpClient` types only indirectly; this task must not import core.

**Produces:** All types and functions in Plan §3 up to `MCP_SUITE_JSON_SCHEMA`.

- [ ] **Step 1: Write validator tests before source implementation**

Use the following exact cases in `spec-validation.test.ts`:

```ts
it("유효한 listTools와 callTool 명세를 검증한다", () => {
  const input = {
    schemaVersion: 1,
    id: "weather-server",
    name: "날씨 MCP 서버",
    defaultTimeoutMs: 10_000,
    cases: [
      {
        id: "tool-exists",
        name: "날씨 툴이 존재한다",
        operation: { type: "listTools" },
        assertions: [{ type: "toolExists", tool: "get_weather" }],
      },
      {
        id: "call-weather",
        name: "서울 날씨를 호출한다",
        timeoutMs: 30_000,
        operation: {
          type: "callTool",
          tool: "get_weather",
          input: { city: "서울" },
        },
        assertions: [{ type: "isError", expected: false }],
      },
    ],
  } as const;

  expect(validateMcpSuite(input)).toEqual({ valid: true, value: input });
});

it("명세의 구조 오류를 결정된 순서로 모두 반환한다", () => {
  const result = validateMcpSuite({
    schemaVersion: 2,
    id: "suite",
    name: "suite",
    extra: true,
    defaultTimeoutMs: 0,
    cases: [
      {
        id: "duplicate",
        name: "first",
        operation: { type: "listTools" },
        assertions: [{ type: "isError", expected: false }],
      },
      {
        id: "duplicate",
        name: "second",
        operation: { type: "callTool", input: {} },
        assertions: [],
      },
    ],
  });

  expect(result.valid).toBe(false);
  if (result.valid) throw new Error("invalid suite unexpectedly passed");
  expect(result.issues.map(({ code, path }) => ({ code, path }))).toEqual([
    { code: "UNSUPPORTED_SCHEMA_VERSION", path: "schemaVersion" },
    { code: "INVALID_TIMEOUT", path: "defaultTimeoutMs" },
    { code: "UNKNOWN_FIELD", path: "extra" },
    { code: "INCOMPATIBLE_ASSERTION", path: "cases[0].assertions[0]" },
    { code: "DUPLICATE_CASE_ID", path: "cases[1].id" },
    { code: "MISSING_REQUIRED_FIELD", path: "cases[1].operation.tool" },
    { code: "EMPTY_ASSERTIONS", path: "cases[1].assertions" },
  ]);
});

it("JSON이 아닌 callTool 입력을 거절한다", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const result = validateMcpSuite({
    schemaVersion: 1,
    id: "suite",
    name: "suite",
    cases: [{
      id: "case",
      name: "case",
      operation: { type: "callTool", tool: "x", input: circular },
      assertions: [{ type: "isError", expected: false }],
    }],
  });

  expect(result).toMatchObject({
    valid: false,
    issues: [{ code: "INVALID_JSON_VALUE", path: "cases[0].operation.input.self" }],
  });
});

it("defineMcpSuite는 유효한 입력을 그대로 반환하고 무효 입력을 구조화해 던진다", () => {
  const valid = defineMcpSuite({
    schemaVersion: 1,
    id: "suite",
    name: "suite",
    cases: [{
      id: "case",
      name: "case",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "x" }],
    }],
  });
  expect(defineMcpSuite(valid)).toBe(valid);
  expect(() => defineMcpSuite({ ...valid, cases: [] } as TestSuiteSpec)).toThrowError(
    SuiteValidationError,
  );
});
```

Add these named cases with the exact issue assertion shown:

| Test name | Exact assertion |
|---|---|
| `공백뿐인 식별자와 이름을 거절한다` | code `INVALID_VALUE` at `id`, `name`, `cases[0].id`, `cases[0].name` |
| `필수 필드 누락을 각각 보고한다` | `MISSING_REQUIRED_FIELD` at `schemaVersion`, `id`, `name`, `cases` |
| `중첩된 알 수 없는 필드를 거절한다` | `UNKNOWN_FIELD` at `cases[0].operation.toolNmae` |
| `유한하지 않은 숫자 입력을 거절한다` | `INVALID_JSON_VALUE` for `NaN`, `Infinity`, and `-Infinity` input paths; implementation calls `Number.isFinite` |
| `사용자 정의 class 입력을 거절한다` | `INVALID_JSON_VALUE` at `cases[0].operation.input` |
| `timeout 경계를 정확히 검증한다` | `2_147_483_647`은 valid; `0`, `-1`, `1.5`, `2_147_483_648`은 `INVALID_TIMEOUT` |
| `공유 JSON 객체 참조를 허용한다` | 같은 plain object를 두 입력 필드가 가리켜도 issues가 비어 있음 |
| `순환 JSON 객체를 거절한다` | 활성 재귀 경로를 다시 가리킨 위치에 `INVALID_JSON_VALUE` |

In `spec-schema.test.ts`, assert the concrete contract rather than snapshotting the whole object:

공통 parity 표는 다음 fixture/Schema keyword 쌍을 그대로 사용한다. validator test는 왼쪽 fixture의 결과를 단언하고 Schema test는 오른쪽 경로와 값을 단언한다.

| Constraint fixture | JSON Schema path/value |
|---|---|
| 필수 suite/case/operation/assertion 필드 누락 | 각 객체의 `required` 배열 |
| suite/case/operation/assertion unknown field | 각 객체의 `additionalProperties: false` |
| 공백 문자열 | `$defs.nonEmptyString`의 `minLength: 1`, `pattern: "\\S"` |
| 빈 cases/assertions | 해당 배열의 `minItems: 1` |
| operation/assertion 조합 불일치 | case `oneOf`, assertion `items.$ref`, 각 `type.const` |
| input의 JSON scalar/array/object | `$defs.jsonValue.oneOf`와 재귀 `$ref` |
| timeout `0`, `2_147_483_648` | `$defs.timeoutMs.minimum/maximum` |

중복 case ID, class instance, `NaN`/`Infinity`/`-Infinity`, 공유 참조, cycle은 직렬화된 JSON Schema가 표현할 수 없는 validator-only fixture로 표시한다.

`tests/helpers/schema-evaluator.ts`는 production export가 아닌 dev-only helper다. 다음 signature와 실패 code를 고정한다.

```ts
export interface SchemaEvaluationError {
  code: "INVALID_SCHEMA" | "UNRESOLVED_REF" | "ONE_OF_MATCH_COUNT" | "INSTANCE_MISMATCH";
  instancePath: string;
  schemaPath: string;
  message: string;
}

export function evaluateSchema(
  rootSchema: ReadonlyJsonObject,
  instance: unknown,
): { valid: boolean; errors: SchemaEvaluationError[] };
```

Evaluator는 local `#/$defs/<name>`만 JSON Pointer unescape(`~1` → `/`, `~0` → `~`) 후 root에서 해석한다. 없는 target 또는 local 형식이 아닌 `$ref`는 `UNRESOLVED_REF`다. `$ref` sibling은 이 Schema에서 사용하지 않으며 발견하면 `INVALID_SCHEMA`다. `oneOf`는 각 branch를 독립 error buffer로 평가하고 match 수가 정확히 1이 아니면 `ONE_OF_MATCH_COUNT`다. 지원 keyword는 `$ref`, `oneOf`, `type`, `const`, `required`, `properties`, `additionalProperties`, `items`, `minItems`, `minLength`, `pattern`, `minimum`, `maximum`이며 `$schema`, `$id`, `$defs`는 root metadata로만 허용한다. 그 밖의 keyword는 `INVALID_SCHEMA`로 실패한다. `type: "number"`는 `typeof === "number" && Number.isFinite(instance)`다. `type: "object"`는 null/array가 아니고 prototype이 `Object.prototype` 또는 `null`인 record만 허용해 production validator와 정확히 맞춘다. `additionalProperties: false`는 선언되지 않은 own enumerable key를 거절하고, Schema 객체이면 모든 추가 key 값에 그 Schema를 재귀 적용한다.

같은 frozen `MCP_SUITE_JSON_SCHEMA`에 아래 fixture를 실제 실행한다.

```ts
it.each([
  ["valid listTools", validListToolsSuite, true],
  ["valid recursive callTool input", validRecursiveInputSuite, true],
  ["valid null-prototype input", validNullPrototypeInputSuite, true],
  ["missing required field", missingNameSuite, false],
  ["unknown nested field", unknownOperationFieldSuite, false],
  ["wrong operation/assertion branch", mixedOperationAssertionSuite, false],
  ["empty assertions", emptyAssertionsSuite, false],
  ["timeout over maximum", oversizedTimeoutSuite, false],
] as const)("공개 JSON Schema를 실행 검증한다: %s", (_name, fixture, expected) => {
  expect(evaluateSchema(MCP_SUITE_JSON_SCHEMA, fixture).valid).toBe(expected);
});

it("깨진 local ref를 evaluator 오류로 보고한다", () => {
  const broken = structuredClone(MCP_SUITE_JSON_SCHEMA) as unknown as MutableSuiteSchema;
  broken.properties.cases.items.oneOf[0].$ref = "#/$defs/missingCase";
  expect(evaluateSchema(broken, validListToolsSuite).errors).toContainEqual(
    expect.objectContaining({ code: "UNRESOLVED_REF" }),
  );
});

it("oneOf가 0개 또는 2개 맞으면 거절한다", () => {
  const zero = evaluateSchema(MCP_SUITE_JSON_SCHEMA, mixedOperationAssertionSuite);
  expect(zero.errors).toContainEqual(expect.objectContaining({ code: "ONE_OF_MATCH_COUNT" }));

  const duplicated = structuredClone(MCP_SUITE_JSON_SCHEMA) as unknown as MutableSuiteSchema;
  duplicated.properties.cases.items.oneOf = [
    { $ref: "#/$defs/listToolsCase" },
    { $ref: "#/$defs/listToolsCase" },
  ];
  expect(evaluateSchema(duplicated, validListToolsSuite).errors).toContainEqual(
    expect.objectContaining({ code: "ONE_OF_MATCH_COUNT" }),
  );
});
```

`MutableSuiteSchema` is test-only and exactly describes the branch the two corruption tests mutate:

```ts
type MutableSuiteSchema = ReadonlyJsonObject & {
  properties: {
    cases: {
      items: {
        oneOf: Array<{ $ref: string }>;
      };
    };
  };
};
```

```ts
it("JSON Schema가 version 1과 닫힌 계약을 공개한다", () => {
  expect(MCP_SUITE_JSON_SCHEMA).toMatchObject({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://ohmymcp.dev/schemas/test-suite/v1.json",
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "id", "name", "cases"],
    properties: {
      schemaVersion: { const: 1 },
      cases: { type: "array", minItems: 1 },
    },
    $defs: {
      nonEmptyString: { type: "string", minLength: 1, pattern: "\\S" },
    },
  });
});

it.each([
  ["required suite fields", "required", ["schemaVersion", "id", "name", "cases"]],
  ["closed suite", "additionalProperties", false],
  ["non-empty string", "$defs.nonEmptyString", { type: "string", minLength: 1, pattern: "\\S" }],
  ["timeout lower bound", "$defs.timeoutMs.minimum", 1],
  ["timeout upper bound", "$defs.timeoutMs.maximum", 2_147_483_647],
  ["non-empty cases", "properties.cases.minItems", 1],
  ["case variants", "properties.cases.items.oneOf", [
    { $ref: "#/$defs/listToolsCase" },
    { $ref: "#/$defs/callToolCase" },
  ]],
  ["required list case fields", "$defs.listToolsCase.required", ["id", "name", "operation", "assertions"]],
  ["required call case fields", "$defs.callToolCase.required", ["id", "name", "operation", "assertions"]],
  ["closed list case", "$defs.listToolsCase.additionalProperties", false],
  ["closed call case", "$defs.callToolCase.additionalProperties", false],
  ["closed list operation", "$defs.listToolsCase.properties.operation.additionalProperties", false],
  ["closed call operation", "$defs.callToolCase.properties.operation.additionalProperties", false],
  ["required list operation fields", "$defs.listToolsCase.properties.operation.required", ["type"]],
  ["required call operation fields", "$defs.callToolCase.properties.operation.required", ["type", "tool", "input"]],
  ["list discriminant", "$defs.listToolsCase.properties.operation.properties.type.const", "listTools"],
  ["call discriminant", "$defs.callToolCase.properties.operation.properties.type.const", "callTool"],
  ["list assertion kind", "$defs.listToolsCase.properties.assertions.items.$ref", "#/$defs/toolExistsAssertion"],
  ["call assertion kind", "$defs.callToolCase.properties.assertions.items.$ref", "#/$defs/isErrorAssertion"],
  ["non-empty list assertions", "$defs.listToolsCase.properties.assertions.minItems", 1],
  ["non-empty call assertions", "$defs.callToolCase.properties.assertions.minItems", 1],
  ["closed toolExists assertion", "$defs.toolExistsAssertion.additionalProperties", false],
  ["closed isError assertion", "$defs.isErrorAssertion.additionalProperties", false],
  ["required toolExists fields", "$defs.toolExistsAssertion.required", ["type", "tool"]],
  ["required isError fields", "$defs.isErrorAssertion.required", ["type", "expected"]],
  ["toolExists discriminant", "$defs.toolExistsAssertion.properties.type.const", "toolExists"],
  ["isError discriminant", "$defs.isErrorAssertion.properties.type.const", "isError"],
  ["JSON object input", "$defs.callToolCase.properties.operation.properties.input.type", "object"],
  ["recursive JSON values", "$defs.jsonValue.oneOf", [
    { type: "null" },
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "array", items: { $ref: "#/$defs/jsonValue" } },
    { type: "object", additionalProperties: { $ref: "#/$defs/jsonValue" } },
  ]],
] as const)("validator 공통 제약과 Schema keyword를 맞춘다: %s", (_name, path, expected) => {
  expect(MCP_SUITE_JSON_SCHEMA).toHaveProperty(path, expected);
});

it("JSON Schema의 모든 내부 참조가 실제 정의를 가리킨다", () => {
  const schema = MCP_SUITE_JSON_SCHEMA as Record<string, unknown>;
  const definitions = schema.$defs as Record<string, unknown>;
  const references: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") references.push(child);
      visit(child);
    }
  };
  visit(schema);
  expect(references.length).toBeGreaterThan(0);
  for (const reference of references) {
    expect(reference).toMatch(/^#\/\$defs\//);
    expect(definitions).toHaveProperty(reference.replace("#/$defs/", ""));
  }
});

it("공개 JSON Schema를 재귀적으로 동결한다", () => {
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    expect(Object.isFrozen(value)).toBe(true);
    for (const child of Object.values(value)) visit(child);
  };
  visit(MCP_SUITE_JSON_SCHEMA);
});

it("공개 JSON Schema 타입이 중첩 값까지 readonly다", () => {
  const definitions = MCP_SUITE_JSON_SCHEMA.$defs;
  if (false && definitions !== null && typeof definitions === "object" && !Array.isArray(definitions)) {
    // @ts-expect-error nested schema objects are read-only
    definitions.timeoutMs = null;
  }
  expect(Object.isFrozen(definitions)).toBe(true);
});
```

- [ ] **Step 2: Run focused tests and observe RED**

Run:

```bash
pnpm exec vitest run packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts packages/runner/tests/index.test.ts
```

Expected: failure because the new modules and exports do not exist. A syntax or test-collection failure is not the intended RED; correct the test setup until Vitest reports missing implementation symbols.

- [ ] **Step 3: Implement the exact types and JSON Schema contract**

Implement the full JSON Schema object from Plan §3 byte-for-byte except for formatter-controlled whitespace. Export it as `ReadonlyJsonObject`, keep `additionalProperties: false` for contract objects, and allow arbitrary recursive JSON values only under `operation.input`. Recursively freeze every Schema array and object before exposing the constant. Implement the dev-only evaluator contract above under `tests/helpers`; do not export or bundle it and do not add a JSON Schema validator dependency.

`spec/index.ts` re-exports only spec types, Schema, validator, and error. Root `src/index.ts` re-exports `./spec/index.js`. Preserve `McpTestConfig`, `McpTestContext`, `TestBody`, `MatchResult`, `createMcpTest`, and `toContainTool` as deprecated compatibility shims with their existing signatures and exact `not implemented` throw behavior; removing or silently changing these exports requires a later major release.

- [ ] **Step 4: Implement deterministic validation**

Validation traversal order is fixed:

```text
schemaVersion → id → name → defaultTimeoutMs → unknown root keys alphabetically → cases
case: id → name → timeoutMs → unknown case keys alphabetically → operation → assertions
operation/assertion: known fields in declaration order → unknown keys alphabetically
```

Rules:

- Missing required fields produce one `MISSING_REQUIRED_FIELD` at the missing field path.
- A non-object node produces one `INVALID_TYPE` and does not recursively validate children.
- Strings must contain at least one non-whitespace character.
- Timeout must be a positive safe integer.
- Every numeric JSON value must satisfy `Number.isFinite`; reject `NaN`, `Infinity`, and `-Infinity` with `INVALID_JSON_VALUE` before cloning or serialization.
- JSON objects must be arrays or plain records with prototype `Object.prototype` or `null`.
- JSON 값 검사는 전역 visited set이 아니라 현재 활성 재귀 stack을 사용한다. 따라서 `{ a: shared, b: shared }` 같은 비순환 공유 참조는 허용하고, 조상 객체를 다시 가리키는 실제 cycle만 두 번째 경로에서 `INVALID_JSON_VALUE`로 보고한다.
- `validateMcpSuite` aggregates issues and never throws.
- `defineMcpSuite` throws `SuiteValidationError` on invalid input and returns the original object identity on success.

- [ ] **Step 5: Run RED→GREEN verification**

Run:

```bash
pnpm exec vitest run packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts packages/runner/tests/index.test.ts
pnpm --filter @ohmymcp/runner typecheck
```

Expected: all Task 1 tests pass and typecheck exits 0.

- [ ] **Step 6: Main-session review gate and user commit checkpoint**

The main session checks the child report, `git diff -- packages/runner/src/spec packages/runner/src/index.ts packages/runner/tests`, and focused test output. It then requests a user commit with:

```text
feat(runner): 선언형 테스트 명세 계약 추가
```

Do not start Task 2 until the user supplies the resulting commit SHA and `git merge-base --is-ancestor` confirms it is the worktree HEAD ancestor.

---

### Task 2: Structured Diagnostics and Pure Assertions

**Model:** `gpt-5.6-terra`, reasoning effort `medium`. Failure messages are product behavior and receive main-session review.

**Files:**

- Create: `packages/runner/src/diagnostics.ts`
- Create: `packages/runner/src/assertions.ts`
- Create: `packages/runner/tests/assertions.test.ts`
- Modify: `packages/runner/src/index.ts`

**Consumes:** `AssertionSpec`, `JsonValue`, `ToolExistsAssertionSpec`, `IsErrorAssertionSpec` from Task 1 and frozen `ToolDef`, `ToolResult` from core.

**Produces:** `RunnerDiagnostic`, `RunnerDiagnosticCode`, `AssertionResult`, pure internal assertion functions.

- [ ] **Step 1: Write exact assertion and message tests**

Load tool definitions from `fixtures/tools-list.sample.json`. Assert these exact failure values:

```ts
expect(assertToolExists(tools, { type: "toolExists", tool: "missing" })).toEqual({
  spec: { type: "toolExists", tool: "missing" },
  status: "failed",
  diagnostic: {
    code: "TOOL_NOT_FOUND",
    message: "툴 'missing'를 찾을 수 없습니다.",
    expected: "missing",
    actual: ["add", "get_weather"],
    hint: "서버의 tools/list 응답과 테스트 명세를 확인하세요.",
  },
});

expect(assertIsError(
  { content: null, isError: true, raw: { secret: "not-in-report" } },
  { type: "isError", expected: false },
)).toEqual({
  spec: { type: "isError", expected: false },
  status: "failed",
  diagnostic: {
    code: "IS_ERROR_MISMATCH",
    message: "정상 응답을 기대했지만 오류 응답을 받았습니다.",
    expected: false,
    actual: true,
    hint: "툴 입력값과 서버의 오류 응답을 확인하세요.",
  },
});
```

Add these named cases and exact assertions:

| Test name | Exact assertion |
|---|---|
| `존재하는 get_weather 툴을 통과시킨다` | `{ spec, status: "passed" }`, no diagnostic |
| `isError true와 false 일치를 통과시킨다` | true/true and false/false both `passed` |
| `오류 응답을 기대했지만 정상 응답이면 실패한다` | exact message `오류 응답을 기대했지만 정상 응답을 받았습니다.`, expected true, actual false |
| `실제 툴 이름을 UTF-16 순서로 중복 제거한다` | input names `가`, `a`, `A`, `a` produce actual `["A", "a", "가"]`; spied `localeCompare` call count 0 |
| `진단에서 raw와 관련 없는 content를 제외한다` | `JSON.stringify(result)` contains neither `raw` nor the sentinel secret string |
| `Error를 JSON 진단값으로 정규화한다` | `{ type: "error", name: "Error", message: "Connection closed" }` |
| `비 Error throw를 안전하게 정규화한다` | every string, finite number, boolean, null, undefined, bigint, symbol, function, object, circular object result passes `JSON.stringify` and never calls a supplied `toJSON` spy |

- [ ] **Step 2: Run focused test and observe RED**

```bash
pnpm exec vitest run packages/runner/tests/assertions.test.ts
```

Expected: missing diagnostic and assertion modules.

- [ ] **Step 3: Implement diagnostic factories and pure assertions**

Use one diagnostic factory per code. Assertion functions do not throw for mismatches and do not mutate their inputs. Successful assertion results omit `diagnostic`.

Tool names are deduplicated before sorting. Use the locale-independent comparator `(left, right) => left < right ? -1 : left > right ? 1 : 0`; do not use `localeCompare`, `Intl.Collator`, or process locale.

`normalizeThrownValue` uses this deterministic mapping and never calls `toJSON` or a custom string conversion:

```text
Error                → { type: "error", name, message }
null/string/boolean  → { type: "thrown", value }
finite number        → { type: "thrown", value }
NaN/Infinity         → { type: "number", value: String(value) }
undefined            → { type: "undefined" }
bigint               → { type: "bigint", value: value.toString() }
symbol               → { type: "symbol", description: value.description ?? null }
function             → { type: "function", name: value.name || null }
every other object   → { type: "object" }
```

Keep `assertToolExists` and `assertIsError` internal to Runner unless tests import a dedicated internal module by relative path. The package root exports result and diagnostic types, not matcher implementation details.

- [ ] **Step 4: Run focused and contract verification**

```bash
pnpm exec vitest run packages/runner/tests/assertions.test.ts packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts
pnpm --filter @ohmymcp/runner typecheck
```

Expected: all pass.

- [ ] **Step 5: Main-session review gate and user commit checkpoint**

Review exact Korean messages, sorted `actual`, JSON safety, and absence of raw data. Request user commit:

```text
feat(runner): 구조화된 assertion 진단 추가
```

Do not start Task 3 before verifying the supplied SHA.

---

### Task 3: Sequential Executor, Events, and Final Report

**Model:** `gpt-5.6-terra`, reasoning effort `medium`. The contract is fixed; this task implements deterministic state transitions without timeout yet.

**Files:**

- Create: `packages/runner/src/sanitization.ts`
- Create: `packages/runner/src/executor.ts`
- Create: `packages/runner/tests/sanitization.test.ts`
- Create: `packages/runner/tests/executor.test.ts`
- Modify: `packages/runner/src/index.ts`

**Consumes:** Task 1 spec contract and Task 2 assertion/diagnostic results.

**Produces:** All report, event, security, payload-limit, and `runSuite` handle types from Plan §3, with sequential success, assertion failure, and operation rejection paths.

- [ ] **Step 1: Write sequential execution tests**

Build an in-memory fake client that records:

```ts
type CallRecord =
  | { type: "listTools" }
  | { type: "callTool"; name: string; args: unknown }
  | { type: "close" };
```

Required tests and assertions:

```ts
expect(records).toEqual([
  { type: "listTools" },
  { type: "callTool", name: "get_weather", args: { city: "서울" } },
]);

expect(events.map((event) => event.type)).toEqual([
  "suiteStarted",
  "caseStarted",
  "operationStarted",
  "operationCompleted",
  "assertionCompleted",
  "caseCompleted",
  "caseStarted",
  "operationStarted",
  "operationCompleted",
  "assertionCompleted",
  "caseCompleted",
  "suiteCompleted",
]);

expect(events.map((event) => event.sequence)).toEqual(
  Array.from({ length: events.length }, (_, index) => index),
);
```

Add these named cases and exact assertions:

| Test name | Exact assertion |
|---|---|
| `한 작업 결과로 모든 assertion을 순서대로 평가한다` | MCP call count 1; result specs equal source assertion array order |
| `assertion 실패 후 다음 케이스를 실행한다` | case statuses `["failed", "passed"]`; call record contains both cases in order |
| `MCP reject를 진단하고 다음 케이스를 실행한다` | operation/case `failed`; operation code `OPERATION_FAILED`; assertions `skipped` with `OPERATION_RESULT_UNAVAILABLE`; following case `passed` |
| `summary 상태를 배타적으로 집계한다` | `total === passed + failed + timedOut + cancelled + notRun` and each case appears in one bucket |
| `suite timeout 원본을 보고서에 보존한다` | `report.suite.defaultTimeoutMs === suite.defaultTimeoutMs` |
| `무효 명세는 이벤트와 MCP 호출 전에 거절한다` | `SuiteValidationError`; events `[]`; call records `[]` |
| `호출자의 suite 변경으로 실행 snapshot이 바뀌지 않는다` | post-start name mutation does not change `TestCaseResult.spec.name` |
| `event 객체 변경으로 내부 보고서가 바뀌지 않는다` | listener mutation does not change later event/report spec name |
| `모든 case 이벤트에 안정적인 식별자를 넣는다` | `caseStarted`와 `caseCompleted`의 `caseId`/`caseIndex`가 실행 spec과 일치함 |
| `event handler 오류를 호출자에게 전달한다` | rejection is the same sentinel Error; no subsequent MCP call |
| `같은 입력은 같은 이벤트와 보고서를 만든다` | two independent runs are deep equal |
| `보고서를 안전하게 직렬화한다` | `JSON.stringify` succeeds and serialized keys exclude `raw`, `timestamp`, `duration`, `durationMs` |
| `정상 실행 handle의 drain을 완료한다` | `report` resolves, `drain` equals `{ status: "settled" }`, `client.close`는 Runner에서 호출하지 않음 |

In `sanitization.test.ts`, use this fixed input:

```ts
const input = {
  Authorization: "Bearer top-secret",
  nested: {
    api_key: "key-secret",
    note: "caller-secret",
  },
};
```

Add these exact cases:

| Test name | Exact assertion |
|---|---|
| `기본 민감 키와 caller 값을 재귀 마스킹한다` | `Authorization`, `api_key`, exact `caller-secret` become `[REDACTED]`; key order is preserved |
| `실제 호출은 원본이고 event와 report만 sanitized다` | fake client receives `input` deep equal; serialized events/report contain none of the three secret strings |
| `case payload 초과를 실행 전에 거절한다` | `maxCaseBytes: 128`, oversized input; `RunnerPayloadLimitError` scope `case`; events/calls empty |
| `report payload 초과는 안전하지 않은 완료 event를 만들지 않는다` | case limit passes, `maxReportBytes: 256`; report rejects scope `report`; event types exclude `suiteCompleted` |
| `limit을 기본값보다 높이거나 잘못 지정하면 거절한다` | zero, fractional, `65_537` case, `1_048_577` report each reject with `RangeError` before events/calls |

- [ ] **Step 2: Run focused tests and observe RED**

```bash
pnpm exec vitest run packages/runner/tests/executor.test.ts packages/runner/tests/sanitization.test.ts
```

Expected: `runSuite`, event/report, sanitization, and payload-limit exports are missing.

- [ ] **Step 3: Implement the deterministic state machine**

Use this case transition table:

| Operation | Assertions | Case | Continue |
|---|---|---|---|
| fulfilled | all passed | `passed` | yes |
| fulfilled | at least one failed | `failed` | yes |
| rejected | all `skipped` | `failed` | yes |

Rules:

- Snapshot the validated suite before `suiteStarted`.
- A fulfilled `callTool` operation is `completed` even when `ToolResult.isError` is true; `isError` assertion decides pass/fail.
- Emit a JSON-safe clone to `onEvent`, never the internal mutable object.
- Keep a private operational suite for client calls and a separate sanitized observer suite for events/reports.
- Start `sequence` at 0 and increment once per emitted conceptual event.
- Preserve case and assertion order.
- Do not include operation output in the public report beyond relevant diagnostics.
- `runSuite` does not call `client.close()` or `forceClose()`; Task 4 adds only the explicitly invoked finalizer.
- Return `{ report, drain }`; `report` may resolve or reject first. `drain` is chained after that outcome, never rejects, and returns `{ status: "settled" }` in Task 3 because no pending operation remains. Task 4 extends only the value to `{ status: "settled" } | { status: "deadlineExceeded", pendingOperations: 1 }` without changing report-first ordering.
- In this task, use a temporary internal control path that resolves operations normally; Task 4 adds timeout/abort without changing public event/report names.

`sanitization.ts` implements these exact defaults and rules:

```ts
const DEFAULT_SENSITIVE_KEYS = new Set([
  "authorization", "cookie", "password", "passwd", "secret", "token",
  "apikey", "accesstoken", "refreshtoken", "clientsecret",
]);
const REDACTED = "[REDACTED]";
const DEFAULT_MAX_CASE_BYTES = 65_536;
const DEFAULT_MAX_REPORT_BYTES = 1_048_576;
```

Normalize keys with `key.toLowerCase().replace(/[^a-z0-9]/g, "")`. Extra sensitive keys extend the defaults; sensitive string values match exactly. Recursively sanitize only `operation.input` while cloning the rest of each case unchanged. Measure `JSON.stringify(value)` with `new TextEncoder().encode(serialized).byteLength`. Caller limits must be positive integers no greater than the defaults. Preflight every sanitized case before `suiteStarted`; measure the final report before `suiteCompleted`. Limit failures reject `report` with `RunnerPayloadLimitError` and do not mutate the caller input.

Rejected operations use these exact messages:

```text
listTools message: MCP 툴 목록 조회 중 오류가 발생했습니다.
callTool message: 툴 'get_weather' 호출 중 오류가 발생했습니다.
operation hint: MCP 서버 프로세스와 연결 상태를 확인하세요.
skipped assertion message: MCP 작업 결과가 없어 assertion을 검사할 수 없습니다.
skipped assertion hint: 먼저 MCP 작업 실패 원인을 해결하세요.
```

- [ ] **Step 4: Run focused and package verification**

```bash
pnpm exec vitest run packages/runner/tests
pnpm --filter @ohmymcp/runner typecheck
pnpm --filter @ohmymcp/runner build
```

Expected: all pass and build emits ESM/CJS declarations from the single root entry.

- [ ] **Step 5: Main-session review gate and user commit checkpoint**

Review event snapshots, state transitions, summary exclusivity, and client ownership. Request user commit:

```text
feat(runner): 순차 suite executor 추가
```

Do not start Task 4 before verifying the supplied SHA.

---

### Task 4: Timeout and AbortSignal Control

**Model:** `gpt-5.6-terra`, reasoning effort `medium`. Cancellation cannot reach the frozen client and therefore affects suite state and determinism; unresolved invariants may trigger the project-policy escalation path.

**Files:**

- Modify: `packages/runner/src/executor.ts`
- Create: `packages/runner/src/shutdown.ts`
- Modify: `packages/runner/tests/executor.test.ts`
- Create: `packages/runner/tests/shutdown.test.ts`
- Modify: `packages/runner/src/index.ts`

**Consumes:** Task 3 executor and final public result/event names.

**Produces:** timeout priority, external abort, remaining `notRun` results, timer/listener cleanup, bounded pending-operation drain outcomes, and caller-owned idempotent forced close.

- [ ] **Step 1: Write fake-timer timeout and abort tests**

Use `vi.useFakeTimers()` with cleanup in `afterEach`. Required tests:

```ts
const execution = runSuite({ client, suite, onEvent: (event) => events.push(event) });
await vi.advanceTimersByTimeAsync(10_000);
const report = await execution.report;

expect(report.status).toBe("failed");
expect(report.stopReason).toEqual({ type: "timeout", caseId: "a" });
expect(report.cases.map(({ status }) => status)).toEqual(["timedOut", "notRun"]);
expect(client.close).not.toHaveBeenCalled();
expect(callRecords).toEqual([{ type: "callTool", name: "slow", args: {} }]);
```

Add these named cases and exact assertions:

| Test name | Exact assertion |
|---|---|
| `case suite fallback 순서로 timeout을 선택한다` | applied values equal case value, then suite value, then `10_000` in three subcases |
| `Node 단일 timer 최대 timeout을 그대로 예약한다` | `2_147_483_647`이 operation/event에 기록되고 timer overflow 경고나 1ms 축소 없이 예약됨 |
| `실제 경과 시간 없이 적용 timeout만 기록한다` | operation/event timeout equals applied value; serialized output lacks duration keys |
| `timeout 이벤트를 고정 순서로 발행한다` | suffix is `operationCompleted`, each `assertionCompleted`, `caseCompleted`, `suiteCompleted`; statuses timedOut/skipped/timedOut/failed |
| `시작 전 abort는 모든 케이스를 notRun으로 둔다` | event types `["suiteStarted", "suiteCompleted"]`; no case ID in stop reason; each `notRun` operation has no `timeoutMs` |
| `operation 중 abort는 현재 케이스를 cancelled로 둔다` | current cancelled, remaining notRun, suite aborted, current case ID present |
| `케이스 사이 abort는 완료 결과를 보존한다` | completed prefix unchanged, remaining notRun, stop reason without case ID |
| `동시에 관찰된 abort가 timeout보다 우선한다` | current case cancelled and stop reason `abortSignal` |
| `모든 settle 경로가 timer와 listener를 정리한다` | fake timer count 0 and instrumented add/remove listener counts equal |
| `timeout과 abort 뒤 다음 MCP 호출을 시작하지 않는다` | call record contains current operation only |
| `Runner가 client를 닫지 않는다` | close spy count 0 for timeout and abort |
| `report는 drain과 독립적으로 먼저 끝난다` | timeout report resolves while pending operation and drain remain pending |
| `deadline 전 operation을 정상 drain한다` | operation settle 전 drain pending; settle 후 `{ status: "settled" }`; finalizer graceful close 1회 |
| `drain deadline 뒤 transport를 강제 종료한다` | report 후 `4_999ms` force 0회; `5_000ms`에 `{ status: "deadlineExceeded", pendingOperations: 1 }`; independent force close 1회 |
| `caller drain deadline 범위를 동기 검증한다` | `0`, `NaN`, `Infinity`, `-1`, `1.5`, `60_001`은 `runSuite` 호출 자체가 events/calls 전 `RangeError`; `1`, `60_000`은 허용 |
| `pending operation의 늦은 reject를 삼킨다` | deadline/close 뒤 원본 Promise reject; no unhandled rejection and drain result unchanged |
| `report reject에서도 finally로 한 번 닫는다` | event handler sentinel rejection을 primary error로 보존; drain 후 close 1회 |
| `timeout abort 중복 cleanup은 transport 종료를 중복 호출하지 않는다` | 같은 execution/controller의 finalizer를 두 경로에서 호출해도 same Promise와 close/force 합계 1회 |

In `shutdown.test.ts`, use a fake `McpClientShutdownController` whose `forceClose` settles independently of its permanently pending `client.callTool` and `close` Promises. Add these exact tests:

| Test name | Exact assertion |
|---|---|
| `permanently pending call을 drain deadline 뒤 강제 종료한다` | report resolves; at 4,999ms force 0; at 5,000ms reason `drainDeadlineExceeded`; finalize resolves after force; pending call remains handled |
| `graceful close deadline 뒤 force close로 전환한다` | settled drain; close pending for 1,999ms; at 2,000ms force reason `gracefulCloseDeadlineExceeded`; one close and one force call |
| `force close 자체도 유한 상한으로 끝낸다` | force Promise permanently pending; 2,000ms 후 `RunnerShutdownTimeoutError`; finalize no longer pending |
| `shutdown timeout 옵션을 동기 검증한다` | close/force 각각 `0`, `NaN`, `Infinity`, `-1`, `1.5`, `10_001`은 transport call 전 `RangeError`; `1`, `10_000` valid |
| `undefined report rejection을 보존한다` | report rejects `undefined`, cleanup succeeds, returned Promise rejects with `undefined` rather than resolving |
| `report와 close 실패를 순서대로 집계한다` | `AggregateError.errors` deep equals `[reportSentinel, closeSentinel, forceSentinel]` when graceful and forced shutdown both fail |
| `drain contract 위반도 cleanup 오류로 보존한다` | fake drain rejects sentinel; force cleanup still runs; failure list keeps report before drain before shutdown |
| `finalize 중복 호출이 transport 종료를 반복하지 않는다` | same execution/controller returns same Promise; close/force total operation count 1 |

- [ ] **Step 2: Run focused tests and observe RED**

```bash
pnpm exec vitest run packages/runner/tests/executor.test.ts packages/runner/tests/shutdown.test.ts
```

Expected: timeout/abort assertions fail against Task 3 behavior while existing executor tests remain green.

- [ ] **Step 3: Implement one controlled-operation helper**

The helper races the MCP Promise against a timer and signal and returns a tagged result:

```ts
type ControlledOperation<T> =
  | { type: "fulfilled"; value: T }
  | { type: "rejected"; error: unknown }
  | { type: "timedOut" }
  | { type: "cancelled" };
```

Use one settle function that clears the timer and removes the abort listener exactly once. Check `signal.aborted` before starting and again in the timeout callback so explicit cancellation has priority. Never close the client and never start the next case after `timedOut` or `cancelled`.

`runSuite` synchronously validates `drainTimeoutMs` before snapshots, events, or MCP calls. Use `DEFAULT_DRAIN_TIMEOUT_MS = 5_000` and `MAX_DRAIN_TIMEOUT_MS = 60_000`; accept only finite integers in `1..60_000`. Zero never means immediate force-close. It creates a resolved default `pendingSettlement`, attaches both handlers as soon as an MCP Promise starts, and records whether that request is still pending.

```ts
const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;
const MAX_DRAIN_TIMEOUT_MS = 60_000;

let pending = false;
let pendingSettlement = Promise.resolve();

function trackOperation<T>(operationPromise: Promise<T>): Promise<T> {
  pending = true;
  pendingSettlement = operationPromise.then(
    () => { pending = false; },
    () => { pending = false; },
  );
  return operationPromise;
}

async function finishDrain(): Promise<RunnerDrainResult> {
  if (!pending) return { status: "settled" };
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: RunnerDrainResult): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ status: "deadlineExceeded", pendingOperations: 1 }),
      drainTimeoutMs,
    );
    void pendingSettlement.then(() => finish({ status: "settled" }));
  });
}

const report = executeSuite();
const drain = report.then(
  () => finishDrain(),
  () => finishDrain(),
);
return { report, drain };
```

The production implementation may avoid the illustrative closure reassignment, but must preserve these state transitions. `pendingSettlement` has a rejection handler before the logical timeout/abort can win, so a deadline result and forced client close cannot create an unhandled late rejection. The drain timer starts only after `report` settles, is cleared on early settlement, and never makes `drain` reject. It tracks at most one request because suite execution is sequential and stops after timeout/abort.

`shutdown.ts` defines a generic outcome helper that does not use `undefined` as the failure sentinel:

```ts
type PromiseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

const settle = <T>(promise: Promise<T>): Promise<PromiseOutcome<T>> =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
```

`finalizeRunnerExecution` first settles report, then drain. A settled drain starts controller `close()` raced against `closeTimeoutMs = 2_000`; timeout or close rejection triggers `forceClose("gracefulCloseDeadlineExceeded")`. `deadlineExceeded` skips close and triggers `forceClose("drainDeadlineExceeded")`. Force close is independently raced against `forceCloseTimeoutMs = 2_000`. Both timed-out Promises keep the two-sided `settle` handler so late rejection is observed. Cache the entire finalize Promise by execution/controller identity before any async work. Collect failed outcomes in report, drain, graceful close, force close order; throw the sole exact rejection value or `AggregateError` for multiple failures. A graceful timeout is control flow, while a graceful close rejection remains in the failure list even if force close succeeds. `runSuite` never imports `shutdown.ts` or initiates shutdown.

Assertions for the current timed-out/cancelled case are `skipped` with `OPERATION_RESULT_UNAVAILABLE`. Assertions for remaining cases are `notRun` without a diagnostic. 시작하지 않은 operation은 적용된 timer가 없으므로 `timeoutMs` 필드를 갖지 않는다.

Timeout and abort diagnostics use these exact messages:

```text
CASE_TIMEOUT message: 테스트 'a'가 제한 시간 10000ms 안에 완료되지 않았습니다.
CASE_TIMEOUT hint: 서버 응답 지연과 테스트의 timeoutMs 설정을 확인하세요.
RUN_ABORTED message: 테스트 'a' 실행이 외부 요청으로 취소되었습니다.
RUN_ABORTED hint: 취소 신호를 발생시킨 호출자 상태를 확인한 뒤 다시 실행하세요.
```

- [ ] **Step 4: Run focused, package, and deterministic verification**

```bash
pnpm exec vitest run packages/runner/tests/executor.test.ts packages/runner/tests/shutdown.test.ts
pnpm exec vitest run packages/runner/tests
pnpm --filter @ohmymcp/runner typecheck
pnpm --filter @ohmymcp/runner build
```

Expected: all pass, no pending timer warning, no unhandled rejection, and deterministic deep-equality tests remain green.

- [ ] **Step 5: Main-session review gate and user commit checkpoint**

Review timeout-vs-abort priority, cleanup, no follow-up calls, and no client close. Request user commit:

```text
feat(runner): 테스트 timeout과 중단 처리 추가
```

Do not start Task 5 before verifying the supplied SHA.

---

### Task 5: Package Documentation, Changeset, and Full Verification

**Model:** `gpt-5.6-terra`, reasoning effort `medium`. This task is mechanical documentation and verification against the frozen design.

**Files:**

- Modify: `packages/runner/package.json`
- Modify: `packages/runner/README.md`
- Create: `.changeset/runner-declarative-suite.md`
- Test only: all files from Tasks 1–4

**Consumes:** Final root exports and verified behavior.

**Produces:** User-facing Runner example and release record.

- [ ] **Step 1: Update package metadata and README**

Set the package description to:

```json
"description": "선언형 MCP 테스트 실행 · assertion · 구조화된 리포트"
```

README must show:

1. `defineMcpSuite` with one `listTools/toolExists` case and one `callTool/isError` case.
2. `const execution = runSuite({ client: shutdown.client, suite, onEvent, redaction, payloadLimits, drainTimeoutMs })`와 `finalizeRunnerExecution({ execution, shutdown })`의 bounded lifecycle.
3. Timeout priority and the 10-second Runner fallback.
4. Statement that `runSuite` never closes the injected client; drain default `5_000ms`, `settled | deadlineExceeded`, 2,000ms graceful/force close bounds, stdio process kill 또는 HTTP abort/socket destroy를 구현하는 controller, late rejection handler 유지.
5. Default sensitive-key redaction, caller `sensitiveValues`, 65,536-byte case and 1,048,576-byte report limits, and no automatic persistence.
6. Statement that `RunnerReport` is JSON-serializable and retains sanitized failed case specs/diagnostics for later repair.
7. Current non-goals: generate provider/repair validator implementation, JUnit, Vitest adapter, parallel execution.
8. `createMcpTest`와 `toContainTool`은 minor 호환성을 위한 deprecated shim이며 기존 시그니처/`not implemented` 오류를 유지하고 major release 전에는 제거하지 않는다는 migration note.
9. `drainTimeoutMs`의 `1..60_000`, close/force timeout의 `1..10_000` 유한 정수 범위와 0/비유한수/음수/소수의 동기 `RangeError`.

- [ ] **Step 2: Add the exact changeset**

```md
---
"@ohmymcp/runner": minor
---

선언형 MCP 테스트 명세, 순차 실행, 구조화된 진단·이벤트·보고서와 timeout·중단 처리를 추가합니다.
```

- [ ] **Step 3: Run formatting check and correct only owned files**

```bash
pnpm exec biome check packages/runner
```

If formatting fails, run `pnpm exec biome format --write packages/runner` and repeat the check. Do not run a repository-wide write-format command.

- [ ] **Step 4: Run full verification from fresh outputs**

```bash
pnpm exec vitest run packages/runner/tests
pnpm --filter @ohmymcp/runner typecheck
pnpm --filter @ohmymcp/runner build
pnpm exec biome check packages/runner
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

For each command record exit code and the number of tests/packages actually inspected. A green command that inspected zero targets is not success.

- [ ] **Step 5: Verify scope and generated artifacts**

```bash
git status --short
git diff --check
git diff -- packages/runner .changeset/runner-declarative-suite.md
```

Expected owned changes only. Confirm `packages/core/src/types.ts`, other packages, and root build configuration are unchanged. Confirm no tracked `dist`, coverage, report, or temporary file appears.

- [ ] **Step 6: Final review gate and user commit checkpoint**

Use `superpowers:requesting-code-review` plus a main-session direct diff review. Verify every Design §17 test requirement maps to a passing test. Request user commit:

```text
docs(runner): 선언형 runner 사용법과 changeset 추가
```

After the user commit, report the final branch HEAD and leave merge/push to the user.

---

## 4. Single-Terminal Execution Prompt

This project has one sequential Wave, so one terminal prompt owns one worktree and pauses at every user commit gate. The prompt determines the execution base at runtime and refuses to start unless the committed base contains both design and plan.

사용자가 터미널을 시작하기 전에 확인할 사전 조건은 두 줄이다.

```bash
git log --oneline -1
git status --short
```

첫 명령의 HEAD에 설계·계획 문서와 로컬 ignore 규칙이 포함돼 있어야 하고, 두 번째 명령의 출력은 비어 있어야 한다.

권장 스폰 설정: `default / gpt-5.6-terra / medium` for orchestration and final review. Task-specific child settings are fixed below. `gpt-5.6-sol` 승급은 표준 모델로 두 번 시도한 뒤에도 timeout 또는 민감정보 불변식이 풀리지 않을 때만 사용한다.

```text
OhMyMCP Runner 구현 계획을 오케스트레이션해라.

[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

먼저 현재 checkout에서 저장소 루트를 계산하고 다음 값을 기록해라.

  repo_root="$(git rev-parse --show-toplevel)"
  base_commit="$(git rev-parse HEAD)"
  git_dir="$(git rev-parse --path-format=absolute --git-dir)"
  git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
  printf '%s\n' "$git_dir"
  printf '%s\n' "$git_common_dir"
  git branch --show-current
  git rev-parse HEAD
  git status --short

git status가 깨끗하지 않으면 아무 변경도 하지 말고 BLOCKED로 보고해라. 다음 두 파일이 현재 HEAD에 추적돼 있지 않아도 BLOCKED다.

  docs/superpowers/specs/2026-08-11-runner-design.md
  docs/superpowers/plans/2026-08-11-runner-implementation.md

worktree나 브랜치를 만들기 전에 로컬 규약 원본을 찾는다. `git worktree list --porcelain`의 각 `worktree` 경로 중 `AGENTS.md`, `.agents/skills/execution-conventions/SKILL.md`, `docs/conventions/execution.md`를 모두 가진 경로를 찾고 절대 경로를 `rules_root`로 기록한다. 후보가 정확히 하나가 아니면 아직 어떤 git 상태도 만들지 말고 BLOCKED로 보고한다. 그 경로에서 `AGENTS.md`, `.agents`, `docs/conventions`가 각각 `git check-ignore`로 ignore되는지도 확인한다.

그 다음 `git_dir`과 `git_common_dir`의 절대 경로 문자열을 비교한다. 서로 다르면 이미 연결 worktree이므로 중첩 worktree를 만들지 않고 `runner_worktree="$repo_root"`로 기록한다. 같으면 일반 checkout이므로 다음 값을 계산한다.

  worktree_parent="$(dirname "$repo_root")/$(basename "$repo_root")-worktrees"
  runner_worktree="$worktree_parent/runner-declarative-suite"
  runner_branch="feat/runner-declarative-suite"
  base_commit="$(git -C "$repo_root" rev-parse HEAD)"

일반 checkout에서 계산한 worktree 경로 또는 브랜치가 이미 존재하면 삭제하거나 재사용하지 말고 BLOCKED로 보고해라. 생성 직전에 `base_commit="$(git -C "$repo_root" rev-parse HEAD)"`를 다시 계산하고, 다음 명령을 실행한다.

  mkdir -p "$worktree_parent"
  git -C "$repo_root" worktree add -b "$runner_branch" "$runner_worktree" "$base_commit"

선택한 worktree에 로컬 규약이 없으면 검증한 `rules_root`에서 같은 상대 경로로 복사한다.

  cp "$rules_root/AGENTS.md" "$runner_worktree/AGENTS.md"
  mkdir -p "$runner_worktree/.agents" "$runner_worktree/docs/conventions"
  cp -R "$rules_root/.agents/." "$runner_worktree/.agents/"
  cp -R "$rules_root/docs/conventions/." "$runner_worktree/docs/conventions/"

worktree에 진입해 다음을 확인한다.

  pwd가 선택한 worktree 절대 경로인지
  git rev-parse HEAD가 기록한 base SHA와 같은지
  일반 checkout에서 만들었다면 git branch --show-current가 feat/runner-declarative-suite인지
  설계 문서와 구현 계획이 존재하는지
  git status --short가 깨끗한지

그 후 pnpm install --frozen-lockfile을 실행하고 아래 도구가 실제로 실행되는지 확인한다.

  pnpm exec vitest --version
  pnpm exec tsc --version
  pnpm exec biome --version
  pnpm exec tsdown --version

하나라도 실패하면 구현 에이전트를 스폰하지 말고 BLOCKED로 보고해라.

[2단계: 실행]

먼저 아래 파일을 끝까지 읽어라.

  AGENTS.md
  CLAUDE.md
  CONTRIBUTING.md
  .agents/skills/execution-conventions/SKILL.md
  docs/conventions/execution.md
  docs/superpowers/specs/2026-08-11-runner-design.md
  docs/superpowers/plans/2026-08-11-runner-implementation.md

메인 세션은 오케스트레이터다. 구현·테스트는 자식에게 맡기고, 자식에게 background 실행, commit, merge, push, 하위 agent spawn 금지와 다른 작업자의 변경을 되돌리지 말라는 지시를 반드시 포함한다.

Task 1 구현 자식은 네이티브 spawn_agent를 다음 설정과 일치시켜 호출한다.

  task_name: runner_spec_contract
  fork_turns: none
  model: gpt-5.6-terra
  reasoning_effort: medium
  허용 Files: 계획의 Task 1 Files만
  report: $runner_worktree/.agents/reports/task-1-runner-spec.md

Task 2 구현 자식:

  task_name: runner_assertions
  fork_turns: none
  model: gpt-5.6-terra
  reasoning_effort: medium
  허용 Files: 계획의 Task 2 Files만
  report: $runner_worktree/.agents/reports/task-2-runner-assertions.md

Task 3 구현 자식:

  task_name: runner_executor
  fork_turns: none
  model: gpt-5.6-terra
  reasoning_effort: medium
  허용 Files: 계획의 Task 3 Files만
  report: $runner_worktree/.agents/reports/task-3-runner-executor.md

Task 4 구현 자식:

  task_name: runner_timeout_abort
  fork_turns: none
  model: gpt-5.6-terra
  reasoning_effort: medium
  허용 Files: 계획의 Task 4 Files만
  report: $runner_worktree/.agents/reports/task-4-runner-timeout.md

Task 5 구현 자식:

  task_name: runner_docs_release
  fork_turns: none
  model: gpt-5.6-terra
  reasoning_effort: medium
  허용 Files: 계획의 Task 5 Files만
  report: $runner_worktree/.agents/reports/task-5-runner-docs.md

각 자식 message를 만들 때 `$runner_worktree`를 실제 기록한 절대 경로 문자열로 치환한다. literal 변수명이나 개인 홈 경로를 자식에게 보내지 않는다. message에는 역할, Task 전문, worktree 절대 경로, 설계·계획 경로, 허용 Files, 금지 파일, RED/GREEN 명령, report 경로와 다음 완료 형식을 반복해서 넣어라. 이전 message나 표를 참조하게 하지 마라.

  status: READY_FOR_REVIEW 또는 status: BLOCKED
  변경 파일
  RED 명령과 관찰 결과
  GREEN 명령과 결과
  report 경로
  남은 위험

활성 자식이 있는 동안 최대 60초 간격으로 wait_agent를 사용해 상태를 확인하고, agent ID와 기대 report 경로를 기록한다.

각 구현 자식이 READY_FOR_REVIEW를 반환하면 곧바로 다음 Task를 시작하지 마라. 메인 세션이 report, 허용 Files diff, 테스트 출력을 직접 열어 설계 준수·테스트 누락·소유권 위반을 리뷰한다.

리뷰 지적이 있으면 같은 구현 자식에게 followup_task로 정확한 지적과 허용 Files를 보내 수정 루프를 진행한다. 메인 리뷰가 통과하면 변경 파일, 검증 결과, 권장 커밋 메시지를 사용자에게 보고하고 멈춘다. 메인과 자식 모두 commit, merge, push를 실행하지 않는다. Task 5가 끝난 뒤에만 계획에 고정된 최종 리뷰 자식을 한 번 실행한다.

사용자가 커밋 SHA를 알려주면 다음을 확인한다.

  git cat-file -e SHA^{commit}
  git merge-base --is-ancestor SHA HEAD
  git rev-parse HEAD가 SHA와 같은지

검증된 경우에만 다음 Task를 시작한다. Task 1부터 Task 5까지 계획 순서대로 반복한다. 활성 자식은 한 번에 구현 1개 또는 리뷰 1개만 둔다. 완료 알림만 믿지 말고 report, diff, 테스트를 직접 확인한다.
```

## 5. Runtime-Resolved Native Spawn Calls

The orchestrator uses these calls one at a time. Before each call it binds `runnerWorktree` to the exact absolute `runner_worktree` recorded in §4. Template interpolation happens before the tool call; the actual `spawn_agent` payload must contain neither a `${runnerWorktree}` literal nor a personal home-directory constant, and each rendered `Report:` line is therefore absolute. Each child starts with no forked conversation and obtains all authority and context from the fully rendered message and committed files.

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_spec_contract",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Runner 공개 명세 계약 구현자.",
    "목표: 선언형 suite union 타입, deep-readonly draft 2020-12 JSON Schema, 구조화 validator, defineMcpSuite, 루트 재수출을 TDD로 구현한다. 한 case는 listTools 또는 callTool 하나만 가지며 assertion 조합, 닫힌 필드, 고유 ID, 비어 있지 않은 문자열, 유한 JSON 값, `1..2_147_483_647ms` timeout을 검증한다. 비순환 공유 객체는 허용하고 실제 cycle만 거절한다. dev-only evaluator로 공개 JSON Schema에 같은 valid/invalid fixture를 실행해 `$ref`와 `oneOf`까지 검증하고 Schema의 중첩 변경은 TypeScript와 recursive freeze 모두 막는다. 기존 `createMcpTest`/`toContainTool` named export와 `not implemented` 동작은 deprecated shim으로 보존한다.",
    "Worktree: ${runnerWorktree}",
    "Report: ${runnerWorktree}/.agents/reports/task-1-runner-spec.md",
    "첫 명령으로 `git rev-parse --show-toplevel`을 실행하고 출력이 위 Worktree 절대 경로와 같은지, 그 경로에 이 계획과 승인된 선행 HEAD가 있는지 확인한다. 다르면 BLOCKED로 끝낸다.",
    "먼저 CLAUDE.md, CONTRIBUTING.md, .agents/skills/execution-conventions/SKILL.md, docs/conventions/execution.md, Runner 설계 문서와 구현 계획을 끝까지 읽는다.",
    "허용 Files: packages/runner/src/spec/types.ts, packages/runner/src/spec/json-schema.ts, packages/runner/src/spec/validation.ts, packages/runner/src/spec/index.ts, packages/runner/src/index.ts, packages/runner/tests/helpers/schema-evaluator.ts, packages/runner/tests/spec-validation.test.ts, packages/runner/tests/spec-schema.test.ts, packages/runner/tests/index.test.ts, .agents/reports/task-1-runner-spec.md.",
    "금지: 다른 파일 수정, background 실행, commit, merge, push, 하위 agent spawn, 다른 작업자의 변경 되돌리기.",
    "반드시 Task 1 Files의 테스트에 필수 필드·unknown 필드·operation/assertion 조합·timeout 양 경계·`NaN`/`Infinity`/`-Infinity`·null-prototype JSON object·공유 참조·cycle·schema 내부 참조·recursive freeze를 먼저 작성한다. Schema parity는 공개 객체를 dev-only evaluator로 실행해 valid/invalid fixture 판정, 깨진 local `$ref`, `oneOf` match 0개와 2개를 검사한다. evaluator와 production validator 모두 `Object.prototype | null` record만 object로 허용한다. 기존 export 호환 테스트도 유지한다. `pnpm exec vitest run packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts packages/runner/tests/index.test.ts`에서 의도한 RED를 확인한 뒤 최소 구현한다. GREEN은 같은 focused 명령, `pnpm exec vitest run packages/runner/tests`, `pnpm --filter @ohmymcp/runner typecheck`로 확인한다.",
    "보고서는 지정 경로에 작성하고 최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED로 시작한다. 변경 파일, RED 관찰, GREEN 결과, 남은 위험을 포함한다.",
  ].join("\n").replaceAll("${runnerWorktree}", runnerWorktree),
});
```

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_assertions",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Runner 실패 진단·assertion 구현자.",
    "목표: `toolExists`와 `isError`를 순수 함수로 평가하고 구조화된 `RunnerDiagnostic`을 만든다. 한 operation 결과로 assertion을 명세 순서대로 모두 평가하며, TOOL_NOT_FOUND는 중복 제거 후 locale과 무관한 UTF-16 순서의 tool 이름만, IS_ERROR_MISMATCH는 boolean만, operation reject는 정규화한 `{ type, name, message }`만 노출한다. raw/content/순환 객체/함수/symbol은 진단에 넣지 않는다.",
    "Worktree: ${runnerWorktree}",
    "Report: ${runnerWorktree}/.agents/reports/task-2-runner-assertions.md",
    "첫 명령으로 `git rev-parse --show-toplevel`을 실행하고 출력이 위 Worktree 절대 경로와 같은지, 그 경로에 이 계획과 승인된 Task 1 HEAD가 있는지 확인한다. 다르면 BLOCKED로 끝낸다.",
    "먼저 프로젝트 지침, 실행 규약, Runner 설계, 구현 계획을 끝까지 읽고 현재 HEAD가 사용자 승인 Task 1 SHA인지 확인한다.",
    "허용 Files: packages/runner/src/diagnostics.ts, packages/runner/src/assertions.ts, packages/runner/src/index.ts, packages/runner/tests/assertions.test.ts, .agents/reports/task-2-runner-assertions.md.",
    "금지: 허용 Files 밖 수정, fixture 수정, raw/content 노출, background 실행, commit, merge, push, 하위 agent spawn, 다른 변경 되돌리기.",
    "다음 실패 단언을 그대로 테스트한다. 없는 툴 `missing`은 code `TOOL_NOT_FOUND`, message `툴 'missing'를 찾을 수 없습니다.`, expected `missing`, 정렬된 actual `[\"add\", \"get_weather\"]`, hint `서버의 tools/list 응답과 테스트 명세를 확인하세요.`다. 별도 fixture `가`, `a`, `A`, `a`는 `[\"A\", \"a\", \"가\"]`가 되고 spied `localeCompare`는 0회다. `isError`가 expected false/actual true면 code `IS_ERROR_MISMATCH`, message `정상 응답을 기대했지만 오류 응답을 받았습니다.`, hint `툴 입력값과 서버의 오류 응답을 확인하세요.`다. expected true/actual false면 message `오류 응답을 기대했지만 정상 응답을 받았습니다.`이고 같은 hint를 쓴다. 존재/일치 성공, raw/content secret 제외, Error와 모든 비 Error throw의 JSON-safe 정규화도 먼저 RED로 만든다.",
    "RED/GREEN focused 명령은 `pnpm exec vitest run packages/runner/tests/assertions.test.ts`다. 이후 `pnpm exec vitest run packages/runner/tests/assertions.test.ts packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts`와 `pnpm --filter @ohmymcp/runner typecheck`를 실행한다.",
    "보고서와 최종 응답 형식은 status, 변경 파일, RED, GREEN, 남은 위험 순서다.",
  ].join("\n").replaceAll("${runnerWorktree}", runnerWorktree),
});
```

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_executor",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Runner 순차 executor 구현자.",
    "목표: 검증된 private operational suite를 case 순서대로 실행하고 sanitized observer snapshot을 event sequence 0부터 고정 순서로 발행한다. 모든 case 이벤트에는 `caseId`와 `caseIndex`를 넣는다. 보통 assertion/operation 실패 뒤에는 다음 case를 실행하고, 배타적 `RunnerSummary`, sanitized spec, 안전한 직렬화 보고서와 `{ report, drain }` handle을 만든다. event handler 오류는 `report`에 그대로 전파한다.",
    "Worktree: ${runnerWorktree}",
    "Report: ${runnerWorktree}/.agents/reports/task-3-runner-executor.md",
    "첫 명령으로 `git rev-parse --show-toplevel`을 실행하고 출력이 위 Worktree 절대 경로와 같은지, 그 경로에 이 계획과 승인된 Task 2 HEAD가 있는지 확인한다. 다르면 BLOCKED로 끝낸다.",
    "프로젝트 지침, 실행 규약, 설계, 계획을 읽고 현재 HEAD가 승인된 Task 2 SHA인지 확인한다.",
    "허용 Files: packages/runner/src/sanitization.ts, packages/runner/src/executor.ts, packages/runner/src/index.ts, packages/runner/tests/sanitization.test.ts, packages/runner/tests/executor.test.ts, .agents/reports/task-3-runner-executor.md.",
    "금지: timeout 범위를 미리 구현, 병렬 실행, client.close 호출, raw 응답 보고, 허용 Files 밖 수정, background, commit, merge, push, 하위 agent spawn.",
    "이벤트 순서는 `suiteStarted → caseStarted → operationStarted → operationCompleted → assertionCompleted* → caseCompleted`를 case마다 반복한 뒤 `suiteCompleted`이고 sequence는 0부터 1씩 증가한다. case 식별자, snapshot 격리, 실패 후 계속 실행, 배타적 summary, 동일 입력 deep equality, handler 오류를 먼저 RED로 확인한다. `Authorization`/`api_key`/caller sentinel 재귀 마스킹, 원본 client input 보존, 65_536-byte case와 1_048_576-byte report 상한, unsafe `suiteCompleted` 제외, 정상 drain도 테스트한다. timeout/abort 없이 Task 3 상태표만 구현한다. RED/GREEN은 `pnpm exec vitest run packages/runner/tests/executor.test.ts packages/runner/tests/sanitization.test.ts`, 회귀는 `pnpm exec vitest run packages/runner/tests`, `pnpm --filter @ohmymcp/runner typecheck`, `pnpm --filter @ohmymcp/runner build`로 확인한다.",
    "최종 응답은 READY_FOR_REVIEW 또는 BLOCKED와 증거를 포함한다.",
  ].join("\n").replaceAll("${runnerWorktree}", runnerWorktree),
});
```

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_timeout_abort",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Runner timeout·AbortSignal 상태 전이 구현자.",
    "목표: case→suite→10_000ms 우선순위와 AbortSignal을 단일 controlled-operation helper로 구현한다. `2_147_483_647ms`까지 정확히 예약하고 더 큰 값은 명세 단계에서 거절한다. timeout은 현재 timedOut/나머지 notRun/suite failed, abort는 현재 cancelled 또는 미시작 notRun/suite aborted다. 시작하지 않은 operation은 `timeoutMs`가 없다. timeout/abort 뒤 다음 MCP 호출과 `runSuite`의 close를 금지하고 timer/listener를 정확히 한 번 정리한다. report 이후 pending 요청은 기본 5_000ms, 허용 1..60_000ms의 non-rejecting drain이 `settled | deadlineExceeded`로 추적한다. 명시적으로 호출한 finalizer만 2,000ms bounded graceful close와 pending call에 독립적인 2,000ms force close를 수행한다.",
    "Worktree: ${runnerWorktree}",
    "Report: ${runnerWorktree}/.agents/reports/task-4-runner-timeout.md",
    "첫 명령으로 `git rev-parse --show-toplevel`을 실행하고 출력이 위 Worktree 절대 경로와 같은지, 그 경로에 이 계획과 승인된 Task 3 HEAD가 있는지 확인한다. 다르면 BLOCKED로 끝낸다.",
    "프로젝트 지침, 실행 규약, 설계, 계획을 읽고 현재 HEAD가 승인된 Task 3 SHA인지 확인한다.",
    "허용 Files: packages/runner/src/executor.ts, packages/runner/src/shutdown.ts, packages/runner/src/index.ts, packages/runner/tests/executor.test.ts, packages/runner/tests/shutdown.test.ts, .agents/reports/task-4-runner-timeout.md.",
    "금지: core 타입 변경, `runSuite` 내부 client.close/forceClose 호출, timeout 뒤 다음 MCP 호출, 허용 Files 밖 수정, background, commit, merge, push, 하위 agent spawn.",
    "fake timer로 timeout 우선순위·최대 경계·notRun 필드·abort 우선순위·고정 이벤트·timer/listener cleanup·후속 호출 금지를 먼저 RED로 확인한다. report가 resolve/reject 먼저 끝나고 drain은 그 뒤 union 결과로 non-rejecting 완료되는지 검사한다. drain 0/NaN/Infinity/음수/소수/상한 초과 동기 거절, permanently pending call의 5,000ms deadline, 2,000ms graceful/force bounds, pending call과 독립적인 forceClose, late reject 처리, undefined report rejection, report→drain→close→force 오류 집계, finalizer 중복 호출에도 transport 종료 1회를 검증한다. RED/GREEN은 `pnpm exec vitest run packages/runner/tests/executor.test.ts packages/runner/tests/shutdown.test.ts`, 회귀는 `pnpm exec vitest run packages/runner/tests`, `pnpm --filter @ohmymcp/runner typecheck`, `pnpm --filter @ohmymcp/runner build`로 확인한다.",
    "최종 응답은 READY_FOR_REVIEW 또는 BLOCKED와 증거를 포함한다.",
  ].join("\n").replaceAll("${runnerWorktree}", runnerWorktree),
});
```

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_docs_release",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Runner 문서·릴리스·회귀 검증 담당자.",
    "목표: Runner README에 listTools/callTool/timeout/AbortSignal/event/report, redaction/payload limit, bounded drain의 `settled | deadlineExceeded`, explicit finalizer와 graceful/force-close controller 예제, deprecated public shim migration note, Generate가 루트 `@ohmymcp/runner` 계약을 소비한다는 경계를 문서화하고, `minor` changeset을 추가한 뒤 전체 회귀를 검증한다.",
    "Worktree: ${runnerWorktree}",
    "Report: ${runnerWorktree}/.agents/reports/task-5-runner-docs.md",
    "첫 명령으로 `git rev-parse --show-toplevel`을 실행하고 출력이 위 Worktree 절대 경로와 같은지, 그 경로에 이 계획과 승인된 Task 4 HEAD가 있는지 확인한다. 다르면 BLOCKED로 끝낸다.",
    "프로젝트 지침, 실행 규약, 설계, 계획을 읽고 현재 HEAD가 승인된 Task 4 SHA인지 확인한다.",
    "허용 Files: packages/runner/package.json, packages/runner/README.md, .changeset/runner-declarative-suite.md, .agents/reports/task-5-runner-docs.md.",
    "금지: root README와 다른 패키지 수정, repository-wide write format, background, commit, merge, push, 하위 agent spawn.",
    "README 예제가 실제 공개 타입과 일치하는지 확인하고 `@ohmymcp/runner` minor changeset을 작성한다. `pnpm exec vitest run packages/runner/tests`, `pnpm --filter @ohmymcp/runner typecheck`, `pnpm --filter @ohmymcp/runner build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm exec changeset status`를 순서대로 실행하고 검사 대상 수와 exit code를 기록한다.",
    "최종 응답은 READY_FOR_REVIEW 또는 BLOCKED와 증거를 포함한다.",
  ].join("\n").replaceAll("${runnerWorktree}", runnerWorktree),
});
```

After Task 5 main review, run one read-only final reviewer.

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_final_review",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Runner 최종 읽기 전용 리뷰어.",
    "Worktree: ${runnerWorktree}",
    "Report: ${runnerWorktree}/.agents/reports/final-runner-review.md",
    "첫 명령으로 `git rev-parse --show-toplevel`을 실행하고 출력이 위 Worktree 절대 경로와 같은지, 그 경로에 이 계획과 승인된 Task 5 HEAD가 있는지 확인한다. 다르면 BLOCKED로 끝낸다.",
    "목표: Runner 설계와 구현 결과의 공개 타입/JSON Schema/validator parity, one-operation-per-case, 모든 assertion 평가, 실패 후 계속 실행, timeout·abort 중단, deterministic event/report, raw 데이터 제외, Generate 루트 계약 경계를 base 이후 diff와 테스트로 읽기 전용 검토한다. Runner 설계 문서, 구현 계획, CLAUDE.md, CONTRIBUTING.md를 읽는다.",
    "파일 수정, background 실행, commit, merge, push, 하위 agent spawn은 금지한다.",
    "공개 계약 일치, 테스트 누락, timeout·abort 결정론성, raw 데이터 노출, 패키지 소유권, generate 연동 경계를 검토하고 필요한 read-only 테스트를 실행한다.",
    "보고서는 위 Report 절대 경로에 작성한다.",
    "최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED로 시작하고 발견 사항을 심각도순으로 적는다.",
  ].join("\n").replaceAll("${runnerWorktree}", runnerWorktree),
});
```

## 6. Plan Self-Review Checklist

- [x] Every Design §2 in-scope item maps to Tasks 1–5.
- [x] Every public type in Design §§5–13 is produced before it is consumed.
- [x] Generate integration remains contract-only; no `packages/generate/**` edit exists.
- [x] Timeout classification remains future generate guidance; Runner implements only explicit values plus 10-second fallback.
- [x] Every implementation task starts with an observable RED test and ends with focused GREEN verification.
- [x] No task edits a frozen/shared contract or another package.
- [x] Child settings match the execution prompt and project model policy.
- [x] User commit gates replace all agent commit/merge/push actions.
- [x] Final verification checks actual target counts and full repository regression.
- [x] The plan contains no unresolved placeholder, implied “similar” step, or undefined symbol.

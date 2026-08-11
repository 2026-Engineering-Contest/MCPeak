# Runner Declarative Suite Implementation Plan

> **For agentic workers:** REQUIRED PROJECT SKILL: Use `plan-conventions` when changing this plan and `execution-conventions` when executing it. Implement each task with `superpowers:test-driven-development`; use `superpowers:systematic-debugging` for unexpected failures and `superpowers:verification-before-completion` before reporting completion.

**Goal:** Implement the first deterministic `TestSuiteSpec → RunnerEvent[] + RunnerReport` vertical slice in `@ohmymcp/runner`, with `toolExists`, `isError`, validation, timeout, cancellation, and a generate-ready public contract.

**Architecture:** Keep the JSON-compatible specification contract isolated under `src/spec/`, re-export it from the existing package root, and let a sequential executor consume only the frozen `McpClient` contract. Assertions return structured results rather than throwing. Runner events are observer snapshots, and the final report retains each executed case specification and diagnostic so generate can later build single-case or batch repair requests.

**Tech Stack:** TypeScript 5.9, Vitest 4, tsdown, Biome, Node.js 20+, pnpm workspaces. Add no dependency.

## Global Constraints

- Modify only `packages/runner/**`, `.changeset/runner-declarative-suite.md`, and this Runner design/plan documentation.
- Do not modify `packages/core/src/types.ts`, another package, or root build configuration.
- Keep `@modelcontextprotocol/sdk` unchanged and add no dependency.
- Implement tests before production code and observe each intended RED failure before GREEN.
- Use in-memory fake clients and `fixtures/tools-list.sample.json`; do not start a real MCP server.
- Preserve specification order, event order, result order, and deterministic diagnostics.
- Do not add timestamps, measured durations, random IDs, or parallel execution.
- Do not call `client.close()` from Runner.
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
- `packages/runner/src/executor.ts` — sequential execution, event emission, report construction, timeout, abort.
- `packages/runner/tests/spec-validation.test.ts` — validator and helper tests.
- `packages/runner/tests/spec-schema.test.ts` — JSON Schema contract tests.
- `packages/runner/tests/assertions.test.ts` — assertion and message tests.
- `packages/runner/tests/executor.test.ts` — execution, event, report, timeout, and abort tests.
- `.changeset/runner-declarative-suite.md` — minor release note for Runner.

### Modify

- `packages/runner/src/index.ts` — remove unusable stubs and re-export the approved API.
- `packages/runner/package.json` — replace the stub-oriented description only.
- `packages/runner/README.md` — document declarative authoring and execution.

### Delete

- `packages/runner/tests/index.test.ts` — replace tests that only assert `not implemented`.

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
export const MCP_SUITE_JSON_SCHEMA: JsonObject = {
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

export interface RunSuiteOptions {
  client: McpClient;
  suite: TestSuiteSpec;
  signal?: AbortSignal;
  onEvent?: (event: RunnerEvent) => void;
}

export function runSuite(options: RunSuiteOptions): Promise<RunnerReport>;

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
- Modify: `packages/runner/src/index.ts`
- Delete: `packages/runner/tests/index.test.ts`

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
| `유한하지 않은 숫자 입력을 거절한다` | `INVALID_JSON_VALUE` for both `NaN` and `Infinity` input paths |
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

중복 case ID, class instance, `NaN`/`Infinity`, 공유 참조, cycle은 직렬화된 JSON Schema가 표현할 수 없는 validator-only fixture로 표시한다.

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
```

- [ ] **Step 2: Run focused tests and observe RED**

Run:

```bash
pnpm exec vitest run packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts
```

Expected: failure because the new modules and exports do not exist. A syntax or test-collection failure is not the intended RED; correct the test setup until Vitest reports missing implementation symbols.

- [ ] **Step 3: Implement the exact types and JSON Schema contract**

Implement the full JSON Schema object from Plan §3 byte-for-byte except for formatter-controlled whitespace. Keep `additionalProperties: false` for contract objects and allow arbitrary recursive JSON values only under `operation.input`. Recursively freeze every Schema array and object before exposing the constant. Do not add a JSON Schema validator dependency.

`spec/index.ts` re-exports only spec types, Schema, validator, and error. Root `src/index.ts` re-exports `./spec/index.js`. Remove `createMcpTest`, `toContainTool`, and their old types.

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
- JSON objects must be arrays or plain records with prototype `Object.prototype` or `null`.
- JSON 값 검사는 전역 visited set이 아니라 현재 활성 재귀 stack을 사용한다. 따라서 `{ a: shared, b: shared }` 같은 비순환 공유 참조는 허용하고, 조상 객체를 다시 가리키는 실제 cycle만 두 번째 경로에서 `INVALID_JSON_VALUE`로 보고한다.
- `validateMcpSuite` aggregates issues and never throws.
- `defineMcpSuite` throws `SuiteValidationError` on invalid input and returns the original object identity on success.

- [ ] **Step 5: Run RED→GREEN verification**

Run:

```bash
pnpm exec vitest run packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts
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
| `실제 툴 이름을 중복 제거하고 정렬한다` | input names `z`, `a`, `z` produce actual `["a", "z"]` |
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

- Create: `packages/runner/src/executor.ts`
- Create: `packages/runner/tests/executor.test.ts`
- Modify: `packages/runner/src/index.ts`

**Consumes:** Task 1 spec contract and Task 2 assertion/diagnostic results.

**Produces:** All report, event, and `runSuite` types from Plan §3, with sequential success, assertion failure, and operation rejection paths.

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

- [ ] **Step 2: Run focused tests and observe RED**

```bash
pnpm exec vitest run packages/runner/tests/executor.test.ts
```

Expected: `runSuite` and event/report exports are missing.

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
- Start `sequence` at 0 and increment once per emitted conceptual event.
- Preserve case and assertion order.
- Do not include operation output in the public report beyond relevant diagnostics.
- Do not call `client.close()`.
- In this task, use a temporary internal control path that resolves operations normally; Task 4 adds timeout/abort without changing public event/report names.

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
- Modify: `packages/runner/tests/executor.test.ts`

**Consumes:** Task 3 executor and final public result/event names.

**Produces:** timeout priority, external abort, remaining `notRun` results, timer/listener cleanup.

- [ ] **Step 1: Write fake-timer timeout and abort tests**

Use `vi.useFakeTimers()` with cleanup in `afterEach`. Required tests:

```ts
const run = runSuite({ client, suite, onEvent: (event) => events.push(event) });
await vi.advanceTimersByTimeAsync(10_000);
const report = await run;

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

- [ ] **Step 2: Run focused tests and observe RED**

```bash
pnpm exec vitest run packages/runner/tests/executor.test.ts
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
pnpm exec vitest run packages/runner/tests/executor.test.ts
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
2. `runSuite({ client, suite, onEvent })`.
3. Timeout priority and the 10-second Runner fallback.
4. Statement that Runner never closes the injected client.
5. Statement that `RunnerReport` is JSON-serializable and retains failed case specs/diagnostics for later repair.
6. Current non-goals: generate provider, JUnit, Vitest adapter, parallel execution.

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

원본 저장소는 /Users/doo._.hyun/Study/Project/OhMyMCP 이다.
먼저 원본 저장소에서 다음을 실행하고 값을 기록해라.

  git rev-parse --git-dir
  git rev-parse --git-common-dir
  git branch --show-current
  git rev-parse HEAD
  git status --short

git status가 깨끗하지 않으면 아무 변경도 하지 말고 BLOCKED로 보고해라. 다음 두 파일이 현재 HEAD에 추적돼 있지 않아도 BLOCKED다.

  docs/superpowers/specs/2026-08-11-runner-design.md
  docs/superpowers/plans/2026-08-11-runner-implementation.md

worktree나 브랜치를 만들기 전에 원본의 로컬 전제 조건을 검사한다. `AGENTS.md`, `.agents`, `.agents/skills/execution-conventions/SKILL.md`, `docs/conventions`, `docs/conventions/execution.md`가 원본에 실제로 존재해야 한다. 하나라도 없으면 아직 어떤 git 상태도 만들지 말고 필요한 경로를 포함해 BLOCKED로 보고한다. `AGENTS.md`, `.agents`, `docs/conventions`가 각각 `git check-ignore`로 ignore되는지도 확인하고, 하나라도 ignore되지 않으면 BLOCKED다.

그 다음 git-dir과 git-common-dir의 절대 경로를 비교한다. 이 프롬프트는 일반 checkout에서만 시작한다. 이미 연결 worktree이면 경로를 추측하거나 재사용하지 말고 BLOCKED로 보고한다. 일반 checkout이면 아래 worktree와 브랜치를 만든다.

  worktree: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite
  branch: feat/runner-declarative-suite
  base: 원본 저장소에서 방금 확인한 git rev-parse HEAD

worktree 경로 또는 브랜치가 이미 존재하면 삭제하거나 재사용하지 말고 BLOCKED로 보고해라. 생성 직전에 `base_commit=$(git -C /Users/doo._.hyun/Study/Project/OhMyMCP rev-parse HEAD)`로 실제 SHA를 변수에 저장한다. 전용 부모 디렉터리를 `mkdir -p /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees`로 만든 뒤 다음 명령을 실행한다.

  git worktree add -b feat/runner-declarative-suite /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite "$base_commit"

새 worktree를 만들었다면 이미 검증한 원본의 로컬 규약을 새 worktree의 같은 상대 경로로 복사한다.

  /Users/doo._.hyun/Study/Project/OhMyMCP/AGENTS.md
  /Users/doo._.hyun/Study/Project/OhMyMCP/.agents
  /Users/doo._.hyun/Study/Project/OhMyMCP/docs/conventions

worktree에 진입해 다음을 확인한다.

  pwd가 선택한 worktree 절대 경로인지
  git rev-parse HEAD가 기록한 base SHA와 같은지
  git branch --show-current가 feat/runner-declarative-suite인지
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
  report: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite/.agents/reports/task-1-runner-spec.md

Task 2 구현 자식:

  task_name: runner_assertions
  fork_turns: none
  model: gpt-5.6-terra
  reasoning_effort: medium
  허용 Files: 계획의 Task 2 Files만
  report: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite/.agents/reports/task-2-runner-assertions.md

Task 3 구현 자식:

  task_name: runner_executor
  fork_turns: none
  model: gpt-5.6-terra
  reasoning_effort: medium
  허용 Files: 계획의 Task 3 Files만
  report: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite/.agents/reports/task-3-runner-executor.md

Task 4 구현 자식:

  task_name: runner_timeout_abort
  fork_turns: none
  model: gpt-5.6-terra
  reasoning_effort: medium
  허용 Files: 계획의 Task 4 Files만
  report: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite/.agents/reports/task-4-runner-timeout.md

Task 5 구현 자식:

  task_name: runner_docs_release
  fork_turns: none
  model: gpt-5.6-terra
  reasoning_effort: medium
  허용 Files: 계획의 Task 5 Files만
  report: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite/.agents/reports/task-5-runner-docs.md

각 자식 message에는 역할, Task 전문, worktree 절대 경로, 설계·계획 경로, 허용 Files, 금지 파일, RED/GREEN 명령, report 경로와 다음 완료 형식을 반복해서 넣어라. 이전 message나 표를 참조하게 하지 마라.

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

## 5. Exact Native Spawn Calls

The orchestrator uses these calls one at a time. Each child starts with no forked conversation and obtains all authority and context from its message and the referenced committed files.

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_spec_contract",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: `역할: OhMyMCP Runner 공개 명세 계약 구현자.
목표: 선언형 suite union 타입, draft 2020-12 JSON Schema, 구조화 validator, defineMcpSuite, 루트 재수출을 TDD로 구현한다. 한 case는 listTools 또는 callTool 하나만 가지며 assertion 조합, 닫힌 필드, 고유 ID, 비어 있지 않은 문자열, JSON 값, `1..2_147_483_647ms` timeout을 검증한다. 비순환 공유 객체는 허용하고 실제 cycle만 거절한다. JSON Schema와 validator 제약을 같은 valid/invalid fixture로 대조한다.
Worktree: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite
먼저 CLAUDE.md, CONTRIBUTING.md, .agents/skills/execution-conventions/SKILL.md, docs/conventions/execution.md, Runner 설계 문서와 구현 계획을 끝까지 읽는다.
허용 Files: packages/runner/src/spec/types.ts, packages/runner/src/spec/json-schema.ts, packages/runner/src/spec/validation.ts, packages/runner/src/spec/index.ts, packages/runner/src/index.ts, packages/runner/tests/spec-validation.test.ts, packages/runner/tests/spec-schema.test.ts, packages/runner/tests/index.test.ts, .agents/reports/task-1-runner-spec.md.
금지: 다른 파일 수정, background 실행, commit, merge, push, 하위 agent spawn, 다른 작업자의 변경 되돌리기.
반드시 Task 1 Files의 테스트에 필수 필드·unknown 필드·operation/assertion 조합·timeout 양 경계·공유 참조·cycle·schema 내부 참조·recursive freeze를 먼저 작성한다. Schema parity 단언은 suite/case/operation/assertion의 `required`와 `additionalProperties`, 네 discriminant의 `const`, cases/assertions `minItems`와 variant `$ref`, timeout 최소·최대, `jsonValue.oneOf`의 null/string/number/boolean/재귀 array/재귀 object 분기를 모두 정확한 값으로 검사한다. `pnpm exec vitest run packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts`에서 의도한 RED를 확인한 뒤 최소 구현한다. GREEN은 같은 focused 명령, `pnpm exec vitest run packages/runner/tests`, `pnpm --filter @ohmymcp/runner typecheck`로 확인한다.
보고서는 지정 경로에 작성하고 최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED로 시작한다. 변경 파일, RED 관찰, GREEN 결과, 남은 위험을 포함한다.`,
});
```

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_assertions",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: `역할: OhMyMCP Runner 실패 진단·assertion 구현자.
목표: `toolExists`와 `isError`를 순수 함수로 평가하고 구조화된 `RunnerDiagnostic`을 만든다. 한 operation 결과로 assertion을 명세 순서대로 모두 평가하며, TOOL_NOT_FOUND는 정렬된 tool 이름만, IS_ERROR_MISMATCH는 boolean만, operation reject는 정규화한 `{ type, name, message }`만 노출한다. raw/content/순환 객체/함수/symbol은 진단에 넣지 않는다.
Worktree: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite
먼저 프로젝트 지침, 실행 규약, Runner 설계, 구현 계획을 끝까지 읽고 현재 HEAD가 사용자 승인 Task 1 SHA인지 확인한다.
허용 Files: packages/runner/src/diagnostics.ts, packages/runner/src/assertions.ts, packages/runner/src/index.ts, packages/runner/tests/assertions.test.ts, .agents/reports/task-2-runner-assertions.md.
금지: 허용 Files 밖 수정, fixture 수정, raw/content 노출, background 실행, commit, merge, push, 하위 agent spawn, 다른 변경 되돌리기.
다음 실패 단언을 그대로 테스트한다. 없는 툴 `missing`은 code `TOOL_NOT_FOUND`, message `툴 'missing'를 찾을 수 없습니다.`, expected `missing`, 정렬된 actual `["add", "get_weather"]`, hint `서버의 tools/list 응답과 테스트 명세를 확인하세요.`다. `isError`가 expected false/actual true면 code `IS_ERROR_MISMATCH`, message `정상 응답을 기대했지만 오류 응답을 받았습니다.`, hint `툴 입력값과 서버의 오류 응답을 확인하세요.`다. expected true/actual false면 message `오류 응답을 기대했지만 정상 응답을 받았습니다.`이고 같은 hint를 쓴다. 존재/일치 성공, tool 이름 중복 제거·정렬, raw/content secret 제외, Error와 모든 비 Error throw의 JSON-safe 정규화도 먼저 RED로 만든다.
RED/GREEN focused 명령은 `pnpm exec vitest run packages/runner/tests/assertions.test.ts`다. 이후 `pnpm exec vitest run packages/runner/tests/assertions.test.ts packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts`와 `pnpm --filter @ohmymcp/runner typecheck`를 실행한다.
보고서와 최종 응답 형식은 status, 변경 파일, RED, GREEN, 남은 위험 순서다.`,
});
```

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_executor",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: `역할: OhMyMCP Runner 순차 executor 구현자.
목표: 검증된 suite snapshot을 case 순서대로 실행하고 event sequence 0부터 고정 순서로 발행한다. 모든 case 이벤트에는 `caseId`와 `caseIndex`를 넣는다. 보통 assertion/operation 실패 뒤에는 다음 case를 실행하고, 배타적 `RunnerSummary`, 원본 spec, 안전한 직렬화 보고서를 만든다. event handler 오류는 그대로 전파한다.
Worktree: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite
프로젝트 지침, 실행 규약, 설계, 계획을 읽고 현재 HEAD가 승인된 Task 2 SHA인지 확인한다.
허용 Files: packages/runner/src/executor.ts, packages/runner/src/index.ts, packages/runner/tests/executor.test.ts, .agents/reports/task-3-runner-executor.md.
금지: timeout 범위를 미리 구현, 병렬 실행, client.close 호출, raw 응답 보고, 허용 Files 밖 수정, background, commit, merge, push, 하위 agent spawn.
이벤트 순서는 `suiteStarted → caseStarted → operationStarted → operationCompleted → assertionCompleted* → caseCompleted`를 case마다 반복한 뒤 `suiteCompleted`이고 sequence는 0부터 1씩 증가한다. caseStarted/caseCompleted를 포함한 모든 case 이벤트의 caseId/caseIndex, snapshot 격리, assertion/operation 실패 후 다음 case 실행, 배타적 summary, 동일 입력 deep equality, raw/timestamp/duration 제외, handler 오류 동일 객체 전파를 먼저 RED로 확인한다. timeout/abort 없이 Task 3 상태표만 최소 구현한다. RED/GREEN은 `pnpm exec vitest run packages/runner/tests/executor.test.ts`, 회귀는 `pnpm exec vitest run packages/runner/tests`, `pnpm --filter @ohmymcp/runner typecheck`, `pnpm --filter @ohmymcp/runner build`로 확인한다.
최종 응답은 READY_FOR_REVIEW 또는 BLOCKED와 증거를 포함한다.`,
});
```

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_timeout_abort",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: `역할: OhMyMCP Runner timeout·AbortSignal 상태 전이 구현자.
목표: case→suite→10_000ms 우선순위와 AbortSignal을 단일 controlled-operation helper로 구현한다. `2_147_483_647ms`까지 정확히 예약하고 더 큰 값은 명세 단계에서 거절한다. timeout은 현재 timedOut/나머지 notRun/suite failed, abort는 현재 cancelled 또는 미시작 notRun/suite aborted다. 시작하지 않은 operation은 `timeoutMs`가 없다. timeout/abort 뒤 다음 MCP 호출과 client.close를 금지하고 timer/listener를 정확히 한 번 정리한다.
Worktree: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite
프로젝트 지침, 실행 규약, 설계, 계획을 읽고 현재 HEAD가 승인된 Task 3 SHA인지 확인한다.
허용 Files: packages/runner/src/executor.ts, packages/runner/tests/executor.test.ts, .agents/reports/task-4-runner-timeout.md.
금지: core 타입 변경, client.close 호출, timeout 뒤 다음 MCP 호출, 허용 Files 밖 수정, background, commit, merge, push, 하위 agent spawn.
fake timer로 timeout 우선순위·최대 경계·notRun 필드·abort 우선순위·고정 이벤트·timer/listener cleanup·후속 호출 금지의 의도한 RED를 먼저 확인한다. ControlledOperation union 하나로 최소 구현한다. RED/GREEN은 `pnpm exec vitest run packages/runner/tests/executor.test.ts`, 회귀는 `pnpm exec vitest run packages/runner/tests`, `pnpm --filter @ohmymcp/runner typecheck`, `pnpm --filter @ohmymcp/runner build`로 확인한다.
최종 응답은 READY_FOR_REVIEW 또는 BLOCKED와 증거를 포함한다.`,
});
```

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "runner_docs_release",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: `역할: OhMyMCP Runner 문서·릴리스·회귀 검증 담당자.
목표: Runner README에 listTools/callTool/timeout/AbortSignal/event/report 예제와 Generate가 루트 `@ohmymcp/runner` 계약을 소비한다는 경계를 문서화하고, `minor` changeset을 추가한 뒤 전체 회귀를 검증한다.
Worktree: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite
프로젝트 지침, 실행 규약, 설계, 계획을 읽고 현재 HEAD가 승인된 Task 4 SHA인지 확인한다.
허용 Files: packages/runner/package.json, packages/runner/README.md, .changeset/runner-declarative-suite.md, .agents/reports/task-5-runner-docs.md.
금지: root README와 다른 패키지 수정, repository-wide write format, background, commit, merge, push, 하위 agent spawn.
README 예제가 실제 공개 타입과 일치하는지 확인하고 `@ohmymcp/runner` minor changeset을 작성한다. `pnpm exec vitest run packages/runner/tests`, `pnpm --filter @ohmymcp/runner typecheck`, `pnpm --filter @ohmymcp/runner build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm exec changeset status`를 순서대로 실행하고 검사 대상 수와 exit code를 기록한다.
최종 응답은 READY_FOR_REVIEW 또는 BLOCKED와 증거를 포함한다.`,
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
  message: `역할: OhMyMCP Runner 최종 읽기 전용 리뷰어.
Worktree: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite
목표: Runner 설계와 구현 결과의 공개 타입/JSON Schema/validator parity, one-operation-per-case, 모든 assertion 평가, 실패 후 계속 실행, timeout·abort 중단, deterministic event/report, raw 데이터 제외, Generate 루트 계약 경계를 base 이후 diff와 테스트로 읽기 전용 검토한다. Runner 설계 문서, 구현 계획, CLAUDE.md, CONTRIBUTING.md를 읽는다.
파일 수정, background 실행, commit, merge, push, 하위 agent spawn은 금지한다.
공개 계약 일치, 테스트 누락, timeout·abort 결정론성, raw 데이터 노출, 패키지 소유권, generate 연동 경계를 검토하고 필요한 read-only 테스트를 실행한다.
보고서: /Users/doo._.hyun/Study/Project/OhMyMCP-worktrees/runner-declarative-suite/.agents/reports/final-runner-review.md
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED로 시작하고 발견 사항을 심각도순으로 적는다.`,
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

# 응답 본문 단언 구현 계획 (2026-08-13)

설계 문서: `docs/superpowers/specs/2026-08-13-response-body-assertion-design.md`
참조: `docs/superpowers/specs/2026-08-11-runner-design.md`

## 1. 배경과 근거

Runner의 단언은 `toolExists`와 `isError` 둘뿐이다. `examples/weather-server`로 확인한 결과,
서버가 `{"city":"서울","temp":21,"condition":"맑음"}`를 반환하는데 현재 스위트는 오류 여부만
본다. `temp`를 삭제하거나 `temperature`로 개명해도 테스트가 통과한다.

설계 문서 §4에서 `bodyMatchesSchema` 단언 하나를 추가하고, §5에서 응답 본문 추출 규칙을,
§6에서 JSON Schema 부분집합 평가기를, §7에서 진단 문장을 확정했다. 이 계획은 그것을 실행한다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

1. `callTool` 응답 본문을 검사하는 `bodyMatchesSchema` 단언을 Runner 공개 계약에 추가한다.
2. 위반을 무엇이 왜 다른지 보이는 한국어 문장으로 진단한다.
3. 같은 응답에 항상 같은 보고서를 만든다.
4. `bodyMatchesSchema`가 없는 기존 스위트의 동작을 바꾸지 않는다.

### 비범위

설계 문서 §11에 연동 계약이 있다. 이 계획에서 건드리지 않는다.

- `packages/generate` 전체. baseline이 새 단언을 내는 것은 다음 웨이브다.
- `packages/cli/src/` 전체. 보고서 렌더링은 다음 웨이브다. T4가 만지는
  `packages/cli/tests/` 세 파일만 예외이며 사용자 승인을 받았다.
- `packages/core` 전체. `ToolResult`와 `ToolDef`는 변경 금지 계약이다.
- `listTools`의 `inputSchema` 단언, `expectFailure`, `structuredContent`
- 조합자(`oneOf` `anyOf` `allOf` `not`), `$ref`, 정규식 `pattern`

### 완료 조건

- `pnpm build && pnpm typecheck && pnpm lint && pnpm test` 전부 통과.
  타입체크와 린트는 검사한 파일 수가 0이 아닌지 출력에서 확인한다.
- `packages/runner/tests/` 신규 테스트가 §6의 단언 목록을 모두 포함하고 통과.
- `examples/weather-server`를 대상으로 한 E2E가 통과하고, 같은 입력 2회 실행의 출력 바이트가 같다.
- `bodyMatchesSchema`가 없는 기존 스위트의 보고서 바이트가 변경 전과 동일하다.
- `docs/adr/0010-응답-스키마-부분집합-경계.md`와 `docs/adr/0011-응답-본문-추출-규칙.md` 존재.
- `.changeset/` 신규 파일 1개. `@ohmymcp/runner` minor.

## 3. Global Constraints

모든 태스크의 요구사항에 아래가 암묵적으로 포함된다.

- T1·T2·T3의 수정 대상은 `packages/runner`뿐이다. 다른 패키지 파일을 고치지 않는다.
  T4만 예외로 `packages/cli/tests/` 아래 세 파일을 만진다. `packages/cli/src/` 는 T4도 금지다.
- `core/src/types.ts`의 `McpClient`와 `ToolResult`는 변경 금지다. 필요해 보이면 `BLOCKED`.
- 의존 방향은 단방향이다. `runner`는 `core`만 참조하고 `cli` `generate` `record` `mock`을
  참조하지 않는다.
- `@modelcontextprotocol/sdk`는 1.x 고정이다. 버전을 올리거나 `^`를 붙이지 않는다.
- 목록에 없는 의존성을 추가하지 않는다.
- 유닛테스트는 인메모리와 `fixtures/`만 쓴다. 실제 서버 프로세스를 띄우지 않는다.
- `schemaVersion`은 1을 유지한다.
- 커밋·머지·푸시는 사람이 한다. 서브에이전트는 worktree 생성 외의 git 명령을 실행하지 않는다.
- 산문에 대시 기호(`—`)를 쓰지 않는다. 주석과 문서는 한국어로 쓴다.

## 4. 공유 계약 (전량 기재)

T1이 만들고 T2·T3가 소비한다. 한 글자만 어긋나도 전부 깨지므로 그대로 쓴다.

### 4-1. `packages/runner/src/spec/types.ts`

기존 `ToolResultAssertionSpec`은 `IsErrorAssertionSpec`의 별칭이었다. 합집합으로 바꾼다.
`CallToolCaseSpec.assertions`의 원소 타입도 함께 바뀐다.

```ts
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

export interface CallToolCaseSpec extends TestCaseBase {
  operation: { type: "callTool"; tool: string; input: JsonObject };
  assertions: ToolResultAssertionSpec[];
}

export type ToolResultAssertionSpec = IsErrorAssertionSpec | BodyMatchesSchemaAssertionSpec;

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
```

`ToolListAssertionSpec`, `ToolExistsAssertionSpec`, `IsErrorAssertionSpec`, `AssertionSpec`,
`ListToolsCaseSpec`, `TestCaseSpec`, `TestSuiteSpec`, `SuiteValidationIssue`,
`SuiteValidationResult`, `SuiteValidationError`는 그대로 둔다.

`packages/generate/src/render.ts`가 자체 로컬 타입으로 `assertions: [{type:"isError";expected:false}]`
를 선언하고 있다. 합집합으로 넓히는 변경이므로 여전히 대입 가능하다. `generate`는 수정하지 않는다.

### 4-2. 검증 상수와 헬퍼

`packages/runner/src/spec/validation.ts` 상단에 추가한다.

```ts
const RESPONSE_SCHEMA_KEYWORDS = [
  "type", "const", "enum",
  "required", "properties", "additionalProperties",
  "items", "minItems",
  "minLength", "maxLength", "stringContains",
  "minimum", "maximum",
] as const;

const RESPONSE_SCHEMA_TYPES = [
  "object", "array", "string", "number", "integer", "boolean", "null",
] as const;

/** 각 키워드가 요구하는 type 값. 설계 문서 §4.4. */
const KEYWORD_TYPES: Readonly<Record<string, readonly string[]>> = {
  required: ["object"],
  properties: ["object"],
  additionalProperties: ["object"],
  items: ["array"],
  minItems: ["array"],
  minLength: ["string"],
  maxLength: ["string"],
  stringContains: ["string"],
  minimum: ["number", "integer"],
  maximum: ["number", "integer"],
};

const SUPPORTED_KEYWORD_LIST = RESPONSE_SCHEMA_KEYWORDS.join(", ");

const nonNegativeInt = (v: unknown): boolean =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

const finiteNumber = (v: unknown): boolean =>
  typeof v === "number" && Number.isFinite(v);

/** 기존 issue()는 고정 문안만 낸다. 새 코드 두 개는 전용 문안이 필요하다. */
const issueWith = (
  issues: SuiteValidationIssue[],
  code: SuiteValidationIssueCode,
  path: string,
  message: string,
  hint: string,
) => issues.push({ code, path, message, hint });
```

기존 `plain`, `nonEmpty`, `issue`, `unknowns`, `required`, `json` 헬퍼는 그대로 쓴다.

### 4-3. 응답 스키마 검증 함수

```ts
/**
 * ResponseSchema를 검증한다. 재귀가 아니라 명시적 프레임 스택으로 순회해
 * 깊게 중첩한 스키마에서도 스택이 넘치지 않게 한다. validation.ts의 json()과 같은 방식이다.
 * 방문 순서는 properties(선언 순서) → additionalProperties → items 이며,
 * 이 순서가 곧 issue 배열의 순서다.
 */
function validateResponseSchema(
  root: unknown,
  rootPath: string,
  issues: SuiteValidationIssue[],
): void {
  const frames: { value: unknown; path: string }[] = [{ value: root, path: rootPath }];
  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    const { value, path } = frame;
    if (!plain(value)) {
      issue(issues, "INVALID_TYPE", path);
      continue;
    }

    for (const key of Object.keys(value).sort())
      if (!(RESPONSE_SCHEMA_KEYWORDS as readonly string[]).includes(key))
        issueWith(
          issues,
          "UNSUPPORTED_SCHEMA_KEYWORD",
          `${path}.${key}`,
          "지원하지 않는 스키마 키워드입니다.",
          `지원 키워드는 ${SUPPORTED_KEYWORD_LIST} 입니다.`,
        );

    const declared = "type" in value ? value.type : undefined;
    if (
      declared !== undefined &&
      (typeof declared !== "string" ||
        !(RESPONSE_SCHEMA_TYPES as readonly string[]).includes(declared))
    )
      issue(issues, "INVALID_VALUE", `${path}.type`);

    for (const keyword of Object.keys(KEYWORD_TYPES).sort()) {
      if (!(keyword in value)) continue;
      const allowed = KEYWORD_TYPES[keyword] as readonly string[];
      if (typeof declared !== "string" || !allowed.includes(declared))
        issueWith(
          issues,
          "SCHEMA_KEYWORD_REQUIRES_TYPE",
          `${path}.${keyword}`,
          `'${keyword}'은 type이 ${allowed.join(" 또는 ")}일 때만 쓸 수 있습니다.`,
          `같은 스키마에 "type": "${allowed[0]}"를 추가하세요.`,
        );
    }

    if ("const" in value) json(value.const, `${path}.const`, issues, new Set());
    if ("enum" in value) {
      if (!Array.isArray(value.enum) || value.enum.length === 0)
        issue(issues, "INVALID_TYPE", `${path}.enum`);
      else
        value.enum.forEach((candidate, index) => {
          json(candidate, `${path}.enum[${index}]`, issues, new Set());
        });
    }
    if ("required" in value) {
      if (!Array.isArray(value.required)) issue(issues, "INVALID_TYPE", `${path}.required`);
      else
        value.required.forEach((key, index) => {
          if (!nonEmpty(key))
            issue(
              issues,
              typeof key === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
              `${path}.required[${index}]`,
            );
        });
    }
    for (const key of ["minItems", "minLength", "maxLength"] as const)
      if (key in value && !nonNegativeInt(value[key]))
        issue(issues, "INVALID_VALUE", `${path}.${key}`);
    for (const key of ["minimum", "maximum"] as const)
      if (key in value && !finiteNumber(value[key]))
        issue(issues, "INVALID_VALUE", `${path}.${key}`);
    if ("stringContains" in value && !nonEmpty(value.stringContains))
      issue(
        issues,
        typeof value.stringContains === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
        `${path}.stringContains`,
      );

    // 역순으로 push해 pop 순서가 properties → additionalProperties → items 가 되게 한다.
    if ("items" in value) frames.push({ value: value.items, path: `${path}.items` });
    if ("additionalProperties" in value && typeof value.additionalProperties !== "boolean")
      frames.push({
        value: value.additionalProperties,
        path: `${path}.additionalProperties`,
      });
    if ("properties" in value) {
      if (!plain(value.properties)) issue(issues, "INVALID_TYPE", `${path}.properties`);
      else {
        const keys = Object.keys(value.properties);
        for (let index = keys.length - 1; index >= 0; index--) {
          const key = keys[index];
          if (key !== undefined)
            frames.push({
              value: (value.properties as Record<string, unknown>)[key],
              path: `${path}.properties.${key}`,
            });
        }
      }
    }
  }
}
```

### 4-4. `validateAssertions` 변경

기존 함수의 허용 단언 판정과 분기만 바꾼다. 나머지는 유지한다.

```ts
const ALLOWED_ASSERTIONS: Readonly<Record<string, readonly string[]>> = {
  listTools: ["toolExists"],
  callTool: ["isError", "bodyMatchesSchema"],
};

const KNOWN_ASSERTIONS = ["toolExists", "isError", "bodyMatchesSchema"] as const;
```

`value.forEach` 안의 판정을 이렇게 바꾼다.

```ts
const type = assertion.type;
if (kind !== undefined) {
  const allowed = ALLOWED_ASSERTIONS[kind];
  if (allowed === undefined || typeof type !== "string" || !allowed.includes(type)) {
    issue(issues, "INCOMPATIBLE_ASSERTION", itemPath);
    return;
  }
} else if (
  typeof type !== "string" ||
  !(KNOWN_ASSERTIONS as readonly string[]).includes(type)
) {
  required(assertion, ["type"], itemPath, issues);
  if ("type" in assertion)
    issue(issues, typeof type === "string" ? "INVALID_VALUE" : "INVALID_TYPE", `${itemPath}.type`);
  unknowns(assertion, ["type"], itemPath, issues);
  return;
}

if (type === "toolExists") {
  // validation.ts:244-252 의 기존 블록을 그대로 옮긴다. 내용을 바꾸지 않는다.
} else if (type === "isError") {
  // validation.ts:253-258 의 기존 else 블록을 그대로 옮긴다. 내용을 바꾸지 않는다.
} else {
  required(assertion, ["type", "schema"], itemPath, issues);
  if ("schema" in assertion) validateResponseSchema(assertion.schema, `${itemPath}.schema`, issues);
  unknowns(assertion, ["type", "schema"], itemPath, issues);
}
```

### 4-5. `packages/runner/src/spec/json-schema.ts`

`$defs`에 세 개를 추가하고 `callToolCase.assertions`의 `items`를 바꾼다.

```ts
nonNegativeInteger: { type: "integer", minimum: 0 },

responseSchema: {
  type: "object",
  additionalProperties: false,
  properties: {
    type: {
      enum: ["object", "array", "string", "number", "integer", "boolean", "null"],
    },
    const: { $ref: "#/$defs/jsonValue" },
    enum: { type: "array", minItems: 1, items: { $ref: "#/$defs/jsonValue" } },
    required: { type: "array", items: { $ref: "#/$defs/nonEmptyString" } },
    properties: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/responseSchema" },
    },
    additionalProperties: {
      oneOf: [{ type: "boolean" }, { $ref: "#/$defs/responseSchema" }],
    },
    items: { $ref: "#/$defs/responseSchema" },
    minItems: { $ref: "#/$defs/nonNegativeInteger" },
    minLength: { $ref: "#/$defs/nonNegativeInteger" },
    maxLength: { $ref: "#/$defs/nonNegativeInteger" },
    stringContains: { $ref: "#/$defs/nonEmptyString" },
    minimum: { type: "number" },
    maximum: { type: "number" },
  },
},

bodyMatchesSchemaAssertion: {
  type: "object",
  additionalProperties: false,
  required: ["type", "schema"],
  properties: {
    type: { const: "bodyMatchesSchema" },
    schema: { $ref: "#/$defs/responseSchema" },
  },
},
```

`callToolCase.properties.assertions`를 바꾼다.

```ts
assertions: {
  type: "array",
  minItems: 1,
  items: {
    oneOf: [
      { $ref: "#/$defs/isErrorAssertion" },
      { $ref: "#/$defs/bodyMatchesSchemaAssertion" },
    ],
  },
},
```

`isErrorAssertion`과 `bodyMatchesSchemaAssertion`은 `type` const가 달라 서로 배타적이므로
`oneOf`의 "정확히 하나" 규칙을 만족한다.

**설계 문서 §4.4의 타입 짝 요구는 이 JSON Schema에 표현하지 않는다.** `if`/`then`이 필요한데
parity 평가기가 지원하지 않는 키워드이고, 이를 위해 평가기 범위를 넓히면 검증 대상보다 검증
도구가 복잡해진다. 설계 문서 §10.5의 결정이다.

### 4-6. parity 평가기 범위 확장

`packages/runner/tests/helpers/schema-evaluator.ts`는 테스트 전용 평가기이며 지금
`enum`과 `maxLength`를 지원하지 않는다. 위 `$defs`가 `enum`을 쓰므로 평가기를 넓힌다.
Runner 설계 §441이 "새 assertion을 추가할 때 세 계약, evaluator 범위, parity fixture를 같은
Runner 변경에서 갱신한다"고 규정한 항목이다.

`allowed` Set에 `"enum"`과 `"maxLength"`를 추가하고 판정 두 개를 넣는다.

```ts
if (Array.isArray(schema.enum)) {
  const matched = schema.enum.some((candidate) => deepEqual(candidate, value));
  if (!matched) {
    fail("INSTANCE_MISMATCH", ip, sp, "enum mismatch");
    return false;
  }
}
if (
  typeof value === "string" &&
  typeof schema.maxLength === "number" &&
  value.length > schema.maxLength
)
  fail("INSTANCE_MISMATCH", ip, sp, "maxLength mismatch");
```

`deepEqual`은 이 파일에 없다. `const` 판정이 쓰는 `Object.is`는 배열·객체 후보를 비교하지
못하므로, 아래 헬퍼를 같은 파일에 추가하고 `enum` 판정에서만 쓴다. `const` 판정은 기존 동작을
유지한다.

```ts
const deepEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
```

이 평가기는 우리가 고정한 메타 스키마만 평가하며 `$defs`의 후보 값은 전부 문자열 리터럴이므로
`JSON.stringify` 비교로 충분하다. 응답 본문 평가에 쓰이는 `schema-match.ts`의 `enum` 판정은
이것과 별개이며 §5-2의 `jsonEqual`을 쓴다.

### 4-7. `packages/runner/src/body.ts` (신규)

`plainObject`와 `typeName`은 `schema-match.ts`에서 가져온다(§5 Task T2).

```ts
import type { ToolResult } from "@ohmymcp/core";
import { plainObject, typeName } from "./schema-match.js";
import type { JsonValue } from "./spec/types.js";

export type BodyForm = "json" | "text";

export type BodyExtractionFailure =
  | { code: "CONTENT_NOT_ARRAY"; actual: string }
  | { code: "CONTENT_BLOCK_COUNT"; actual: number }
  | { code: "CONTENT_BLOCK_NOT_TEXT"; actual: string };

export type BodyExtraction =
  | { ok: true; body: JsonValue; form: BodyForm }
  | { ok: false; failure: BodyExtractionFailure };

export function extractResponseBody(result: ToolResult): BodyExtraction;
```

### 4-8. `packages/runner/src/schema-match.ts` (신규)

```ts
export const MAX_SCHEMA_VIOLATIONS = 10;

export type SchemaViolationCode =
  | "TYPE_MISMATCH"
  | "CONST_MISMATCH"
  | "ENUM_MISMATCH"
  | "REQUIRED_MISSING"
  | "ADDITIONAL_PROPERTY"
  | "MIN_ITEMS"
  | "MIN_LENGTH"
  | "MAX_LENGTH"
  | "STRING_CONTAINS"
  | "MINIMUM"
  | "MAXIMUM";

/** expected·actual·observedKeys는 가공하지 않은 원본이다. sanitize와 요약은 diagnostics.ts가 한다. */
export interface SchemaViolation {
  code: SchemaViolationCode;
  path: string;
  expected: JsonValue;
  actual: JsonValue;
  observedKeys?: string[];
}

export interface SchemaMatchResult {
  violations: SchemaViolation[];
  totalViolations: number;
}

export function matchResponseSchema(
  schema: ResponseSchema,
  body: JsonValue,
): SchemaMatchResult;
```

### 4-9. `packages/runner/src/diagnostics.ts` 확장

```ts
export type RunnerDiagnosticCode =
  | "TOOL_NOT_FOUND"
  | "IS_ERROR_MISMATCH"
  | "OPERATION_FAILED"
  | "OPERATION_RESULT_UNAVAILABLE"
  | "CASE_TIMEOUT"
  | "RUN_ABORTED"
  | "BODY_SCHEMA_MISMATCH"
  | "BODY_EXTRACTION_FAILED";

export const MAX_VALUE_STRING_CHARS = 200;
export const MAX_OBSERVED_KEYS = 20;

export interface SchemaViolationDiagnostic {
  code: SchemaViolationCode;
  path: string;
  expected: JsonValue;
  actual: JsonValue;
  actualChars?: number;
  observedKeys?: string[];
  observedKeysTotal?: number;
  message: string;
}

export interface RunnerDiagnostic {
  code: RunnerDiagnosticCode;
  message: string;
  expected?: JsonValue;
  actual?: JsonValue;
  hint: string;
  violations?: SchemaViolationDiagnostic[];
  totalViolations?: number;
}

export function bodySchemaMismatchDiagnostic(
  result: SchemaMatchResult,
  options?: RunnerRedactionOptions,
): RunnerDiagnostic;

export function bodyExtractionFailedDiagnostic(
  failure: BodyExtractionFailure,
): RunnerDiagnostic;
```

### 4-10. `packages/runner/src/assertions.ts` 확장

```ts
export function assertBodyMatchesSchema(
  extraction: BodyExtraction | undefined,
  spec: BodyMatchesSchemaAssertionSpec,
  options?: { redaction?: RunnerRedactionOptions },
): AssertionResult;
```

`extraction`이 `undefined`이면 선행 결과가 없는 경우이므로 `skipped`와 기존
`OPERATION_RESULT_UNAVAILABLE` 진단을 낸다. `executor.ts`가 MCP 호출 실패·타임아웃·취소에서
`undefined`를 넘긴다.

## 5. 태스크

### Task T1 — 공개 계약

**Files**

- 수정: `packages/runner/src/spec/types.ts`
- 수정: `packages/runner/src/spec/json-schema.ts`
- 수정: `packages/runner/src/spec/validation.ts`
- 수정: `packages/runner/src/index.ts` (새 타입 재수출)
- 수정: `packages/runner/tests/helpers/schema-evaluator.ts`
- 수정: `packages/runner/tests/spec-validation.test.ts`
- 수정: `packages/runner/tests/spec-schema.test.ts`
- 신규: `docs/adr/0010-응답-스키마-부분집합-경계.md`

**입력** 없음. 이 웨이브의 첫 태스크다.

**산출** §4-1부터 §4-6까지 전부. T2와 T3가 이 타입에 의존한다.

**구현 순서**

1. `spec-validation.test.ts`에 아래 테스트를 먼저 쓰고 실패를 확인한다.
2. `types.ts` → `validation.ts` → `json-schema.ts` → `index.ts` 순으로 구현한다.
3. `schema-evaluator.ts`에 `enum`과 `maxLength`를 추가한다.
4. `spec-schema.test.ts`에 parity fixture를 추가한다.
5. ADR-0010을 쓴다. 배경 / 선택지 / 결정 / 이유 / 결과 다섯 항목, 한 페이지.

**테스트 케이스와 단언 전량**

`packages/runner/tests/spec-validation.test.ts`

| 테스트 이름 | 핵심 단언 |
|---|---|
| `bodyMatchesSchema를 callTool 케이스에서 허용한다` | `valid === true` |
| `bodyMatchesSchema를 listTools 케이스에서 거부한다` | `INCOMPATIBLE_ASSERTION`, path `cases[0].assertions[0]` |
| `isError와 bodyMatchesSchema를 한 배열에 함께 허용한다` | `valid === true`, 케이스 단언 2개 |
| `schema가 없으면 거부한다` | `MISSING_REQUIRED_FIELD`, path `cases[0].assertions[0].schema` |
| `schema가 객체가 아니면 거부한다` | `INVALID_TYPE`, path `cases[0].assertions[0].schema` |
| `단언에 알 수 없는 필드가 있으면 거부한다` | `UNKNOWN_FIELD`, path `...assertions[0].source` |
| `지원하지 않는 스키마 키워드를 거부한다` | `UNSUPPORTED_SCHEMA_KEYWORD`, path `...schema.multipleOf`, message `지원하지 않는 스키마 키워드입니다.` |
| `중첩된 properties의 알 수 없는 키워드도 거부한다` | `UNSUPPORTED_SCHEMA_KEYWORD`, path `...schema.properties.temp.multipleOf` |
| `type 값이 목록 밖이면 거부한다` | `INVALID_VALUE`, path `...schema.type` |
| `minimum에 type이 없으면 거부한다` | `SCHEMA_KEYWORD_REQUIRES_TYPE`, path `...schema.minimum`, message에 `number 또는 integer` 포함 |
| `required에 type object가 없으면 거부한다` | `SCHEMA_KEYWORD_REQUIRES_TYPE`, path `...schema.required` |
| `stringContains에 type string이 있으면 통과한다` | `valid === true` |
| `minItems가 음수이면 거부한다` | `INVALID_VALUE`, path `...schema.minItems` |
| `minItems가 소수이면 거부한다` | `INVALID_VALUE`, path `...schema.minItems` |
| `minimum이 NaN이면 거부한다` | `INVALID_VALUE`, path `...schema.minimum` |
| `enum이 빈 배열이면 거부한다` | `INVALID_TYPE`, path `...schema.enum` |
| `stringContains가 빈 문자열이면 거부한다` | `INVALID_VALUE`, path `...schema.stringContains` |
| `required 원소가 문자열이 아니면 거부한다` | `INVALID_TYPE`, path `...schema.required[0]` |
| `additionalProperties에 스키마를 쓸 수 있다` | `valid === true` |
| `additionalProperties 스키마의 오류도 잡는다` | `UNSUPPORTED_SCHEMA_KEYWORD`, path `...schema.additionalProperties.multipleOf` |
| `items 스키마의 오류도 잡는다` | `UNSUPPORTED_SCHEMA_KEYWORD`, path `...schema.items.multipleOf` |
| `깊이 500 중첩 스키마에서 스택이 넘치지 않는다` | 예외 없이 반환, `valid === true` |
| `이슈 순서가 properties, additionalProperties, items 순이다` | `issues.map((i) => i.path)`가 기대 배열과 동일 |
| `기존 isError 전용 스위트가 그대로 통과한다` | `valid === true` |

`packages/runner/tests/spec-schema.test.ts`

| 테스트 이름 | 핵심 단언 |
|---|---|
| `bodyMatchesSchema valid fixture가 두 계약에서 같은 판정을 낸다` | validator `valid === true`, evaluator `valid === true` |
| `알 수 없는 키워드 fixture가 두 계약에서 같은 판정을 낸다` | 양쪽 모두 invalid |
| `listTools에 bodyMatchesSchema를 넣은 fixture가 두 계약에서 같은 판정을 낸다` | 양쪽 모두 invalid |
| `재귀 responseSchema를 evaluator가 해석한다` | 깊이 3 중첩 fixture에서 evaluator `valid === true` |
| `타입 짝 요구는 대조 대상이 아니다` | validator invalid, evaluator valid. 주석으로 설계 문서 §10.5를 인용 |

마지막 테스트는 의도적 불일치를 고정하는 테스트다. 나중에 누가 우연히 맞추거나 어긋내면
즉시 드러난다.

**표적 검증** `pnpm vitest run packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts`

**전체 회귀** `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

**실패 시 보고 경계** `packages/runner` 밖의 파일을 고쳐야 통과한다고 판단되면 고치지 말고
`BLOCKED`로 보고한다.

---

### Task T2 — 본문 추출과 스키마 평가

**Files**

- 신규: `packages/runner/src/body.ts`
- 신규: `packages/runner/src/schema-match.ts`
- 수정: `packages/runner/src/index.ts` (재수출)
- 신규: `packages/runner/tests/body.test.ts`
- 신규: `packages/runner/tests/schema-match.test.ts`
- 신규: `docs/adr/0011-응답-본문-추출-규칙.md`

**입력** T1의 `ResponseSchema`, `JsonValue`.

**산출** §4-7의 `extractResponseBody`, §4-8의 `matchResponseSchema`. T3가 소비한다.

**`body.ts` 구현 전량**

판단이 갈리는 로직이라 전량 기재한다. 설계 문서 §5.1의 6개 규칙과 §5.2의 근거가 여기에 박힌다.

`plainObject`와 `typeName`은 `schema-match.ts`가 export하고 `body.ts`가 가져다 쓴다. 두 파일에
같은 4줄을 중복해 두지 않는다.

```ts
// schema-match.ts
export const plainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

export const typeName = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
```

```ts
// body.ts
import { plainObject, typeName } from "./schema-match.js";

export function extractResponseBody(result: ToolResult): BodyExtraction {
  const content = result.content;
  if (!Array.isArray(content))
    return { ok: false, failure: { code: "CONTENT_NOT_ARRAY", actual: typeName(content) } };
  if (content.length !== 1)
    return { ok: false, failure: { code: "CONTENT_BLOCK_COUNT", actual: content.length } };

  const block = content[0];
  if (!plainObject(block) || block.type !== "text")
    return {
      ok: false,
      failure: {
        code: "CONTENT_BLOCK_NOT_TEXT",
        actual: plainObject(block) ? String(block.type) : typeName(block),
      },
    };
  if (typeof block.text !== "string")
    return {
      ok: false,
      failure: { code: "CONTENT_BLOCK_NOT_TEXT", actual: typeName(block.text) },
    };

  const text = block.text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: true, body: text, form: "text" };
  }
  // 스칼라는 구조로 해석하지 않는다. 설계 문서 §5.2.
  if (Array.isArray(parsed) || plainObject(parsed))
    return { ok: true, body: parsed as JsonValue, form: "json" };
  return { ok: true, body: text, form: "text" };
}
```

`JSON.parse`는 프로토타입 오염 없는 순수 JSON만 만들지만, `{"__proto__":1}` 같은 입력이
`plainObject` 판정을 통과하는지 확인한다. `JSON.parse`는 `__proto__`를 일반 자기 키로 만들며
프로토타입은 `Object.prototype`이므로 통과한다. 이것이 의도한 동작이다.

**`schema-match.ts` 사양**

설계 문서 §6 전체를 그대로 구현한다. 아래는 계획서가 못 박는 부분이다.

노드 평가 순서와 단락은 §6.1 그대로다.

```
1. type      위반이면 이 노드 종료
2. const     위반이면 이 노드 종료
3. enum      위반이면 이 노드 종료
4. 타입별 제약  minLength / maxLength / stringContains / minimum / maximum / minItems
5. 하위 순회   required → properties → additionalProperties → items
```

깊은 비교는 이 파일 안에 자체 구현을 둔다. `generate`의 `jsonEqual`을 참조하지 않는다
(의존 방향 위반이다).

```ts
function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((v, i) => jsonEqual(v, right[i] as JsonValue))
    );
  if (plainObject(left) && plainObject(right)) {
    const l = Object.keys(left).sort();
    const r = Object.keys(right).sort();
    return (
      l.length === r.length &&
      l.every((k, i) => k === r[i] && jsonEqual(left[k] as JsonValue, right[k] as JsonValue))
    );
  }
  return false;
}
```

`plainObject`와 `typeName`은 `body.ts`에도 필요하다. 두 파일이 각자 같은 4줄을 두는 것보다
`schema-match.ts`에 두고 `body.ts`가 가져다 쓰는 편이 낫다. `body.ts`가 `schema-match.ts`를
참조하는 방향으로 고정한다. 반대 방향은 만들지 않는다.

키 존재 판정은 `Object.hasOwn`을 쓴다. `in`은 프로토타입 체인을 타므로
`required: ["toString"]`이 빈 객체에서 통과한다.

정렬은 UTF-16 코드 단위 안정 비교를 쓴다. `assertions.ts`의 `assertToolExists`와 같다.

```ts
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
```

순회는 명시적 프레임 스택으로 구현한다. 재귀를 쓰지 않는다.

위반 수집은 `MAX_SCHEMA_VIOLATIONS`에서 멈추되 순회는 끝까지 진행해 `totalViolations`를 센다.

각 위반의 `expected`는 다음을 담는다.

| code | expected |
|---|---|
| code | expected | actual |
|---|---|---|
| `TYPE_MISMATCH` | 선언한 `type` 문자열 | 그 지점의 원본 값 |
| `CONST_MISMATCH` | `const` 값 | 그 지점의 원본 값 |
| `ENUM_MISMATCH` | `enum` 배열 | 그 지점의 원본 값 |
| `REQUIRED_MISSING` | 빠진 키 이름 | `null` |
| `ADDITIONAL_PROPERTY` | `null` | 그 지점의 원본 값 |
| `MIN_ITEMS` | 임계값 | **배열 길이(숫자)** |
| `MIN_LENGTH` / `MAX_LENGTH` | 임계값 | **문자열 길이(숫자)** |
| `MINIMUM` / `MAXIMUM` | 임계값 | 그 지점의 원본 숫자 |
| `STRING_CONTAINS` | 찾던 부분문자열 | 그 지점의 원본 문자열 |

길이 계열 세 개의 `actual`이 값이 아니라 **길이**인 것이 중요하다. `MIN_LENGTH` 문장은
`기대: 1자 이상, 실제: 0자`인데, `actual`에 문자열을 담으면 T3가 길이를 다시 세야 하고 그때는
이미 잘린 값이라 원본 길이를 알 수 없다.

`REQUIRED_MISSING`은 `observedKeys`에 그 객체의 자기 키 전량을 정렬해 담는다. 잘라내기는 T3가
한다.

`ADDITIONAL_PROPERTY`의 `path`는 위반한 키를 포함한다(`$.temperature`).

**문자열 길이는 코드 포인트로 센다.** `Array.from(value).length`를 쓰고 `value.length`를 쓰지
않는다. JSON Schema의 `minLength` 정의가 코드 포인트 기준이고, T3의 자르기도 코드 포인트
기준이라 둘을 맞춰야 `실제: 812자`와 잘린 결과가 어긋나지 않는다.

**테스트 케이스와 단언 전량**

`packages/runner/tests/body.test.ts`

| 입력 `content` | 기대 |
|---|---|
| `[{type:"text",text:'{"a":1}'}]` | `ok`, `body` `{a:1}`, `form` `json` |
| `[{type:"text",text:'[1,2]'}]` | `ok`, `body` `[1,2]`, `form` `json` |
| `[{type:"text",text:'{"__proto__":1}'}]` | `ok`, `form` `json`, `Object.hasOwn(body,"__proto__")` 참 |
| `[{type:"text",text:'→ 없습니다'}]` | `ok`, `body` `"→ 없습니다"`, `form` `text` |
| `[{type:"text",text:'21'}]` | `ok`, `body` `"21"`, `form` `text` |
| `[{type:"text",text:'null'}]` | `ok`, `body` `"null"`, `form` `text` |
| `[{type:"text",text:'true'}]` | `ok`, `body` `"true"`, `form` `text` |
| `[{type:"text",text:'"오류"'}]` | `ok`, `body` `'"오류"'`, `form` `text` |
| `[{type:"text",text:''}]` | `ok`, `body` `""`, `form` `text` |
| `[]` | `CONTENT_BLOCK_COUNT`, `actual` 0 |
| `[{text},{text}]` | `CONTENT_BLOCK_COUNT`, `actual` 2 |
| `[{type:"image",data:"..."}]` | `CONTENT_BLOCK_NOT_TEXT`, `actual` `"image"` |
| `[{type:"text",text:42}]` | `CONTENT_BLOCK_NOT_TEXT`, `actual` `"number"` |
| `[null]` | `CONTENT_BLOCK_NOT_TEXT`, `actual` `"null"` |
| `{a:1}` | `CONTENT_NOT_ARRAY`, `actual` `"object"` |
| `null` | `CONTENT_NOT_ARRAY`, `actual` `"null"` |
| `undefined` | `CONTENT_NOT_ARRAY`, `actual` `"undefined"` |

`packages/runner/tests/schema-match.test.ts`

키워드 13개 각각에 통과 1건과 위반 1건을 쓴다. 테스트 이름은
`<키워드>를 만족하면 위반이 없다` / `<키워드>를 위반하면 <CODE>를 낸다` 형식으로 통일한다.
각 위반 테스트는 `violations[0].code`, `violations[0].path`, `violations[0].expected`,
`violations[0].actual`을 모두 단언한다.

추가로 아래를 쓴다.

| 테스트 이름 | 핵심 단언 |
|---|---|
| `type 위반이면 같은 노드의 minimum을 평가하지 않는다` | `violations.length === 1`, code `TYPE_MISMATCH` |
| `const 위반이면 하위 properties를 평가하지 않는다` | `violations.length === 1`, code `CONST_MISMATCH` |
| `한 필드가 종료해도 형제 필드를 계속 평가한다` | `violations.length === 2`, path `$.temp`와 `$.condition` |
| `required는 Object.hasOwn으로 판정한다` | `required:["toString"]`, 본문 `{}`에서 `REQUIRED_MISSING` |
| `required는 값이 null이어도 존재로 본다` | 본문 `{temp:null}`에서 위반 없음 |
| `observedKeys를 정렬해 담는다` | 본문 키를 역순으로 넣어도 `observedKeys`가 오름차순 |
| `additionalProperties false 위반 키를 정렬해 보고한다` | 위반 path 배열이 오름차순 |
| `additionalProperties 스키마 순회 순서가 고정이다` | 키 순서를 뒤집은 두 본문의 위반 목록이 동일 |
| `응답 키 순서를 뒤집어도 위반 목록 바이트가 같다` | `JSON.stringify` 결과 동일 |
| `위반 25건이면 10건만 담고 총합은 25다` | `violations.length === 10`, `totalViolations === 25` |
| `깊이 1000 중첩에서 스택이 넘치지 않는다` | 예외 없이 반환 |
| `items가 모든 원소를 검사한다` | 원소 3개 중 2개 위반에서 `totalViolations === 2` |
| `문자열 본문에 stringContains를 적용한다` | 본문 `"→ 사용 가능한 도시: 서울"`에서 위반 없음 |

**표적 검증** `pnpm vitest run packages/runner/tests/body.test.ts packages/runner/tests/schema-match.test.ts`

**전체 회귀** `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

---

### Task T3 — 진단, 단언, executor 통합

**Files**

- 수정: `packages/runner/src/diagnostics.ts`
- 수정: `packages/runner/src/assertions.ts`
- 수정: `packages/runner/src/executor.ts`
- 수정: `packages/runner/src/index.ts` (재수출)
- 수정: `packages/runner/tests/assertions.test.ts`
- 수정: `packages/runner/tests/executor.test.ts`
- 신규: `packages/runner/tests/body-diagnostics.test.ts`
- 신규: `.changeset/` 아래 파일 1개

**입력** T1의 타입, T2의 `extractResponseBody`와 `matchResponseSchema`.

**산출** §4-9와 §4-10.

**문안 전량**

이 태스크의 본체다. 아래 문장을 그대로 쓴다. 값 렌더링 규칙은 그다음에 있다.

```
TYPE_MISMATCH        {path}: 타입이 다릅니다. 기대: {expected}, 실제: {actualType}{actualSuffix}
CONST_MISMATCH       {path}: 값이 다릅니다. 기대: {expected}, 실제: {actual}
ENUM_MISMATCH        {path}: 기대한 값 중 하나가 아닙니다. 기대: {enum을 " | "로 연결}, 실제: {actual}
REQUIRED_MISSING     {path}: 필수 필드가 없습니다. 발견된 필드: {observedKeys를 ", "로 연결}{keysSuffix}
ADDITIONAL_PROPERTY  {path}: 스키마에 없는 필드입니다.
MIN_ITEMS            {path}: 배열 원소가 부족합니다. 기대: {expected}개 이상, 실제: {actual}개
MIN_LENGTH           {path}: 문자열이 너무 짧습니다. 기대: {expected}자 이상, 실제: {actual}자
MAX_LENGTH           {path}: 문자열이 너무 깁니다. 기대: {expected}자 이하, 실제: {actual}자
STRING_CONTAINS      {path}: 응답 문자열에 기대한 내용이 없습니다. 기대: {expected} 포함, 실제: {actual}
MINIMUM              {path}: 값이 범위를 벗어납니다. 기대: {expected} 이상, 실제: {actual}
MAXIMUM              {path}: 값이 범위를 벗어납니다. 기대: {expected} 이하, 실제: {actual}
```

- `actualType`은 `TYPE_MISMATCH` 전용이며 실제 값의 타입 이름이다.
- `actualSuffix`는 실제 값이 스칼라일 때 ` (렌더링된 값)`이고 객체·배열일 때 ` (키 3개)` 또는
  ` (원소 1000개)`이다.
- `keysSuffix`는 `observedKeysTotal`이 있을 때 ` 외 {observedKeysTotal - observedKeys.length}개`다.
- `observedKeys`는 각 키를 작은따옴표로 감싼다. 나머지 문자열 값은 큰따옴표로 감싼다.

요약 문장.

```
위반이 상한 이하
  message  응답이 기대 스키마와 다릅니다. 위반 {totalViolations}건.
  hint     스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.

위반이 상한 초과
  message  응답이 기대 스키마와 다릅니다. 위반 {totalViolations}건 중 {violations.length}건을 표시합니다.
  hint     표시된 위반을 고친 뒤 나머지를 다시 확인하세요.
```

추출 실패 문장.

```
CONTENT_NOT_ARRAY
  message  응답에서 검사할 본문을 정할 수 없습니다. content가 배열이 아닙니다. 실제 타입: {actual}
  hint     bodyMatchesSchema는 text 블록 1개짜리 응답에만 쓸 수 있습니다.

CONTENT_BLOCK_COUNT
  message  응답에서 검사할 본문을 정할 수 없습니다. content 블록이 {actual}개입니다. 1개여야 합니다.
  hint     서버 응답 구조를 확인하거나 이 단언을 제거하세요.

CONTENT_BLOCK_NOT_TEXT
  message  응답에서 검사할 본문을 정할 수 없습니다. content 블록이 text가 아닙니다. 실제 type: {actual}
  hint     bodyMatchesSchema는 text 블록에만 쓸 수 있습니다.
```

**값 요약 구현 전량**

순서가 뒤집히면 민감값이 새므로 전량 기재한다.

```ts
/**
 * 진단에 넣을 값을 만든다. sanitize를 먼저 하고 자르기를 나중에 한다.
 * 순서를 뒤집으면 잘린 조각이 sensitiveValues 일치 검사를 통과하지 못해 [REDACTED]가 적용되지 않는다.
 */
function summarizeValue(
  value: JsonValue,
  options?: RunnerRedactionOptions,
): { value: JsonValue; chars?: number } {
  const safe = sanitizeJsonValue(value, options);
  if (safe === null || typeof safe === "number" || typeof safe === "boolean")
    return { value: safe };
  if (typeof safe === "string") {
    // 코드 포인트 기준으로 자른다. slice는 서로게이트 페어를 쪼갠다.
    const points = Array.from(safe);
    if (points.length <= MAX_VALUE_STRING_CHARS) return { value: safe };
    return {
      value: points.slice(0, MAX_VALUE_STRING_CHARS).join(""),
      chars: points.length,
    };
  }
  if (Array.isArray(safe)) return { value: { kind: "array", items: safe.length } };
  return { value: { kind: "object", keys: Object.keys(safe).length } };
}
```

`expected`는 스펙에서 온 값이므로 sanitize하지 않고 자르기만 적용한다. Runner 설계 §706이
assertion을 계약 식별자로 규정한다.

`observedKeys`는 정렬 후 `MAX_OBSERVED_KEYS`까지 담고, 잘렸을 때만 `observedKeysTotal`에
원본 개수를 넣는다.

**executor 통합**

`executor.ts`의 단언 평가 블록만 바꾼다. 다른 부분은 손대지 않는다.

```ts
const needsBody =
  spec.operation.type === "callTool" &&
  spec.assertions.some((a) => a.type === "bodyMatchesSchema");
const extraction =
  needsBody && result !== undefined && result.type === "callTool"
    ? extractResponseBody(result.result)
    : undefined;
```

단언 분기.

```ts
result.type === "listTools"
  ? assertToolExists(result.tools, assertion as ToolExistsAssertionSpec)
  : assertion.type === "isError"
    ? assertIsError(result.result, assertion as IsErrorAssertionSpec)
    : assertBodyMatchesSchema(extraction, assertion as BodyMatchesSchemaAssertionSpec, {
        redaction: options.redaction,
      })
```

`result === undefined`인 기존 `skipped` 경로는 그대로 둔다. 새 이벤트 종류를 만들지 않는다.

**테스트 케이스와 단언 전량**

`packages/runner/tests/body-diagnostics.test.ts`

| 테스트 이름 | 핵심 단언 |
|---|---|
| `TYPE_MISMATCH 문장을 만든다` | message가 `$.temp: 타입이 다릅니다. 기대: number, 실제: string ("21")` |
| `CONST_MISMATCH 문장을 만든다` | message가 `$.city: 값이 다릅니다. 기대: "서울", 실제: "Seoul"` |
| `ENUM_MISMATCH 문장을 만든다` | message에 `"맑음" \| "흐림" \| "비"` 포함 |
| `REQUIRED_MISSING 문장을 만든다` | message가 `$.temp: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temperature'` |
| `ADDITIONAL_PROPERTY 문장을 만든다` | message가 `$.temperature: 스키마에 없는 필드입니다.` |
| `MIN_ITEMS 문장을 만든다` | message가 `$.hourly: 배열 원소가 부족합니다. 기대: 24개 이상, 실제: 3개` |
| `MIN_LENGTH 문장을 만든다` | message에 `기대: 1자 이상, 실제: 0자` 포함 |
| `MAX_LENGTH 문장을 만든다` | message에 `기대: 200자 이하, 실제: 812자` 포함 |
| `STRING_CONTAINS 문장을 만든다` | message에 `기대: "사용 가능한 도시" 포함` 포함 |
| `MINIMUM 문장을 만든다` | message에 `기대: -90 이상, 실제: -273` 포함 |
| `MAXIMUM 문장을 만든다` | message에 `기대: 60 이하, 실제: 210` 포함 |
| `상한 이하 요약 문장을 만든다` | message가 `응답이 기대 스키마와 다릅니다. 위반 3건.` |
| `상한 초과 요약 문장을 만든다` | message가 `응답이 기대 스키마와 다릅니다. 위반 20건 중 10건을 표시합니다.` |
| `CONTENT_NOT_ARRAY 문장을 만든다` | message에 `실제 타입: object` 포함 |
| `CONTENT_BLOCK_COUNT 문장을 만든다` | message에 `content 블록이 2개입니다` 포함 |
| `CONTENT_BLOCK_NOT_TEXT 문장을 만든다` | message에 `실제 type: image` 포함 |
| `812자 문자열을 200자로 자르고 원본 길이를 남긴다` | `Array.from(actual).length === 200`, `actualChars === 812` |
| `서로게이트 페어를 쪼개지 않는다` | 199자 뒤에 이모지를 둔 문자열에서 잘린 값이 유효한 문자열이고 깨진 조각이 없을 것 |
| `키 50개 객체의 observedKeys를 20개로 자른다` | `observedKeys.length === 20`, `observedKeysTotal === 50` |
| `큰 객체를 요약값으로 바꾼다` | `actual`이 `{kind:"object",keys:N}` |
| `큰 배열을 요약값으로 바꾼다` | `actual`이 `{kind:"array",items:N}` |
| `민감값을 자르기 전에 REDACTED로 바꾼다` | 300자 토큰을 `sensitiveValues`에 넣으면 `actual === "[REDACTED]"` |
| `민감 키를 REDACTED로 바꾼다` | `{token:"..."}`가 든 객체에서 위반 값이 `[REDACTED]` |
| `expected는 sanitize하지 않는다` | `sensitiveValues`에 스펙의 `const` 값을 넣어도 `expected`가 그대로 |
| `같은 위반 목록을 두 번 넣으면 문장 바이트가 같다` | `JSON.stringify` 결과 동일 |

`packages/runner/tests/assertions.test.ts` 추가분

| 테스트 이름 | 핵심 단언 |
|---|---|
| `추출 성공에 위반이 없으면 통과한다` | `status === "passed"`, `diagnostic === undefined` |
| `추출 성공에 위반이 있으면 실패한다` | `status === "failed"`, `diagnostic.code === "BODY_SCHEMA_MISMATCH"` |
| `추출 실패면 실패한다` | `status === "failed"`, `diagnostic.code === "BODY_EXTRACTION_FAILED"` |
| `extraction이 undefined면 skipped다` | `status === "skipped"`, `diagnostic.code === "OPERATION_RESULT_UNAVAILABLE"` |

`packages/runner/tests/executor.test.ts` 추가분

| 테스트 이름 | 핵심 단언 |
|---|---|
| `bodyMatchesSchema가 있는 케이스에서 본문을 검사한다` | 케이스 `status === "failed"`, 단언 진단 code `BODY_SCHEMA_MISMATCH` |
| `bodyMatchesSchema가 없으면 추출을 호출하지 않는다` | `content`를 접근하면 던지는 getter를 둔 `ToolResult`로 통과할 것 |
| `한 케이스의 bodyMatchesSchema 두 개가 같은 추출을 공유한다` | `content` getter 접근 횟수가 1 |
| `isError가 실패해도 bodyMatchesSchema를 평가한다` | 단언 2개 모두 `status === "failed"`, 어느 것도 `skipped`가 아닐 것 |
| `MCP 호출이 실패하면 bodyMatchesSchema가 skipped다` | `status === "skipped"` |
| `타임아웃이면 bodyMatchesSchema가 skipped다` | `status === "skipped"` |
| `위반 10건 케이스가 maxCaseBytes 안에 든다` | 보고서 생성이 예외 없이 끝나고 케이스 바이트가 65536 미만 |
| `큰 객체 위반 10건도 maxCaseBytes 안에 든다` | 각 위반 `actual`이 요약값이고 케이스 바이트가 65536 미만 |
| `기존 isError 전용 스위트의 보고서가 변하지 않는다` | 고정 fixture의 `JSON.stringify` 결과가 기대 문자열과 동일 |

**changeset 내용**

```markdown
---
"@ohmymcp/runner": minor
---

callTool 응답 본문을 JSON Schema 부분집합으로 검사하는 `bodyMatchesSchema` 단언을 추가합니다.
필드 누락, 타입 변경, 값 불일치, 오류 메시지 내용을 위반 목록과 한국어 진단 문장으로 보고합니다.
```

**표적 검증** `pnpm vitest run packages/runner`

**전체 회귀** `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

---

### Task T4 — 실환경 E2E (직렬 전용)

**Files**

- 신규: `packages/cli/tests/fixtures/weather-body-assertion.suite.json`
- 신규: `packages/cli/tests/fixtures/weather-body-assertion-failing.suite.json`
- 수정: `packages/cli/tests/dist-cli-e2e.mjs`

`packages/cli`를 수정하는 유일한 태스크다. **사용자가 이 파일 수정을 명시적으로 승인했다.**
승인 범위는 위 세 파일뿐이며 `packages/cli/src/` 는 건드리지 않는다.

**입력** T1·T2·T3의 산출 전부. 빌드된 `packages/cli/dist/cli.mjs` 가 필요하므로 반드시
`pnpm build` 뒤에 실행한다.

**직렬 전용인 이유**

`examples/weather-server` 의 실제 프로세스를 띄운다. `CLAUDE.local.md` 규칙상 유닛테스트와 같은
웨이브에서 돌리지 않는다.

**픽스처 1: 통과 (`weather-body-assertion.suite.json`)**

설계 문서 §4.8의 두 예시에 타입 오류 분기를 더해 3케이스로 만든다.

```json
{
  "schemaVersion": 1,
  "id": "weather-body",
  "name": "날씨 서버 응답 본문 검증",
  "defaultTimeoutMs": 10000,
  "cases": [
    {
      "id": "weather-seoul",
      "name": "서울 날씨를 계약대로 반환한다",
      "operation": { "type": "callTool", "tool": "get_weather", "input": { "city": "서울" } },
      "assertions": [
        { "type": "isError", "expected": false },
        { "type": "bodyMatchesSchema", "schema": {
            "type": "object",
            "additionalProperties": false,
            "required": ["city", "temp", "condition"],
            "properties": {
              "city": { "type": "string", "const": "서울" },
              "temp": { "type": "number", "minimum": -90, "maximum": 60 },
              "condition": { "type": "string", "enum": ["맑음", "흐림", "비"] }
            }
        }}
      ]
    },
    {
      "id": "weather-unknown-city",
      "name": "없는 도시는 사용 가능한 목록을 안내한다",
      "operation": { "type": "callTool", "tool": "get_weather", "input": { "city": "평양" } },
      "assertions": [
        { "type": "isError", "expected": true },
        { "type": "bodyMatchesSchema", "schema": {
            "type": "string", "stringContains": "사용 가능한 도시"
        }}
      ]
    },
    {
      "id": "weather-invalid-type",
      "name": "city가 문자열이 아니면 타입을 안내한다",
      "operation": { "type": "callTool", "tool": "get_weather", "input": { "city": 123 } },
      "assertions": [
        { "type": "isError", "expected": true },
        { "type": "bodyMatchesSchema", "schema": {
            "type": "string", "stringContains": "문자열이어야 합니다"
        }}
      ]
    }
  ]
}
```

세 케이스가 각각 다른 경로를 탄다. 1번은 JSON 본문 구조 검증, 2번과 3번은 문자열 본문 검증이며
**서로 다른 오류 분기**를 구분한다. 지금 계약으로는 2번과 3번이 구별되지 않는다는 것이 이
작업의 출발점이었다.

`examples/weather-server/server.mjs` 의 실제 응답을 근거로 값을 골랐다. `WEATHER` 테이블은
`서울: { temp: 21, condition: "맑음" }` 이고, 없는 도시는
`→ '{city}' 의 날씨 데이터가 없습니다. 사용 가능한 도시: 서울, 부산, 제주` 를,
문자열이 아닌 `city` 는 `→ 'city' 는 문자열이어야 합니다. 예: { "city": "서울" }` 를 반환한다.

**픽스처 2: 실패 (`weather-body-assertion-failing.suite.json`)**

진단 문장이 실제로 나오는지 확인하는 픽스처다. 서버를 고칠 수 없으므로 스펙 쪽에서 일부러
어긋나게 한다. `temp` 대신 `temperature` 를 요구하면 서버가 필드를 개명한 상황과 같은 진단이
나온다.

```json
{
  "schemaVersion": 1,
  "id": "weather-body-failing",
  "name": "날씨 서버 응답 본문 불일치",
  "defaultTimeoutMs": 10000,
  "cases": [
    {
      "id": "weather-renamed-field",
      "name": "temperature 필드를 기대하지만 서버는 temp를 반환한다",
      "operation": { "type": "callTool", "tool": "get_weather", "input": { "city": "서울" } },
      "assertions": [
        { "type": "bodyMatchesSchema", "schema": {
            "type": "object",
            "required": ["temperature"]
        }}
      ]
    }
  ]
}
```

**`dist-cli-e2e.mjs` 변경**

1. 파일 상단 `for (const [fixture, expectedStatus, expectedSummary] of [...])` 배열에 항목
   하나를 추가한다.

```js
[
  "weather-body-assertion.suite.json",
  "passed",
  { total: 3, passed: 3, failed: 0, timedOut: 0, cancelled: 0, notRun: 0 },
],
```

2. 파일 끝의 `generate` 블록 뒤에 새 블록을 추가한다. 진단 문장과 결정론성을 함께 본다.

```js
{
  const dir = await mkdtemp(join(tmpdir(), "ohmymcp-dist-body-"));
  const pidFile = join(dir, "pid");
  const args = [
    "test",
    join(here, "fixtures", "weather-body-assertion-failing.suite.json"),
    "--command",
    process.execPath,
    "--arg",
    wrapper,
    "--arg",
    pidFile,
    "--arg",
    server,
  ];
  try {
    const first = await execute(args);
    assert.equal(first.code, 1);
    assert.equal(first.err, "");
    const report = JSON.parse(first.out);
    assert.equal(report.status, "failed");

    const diagnostic = report.cases[0].assertions[0].diagnostic;
    assert.equal(diagnostic.code, "BODY_SCHEMA_MISMATCH");
    assert.equal(diagnostic.totalViolations, 1);
    assert.equal(diagnostic.violations.length, 1);
    assert.equal(diagnostic.violations[0].code, "REQUIRED_MISSING");
    assert.equal(diagnostic.violations[0].path, "$.temperature");
    // 실패 메시지가 곧 제품이다. 문장 전문을 고정한다.
    assert.equal(
      diagnostic.violations[0].message,
      "$.temperature: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temp'",
    );
    await expectExited(pidFile);

    // 결정론성: 같은 입력 2회 실행의 표준 출력 바이트가 같아야 한다.
    const second = await execute(args);
    assert.equal(second.out, first.out);
    await expectExited(pidFile);
  } finally {
    await cleanupPid(pidFile);
    await rm(dir, { recursive: true, force: true });
  }
}
```

`발견된 필드` 목록이 `'city', 'condition', 'temp'` 인 것에 주의한다. 서버 응답의 키 순서는
`city`, `temp`, `condition` 이지만 §4-8의 규칙대로 **응답에서 온 목록은 정렬**하므로 사전순이
된다. 이 단언이 정렬 규칙이 실제 경로에서 지켜지는지 증명한다.

**표적 검증**

```
pnpm build && node packages/cli/tests/dist-cli-e2e.mjs
```

`pnpm build` 를 빼먹으면 낡은 `dist/cli.mjs` 를 돌려 새 단언을 모르는 CLI로 판정한다.
`CLAUDE.local.md` 거짓 신호 표의 "결함이 계속 재현 / 빌드 산출물이 낡음" 항목이다.

**전체 회귀** `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

**실패 시 보고 경계** `packages/cli/src/` 를 고쳐야 통과한다고 판단되면 고치지 말고 `BLOCKED`로
보고한다. 승인 범위는 `tests/` 아래 세 파일뿐이다.

## 6. 웨이브와 터미널 분할

의존이 직렬이라 병렬이 없다. **터미널 1개, worktree 1개, 브랜치 1개**다.

```
T1 공개 계약  →  T2 추출·평가  →  T3 진단·통합  →  T4 실환경 E2E
```

| 태스크 | 선행 | 쓰기 파일 겹침 |
|---|---|---|
| T1 | 없음 | `runner/src/index.ts` |
| T2 | T1 | `runner/src/index.ts` |
| T3 | T1, T2 | `runner/src/index.ts` |
| T4 | T3 | 없음 (`cli/tests/`) |

T1·T2·T3이 `runner/src/index.ts`를 모두 건드리므로 병렬로 나눌 수 없다. T4는 파일이 겹치지
않지만 빌드된 `packages/cli/dist/cli.mjs`가 T3까지의 산출을 담아야 하므로 마지막이다.
T4는 실제 서버 프로세스를 띄우므로 `CLAUDE.local.md` 규칙상 직렬 전용이다.

worktree 경로: `.claude/worktrees/ohmymcp-runner-body-assertion`
브랜치: `feat/runner-body-assertion`

## 7. 모델 배분

| 태스크 | 모델 | 근거 |
|---|---|---|
| 오케스트레이터 세션 | 상위 | 리뷰와 머지 게이트 |
| T1 | 표준 | 계약이 §4에 코드 수준으로 전량 적혀 있다 |
| T2 | 표준 | `body.ts`는 전량 기재, `schema-match.ts`는 사양이 설계 문서 §6에 확정돼 있다 |
| T3 | **상위** | 실패 메시지 문안 설계. `CLAUDE.local.md` 모델 배분표의 상위 모델 예외 첫 항목이다 |
| T4 | 표준 | 픽스처와 단언이 계획서에 전량 적혀 있다 |

## 8. 사람 몫 사전 조건

터미널을 열기 전에 프로젝트 루트에서 확인한다.

```
git log --oneline -1     # 설계 문서와 이 계획서 커밋이 HEAD인지
git status --short       # 깨끗한지
```

설계 문서 `docs/superpowers/specs/2026-08-13-response-body-assertion-design.md`와 이 계획서는
현재 untracked다. **worktree를 만들기 전에 커밋되어 있어야 한다.** 커밋은 사람이 한다.
untracked면 새 worktree에 딸려가지 않아 서브에이전트가 문서를 읽지 못한다.

## 9. 실행 프롬프트

### 터미널 1 — Task T1 · T2 · T3 · T4 (순차)

권장 실행 설정: 상위 모델, 추론 수준 high. 이 세션은 오케스트레이터이며 태스크마다 서브에이전트를
스폰한다.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

이 저장소의 루트에서
  git worktree add .claude/worktrees/ohmymcp-runner-body-assertion -b feat/runner-body-assertion
를 실행한 뒤 세션을 방금 만든 .claude/worktrees/ohmymcp-runner-body-assertion 로 옮겨라.

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED로 보고해라:
  - pwd가 .claude/worktrees/ohmymcp-runner-body-assertion 로 끝나는지
  - git log --oneline -1 이 루트에서 본 기점 커밋과 같은지
  - docs/superpowers/plans/2026-08-13-response-body-assertion-implementation.md 와
    docs/superpowers/specs/2026-08-13-response-body-assertion-design.md 가 실제로 존재하는지
  - git status --short 가 비어 있는지
  - pnpm install 을 실행한 뒤 pnpm build 와 pnpm vitest run packages/runner 가 실제로 실행되는지

[2단계: 실행]

역할: 오케스트레이터. 직접 구현하지 않는다. 태스크마다 서브에이전트를 스폰하고, 보고를 받으면
직접 diff와 테스트 결과를 확인한 뒤 다음 태스크로 넘어간다.

계획서 docs/superpowers/plans/2026-08-13-response-body-assertion-implementation.md 의
3장(Global Constraints), 4장(공유 계약), 5장(태스크)을 읽어라. 4장의 코드는 그대로 쓴다.

태스크 순서는 T1 → T2 → T3 → T4 이며 병렬 실행은 없다. T1·T2·T3 은 셋 다
packages/runner/src/index.ts 를 건드리므로 반드시 순차로 돌려라. T4 는 빌드된
packages/cli/dist/cli.mjs 가 T3 까지의 산출을 담아야 하므로 마지막이다.

각 서브에이전트에게 아래를 그대로 지시해라:
  - 계획서 5장의 해당 Task 절만 읽고 그대로 구현할 것
  - 그 Task의 Files 목록에 있는 파일만 수정할 것
  - 테스트를 먼저 쓰고 실패를 실제로 확인한 뒤 구현할 것
  - 계획서에 적힌 테스트 케이스와 단언을 하나도 빠뜨리지 말 것
  - 표적 검증과 전체 회귀 검증을 모두 실행할 것
  - 보고서를 worktree 안의 docs/reports/task-t1.md (또는 t2, t3, t4)에 쓸 것
  - 보고서에 pwd, git rev-parse HEAD, 변경 파일 목록, 실행한 검증 명령과 결과 원문,
    임의로 판단한 부분을 적을 것
  - 최종 응답을 "status: READY_FOR_REVIEW" 또는 "status: BLOCKED" 로 시작할 것

서브에이전트 스폰 설정:
  T1  표준 모델, 추론 수준 medium, 일반 구현 에이전트(general-purpose)
  T2  표준 모델, 추론 수준 medium, 일반 구현 에이전트(general-purpose)
  T3  상위 모델, 추론 수준 high,  일반 구현 에이전트(general-purpose)
      T3는 실패 메시지 문안 설계가 본체라 상위 모델을 쓴다.
  T4  표준 모델, 추론 수준 medium, 일반 구현 에이전트(general-purpose)

T1·T2·T3 서브에이전트에게 아래 금지 사항을 그대로 전달해라:
  - packages/runner 밖의 파일을 수정하지 마라. 특히 packages/core, packages/generate,
    packages/cli, packages/record, packages/mock, 루트 package.json, turbo.json,
    tsconfig.base.json, vitest.config.ts 는 공유 계약이다. 안 맞아 보여도 고치지 말고
    BLOCKED로 보고해라.
  - core/src/types.ts 의 McpClient 와 ToolResult 는 변경 금지다.
  - 의존 방향은 단방향이다. runner 는 core 만 참조한다. cli, generate, record, mock 을
    참조하지 마라.
  - @modelcontextprotocol/sdk 는 1.x 고정이다. 버전을 올리거나 ^ 를 붙이지 마라.
  - 목록에 없는 의존성을 추가하지 마라.
  - 유닛테스트는 인메모리와 fixtures/ 만 쓴다. examples/ 의 실제 서버 프로세스를 띄우지 마라.
  - git 명령(커밋, 머지, 푸시)을 실행하지 마라.
  - 백그라운드 실행과 하위 에이전트 스폰을 하지 마라.
  - 다른 작업자의 변경을 되돌리지 마라.
  - 산문에 대시 기호를 쓰지 마라. 주석과 문서는 한국어로 써라.

T4 서브에이전트에게는 위 금지 사항 중 첫 항목만 아래로 바꿔 전달해라. 나머지는 같다:
  - 수정해도 되는 파일은 아래 셋뿐이다. 사용자가 이 범위를 명시적으로 승인했다.
      packages/cli/tests/fixtures/weather-body-assertion.suite.json (신규)
      packages/cli/tests/fixtures/weather-body-assertion-failing.suite.json (신규)
      packages/cli/tests/dist-cli-e2e.mjs (수정)
    packages/cli/src/ 와 packages/runner/ 는 T4에서 수정 금지다. 고쳐야 통과한다고 판단되면
    고치지 말고 BLOCKED로 보고해라.
  - T4는 examples/weather-server 의 실제 프로세스를 띄운다. 이 태스크에 한해 허용한다.
  - node packages/cli/tests/dist-cli-e2e.mjs 를 돌리기 전에 반드시 pnpm build 를 먼저 해라.
    빼먹으면 새 단언을 모르는 낡은 dist/cli.mjs 로 판정한다.

태스크 사이 리뷰에서 네가 직접 확인할 것:
  - 변경 파일이 그 Task의 Files 목록을 벗어나지 않았는지 git status --short 로 확인
  - 계획서에 적힌 테스트 케이스가 실제로 존재하는지 테스트 파일을 열어 대조
  - pnpm build && pnpm typecheck && pnpm lint && pnpm test 를 네가 직접 다시 실행
  - 타입체크와 린트 출력에서 검사한 파일 수가 0이 아닌지 확인
  - 서브에이전트의 "완료" 선언만으로 다음 태스크를 시작하지 마라

T4까지 끝나면 아래를 확인하고 사용자에게 보고해라:
  - packages/runner/src/index.ts 가 새 타입과 함수를 모두 재수출하는지
  - docs/adr/0010-응답-스키마-부분집합-경계.md 와
    docs/adr/0011-응답-본문-추출-규칙.md 가 존재하는지
  - .changeset/ 에 @ohmymcp/runner minor 파일이 있는지
  - pnpm build && node packages/cli/tests/dist-cli-e2e.mjs 가 통과하는지
  - E2E의 결정론성 단언(같은 입력 2회 실행의 표준 출력 바이트 일치)이 실제로 들어 있는지
  - git status --short 에 packages/cli/src/ 변경이 없는지

커밋과 머지는 하지 마라. 사람이 한다.
```

## 10. 통합 게이트

1. 네 태스크의 보고서(`docs/reports/task-t1.md` ~ `task-t4.md`)를 직접 읽는다.
2. `git diff` 로 변경 파일이 각 Task의 Files 목록 안에 있는지 확인한다.
   특히 `packages/cli/src/` 변경이 하나도 없어야 한다.
3. `pnpm build && pnpm typecheck && pnpm lint && pnpm test` 를 오케스트레이터가 직접 실행한다.
4. `pnpm build && node packages/cli/tests/dist-cli-e2e.mjs` 를 직접 실행한다.
   `pnpm build` 를 생략하지 않는다.
5. 통과하면 사람이 커밋하고 머지한다.
6. 머지 직후 `docs/task-integration-ledger.tsv` 에 `T1-runner-body-assertion` 등 태스크명과
   통합 SHA를 기록하고 별도 문서 커밋으로 보존한다.

## 11. 거짓 신호 점검

`CLAUDE.local.md` 의 표에 있는 항목 중 이 작업에서 실제로 밟을 가능성이 있는 것들이다.

| 거짓 신호 | 이 작업에서의 모습 | 진실 기준 |
|---|---|---|
| 타입체크·린트 녹색 | 새 파일이 tsconfig include 밖에 있으면 검사 대상 0 | 출력에서 검사한 파일 수를 확인 |
| 유닛테스트 녹색, 실행 시 실패 | 인메모리 `ToolResult` fixture만 통과하고 실제 SDK 응답 모양이 다름 | T4의 `examples/weather-server` E2E |
| 새 worktree에서 테스트 타임아웃 | `pnpm install` 누락 | 1단계 부트스트랩 확인 |
| 결함이 계속 재현 | `dist/` 산출물이 낡음 | `pnpm build` 후 재확인 |
| 재생 테스트가 가끔 실패 | 응답 키 순서나 위반 순서가 흔들림 | 같은 입력 2회 실행해 출력 바이트 비교 |

이 작업 고유의 거짓 신호 두 개를 추가로 적는다.

| 거짓 신호 | 원인 | 진실 기준 |
|---|---|---|
| 스키마 단언이 항상 통과 | 지원하지 않는 키워드를 조용히 무시 | 알 수 없는 키워드 fixture가 `UNSUPPORTED_SCHEMA_KEYWORD`를 내는지 |
| 진단 문장은 맞는데 보고서가 비대 | 값 요약을 안 거치고 원본을 담음 | 큰 객체 위반 10건 케이스의 바이트가 `maxCaseBytes` 미만인지 |

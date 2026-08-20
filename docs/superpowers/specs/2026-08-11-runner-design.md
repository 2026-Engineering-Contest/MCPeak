# Runner 실행·보고서 및 Generate 연동 설계

- 상태: 사용자 승인 완료, Runner 구현 대기
- 작성일: 2026-08-11
- 구현 대상: `@mcpeak/runner`
- 후속 연동 대상: `@mcpeak/generate`, `mcpeak` CLI, Dashboard

## 1. 목적

Runner는 생성 출처와 무관하게 검증된 `TestSuiteSpec`을 받아 MCP 작업을 순차 실행하고, CLI와 Dashboard가 함께 소비할 수 있는 이벤트와 보고서를 만든다.

첫 수직 기능의 완료 조건은 다음과 같다.

> 가짜 `McpClient`와 직접 작성하거나 generate가 만든 `TestSuiteSpec`을 Runner에 전달하면, 툴 존재 여부와 정상·오류 응답을 검사하고 구조화된 이벤트 및 최종 보고서를 반환한다.

완료 여부는 다음 명령과 관찰 결과로 판정한다.

```text
pnpm exec vitest run packages/runner/tests
→ Runner 단위 테스트 전체 통과

pnpm --filter @mcpeak/runner typecheck
→ Runner 공개 타입과 테스트 타입체크 통과

pnpm --filter @mcpeak/runner build
→ ESM, CJS, 선언 파일 생성 성공

pnpm exec biome check packages/runner
→ Runner 변경 파일 lint·format 검사 통과
```

동일한 suite와 결정론적 fake client를 두 번 실행한 `RunnerEvent[]`와 `RunnerReport`가 deep equality를 만족하고, 보고서를 `JSON.stringify`할 수 있어야 한다. 전체 저장소 회귀 검증은 `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` 네 명령으로 판정한다.

Runner 결과는 이후 Codex 또는 Claude가 실패한 테스트를 수정할 수 있는 입력으로도 재사용한다. Runner가 AI를 직접 호출하지는 않는다.

## 2. 범위

### 이번 Runner 구현에 포함

- 선언형 `TestSuiteSpec` 공개 계약
- TypeScript 작성 helper와 런타임 validator
- generate가 소비할 JSON Schema
- `listTools`와 `callTool` 작업
- `toolExists`와 `isError` assertion
- 명세 순서에 따른 순차 실행
- 구조화된 진단, 이벤트, 최종 보고서
- 테스트별 timeout과 외부 `AbortSignal`
- 실패한 테스트를 AI 수정 흐름에 넘길 수 있는 결과 구조
- Runner 공개 기능 변경을 설명하는 changeset

### 이번 구현에서 제외

- Codex·Claude 프로세스 실행
- 자연어 또는 JSON Schema 기반 테스트 생성
- 실패 테스트 자동 수정과 파일 반영
- CLI 명령과 Dashboard UI
- JUnit과 Vitest adapter
- 입력·응답 JSON Schema assertion
- `ToolResult.content`의 범용 JSON 본문 추출
- 병렬 실행
- 토큰 추정과 MCP 정의 최적화

제외 항목은 후속 구현 시 경계를 다시 설계하지 않도록 이 문서에 연동 계약을 남긴다.

## 3. 설계 원칙

1. 테스트 케이스 하나는 MCP 작업을 정확히 한 번 수행한다.
2. 한 작업 결과에는 여러 assertion을 작성할 수 있다.
3. assertion 하나가 실패해도 독립적인 나머지 assertion은 계속 검사한다.
4. 선행 결과가 없어 검사할 수 없는 assertion만 `skipped`로 기록한다.
5. 일반 실패는 다음 케이스의 실행을 막지 않는다.
6. 취소할 수 없는 MCP 작업의 timeout과 외부 취소는 스위트를 중단한다.
7. 명세, 이벤트, 결과는 JSON으로 직렬화할 수 있어야 한다.
8. 타임스탬프와 실제 실행 시간처럼 매 실행마다 달라지는 값은 결과에 넣지 않는다.
9. 실패 정보에는 원인, 실제 값, 해결 힌트를 포함한다.
10. Runner는 주입받은 `McpClient`의 수명주기를 소유하지 않는다.

## 4. 전체 데이터 흐름

```text
직접 작성 ─→ validateMcpSuite ─────────────────────────┐
                                                       │
스키마 기반 generate ─→ validate→sanitize→승인 snapshot ├─→ runSuite
                                                       │
자연어 + Codex/Claude ─→ validate→sanitize→승인 snapshot ┘
                                      ↙        ↘
                              RunnerEvent    RunnerReport
                                  ↓               ↓
                           CLI/Dashboard    실패 테스트 선택
                                                  ↓
                                            generate repair
                                                  ↓
                                         사용자 검토·선택 반영
```

Generate의 compile·repair 결과만 safe preview 승인과 immutable snapshot 경계를 통과한다. 사용자가 직접 작성한 명세는 `validateMcpSuite`를 통과하면 별도 Generate 승인 없이 Runner에 전달할 수 있다. CLI와 Dashboard는 생성과 실행을 연결하지만 테스트 내용이나 timeout을 스스로 추론하지 않는다.

## 5. 공개 명세 모델

### 5.1 JSON 값

명세는 JSON 파일, AI 구조화 출력, TypeScript helper에서 같은 범위를 사용한다.

```ts
export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = {
  [key: string]: JsonValue;
};

export type ReadonlyJsonValue =
  | JsonPrimitive
  | readonly ReadonlyJsonValue[]
  | ReadonlyJsonObject;

export type ReadonlyJsonObject = {
  readonly [key: string]: ReadonlyJsonValue;
};
```

### 5.2 스위트와 케이스

```ts
export interface TestSuiteSpec {
  schemaVersion: 1;
  id: string;
  name: string;
  defaultTimeoutMs?: number;
  cases: TestCaseSpec[];
}

export type TestCaseSpec = ListToolsCaseSpec | CallToolCaseSpec;

export interface TestCaseBase {
  id: string;
  name: string;
  timeoutMs?: number;
}

export interface ListToolsCaseSpec extends TestCaseBase {
  operation: {
    type: "listTools";
  };
  assertions: ToolListAssertionSpec[];
}

export interface CallToolCaseSpec extends TestCaseBase {
  operation: {
    type: "callTool";
    tool: string;
    input: JsonObject;
  };
  assertions: ToolResultAssertionSpec[];
}
```

인자가 없는 툴도 `input: {}`를 명시한다. 생략과 빈 입력을 동일시하지 않는다.

작업별 discriminated union은 다음과 같은 무의미한 조합을 타입 단계에서 차단한다.

```text
listTools + isError      → 허용하지 않음
callTool + toolExists    → 허용하지 않음
```

### 5.3 첫 assertion 두 개

```ts
export type ToolListAssertionSpec = ToolExistsAssertionSpec;

export interface ToolExistsAssertionSpec {
  type: "toolExists";
  tool: string;
}

export type ToolResultAssertionSpec = IsErrorAssertionSpec;

export interface IsErrorAssertionSpec {
  type: "isError";
  expected: boolean;
}

export type AssertionSpec =
  | ToolListAssertionSpec
  | ToolResultAssertionSpec;
```

### 5.4 예시

```ts
const suite = defineMcpSuite({
  schemaVersion: 1,
  id: "weather-server",
  name: "날씨 MCP 서버 테스트",
  defaultTimeoutMs: 10_000,
  cases: [
    {
      id: "weather-tool-exists",
      name: "날씨 조회 툴을 제공한다",
      operation: { type: "listTools" },
      assertions: [
        { type: "toolExists", tool: "get_weather" },
      ],
    },
    {
      id: "weather-call-succeeds",
      name: "서울 날씨를 정상적으로 조회한다",
      timeoutMs: 30_000,
      operation: {
        type: "callTool",
        tool: "get_weather",
        input: { city: "서울" },
      },
      assertions: [
        { type: "isError", expected: false },
      ],
    },
  ],
});
```

`서울` 같은 도메인 입력값은 Runner가 결정하지 않는다. 사용자가 직접 작성하거나 generate가 자연어, `default`, `examples` 등의 근거로 제안한다.

## 6. 명세 작성과 검증 API

```ts
export function defineMcpSuite<const T extends TestSuiteSpec>(spec: T): T;

export function validateMcpSuite(input: unknown): SuiteValidationResult;

export type SuiteValidationResult =
  | { valid: true; value: TestSuiteSpec }
  | { valid: false; issues: SuiteValidationIssue[] };

export interface SuiteValidationIssue {
  code: SuiteValidationIssueCode;
  path: string;
  message: string;
  hint: string;
}

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

export class SuiteValidationError extends Error {
  override readonly name = "SuiteValidationError";
  readonly issues: SuiteValidationIssue[];

  constructor(issues: SuiteValidationIssue[]) {
    super("MCP 테스트 명세가 유효하지 않습니다.");
    this.issues = issues;
  }
}
```

`defineMcpSuite`는 TypeScript의 문맥 타입과 리터럴 타입을 유지하며 런타임 검증도 수행한다. 잘못된 경우 구조화된 `issues`를 가진 `SuiteValidationError`를 던진다.

`validateMcpSuite`는 JSON과 AI 출력처럼 신뢰할 수 없는 `unknown`을 안전하게 검사하며, 하나를 발견했다고 멈추지 않고 전체 issue를 작성 순서대로 반환한다.

validator는 다음을 검사한다.

- `schemaVersion`이 정확히 `1`인지
- 필수 문자열이 비어 있지 않은지
- 케이스 ID가 스위트 안에서 고유한지
- 케이스와 assertion 배열이 비어 있지 않은지
- operation과 assertion 조합이 맞는지
- `callTool.input`이 JSON 객체인지
- `NaN`, `Infinity`, 사용자 정의 class instance처럼 실제 JSON으로 표현할 수 없는 값이 없는지
- timeout이 `1..2_147_483_647` 범위의 정수인지
- 알 수 없는 필드가 없는지

`runSuite`도 실행 전에 같은 검증을 방어적으로 수행한다. 검증 실패 시 MCP 작업과 Runner 이벤트를 발생시키지 않고 `SuiteValidationError`를 던진다.

JSON 값 validator는 `typeof value === "number"`인 모든 위치에서 `Number.isFinite(value)`를 검사한다. 따라서 일반 유한수는 허용하지만 `NaN`, `Infinity`, `-Infinity`는 `INVALID_JSON_VALUE`로 거절한다. JSON stringify가 이 값들을 `null`로 조용히 바꾸기 전에 operational input과 observer snapshot이 같은 의미를 갖도록 보장한다.

## 7. Generate용 공개 계약 경계

generate는 Runner의 루트 공개 API에서 명세 계약을 직접 소비한다.

```ts
import {
  MCP_SUITE_JSON_SCHEMA,
  validateMcpSuite,
  type TestSuiteSpec,
} from "@mcpeak/runner";
```

별도 `@mcpeak/runner/spec` subpath는 첫 구현에 만들지 않는다. 현재 `tsconfig.base.json`은 `@mcpeak/runner` 루트만 소스에 매핑한다. subpath를 추가하면 Runner 작업 범위를 넘어 공유 루트 설정까지 바꾸거나 generate가 Runner 빌드 산출물에 의존해야 한다. 두 선택 모두 현재의 패키지별 병렬 개발 원칙에 맞지 않는다.

Runner 내부에서는 명세 계약을 `src/spec/`에 격리하되 `src/index.ts`가 이를 재수출한다. spec 모듈은 executor를 import하지 않고, executor 모듈도 import 시 작업을 수행하는 부작용을 갖지 않는다.

JSON Schema는 다음 정책을 가진다.

- `schemaVersion`은 `const: 1`
- 명세 계약 객체는 `additionalProperties: false`
- 사용자 툴 입력인 `operation.input`만 임의 JSON 객체 키를 허용
- operation과 assertion은 `type` discriminant로 구분
- 필수 필드는 JSON Schema와 TypeScript 타입에서 동일
- timeout은 Node 단일 timer가 정확히 표현할 수 있는 `1..2_147_483_647ms`

첫 버전의 Schema 계약은 다음과 같다.

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
    nonEmptyString: {
      type: "string",
      minLength: 1,
      pattern: "\\S",
    },
    timeoutMs: {
      type: "integer",
      minimum: 1,
      maximum: 2_147_483_647,
    },
    jsonValue: {
      oneOf: [
        { type: "null" },
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        {
          type: "array",
          items: { $ref: "#/$defs/jsonValue" },
        },
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
          properties: {
            type: { const: "listTools" },
          },
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

타입, JSON Schema, validator가 서로 다른 규칙을 갖지 않도록 공통으로 표현 가능한 제약마다 같은 valid/invalid fixture를 validator와 공개 `MCP_SUITE_JSON_SCHEMA`에 모두 실행한다. 테스트 전용 소형 evaluator는 로컬 `$ref`, `oneOf`, `type`, `const`, `required`, `properties`, `additionalProperties`, `items`, `minItems`, `minLength`, `pattern`, `minimum`, `maximum`만 지원한다. 알 수 없는 keyword와 해석할 수 없는 `$ref`는 조용히 건너뛰지 않고 evaluator 오류로 처리한다. 새 assertion을 추가할 때 세 계약, evaluator 범위, parity fixture를 같은 Runner 변경에서 갱신한다.

JSON Schema는 직렬화된 JSON 문서의 구조를 표현하므로 중복 case ID 같은 스위트 의미 규칙이나 JavaScript 메모리의 공유 참조·순환 참조는 표현하지 못한다. 이 항목들은 validator 전용 fixture로 분명히 표시한다. 반대로 필수 필드, 닫힌 객체, 비어 있지 않은 문자열, 배열 최소 길이, discriminant 조합, 재귀 JSON 값, timeout 범위는 parity 대상이다.

공개 Schema 객체는 `ReadonlyJsonObject`로 노출하고 모듈 초기화 시 재귀적으로 `Object.freeze`한다. TypeScript 소비자는 중첩 필드 변경을 컴파일할 수 없고, JavaScript 소비자도 런타임에 변경할 수 없다. generate나 다른 소비자가 `$defs`를 변경해 같은 프로세스의 후속 검증·생성 계약을 바꾸지 못하게 한다.

외부 JSON Schema validator 의존성은 이번 작업에서 추가하지 않는다. production validator는 독립적으로 유지하고, dev-only evaluator는 공개 Schema 객체 자체를 대상으로 유효 fixture 수용, 무효 fixture 거절, 깨진 로컬 `$ref` 탐지, `oneOf`가 정확히 한 분기만 허용하는 동작을 실행 검증한다. 향후 범위가 커져 외부 validator가 필요해지면 용도와 라이선스를 먼저 합의한다.

`generate → runner`는 순환 의존을 만들지 않는다.

```text
generate → runner → core
```

단, 현재 문서화된 형제 패키지 의존 방향을 넓히고 generate의 workspace dependency가 추가되므로 실제 generate 작업 전에 팀 합의를 받는다. 합의 전에는 스키마를 복사하지 않는다. 새 공용 contract 패키지를 만드는 것은 MVP 범위에서 제외한다.

## 8. 실행 API

```ts
export interface RunSuiteOptions {
  client: McpClient;
  suite: TestSuiteSpec;
  signal?: AbortSignal;
  onEvent?: (event: RunnerEvent) => void;
  redaction?: RunnerRedactionOptions;
  payloadLimits?: RunnerPayloadLimits;
  drainTimeoutMs?: number;
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

export interface RunnerExecution {
  readonly report: Promise<RunnerReport>;
  readonly drain: Promise<RunnerDrainResult>;
}

export type RunnerDrainResult =
  | { status: "settled" }
  | { status: "deadlineExceeded"; pendingOperations: 1 };

export type RunnerForceCloseReason =
  | "drainDeadlineExceeded"
  | "drainFailed"
  | "gracefulCloseDeadlineExceeded"
  | "gracefulCloseFailed";

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
```

`runSuite`는 `client.close()` 또는 `forceClose()`를 호출하지 않는다. client와 underlying transport를 만들고 `McpClientShutdownController`를 구현하는 책임은 CLI, Dashboard Node 서버 또는 테스트 adapter에 있다. package-private `execution-binding.ts`가 `runSuite`가 반환한 `RunnerExecution`과 실제 실행에 사용한 `McpClient` identity의 `WeakMap`을 소유하고 executor와 shutdown에만 register/read helper를 제공한다. 이 helper는 package root에서 export하지 않는다. `finalizeRunnerExecution`은 이 opaque binding을 조회해 `shutdown.client`가 정확히 같은 객체인지 먼저 검사한다. binding이 없거나 client가 다르면 report/drain을 관찰하거나 `close`/`forceClose`를 호출하기 전에 동기 `TypeError`를 던진다. caller가 임의 필드나 구조적으로 같은 client로 binding을 위조할 수 없다.

호출자는 `report`로 논리적인 suite 완료를 관찰하고, `drain`이 resolve된 뒤 client를 닫는다. `report`는 `drain`과 독립적으로 먼저 resolve 또는 reject할 수 있다. `drain`은 자체적으로 reject하지 않으며, Runner가 시작한 MCP Promise가 먼저 settle되면 `{ status: "settled" }`를 반환한다. 보류 요청이 없으면 즉시 같은 결과를 반환한다.

timeout 또는 operation 중 abort 뒤 취소할 수 없는 요청이 남으면 `report` 완료 시점부터 별도 drain deadline을 적용한다. `drainTimeoutMs` 기본값은 `5_000ms`, 허용값은 `1..60_000ms`의 유한 정수다. `0`은 즉시 종료 의미가 아니라 잘못된 설정이며 `NaN`, `Infinity`, 음수, 소수, `60_001` 이상과 함께 `runSuite`가 이벤트·MCP 호출 전에 동기 `RangeError`를 던진다. 이 5초는 작업 성공을 기다리는 timeout이 아니라 transport가 이미 시작한 요청을 정리할 짧은 grace period다. deadline이 먼저 끝나면 `drain`은 `{ status: "deadlineExceeded", pendingOperations: 1 }`을 반환한다. 요청 settlement가 deadline과 정확히 같은 monotonic timestamp에 관찰되면 deadline이 항상 이긴다. settlement callback과 timer callback 모두 `now >= deadlineAt`을 검사하므로 등록 순서에 따라 결과가 바뀌지 않는다. 늦게 settle하는 원본 Promise에는 fulfillment/rejection handler를 계속 붙여 unhandled rejection을 만들지 않는다.

`deadlineExceeded`에서 일반 `McpClient.close()`만 호출하는 것은 충분하지 않다. close가 같은 pending 요청을 기다릴 수 있기 때문이다. `McpClientShutdownController.forceClose`는 pending `listTools` 또는 `callTool` Promise와 독립적으로 underlying transport를 끊어야 한다. stdio adapter는 자식 프로세스와 stream을 종료하고 grace 뒤 `SIGKILL`, HTTP adapter는 request `AbortController`와 socket destroy를 사용한다. `finalizeRunnerExecution`은 drain deadline 초과 시 graceful close를 건너뛰고 `forceClose("drainDeadlineExceeded")`를 호출한다.

정상 drain에서는 `close()`를 먼저 호출하되 기본 `closeTimeoutMs: 2_000` 안에 끝나지 않으면 `forceClose("gracefulCloseDeadlineExceeded")`로 전환한다. `close()`가 먼저 reject하면 그 오류를 graceful-close outcome에 기록하고 즉시 별도의 `forceClose("gracefulCloseFailed")`를 수행한다. 따라서 즉시 실패한 graceful close도 transport를 열린 채 남기지 않으며 report 오류가 있으면 report를 첫 오류로 보존한다. `forceCloseTimeoutMs` 기본값도 `2_000`이다. 두 옵션은 모두 `1..10_000ms`의 유한 정수만 허용하고, `0`은 즉시 종료가 아니라 잘못된 설정이다. `0`, `NaN`, `Infinity`, 음수, 소수, `10_001` 이상은 binding 확인과 report/drain 관찰 및 transport 호출 전에 `finalizeRunnerExecution`이 동기 `RangeError`를 던진다.

drain, graceful close, force close는 같은 monotonic `deadlineAt` 비교 helper를 사용한다. 각 Promise의 fulfillment/rejection이 `now < deadlineAt`에 관찰될 때만 settlement가 이기며, `now >= deadlineAt`이면 항상 deadline이 이긴다. 따라서 close가 정확히 `2_000ms`에 fulfill/reject하면 `gracefulCloseDeadlineExceeded`로 force close하고 그 경계 rejection은 늦은 settlement로 관찰만 할 뿐 close 오류 목록에 추가하지 않는다. force close가 정확히 `2_000ms`에 fulfill/reject하면 `RunnerShutdownTimeoutError`가 이기고 이후 settlement가 finalize 결과를 바꾸지 않는다. timeout race에서 빠진 close/force Promise에도 양쪽 settlement handler를 유지해 늦은 reject를 unhandled로 만들지 않는다. transport adapter는 force-close 호출을 idempotent하게 캐시하고 실제 종료 동작을 정확히 한 번 수행한다. exact-boundary fake-timer fixture는 close와 force close의 fulfill/reject 네 경우 모두 이 결과를 고정한다.

```ts
const execution = runSuite({ client: shutdown.client, suite, signal });
const report = await finalizeRunnerExecution({ execution, shutdown });
```

`finalizeRunnerExecution`은 `report`, `drain`, graceful close, force close를 각각 `{ ok: true, value } | { ok: false, error }` outcome으로 기록한다. boolean 실패 flag를 사용하므로 rejection reason이 `undefined`여도 실패를 잃지 않는다. report가 먼저 resolve 또는 reject하고 drain은 그 뒤 `settled | deadlineExceeded`로 non-rejecting 완료한다. defensive하게 genuine bound execution의 drain이 구현 버그로 reject하면 그 오류를 별도 cleanup failure로 기록하고 `forceClose("drainFailed")`를 수행한다. 실패가 하나면 그 rejection value를 그대로 throw하고, 둘 이상이면 report→drain→graceful close→force close 순서의 `AggregateError`를 throw한다. `close()` rejection 뒤 force close가 성공해도 close 오류는 유지하며, force close도 실패하면 두 cleanup 오류를 모두 report 오류 뒤에 둔다. cleanup 오류가 primary report 오류를 덮거나 삼키지 않는다. finalizer registry는 execution별 첫 valid controller와 Promise를 캐시한다. 같은 execution/controller 재호출은 같은 Promise를 반환하고, 같은 client를 감싼 다른 controller 객체라도 첫 호출 뒤에는 동기 `TypeError`로 거절해 두 lifecycle이 경쟁하지 않게 한다.

현재 CLI와 Dashboard는 아직 Runner를 호출하지 않는 스텁이므로 이번 Runner PR은 generic controller/finalizer와 인메모리 contract test까지만 구현한다. 후속 CLI/Dashboard 연동 PR은 실제 transport별 controller를 먼저 구현하고 permanently pending `listTools`와 `callTool` 각각에 대한 force-close 통합 테스트를 통과하기 전에는 `runSuite`를 사용자 경로에 연결할 수 없다.

`onEvent`는 동기 관찰자다. handler가 던진 오류는 테스트 실패로 변환하지 않고 `RunnerExecution.report` rejection으로 호출자에게 전파하며, 다음 MCP 작업은 시작하지 않는다. 정상적인 성공, 실패, timeout, `AbortSignal` 경로에서는 항상 마지막에 `suiteCompleted`를 전달한다. validation, event handler, payload-limit 오류는 안전한 정상 종료 경로가 아니므로 이 보장을 적용하지 않는다.

`runSuite`는 검증 직후 실제 MCP 호출에만 쓰는 private operational snapshot과 observer용 sanitized snapshot을 따로 만든다. 호출자가 실행 도중 원본 객체를 변경해 실행 결과가 달라지는 일을 막고, 이벤트와 `TestCaseResult.spec`에 비밀 입력이 노출되는 것도 막기 위함이다. Runner는 전달받은 원본 객체를 수정하지 않는다.

이벤트 listener에도 Runner 내부 상태의 참조를 직접 노출하지 않는다. `onEvent`에는 JSON-safe sanitized snapshot을 전달해 listener가 event 객체를 변경하더라도 이후 assertion, case 결과, 최종 보고서가 바뀌지 않게 한다.

## 9. 실행 의미

각 케이스는 다음 순서로 실행한다.

```text
caseStarted
→ operationStarted
→ listTools 또는 callTool 정확히 한 번
→ operationCompleted
→ assertion을 명세 순서대로 모두 평가
→ caseCompleted
```

- assertion 실패는 독립적인 다음 assertion의 평가를 막지 않는다.
- 작업 결과가 없으면 관련 assertion을 `skipped`로 기록한다.
- 일반 assertion 실패와 MCP 메서드의 reject는 다음 케이스의 실행을 막지 않는다.
- 실행 순서와 결과 배열 순서는 명세의 케이스 및 assertion 순서와 같다.

## 10. Timeout과 취소

timeout 적용 우선순위는 다음과 같다.

```text
case.timeoutMs
→ suite.defaultTimeoutMs
→ Runner 안전 기본값 10_000ms
```

사용자가 값을 지정했다면 generate가 덮어쓰지 않는다. 사용자가 생략한 경우 generate는 실행 명세에 다음 제안값을 구체화한다.

```text
일반 또는 로컬 작업                   → 10_000ms
외부 API 호출이 명확하거나 강하게 추정 → 30_000ms
```

generate가 툴 정의나 자연어만으로 판단을 확신하지 못하면 값을 제안하되 `TIMEOUT_INFERRED` 경고와 `needsReview: true`를 반환한다. schema-only 생성은 실제 구현을 알 수 없다는 한계를 숨기지 않는다.

Runner의 10초 값은 generate를 거치지 않은 명세가 무기한 대기하지 않게 하는 최종 안전장치다. 시작한 operation에는 실제 적용값을 `timeoutMs`로 남기지만 실제 경과 시간과 타임스탬프는 기록하지 않는다. Node가 `2_147_483_647ms`보다 큰 단일 timer를 1ms로 축소할 수 있으므로 명세와 validator가 그보다 큰 값을 거절한다.

### 취소할 수 없는 작업의 제약

동결된 `McpClient`의 `listTools()`와 `callTool()`은 `AbortSignal`을 받지 않는다. `Promise.race`로 Runner의 대기를 끝내도 실제 요청은 백그라운드에서 계속될 수 있다. 이 상태에서 다음 케이스를 시작하면 순차 실행과 결정론성이 깨질 수 있다.

따라서 다음 정책을 사용한다.

- timeout: 현재 케이스 `timedOut`, 남은 케이스 `notRun`, 스위트 상태 `failed`
- 외부 취소: 현재 케이스 `cancelled`, 남은 케이스 `notRun`, 스위트 상태 `aborted`
- 두 경우 모두 다음 케이스를 시작하지 않고 `client.close()`도 호출하지 않음
- 논리 결과인 `report`는 먼저 완료할 수 있지만 취소할 수 없는 요청은 별도 deadline이 있는 `drain`이 추적함
- 요청이 먼저 settle하면 `finalizeRunnerExecution`이 bounded graceful close를 시도하고, deadline을 넘으면 controller의 독립 `forceClose`로 transport를 강제 종료함
- 원본 Promise의 rejection handler는 강제 종료 뒤에도 유지하며 `runSuite`는 close를 직접 호출하지 않음

timeout으로 실행은 조기 종료되지만 CI 의미상 실패이므로 스위트 상태는 `aborted`가 아니라 `failed`다.

`signal.aborted === true`인 상태로 시작하면 `suiteStarted` 직후 모든 케이스를 `notRun`으로 만든 `suiteCompleted`를 발행한다. 케이스 사이에 취소되면 완료한 케이스는 유지하고 나머지는 `notRun`으로 둔다. 두 경우 `stopReason`은 `{ type: "abortSignal" }`이며 `caseId`가 없다. operation 실행 중 취소된 경우에만 현재 케이스 ID를 `stopReason.caseId`에 기록한다.

## 11. 진단 모델

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
```

첫 구현의 진단 규칙은 다음과 같다.

- `TOOL_NOT_FOUND.actual`에는 중복을 제거한 툴 이름만 넣고 JavaScript 기본 string 비교의 UTF-16 code unit 순서로 정렬한다. `localeCompare`는 사용하지 않는다.
- `IS_ERROR_MISMATCH`에는 boolean `expected`와 `actual`만 넣는다.
- Error 객체는 `{ type, name, message }` 형태의 JSON 값으로 정규화한다.
- `ToolResult.raw`와 관련 없는 응답 전체는 보고서에 넣지 않는다.
- 순환 객체, 함수, symbol 등 직렬화할 수 없는 값은 그대로 노출하지 않는다.

`message`는 원인, `actual`은 관찰값, `hint`는 해결 방향을 제공한다. AI 전송 시에는 로컬 보고서의 값조차 자동 전송하지 않고 사용자가 payload를 확인하고 승인하게 한다.

## 12. 결과 모델

```ts
export interface RunnerReport {
  schemaVersion: 1;
  suite: {
    id: string;
    name: string;
    defaultTimeoutMs?: number;
  };
  status: "passed" | "failed" | "aborted";
  stopReason?:
    | { type: "timeout"; caseId: string }
    | { type: "abortSignal"; caseId?: string };
  cases: TestCaseResult[];
  summary: RunnerSummary;
}

export interface RunnerSummary {
  total: number;
  passed: number;
  failed: number;
  timedOut: number;
  cancelled: number;
  notRun: number;
}

export interface TestCaseResult {
  spec: TestCaseSpec;
  status: "passed" | "failed" | "timedOut" | "cancelled" | "notRun";
  operation: OperationResult;
  assertions: AssertionResult[];
}

export type OperationResult =
  | {
      status: "completed" | "failed" | "timedOut" | "cancelled";
      timeoutMs: number;
      diagnostic?: RunnerDiagnostic;
    }
  | {
      status: "notRun";
      diagnostic?: RunnerDiagnostic;
    };

export interface AssertionResult {
  spec: AssertionSpec;
  status: "passed" | "failed" | "skipped" | "notRun";
  diagnostic?: RunnerDiagnostic;
}
```

summary의 각 케이스는 정확히 한 상태에만 집계한다. `failed`는 status가 정확히 `failed`인 케이스 수이며 `timedOut`, `cancelled`, `notRun`을 중복 포함하지 않는다. `total`은 다섯 상태 카운트의 합이다.

`TestCaseResult.spec`은 실행 당시 케이스의 sanitized snapshot을 보존한다. operation 실행은 별도 private 원본 snapshot을 사용한다. 이 필드와 assertion 진단이 AI 수정 요청의 핵심 입력이며, 보고서 전체는 `JSON.stringify`할 수 있어야 한다.

### 12.1 민감정보, 크기, 보존 정책

Runner는 실제 MCP 호출 전용 원본과 외부 관찰용 sanitized 값을 분리한다. 다음 필드는 구조 전체를 새 JSON 값으로 복제하되 `operation.input`과 미래 `tools[].inputSchema`에 같은 재귀 redaction 함수를 적용한 값만 노출한다. case ID, 이름, operation type, tool 이름과 assertion은 계약 식별자이므로 caller의 `sensitiveValues`와 우연히 같아도 바꾸지 않는다.

- `TestCaseResult.spec`
- `CaseStartedEvent.case`
- `OperationStartedEvent.operation`
- `SuiteCompletedEvent.report`
- 미래 `RepairRequest.cases`

기본 민감 키는 `key.toLowerCase().replace(/[^a-z0-9]/g, "")`로 정규화한 뒤 다음 집합과 정확히 일치하는지 검사한다.

```text
authorization, cookie, password, passwd, secret, token,
apikey, accesstoken, refreshtoken, clientsecret
```

민감 키의 값은 하위 구조 전체를 문자열 `"[REDACTED]"`로 바꾼다. `RunnerRedactionOptions.sensitiveKeys`는 이 기본 집합에 같은 정규화 규칙으로 추가되고, `sensitiveValues`는 JSON 안의 문자열 값과 정확히 일치할 때 키와 무관하게 `"[REDACTED]"`로 바뀐다. 배열과 plain object는 명세 순서를 유지하며 재귀 순회한다. redaction은 입력 객체를 수정하지 않고 JSON-safe 새 값을 만든다.

기본 제한은 sanitized case 하나 `65_536` UTF-8 bytes, 최종 `RunnerReport` `1_048_576` UTF-8 bytes다. `JSON.stringify` 후 `TextEncoder`로 측정하며 호출자가 더 작은 양의 정수로만 낮출 수 있다. case가 제한을 넘으면 이벤트와 MCP 호출 전에 `RunnerPayloadLimitError(scope: "case")`로 `report`가 reject한다. 실행 후 최종 보고서가 제한을 넘으면 `RunnerPayloadLimitError(scope: "report")`로 reject하고 안전한 `suiteCompleted` payload를 만들 수 없으므로 그 이벤트를 발행하지 않는다. `drain` 계약은 두 오류에서도 유지된다.

Runner는 report/event를 메모리에서만 반환하며 파일, 로그, 원격 저장소에 자동 저장하지 않는다. CLI와 Dashboard도 기본 보존 기간을 `0`으로 두고, 사용자가 명시적으로 export를 선택한 경우에만 승인된 위치에 저장한다. Generate의 provider 요청은 전송 완료 후 메모리 참조를 해제하고 prompt/result 전문을 기본 로그에 남기지 않는다.

repair payload는 sanitized case만 사용하고 case당 `65_536` bytes, 요청 전체 `262_144` bytes를 넘으면 provider 호출 전에 거절한다. CLI/Dashboard는 마스킹된 최종 payload와 선택된 provider를 사용자에게 보여주고 명시적 승인을 받은 뒤에만 전송한다. 기본 키 목록은 알려지지 않은 비밀값을 완전히 탐지하지 못하므로 preview 승인은 생략할 수 없다.

## 13. 이벤트 모델

```ts
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
  suite: {
    id: string;
    name: string;
  };
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

이벤트의 공통 식별 필드는 다음과 같다.

- suite 이벤트: `{ id, name }`
- case 이벤트: `caseId`, `caseIndex`
- assertion 이벤트: `assertionIndex`

성공한 케이스 하나의 고정 순서는 다음과 같다.

```text
suiteStarted
caseStarted
operationStarted
operationCompleted
assertionCompleted (명세 순서대로 반복)
caseCompleted
suiteCompleted
```

`sequence`는 0부터 시작해 이벤트마다 1씩 증가한다. timestamp는 넣지 않는다.

timeout과 취소 시에도 현재 operation, 각 skipped assertion, 현재 case의 완료 이벤트를 보낸 후 `suiteCompleted`를 보낸다. 시작하지 않은 나머지 케이스에는 개별 이벤트를 만들지 않고 최종 보고서에 `notRun`으로 포함한다.

별도 `suiteAborted` 이벤트는 만들지 않는다. 모든 정상 Runner 종료 경로가 `suiteCompleted` 하나를 기다리게 하기 위함이다.

## 14. 실패 테스트 수정 연동 계약

이 절은 Runner가 보장하는 compile·repair 안전 경계의 진실이다. 결정론적 baseline과 AI 후보의
공존, 검토 중 재호출, 실제 Codex·Claude CLI 격리 실행과 사용자 변경 선택은 후속
[AI 보조 테스트 작성·반복 검토 설계](./2026-08-12-ai-assisted-test-authoring-design.md)를 따른다.
§14.4의 아직 구현되지 않은 단발 `CompileRequest`, `CompileResult`, `NaturalLanguageCompiler` shape는
후속 설계의 반복 authoring 계약이 대체한다. redaction, approval binding, provider lifecycle,
bounded output과 safe failure 계약 및 이 절의 repair shape는 계속 유효하다.

### 14.1 책임 분리

```text
Runner   → 원본으로 실행하고 sanitized 테스트와 구조화된 실패 결과 생성
CLI/UI   → 실패 테스트 선택, payload 미리보기, 사용자 승인
Generate → provider 호출, 수정 결과 검증, 교체 후보 반환
Provider → 수정·서버 문제·판단 불가 중 하나를 제안
```

Runner는 provider 이름이나 자연어 생성 여부를 알지 않는다.

### 14.2 단일 및 일괄 수정 요청

generate는 한 개와 여러 개를 같은 배열 계약으로 처리한다.

```ts
export interface RepairRequest {
  readonly suite: {
    readonly id: string;
    readonly name: string;
    readonly defaultTimeoutMs?: number;
  };
  readonly tools: readonly McpToolContext[];
  readonly cases: readonly FailedCaseContext[];
}

export interface McpToolContext {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: ReadonlyJsonValue;
}

export class GenerateRequestValidationError extends Error {
  override readonly name = "GenerateRequestValidationError";
  readonly code: "INVALID_TOOL_INPUT_SCHEMA";
  override readonly message: "툴 inputSchema가 JSON 값이 아닙니다.";
  readonly path: string;
  readonly toolIndex: number;
  readonly hint: "tools/list의 inputSchema를 JSON 값으로 정규화하세요.";

  constructor(options: { toolIndex: number });
}

export interface FailedCaseContext {
  readonly spec: TestCaseSpec;
  readonly operation: OperationResult;
  readonly assertions: readonly AssertionResult[];
}

export interface RepairRequestPreview {
  request: RepairRequest;
  byteLength: number;
  maxResultBytes: number;
  providerTimeoutMs: number;
  requiresApproval: true;
  fingerprint: string;
  binding: RepairRequestBinding;
}

declare const repairRequestBindingBrand: unique symbol;

export interface RepairRequestBinding {
  readonly [repairRequestBindingBrand]: true;
}

export class RepairPayloadLimitError extends Error {
  override readonly name = "RepairPayloadLimitError";
  readonly scope: "case" | "request" | "providerOutput" | "result";
  readonly limitBytes: number;
  readonly actualBytes: number;
  readonly caseId?: string;

  constructor(options: {
    scope: "case" | "request" | "providerOutput" | "result";
    limitBytes: number;
    actualBytes: number;
    caseId?: string;
  });
}

export function prepareRepairRequest(options: {
  originalSuite: TestSuiteSpec;
  report: RunnerReport;
  selectedCaseIds: readonly string[];
  tools: readonly McpToolContext[];
  redaction?: RunnerRedactionOptions;
  maxResultBytes?: number;
  providerTimeoutMs?: number;
}): RepairRequestPreview;
```

한 케이스만 고칠 때 `cases.length === 1`, 실패 전체를 고칠 때 선택된 실패 수만큼 전달한다. passing 케이스는 provider payload에 넣지 않는다.

기본 repair 후보는 status가 `failed`인 케이스다. `timedOut`은 우선 timeout 설정과 서버 지연 문제로 안내하며 사용자가 명시적으로 선택한 경우에만 `needsReview` 후보로 보낸다. `cancelled`와 `notRun`은 실행 결과가 없으므로 repair 대상으로 보내지 않는다.

`prepareRepairRequest`의 구현과 소유권은 미래 `@mcpeak/generate`에 있다. 함수는 `originalSuite`와 report의 suite identity·case ID를 먼저 대조하고, report의 sanitized 실패 case만 선택하며 tools의 `inputSchema`에도 같은 redaction을 적용한다. case당 `65_536` bytes 또는 전체 `262_144` bytes를 넘으면 `RepairPayloadLimitError`를 던지고 preview를 반환하지 않는다. result 상한 기본값은 `262_144` UTF-8 bytes, 허용값은 `1..262_144`의 유한 정수이며 caller는 낮출 수만 있다. provider 호출 timeout 기본값은 `120_000ms`, 허용값은 `1..600_000ms`의 유한 정수다. 두 옵션의 잘못된 값은 preview나 provider 실행 전에 동기 `RangeError`로 거절한다. runtime caller가 타입을 우회해 전달할 수 있으므로 tools는 redaction보다 먼저 배열 순서대로 검사한다. `inputSchema`가 JSON primitive(`string`, `boolean`, `null`, 유한 `number`), dense array, 또는 `Object.prototype | null` plain object로만 재귀 구성된 비순환 `ReadonlyJsonValue`가 아니면 첫 위반 tool index만 받는 `GenerateRequestValidationError`를 동기로 던진다. 비순환 공유 참조는 허용하지만 sparse array, `undefined`, `bigint`, `symbol`, 함수, 비 plain object, 비유한 숫자, cycle은 거절한다. 이 오류의 `code`, `message`, `hint`는 위 고정 literal이고 `path`는 안전한 numeric index로 만든 `tools[i].inputSchema`다. 이 경로에는 `needsReview` 대체 결과가 없으며 preview·binding·provider 호출도 만들지 않는다. raw MCP 메시지, 환경 변수, 서버 stderr, 관련 없는 응답 본문은 기본 payload에서 제외한다.

함수는 sanitized request, original suite, 정렬·중복 제거한 `selectedCaseIds`, redaction 정책, result 상한, provider timeout을 deep clone·deep freeze해 module-private `WeakMap<RepairRequestBinding, RepairRequestContext>`에 보존한다. visible preview fingerprint는 binding·fingerprint를 제외한 canonical JSON SHA-256이다. `dispatchRepair`는 compile과 같은 approval fingerprint 검사를 수행하고 mutable `preview.request`가 아니라 binding의 request snapshot만 provider에 전달한다. stdout은 binding의 `maxResultBytes`로 streaming 제한하며 초과하면 process/stream을 중단하고 parse·validate·sanitize 전에 내용 없는 `outputLimitExceeded`를 반환한다. 이 request binding이 provider result의 유일한 원본 suite·선택 집합·timeout 문맥이다.

### 14.3 Provider 결과

```ts
export type RepairDecision =
  | {
      caseId: string;
      decision: "replace";
      replacement: TestCaseSpec;
      explanation: string;
      needsReview: boolean;
    }
  | {
      caseId: string;
      decision: "serverIssue";
      explanation: string;
    }
  | {
      caseId: string;
      decision: "needsReview";
      explanation: string;
    };

export interface RepairResult {
  repairs: RepairDecision[];
}

export interface RepairValidationContext {
  originalSuite: TestSuiteSpec;
  selectedCaseIds: readonly string[];
}

export type RepairValidationIssueCode =
  | "INVALID_REPAIR_RESULT"
  | "DUPLICATE_REPAIR_CASE_ID"
  | "UNKNOWN_REPAIR_CASE_ID"
  | "UNSELECTED_REPAIR_CASE_ID"
  | "REPLACEMENT_CASE_ID_MISMATCH"
  | "REPLACEMENT_OPERATION_MISMATCH"
  | "INVALID_REPLACEMENT";

export interface RepairValidationIssue extends PublicProviderValidationIssue {
  code: RepairValidationIssueCode;
  path: string;
}

export type PublicProviderValidationIssueCode =
  | RepairValidationIssueCode
  | "INVALID_PROVIDER_RESULT"
  | "INVALID_PROVIDER_ENVELOPE"
  | "INVALID_SUITE"
  | "INVALID_GENERATION_METADATA"
  | "VALIDATION_ISSUES_TRUNCATED";

export interface PublicProviderValidationIssue {
  readonly code: PublicProviderValidationIssueCode;
  readonly path?: string;
  readonly message: string;
  readonly hint: string;
}

export type RepairValidationResult =
  | { valid: true; value: RepairResult }
  | { valid: false; issues: RepairValidationIssue[] };

declare const repairReviewBindingBrand: unique symbol;

export interface RepairReviewBinding {
  readonly [repairReviewBindingBrand]: true;
}

export type GenerateReviewApproval =
  | { approved: false }
  | { approved: true; fingerprint: string };

export interface SanitizedRepairResultPreview {
  result: RepairResult;
  byteLength: number;
  redactionsApplied: true;
  redactedPaths: string[];
  applicable: boolean;
  requiresApproval: true;
  fingerprint: string;
  binding: RepairReviewBinding;
}

export function validateRepairResult(
  input: unknown,
  context: RepairValidationContext,
): RepairValidationResult;

export function sanitizeRepairResult(options: {
  result: RepairResult;
  requestBinding: RepairRequestBinding;
}): SanitizedRepairResultPreview;

export type RepairDispatchResult =
  | { status: "notApproved" }
  | { status: "approvalInvalidated" }
  | { status: "providerFailed"; failure: ProviderFailure }
  | {
      status: "outputLimitExceeded";
      error: {
        name: "RepairPayloadLimitError";
        scope: "providerOutput";
        limitBytes: number;
        actualBytes: number;
      };
    }
  | {
      status: "resultLimitExceeded";
      error: {
        name: "RepairPayloadLimitError";
        scope: "result";
        limitBytes: number;
        actualBytes: number;
      };
    }
  | { status: "invalid"; issues: PublicProviderValidationIssue[] }
  | { status: "preview"; preview: SanitizedRepairResultPreview };

export function dispatchRepair(options: {
  repairer: FailedCaseRepairer;
  preview: RepairRequestPreview;
  approval: GenerateReviewApproval;
  signal?: AbortSignal;
}): Promise<RepairDispatchResult>;

export function applyReviewedRepairs(options: {
  preview: SanitizedRepairResultPreview;
  approval: GenerateReviewApproval;
}): RepairApplicationResult;

export type RepairApplicationResult =
  | { applied: true; suite: TestSuiteSpec }
  | {
      applied: false;
      reason:
        | "notApproved"
        | "approvalInvalidated"
        | "resultLimitExceeded"
        | "invalid"
        | "redactionRequired";
      issues?: PublicProviderValidationIssue[];
      preview?: SanitizedRepairResultPreview;
      error?: {
        name: "RepairPayloadLimitError";
        scope: "result";
        limitBytes: number;
        actualBytes: number;
      };
    };
```

`PublicProviderValidationIssue`는 provider 결과를 그대로 설명하는 객체가 아니라 validator가 로컬에서 생성하는 안전한 진단이다. compile·repair validator는 raw input의 key, value, 문자열 표현, provider message 또는 metadata를 `code`, `path`, `message`, `hint` 어디에도 보간하지 않는다. `code`는 닫힌 allowlist, `message`와 `hint`는 code별 고정 dictionary에서만 가져온다. `path`는 validator가 순회한 알려진 schema field와 numeric array index로만 구성하며 unknown property는 그 이름을 쓰지 않고 가장 가까운 알려진 parent path를 가리킨다. 알 수 없는 내부 code도 raw 내용을 전달하지 않고 고정 `INVALID_PROVIDER_RESULT` 진단으로 축약한다.

dispatch/apply 경계는 최대 100개, 최종 직렬화 배열 기준 `65_536` UTF-8 bytes까지만 이 안전한 issue를 반환한다. 더 많은 finding이 있으면 고정 `VALIDATION_ISSUES_TRUNCATED` 한 건이 마지막 원소로 들어갈 count와 byte budget을 먼저 예약한다. 다음 normal issue와 sentinel을 함께 넣었을 때 어느 상한이든 넘으면 normal issue 수집을 멈추고, 필요하면 이미 넣은 마지막 normal issue부터 제거해 sentinel을 포함한 최종 배열 자체가 반드시 `length <= 100` 및 `byteLength <= 65_536`을 만족하게 한다. sentinel 단독 크기는 상수로 검증한다. actual provider content와 생략된 수는 포함하지 않는다. `RepairDispatchResult.invalid`, `CompileDispatchResult.invalid`, 두 application result의 `issues`는 이 public 타입만 사용한다. raw sentinel을 unknown key·value·message 위치에 넣은 invalid fixture는 반환된 전체 issue 배열의 모든 필드를 재귀 직렬화해 sentinel이 없음을 확인한다. 101개 이상의 finding과 byte 상한 직전 fixture는 sentinel을 포함한 최종 배열도 두 상한을 넘지 않는지 검증한다.

실패가 테스트 오류라는 보장은 없다. provider는 기대값을 실제값에 맞춰 통과시키는 방향으로 무조건 수정하지 않고 테스트 오류, 서버 오류, 판단 불가를 구분한다.

`replace` 결과는 다음 제약을 만족해야 한다.

- 요청한 실패 케이스마다 최대 하나의 결과
- passing 또는 선택하지 않은 케이스 수정 금지
- 교체 후에도 기존 `caseId` 유지
- 원래 case의 `operation.type` 유지
- replacement를 원래 suite 문맥에 끼워 넣은 뒤 `validateMcpSuite`와 같은 규칙으로 재검증
- 자동 파일 반영 금지
- 변경 전후 diff와 explanation을 표시한 뒤 사용자 승인

승인된 교체안은 해당 케이스만 바꾸며, CLI 또는 Dashboard가 교체된 케이스로 작은 임시 suite를 만들어 선택 재실행할 수 있다. 첫 Runner API에 별도 `caseIds` 필터를 추가하지 않는다.

`validateRepairResult`, `sanitizeRepairResult`, `applyReviewedRepairs`의 구현과 소유권은 미래 `@mcpeak/generate`에 있다. provider JSON은 먼저 구조·문맥 검증을 통과하고, 그 다음 모든 `replacement.operation.input`에 기본 민감 키와 caller 지정 민감 키·문자열 값 redaction을 재귀 적용해야 한다. explanation을 포함한 나머지 문자열에도 caller의 exact `sensitiveValues`와 compile prompt의 민감 assignment 규칙을 적용한다. CLI/Dashboard는 raw `RepairResult`를 받지 않고 `SanitizedRepairResultPreview`만 받는다. 알 수 없는 PII는 자동 판별했다고 주장하지 않으며 preview와 명시적 사용자 승인이 마지막 경계다. validator는 닫힌 객체와 필수 필드, 비어 있지 않은 explanation, boolean `needsReview`를 검사하고 다음 순서로 문맥 규칙을 적용한다.

`sanitizeRepairResult`는 request binding에서 원본 validation context, redaction, result 상한을 읽고 모든 redaction 위치를 `redactedPaths`에 기록한다. replacement 내부에 redaction이 하나라도 있으면 `applicable: false`다. UI는 해당 후보를 적용할 수 없고, 사용자가 replacement 값을 직접 채우고 검토한 새 결과를 같은 request binding으로 다시 validate→sanitize해야 한다. raw provider 결과를 숨겨서 적용하거나 `[REDACTED]` placeholder를 suite에 기록하는 경로는 없다. explanation만 redacted된 경우에는 suite에 적용되는 replacement가 변하지 않으므로 `applicable` 판정에 영향을 주지 않는다. raw validated result와 sanitized result를 각각 측정해 어느 쪽이든 binding의 상한을 넘으면 내용 없는 `RepairPayloadLimitError(scope: "result")`를 동기로 던지고 preview·UI·저장 경계로 결과를 보내지 않는다. `dispatchRepair`는 이를 `status: "resultLimitExceeded"`로, `applyReviewedRepairs`의 재검증 경로는 `reason: "resultLimitExceeded"`로 변환한다. `byteLength`는 통과한 sanitized result의 실제 UTF-8 byte 수다.

`SanitizedRepairResultPreview`는 UI가 편집할 수 있는 untrusted 값이다. `sanitizeRepairResult`는 request binding에 이미 고정된 original suite, `selectedCaseIds`, redaction 정책, result 상한을 새 module-private `WeakMap<RepairReviewBinding, RepairReviewContext>`에 연결하고 opaque review binding을 preview에 넣는다. public fingerprint는 `binding`과 `fingerprint` 필드를 제외한 visible preview의 canonical JSON SHA-256이다. 원래 선택 집합은 provider 결과 처리나 approval API의 caller 입력으로 다시 받지 않는다.

`applyReviewedRepairs`는 `approval.approved === false`이면 preview나 binding을 읽지 않고 `{ applied: false, reason: "notApproved" }`를 반환한다. 승인된 경우에는 binding이 등록되어 있는지, 현재 visible preview fingerprint와 `approval.fingerprint`가 원래 fingerprint와 모두 같은지 먼저 검사한다. preview가 승인 뒤 바뀌거나 binding이 복제·위조되면 provider나 suite 내용을 적용하지 않고 `approvalInvalidated`를 반환해 같은 request binding에서 만든 새 validate→sanitize preview와 새 승인을 요구한다. 일치해도 preview의 `applicable`, `redactedPaths`, `result`는 신뢰하지 않는다. `preview.result`를 review binding에 연결된 원본 suite와 원래 `selectedCaseIds`로 `validateRepairResult`에 재통과시키고, 같은 request binding의 redaction·byte 정책으로 다시 sanitize한다. 이 재-sanitize가 `RepairPayloadLimitError(scope: "result")`를 던지면 예외를 밖으로 보내지 않고 구조화된 `resultLimitExceeded`를 반환하며 suite를 만들지 않는다. 새 결과가 invalid면 `invalid`, replacement redaction이 남으면 새 safe preview와 `redactionRequired`를 반환한다. 새로 계산한 candidate만 binding의 원본 suite deep clone에 적용하고 최종 suite를 `validateMcpSuite`로 다시 검사한 뒤 `{ applied: true, suite }`를 반환한다.

1. `repairs` 배열 순서대로 shape issue를 기록한다.
2. 같은 `caseId`의 두 번째 decision을 `DUPLICATE_REPAIR_CASE_ID`로 거절한다.
3. `originalSuite`에 없는 ID를 `UNKNOWN_REPAIR_CASE_ID`로 거절한다.
4. 원본에는 있지만 `selectedCaseIds`에 없는 ID를 `UNSELECTED_REPAIR_CASE_ID`로 거절한다.
5. `replace`의 replacement ID와 operation type이 원본과 다르면 각각 mismatch issue를 기록한다.
6. replacement를 원본 suite의 해당 위치에 끼운 임시 suite를 Runner의 `validateMcpSuite`로 검사하고 issue가 있으면 `INVALID_REPLACEMENT`로 감싼다.

Generate 구현 계획은 최소한 다음 fixture를 고정한다.

| Fixture | Expected issue |
|---|---|
| 같은 선택 ID decision 두 개 | 두 번째 항목에 `DUPLICATE_REPAIR_CASE_ID` |
| 원본 suite에 없는 ID | `UNKNOWN_REPAIR_CASE_ID` |
| 원본에는 있지만 선택하지 않은 ID | `UNSELECTED_REPAIR_CASE_ID` |
| replacement의 ID 변경 | `REPLACEMENT_CASE_ID_MISMATCH` |
| callTool case를 listTools로 변경 | `REPLACEMENT_OPERATION_MISMATCH` |
| 빈 assertions 또는 알 수 없는 필드가 있는 replacement | `INVALID_REPLACEMENT` |
| invalid repair envelope의 unknown key/value에 `raw-invalid-secret` | 모든 public issue field와 직렬화 결과에 sentinel 없음; 고정 code/path/message/hint만 반환 |
| replacement의 `Authorization`과 caller PII sentinel | preview에서 `[REDACTED]`, `applicable: false`, 승인해도 apply 거절, 직렬화 결과에 원문 없음 |
| preview의 `applicable`, `redactedPaths`, `result` 또는 fingerprint를 승인 뒤 변조 | `approvalInvalidated`, 적용 0건, 새 preview와 재승인 필요 |
| 원래 `selectedCaseIds = ["a"]`인 binding에 caller가 `b`를 추가하려 함 | approval API가 selection을 받지 않으며 stored context로 `UNSELECTED_REPAIR_CASE_ID`, 적용 0건 |
| repair request의 cases/tools/fingerprint 또는 binding을 provider 승인 뒤 변조 | `approvalInvalidated`, provider 호출 0회 |
| `inputSchema`가 각각 `"schema"`, `true`, `null`, `0`, dense array, null-prototype object | compile·repair prepare가 모두 허용하고 immutable sanitized preview 생성 |
| runtime에서 `inputSchema`가 `new Date()`, `undefined`, `NaN`, `Infinity`, sparse array, 함수, bigint, symbol 또는 cycle | 각 값에 동기 `GenerateRequestValidationError`, code `INVALID_TOOL_INPUT_SCHEMA`, 고정 numeric path; preview·binding·provider 호출 0회, raw schema 노출 없음 |
| provider repair stdout가 chunk 수신 중 `262_145` UTF-8 bytes에 도달 | process/stream 중단, parse·sanitize 0회, `outputLimitExceeded` |
| raw 또는 sanitized repair result `262_145` UTF-8 bytes | dispatch는 `resultLimitExceeded`와 preview 0개; 승인 뒤 apply 재검증도 같은 reason과 suite 0개; reject 없음 |
| 사용자가 redacted replacement 값을 다시 입력 | validate→sanitize 재실행 후 redacted replacement path가 0일 때만 승인·적용 |

검증 실패 시 provider 결과를 일부 적용하거나 사용자 diff 화면으로 넘기지 않는다. sanitized `RepairRequest`만 provider에 전달하며 `RepairResult` validator는 비밀값이 다시 삽입된 replacement도 같은 redaction/preview 단계를 거친 뒤에만 승인 후보로 만든다.

### 14.4 Generate provider 구조 가이드

자연어 compile과 실패 repair는 입력·출력 계약이 다르므로 공개 인터페이스를 분리한다. Codex와 Claude adapter는 두 인터페이스를 모두 구현할 수 있다.

```ts
export interface ProviderStatus {
  available: boolean;
  message?: string;
}

export type ProviderFailureCode =
  | "rejected"
  | "nonZeroExit"
  | "timedOut"
  | "cancelled"
  | "invalidUtf8"
  | "invalidJson"
  | "internal";

export interface ProviderFailure {
  readonly code: ProviderFailureCode;
  readonly providerId: "codex" | "claude";
  readonly message: string;
  readonly hint: string;
  readonly exitCode?: number;
  readonly timeoutMs?: number;
  readonly stderr: {
    readonly captured: boolean;
    readonly truncated: boolean;
  };
}

export class ProviderInvocationError extends Error {
  override readonly name = "ProviderInvocationError";
  readonly code: "nonZeroExit" | "invalidUtf8" | "invalidJson";
  readonly providerId: "codex" | "claude";
  readonly exitCode?: number;
  readonly stderr: {
    readonly captured: boolean;
    readonly truncated: boolean;
  };

  constructor(options: {
    code: "nonZeroExit" | "invalidUtf8" | "invalidJson";
    providerId: "codex" | "claude";
    exitCode?: number;
    stderr: { captured: boolean; truncated: boolean };
  });
}

export interface ProviderInvocationOptions {
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface CompileRequest {
  readonly prompt: string;
  readonly tools: readonly McpToolContext[];
}

export interface CompileRequestPreview {
  request: CompileRequest;
  byteLength: number;
  maxResultBytes: number;
  providerTimeoutMs: number;
  redactionsApplied: true;
  requiresApproval: true;
  fingerprint: string;
  binding: CompileRequestBinding;
}

declare const compileRequestBindingBrand: unique symbol;

export interface CompileRequestBinding {
  readonly [compileRequestBindingBrand]: true;
}

export class CompilePayloadLimitError extends Error {
  override readonly name = "CompilePayloadLimitError";
  readonly scope: "prompt" | "tools" | "request" | "providerOutput" | "result";
  readonly limitBytes: number;
  readonly actualBytes: number;
}

export type CompileResult =
  | {
      ok: true;
      suite: TestSuiteSpec;
      needsReview: boolean;
      warnings: GenerateIssue[];
      metadata: GenerationMetadata;
    }
  | {
      ok: false;
      issues: GenerateIssue[];
    };

export interface GenerateIssue {
  code: string;
  path?: string;
  message: string;
  hint: string;
}

export interface GenerationMetadata {
  source: "schema" | "naturalLanguage";
  policyVersion: string;
  timeoutDecisions: TimeoutDecision[];
}

export interface TimeoutDecision {
  caseId: string;
  timeoutMs: number;
  source: "user" | "localDefault" | "externalApiDefault";
  inferred: boolean;
}

export interface NaturalLanguageCompiler {
  readonly id: "codex" | "claude";
  checkAvailability(): Promise<ProviderStatus>;
  compile(
    request: CompileRequest,
    options: ProviderInvocationOptions,
  ): Promise<unknown>;
}

export interface FailedCaseRepairer {
  readonly id: "codex" | "claude";
  checkAvailability(): Promise<ProviderStatus>;
  repair(
    request: RepairRequest,
    options: ProviderInvocationOptions,
  ): Promise<unknown>;
}

export function prepareCompileRequest(options: {
  prompt: string;
  tools: readonly McpToolContext[];
  redaction?: RunnerRedactionOptions;
  maxResultBytes?: number;
  providerTimeoutMs?: number;
}): CompileRequestPreview;

export type CompileValidationResult =
  | { valid: true; value: CompileResult }
  | { valid: false; issues: PublicProviderValidationIssue[] };

export function validateCompileResult(input: unknown): CompileValidationResult;

export interface SanitizedCompileResultPreview {
  result: CompileResult;
  byteLength: number;
  redactedPaths: string[];
  executable: boolean;
  requiresApproval: true;
  fingerprint: string;
  binding: CompileResultReviewBinding;
}

declare const compileResultReviewBindingBrand: unique symbol;

export interface CompileResultReviewBinding {
  readonly [compileResultReviewBindingBrand]: true;
}

export function sanitizeCompileResult(options: {
  result: CompileResult;
  requestBinding: CompileRequestBinding;
}): SanitizedCompileResultPreview;

export type CompileDispatchResult =
  | { status: "notApproved" }
  | { status: "approvalInvalidated" }
  | { status: "providerFailed"; failure: ProviderFailure }
  | {
      status: "outputLimitExceeded";
      error: {
        name: "CompilePayloadLimitError";
        scope: "providerOutput";
        limitBytes: number;
        actualBytes: number;
      };
    }
  | {
      status: "resultLimitExceeded";
      error: {
        name: "CompilePayloadLimitError";
        scope: "result";
        limitBytes: number;
        actualBytes: number;
      };
    }
  | { status: "invalid"; issues: PublicProviderValidationIssue[] }
  | { status: "preview"; preview: SanitizedCompileResultPreview };

export function dispatchCompile(options: {
  compiler: NaturalLanguageCompiler;
  preview: CompileRequestPreview;
  approval: GenerateReviewApproval;
  signal?: AbortSignal;
}): Promise<CompileDispatchResult>;

declare const compileExecutionSnapshotBrand: unique symbol;

export interface CompileExecutionSnapshot {
  readonly [compileExecutionSnapshotBrand]: true;
  readonly fingerprint: string;
}

export function getCompileExecutionSuite(
  snapshot: CompileExecutionSnapshot,
): TestSuiteSpec;

export type CompileApplicationResult =
  | { accepted: true; snapshot: CompileExecutionSnapshot }
  | {
      accepted: false;
      reason:
        | "notApproved"
        | "approvalInvalidated"
        | "resultLimitExceeded"
        | "invalid"
        | "redactionRequired"
        | "noSuite";
      issues?: PublicProviderValidationIssue[];
      preview?: SanitizedCompileResultPreview;
      error?: {
        name: "CompilePayloadLimitError";
        scope: "result";
        limitBytes: number;
        actualBytes: number;
      };
    };

export function applyReviewedCompileResult(options: {
  preview: SanitizedCompileResultPreview;
  approval: GenerateReviewApproval;
}): CompileApplicationResult;
```

모든 Generate fingerprint는 같은 canonical serializer를 사용한다. array 순서는 유지하고 object key는 JavaScript UTF-16 code unit 순서로 정렬하며, JSON-safe visible field만 직렬화한다. opaque `binding`과 자기 자신인 `fingerprint` 필드는 제외하고 Node 내장 SHA-256의 lowercase hex를 사용한다. fingerprint만으로 binding을 인증하지 않으며, 반드시 module-private registry의 binding identity와 함께 확인한다. CLI와 Dashboard backend가 승인 시 표시·저장한 fingerprint가 provider dispatch와 execution snapshot 생성에 그대로 전달된다.

`prepareCompileRequest`는 provider 전송 전에 반드시 호출한다. `tools[].inputSchema`에는 repair와 같은 runtime `ReadonlyJsonValue` 검증을 redaction보다 먼저 적용하며 첫 위반에 같은 동기 `GenerateRequestValidationError`를 던진다. 이때 preview·binding·provider 호출은 없다. 통과한 schema에만 같은 재귀 key/value redaction을 적용한다. 자연어 prompt에는 caller의 exact `sensitiveValues`와 `authorization: ...`, `api_key=...`처럼 정규화된 기본 민감 키가 `:` 또는 `=` 앞에 있는 assignment의 값을 `[REDACTED]`로 바꾼다. UTF-8 상한은 prompt `65_536` bytes, tools `131_072` bytes, 전체 request `262_144` bytes이며 어느 하나라도 넘으면 preview를 만들지 않는다. `maxResultBytes` 기본값은 `262_144`, 허용값은 `1..262_144`의 유한 정수이고 caller는 기본값보다 낮출 수만 있다. `providerTimeoutMs` 기본값은 `120_000`, 허용값은 `1..600_000`의 유한 정수다. 잘못된 옵션은 preview나 provider 실행 전에 동기 `RangeError`다.

`prepareCompileRequest`는 sanitized request, redaction 정책, `maxResultBytes`, `providerTimeoutMs`를 deep clone·deep freeze해 module-private `WeakMap<CompileRequestBinding, CompileRequestContext>`에 저장한다. visible preview의 `binding`과 `fingerprint`를 제외한 canonical JSON SHA-256을 fingerprint로 함께 반환한다. CLI/Dashboard는 이 visible preview의 byte length, redacted payload, result 상한, provider timeout과 fingerprint를 한 화면에서 보여주고 `{ approved: true, fingerprint }`로 매 요청을 승인한다. `dispatchCompile`은 미승인이면 preview를 읽지 않는다. 승인된 경우 등록된 binding, 현재 visible preview fingerprint, approval fingerprint가 모두 일치하는지 provider 호출 전에 확인한다. 하나라도 다르면 `approvalInvalidated`이며 재검토·재승인이 필요하다. 일치하면 mutable `preview.request`가 아니라 binding 안의 deep-frozen request snapshot만 provider에 전달한다. 따라서 승인 전후 prompt/tools/timeout 변경이나 다른 binding 치환으로 redaction과 상한을 우회할 수 없다.

`dispatchCompile`과 `dispatchRepair`는 예상 가능한 provider 생명주기 실패로 reject하지 않는 API다. 둘은 승인된 binding의 timeout으로 내부 `AbortController`를 만들고 caller `signal`을 연결한 뒤 monotonic deadline과 provider Promise를 race한다. caller signal이 호출 전에 이미 aborted면 provider를 호출하지 않고 `providerFailed(cancelled)`를 반환한다. 실행 중 abort면 내부 signal을 abort하고 `cancelled`, deadline이면 내부 signal을 abort하고 `timedOut`을 반환한다. abort와 deadline이 같은 관찰 시각이면 caller signal의 `aborted`를 먼저 검사해 `cancelled`를 우선한다. timer와 listener는 한 settle 경로에서 정확히 한 번 해제한다.

adapter는 전달받은 `signal`의 abort를 받으면 child/stream에 graceful termination을 요청하고 최대 `2_000ms` 뒤 force kill하며, dispatch는 이 cleanup이나 원래 provider Promise가 settle할 때까지 기다리지 않는다. provider Promise에는 생성 즉시 fulfill/reject 양쪽 handler를 붙여 timeout·취소 뒤 늦은 resolve/reject와 `undefined` reject도 항상 관찰한다. 따라서 permanently pending provider에서도 dispatch는 승인된 timeout에 끝나며, 늦은 reject는 unhandled rejection이 되지 않는다.

adapter가 관찰한 non-zero exit, invalid UTF-8, invalid JSON은 각각 `nonZeroExit`, `invalidUtf8`, `invalidJson`의 `ProviderInvocationError`로 reject한다. stdout streaming 상한은 해당 payload limit error로 reject한다. dispatch는 이 알려진 오류를 `providerFailed` 또는 `outputLimitExceeded`로 변환하고, 그 밖의 reject 값은 내용이나 타입과 무관하게 `providerFailed(rejected)`로 변환한다. dispatch 내부의 예상하지 못한 동기 오류도 raw 값을 버리고 `providerFailed(internal)`로 변환한다. `ProviderFailure.message`와 `hint`는 `(providerId, code)`별 로컬 고정 dictionary만 사용한다. public stderr에는 원문이나 sanitized 일부를 싣지 않고 `captured`와 `truncated` boolean만, non-zero exit에는 안전하게 파싱된 정수 `exitCode`만, timeout에는 승인된 `timeoutMs`만 넣는다. 이 규칙 때문에 provider exception, stdout, stderr의 비밀값은 CLI/Dashboard failure에 포함되지 않는다.

`NaturalLanguageCompiler.compile`의 반환값은 외부 JSON이므로 `unknown`이다. 다만 adapter는 JSON 전체를 메모리에 받은 뒤 이 Promise를 resolve하면 안 된다. 공통 provider reader가 child stdout의 각 `Buffer` chunk를 UTF-8 decode·문자열 결합 전에 `byteLength`로 누적하고 binding의 `maxResultBytes`를 넘는 첫 chunk에서 child process 또는 response stream을 중단한다. provider envelope를 포함한 stdout 전체가 상한 대상이다. 초과 뒤 남은 chunk는 버리고 JSON parse, envelope 제거, `validateCompileResult`, sanitization을 전혀 호출하지 않는다. `dispatchCompile`은 provider 출력 내용을 포함하지 않는 `{ status: "outputLimitExceeded", error: { name: "CompilePayloadLimitError", scope: "providerOutput", limitBytes, actualBytes } }`를 반환한다. `actualBytes`는 초과를 관찰한 누적 byte 수이며, stdout 일부나 stderr 원문을 CLI/Dashboard에 전달하지 않는다. repair adapter도 같은 streaming reader를 사용하고 `RepairPayloadLimitError(scope: "providerOutput")`로 실패한다. stderr는 별도 `65_536` byte 상한으로 수집·sanitization하고 초과분은 버려 메모리를 무제한 사용하지 않는다.

reader는 호출마다 `new TextDecoder("utf-8", { fatal: true })` 하나를 만들고, 상한 안의 각 chunk에 `decoder.decode(chunk, { stream: true })`를 호출해 분할된 멀티바이트 sequence 상태를 다음 chunk까지 보존한다. stdout 종료 시 반드시 인자 없는 `decoder.decode()`로 final flush한 뒤에만 문자열 결합 결과를 provider envelope 제거와 `JSON.parse`에 전달한다. chunk decode나 final flush가 한 번이라도 throw하면 child/stream을 중단하고 raw byte나 대체 문자를 만들지 않은 `ProviderInvocationError(code: "invalidUtf8")`로 끝낸다. dispatch는 이를 `providerFailed(invalidUtf8)`로 변환하며 JSON parse, envelope 제거, validation, sanitization 호출 횟수는 모두 0이다. 유효한 UTF-8과 수신 상한을 통과한 뒤에만 adapter가 envelope 제거와 JSON parse를 수행한다. 그 `unknown`을 공통 Generate 경계의 `validateCompileResult`가 닫힌 envelope, issue와 metadata shape로 검증하고, 성공 결과의 `suite`를 Runner `validateMcpSuite`로 검증·정규화한 뒤에만 `CompileResult`를 반환한다. adapter는 유효한 결과에 provider 전용 envelope를 남기지 않는다. invalid suite나 유효하지 않은 metadata는 일부 수용하지 않고 전체 실패로 반환한다.

`sanitizeCompileResult`는 수신 상한을 통과한 valid provider 결과와 승인된 request binding을 함께 받는다. binding에 고정된 기본 민감 key, caller key/value, 민감 assignment 규칙을 suite의 `name`, case name, operation tool/input, assertion 값, warnings/issues/metadata 문자열에 모두 적용한다. raw validated result와 sanitized result를 다시 측정해 어느 쪽이든 binding의 `maxResultBytes`를 넘으면 내용을 오류에 포함하지 않고 `CompilePayloadLimitError(scope: "result")`를 던진다. redaction 위치를 `redactedPaths`에 기록하며 suite 안에 redaction이 하나라도 있으면 `executable: false`다. provider 결과의 secret을 UI에 보여주거나 `[REDACTED]`가 든 suite를 실행하지 않는다. 함수는 request binding과 output redaction·상한 정책을 `CompileResultReviewBinding`에 연결하고, binding·fingerprint를 제외한 visible preview의 canonical JSON SHA-256 fingerprint를 만든다.

CLI/Dashboard는 provider를 직접 호출하지 않고 `dispatchCompile`만 호출한다. approval이 false이면 `{ status: "notApproved" }`를 반환하고 preview getter나 `compiler.compile`을 건드리지 않는다. 승인 binding과 fingerprint가 유효하면 binding의 sanitized request, `maxResultBytes`, `providerTimeoutMs`, 내부 signal을 provider에 보내고, bounded reader가 반환한 `unknown`을 즉시 `validateCompileResult`에 전달한다. invalid 결과는 raw key/value/message를 보간하지 않는 bounded `PublicProviderValidationIssue`만 반환한다. valid 결과는 같은 request binding으로 즉시 `sanitizeCompileResult`를 수행한다. 이 함수의 `CompilePayloadLimitError(scope: "result")`는 dispatch가 catch해 `status: "resultLimitExceeded"`로 반환하고 preview를 만들지 않는다. 그 밖의 valid 결과만 `{ status: "preview", preview }`로 반환하므로 raw provider output은 CLI/Dashboard 경계를 넘지 않는다.

실행 전에는 result preview에 대한 별도 사용자 승인이 필요하다. `applyReviewedCompileResult`는 approval이 false면 preview를 읽지 않고 `notApproved`를 반환한다. 승인 true에서는 등록된 result binding, approval fingerprint, 현재 visible preview fingerprint를 먼저 비교한다. 사용자가 승인한 뒤 preview의 `result`, `executable`, `redactedPaths`, byte length 또는 fingerprint가 바뀌면 `approvalInvalidated`를 반환하고 새 validate→sanitize preview와 재승인을 요구한다. 일치해도 mutable 필드를 신뢰하지 않고 `validateCompileResult(preview.result)`와 binding의 정책을 사용한 `sanitizeCompileResult`를 재실행한다. 이 재-sanitize의 `CompilePayloadLimitError(scope: "result")`는 밖으로 던지지 않고 `reason: "resultLimitExceeded"`와 안전한 크기 metadata만 반환하며 snapshot을 만들지 않는다. invalid, redaction 잔존, `ok: false`는 각각 실행을 거절한다.

통과한 `ok: true` suite는 승인에 사용한 fingerprint와 함께 deep clone·deep freeze해 module-private `WeakMap<CompileExecutionSnapshot, TestSuiteSpec>`에 저장하고 opaque snapshot handle만 반환한다. 승인 결과와 Runner 호출 사이에 mutable preview를 다시 읽지 않으며 CLI/Dashboard는 `runSuite({ client, suite: getCompileExecutionSuite(snapshot) })`를 호출한다. getter는 등록되지 않았거나 변조된 handle을 거절하고 저장된 동일 suite 객체만 반환한다. Runner도 호출 시 자체 operational clone을 동기 생성하므로 승인된 snapshot 이후의 원본 변경은 실행에 영향을 주지 않는다. 즉 사용자 승인이 가리킨 fingerprint와 Runner가 받은 suite는 하나의 불변 snapshot binding에 속한다.

미래 Generate 테스트는 아래 fixture를 고정한다.

| Fixture | Expected |
|---|---|
| prompt `Authorization: Bearer compile-secret` | preview가 `Authorization: [REDACTED]`, 직렬화 문자열에 `compile-secret` 없음 |
| tool `inputSchema.properties.api_key.default = "tool-secret"` | default 값 `[REDACTED]` |
| caller PII sentinel `person@example.com`이 prompt와 tool schema에 존재 | 두 위치 모두 `[REDACTED]` |
| JSON primitive·dense array·plain/null-prototype object `inputSchema` | 모두 허용; 비순환 shared object도 정상 preview |
| runtime에서 비 JSON·비 plain·비유한·sparse·cyclic `inputSchema`로 타입을 우회 | 동기 `GenerateRequestValidationError`; preview·binding·provider 호출 0회, fixed code/path/message/hint에 raw schema 없음 |
| prompt `65_537`, tools `131_073`, request `262_145` UTF-8 bytes | 각각 `CompilePayloadLimitError`의 `prompt`, `tools`, `request` scope |
| `dispatchCompile({ approval: { approved: false } })` | `{ status: "notApproved" }`, preview getter와 provider `compile` 호출 0회 |
| request preview의 prompt/tools/fingerprint 또는 binding을 승인 뒤 변조 | `approvalInvalidated`, provider 호출 0회 |
| provider stdout가 chunk 수신 중 `262_145` UTF-8 bytes에 도달 | child/stream 중단, parse·sanitize 0회, `outputLimitExceeded`이고 내용 노출 없음 |
| provider 성공 envelope의 suite에 `cases`가 없고 unknown key/value에 `raw-invalid-secret` | `validateCompileResult` invalid, CLI/Dashboard에 suite 없음, 모든 public issue field에 sentinel 없음 |
| provider suite name과 `operation.input.Authorization`에 `provider-secret` | serialized result preview에 secret 없음, 두 path 기록, `executable: false` |
| result preview를 승인 뒤 `executable: true` 또는 secret suite로 변조 | `approvalInvalidated`, snapshot 없음, 재승인 필요 |
| 승인된 result preview가 변경되지 않음 | validate→sanitize 재실행 후 opaque `CompileExecutionSnapshot`; getter와 Runner는 binding에 저장된 같은 frozen suite 사용 |
| raw 또는 sanitized result `262_145` UTF-8 bytes | dispatch는 `resultLimitExceeded`와 preview 0개; 승인 뒤 재검증 apply는 같은 reason과 snapshot 0개; 어느 경로도 reject하지 않음 |

compile과 repair에 같은 provider lifecycle fixture를 각각 적용한다.

| Fixture | Expected |
|---|---|
| `providerTimeoutMs`가 `0`, 소수, `600_001`, `NaN`, `Infinity` | prepare가 provider·preview 전에 동기 `RangeError`; `1`과 `600_000`은 허용 |
| provider가 `undefined` 또는 secret이 든 `Error`로 reject | dispatch가 reject하지 않고 `providerFailed(rejected)`; public 직렬화 결과에 reject 값·secret 없음 |
| exit `17`, stderr `Authorization: process-secret`, stderr 상한 초과 | `providerFailed(nonZeroExit)`, `exitCode === 17`, `stderr === { captured: true, truncated: true }`; 원문·secret 없음 |
| 유효한 `"서울"` UTF-8 bytes를 멀티바이트 중간에서 두 chunk로 분할 | stateful decoder가 원문을 복원하고 정상 JSON 처리 |
| malformed sequence `[0xe2]` 다음 `[0x28, 0xa1]` 또는 incomplete final `[0xe2, 0x82]` | chunk decode/final flush에서 `providerFailed(invalidUtf8)`; parse·envelope·validate·sanitize 0회, raw byte/text 없음 |
| 유효 UTF-8이지만 invalid JSON | 고정 `providerFailed(invalidJson)`; raw text 없음 |
| timeout `120_000ms`, provider가 permanently pending | `119_999ms`에는 미완료, `120_000ms`에 `providerFailed(timedOut)`과 `timeoutMs === 120_000`; internal signal abort·termination 요청, dispatch pending 없음 |
| caller signal이 호출 전 aborted | provider 호출 0회, `providerFailed(cancelled)` |
| 실행 중 caller abort | internal signal abort·termination 요청, `providerFailed(cancelled)` |
| caller abort와 timeout이 같은 monotonic 시각에 관찰 | `cancelled`가 이기며 timer/listener 정리 1회 |
| timeout·취소가 반환된 뒤 provider가 늦게 reject | 결과 불변, `unhandledRejection` 0건 |
| raw 또는 sanitized result가 result 상한보다 1 byte 큼 | dispatch의 `resultLimitExceeded`, preview 0개; approved apply 재검증도 같은 reason, suite/snapshot 0개, reject 0건 |

공통 provider 실행 계층은 다음만 담당한다.

- 입력은 셸 인자가 아니라 stdin으로 전달
- 일회성 비대화형 세션 사용
- 파일 수정 및 불필요한 도구 사용 제한
- timeout, 종료 코드, bounded·sanitized stderr 수집
- caller 취소와 승인된 timeout을 dispatch에서 race하고 adapter signal로 bounded termination 요청
- expected adapter error와 임의 reject를 raw 값 없는 `ProviderFailure`로 정규화하며 늦은 settlement handler 유지
- provider별 JSON envelope 제거
- stdout를 UTF-8 byte 상한 안에서 streaming 수신하고 초과 시 process/stream을 중단한 뒤 JSON parsing을 생략
- chunk 상태를 보존하는 fatal UTF-8 decoder를 final flush하고 decode 실패 시 후속 parsing·validation을 생략
- JSON 파싱 뒤 compile 결과는 `validateCompileResult`와 `sanitizeCompileResult`, repair 결과는 binding에 저장한 원래 문맥을 포함한 `validateRepairResult`와 `sanitizeRepairResult`로 검증
- 모호한 결과는 `needsReview`

Codex와 Claude 고유 명령이나 응답 envelope는 adapter 내부에 가둔다. Runner와 CLI에는 검증된 공통 결과만 노출한다.

## 15. Generate의 테스트 생성 가이드

generate는 세 입력 경로를 같은 `TestSuiteSpec`으로 정규화한다.

### 직접 작성

- TypeScript: `defineMcpSuite`
- JSON: `validateMcpSuite`

### 결정론적 스키마 생성

- `ToolDef.name`으로 `toolExists` 생성
- `inputSchema.default` 또는 `examples`가 있으면 유효 호출 입력 후보로 사용
- 의미 있는 입력값의 근거가 없으면 임의의 도메인 값을 사실처럼 만들지 않음
- 추론이 필요한 값은 경고와 `needsReview` 표시
- 같은 schema와 정책 버전에는 같은 case ID, 순서, 입력, timeout 생성

### 자연어 생성

- `prepareCompileRequest`가 redaction·byte 제한을 적용한 자연어와 필요한 툴 정의만 provider stdin에 전달
- `MCP_SUITE_JSON_SCHEMA`로 구조화 출력 제한
- provider 반환은 `unknown`으로 받고 `validateCompileResult` 내부에서 `validateMcpSuite` 적용
- redacted compile payload와 byte length를 보여주고 provider 전송 전 사용자 승인
- generate가 만든 suite는 실제 MCP 툴 실행 전 sanitized result 미리보기 승인과 immutable snapshot 생성

### Timeout 생성 정책

- 사용자 지정값 우선, 절대 덮어쓰지 않음
- 일반·로컬 작업은 10초 제안
- 툴 설명이나 사용자 의도에 외부 API·네트워크 호출 근거가 있으면 30초 제안
- 근거가 약하면 값을 채우되 `TIMEOUT_INFERRED` 및 `needsReview`
- 첫 정책 버전은 `timeout-v1`
- 정책 버전을 generate 결과 메타데이터에 남겨 재현 가능하게 함

결정론적 schema-only 생성은 `inputSchema`만 보고 외부 호출을 추측하지 않고 10초를 사용한다. 자연어 또는 툴 설명에 외부 API·네트워크·원격 서비스 호출이 명시된 경우 generate가 30초를 제안한다. 의미를 추론했지만 근거 문장을 특정할 수 없으면 30초를 자동 확정하지 않고 `TIMEOUT_INFERRED`와 `needsReview`를 함께 반환한다.

## 16. 기존 Runner 스텁 처리

현재 `createMcpTest`와 `toContainTool`은 구현되지 않은 공개 스텁이며 새 선언형 계약과 맞지 않는다.

- `createMcpTest` callback 모델은 공통 JSON 명세를 표현하지 못한다.
- `toContainTool`은 툴 목록이 아닌 `ToolResult`를 받아 의미가 맞지 않는다.
- 두 실행 모델을 동시에 구현하지 않는다.

이번 변경은 minor release이므로 기존 named export, 타입, 호출 시 `not implemented` 오류 동작을 deprecated compatibility shim으로 유지한다. `void` callback API를 새 `RunnerExecution`에 위임하면 반환·await 의미가 조용히 달라지므로 억지 wrapper는 만들지 않는다. README에서 새 선언형 API를 권장하고, deprecated shim 제거는 major release와 migration 문서가 승인된 뒤에만 수행한다. Vitest 지원은 나중에 독립 adapter로 설계한다.

Runner README는 같은 변경에서 갱신한다. 공동 소유인 루트 README 수정은 별도 합의가 필요한 후속 문서 작업으로 기록한다.

## 17. 테스트 설계

### 명세와 Schema

- 유효한 `listTools` 및 `callTool` 명세 통과
- 여러 검증 오류를 한 번에 반환
- 중복 ID, 빈 배열, 잘못된 조합, 알 수 없는 필드 거절
- 0, 음수, 소수, `2_147_483_647` 초과 timeout 거절
- `NaN`, `Infinity`, `-Infinity` JSON 입력 거절
- dev-only evaluator가 공개 JSON Schema의 valid/invalid fixture, local `$ref`, `oneOf`를 실제 실행
- TypeScript 타입, JSON Schema, validator parity
- 중첩 Schema 속성이 TypeScript readonly이고 런타임에도 재귀 동결됐는지 검증

### Assertions와 진단

- 존재하는 툴 통과
- 없는 툴은 `TOOL_NOT_FOUND`와 UTF-16 순서로 중복 제거·정렬된 실제 목록 반환
- Unicode, 대소문자, 중복 이름 정렬이 locale 설정과 무관한지 검증
- `isError`의 true와 false 기대값 모두 통과·실패 검증
- 실패 메시지에 원인, 실제 값, 힌트 포함
- operation 한 번의 결과에 모든 assertion을 순서대로 적용

### Executor와 이벤트

- 명세 순서대로 케이스 실행
- 케이스마다 MCP 메서드 정확히 한 번 호출
- assertion 실패와 메서드 reject 후 다음 케이스 계속 실행
- 이벤트 종류, 순서, sequence 검증
- 최종 summary 카운트 검증
- 같은 입력을 두 번 실행한 이벤트와 보고서 deep equality
- timestamp와 실제 duration이 없는지 검증
- 민감 키와 caller 지정 민감 값이 event/report에서 재귀 마스킹됐는지 검증
- case/report byte 제한 초과가 MCP 호출 또는 안전하지 않은 완료 이벤트 전에 거절되는지 검증

### Timeout과 취소

- fake timer로 case, suite, Runner fallback 우선순위 검증
- timeout 시 현재 케이스 `timedOut`, 나머지 `notRun`
- abort 전과 실행 중 abort 검증
- timeout과 abort에서 다음 MCP 작업 및 `client.close()` 미호출
- timeout·abort의 `report`가 `drain`과 독립적으로 먼저 완료되는지 검증
- pending MCP Promise가 deadline 전에 settle하면 `drain.status === "settled"`
- `5_000ms` deadline까지 pending이면 `deadlineExceeded`, pending request와 독립적인 force close 1회, 늦은 reject의 unhandled rejection 없음
- settlement 관찰 시각이 drain deadline과 같으면 callback 등록 순서와 무관하게 deadline이 이김
- permanently pending `listTools`와 `callTool`, graceful close 지연·실패, force close 지연·실패가 모두 정해진 상한 안에 finalize되는지 검증
- close와 force close의 fulfill/reject가 정확히 deadline에 관찰되는 네 경우 모두 deadline 우선이며 late settlement가 결과를 바꾸지 않음
- execution에 binding된 client와 다른 shutdown controller 또는 위조 execution을 transport 접근 전에 거절
- close rejection은 `gracefulCloseFailed` force close를 수행하고 report→drain→close→force 오류 순서를 보존
- report/drain/close 오류와 `undefined` rejection reason을 outcome flag로 보존하고 단일 오류 또는 순서가 고정된 `AggregateError`로 반환
- `report` reject와 timeout·abort 정리 경로가 겹쳐도 idempotent controller가 실제 transport 종료를 한 번만 수행

### Generate/repair 준비성

- 실패 결과에 sanitized spec과 diagnostic 포함
- 하나 또는 모든 실패 결과 선택 가능
- 보고서 `JSON.stringify` 성공
- `ToolResult.raw` 미포함
- repair payload의 재귀 마스킹, case/request/provider-output/result byte 제한, request/result fingerprint 승인 검증
- invalid compile/repair provider sentinel이 bounded public validation issue의 어떤 field에도 나타나지 않음
- repair의 원래 suite와 `selectedCaseIds`가 request binding에 고정되고 approval 단계에서 교체되지 않는지 검증
- provider 교체안의 중복·unknown·미선택 case ID와 잘못된 replacement 거절 fixture
- 검증된 replacement의 provider-inserted secret과 caller PII sentinel을 UI preview 전에 재마스킹
- redacted replacement는 적용 불가이며 사용자가 값을 다시 입력한 sanitized preview만 적용
- compile prompt/tool schema redaction, prompt/tools/request/provider-output/result byte 제한, provider 전송 전 immutable request snapshot 승인
- compile의 `unknown` 결과에서 invalid suite와 invalid metadata를 거절
- provider compile 결과를 UI 전 재마스킹·크기 제한하고 승인 fingerprint가 같은 result만 opaque immutable execution snapshot으로 고정
- compile·repair provider의 reject/non-zero exit/invalid UTF-8·JSON/timeout/cancel을 non-rejecting dispatch 상태로 정규화하고 permanently pending·late reject를 종료
- compile·repair의 raw/sanitized result limit을 dispatch/apply의 `resultLimitExceeded`로 정규화해 preview·suite·snapshot을 만들지 않음
- deprecated `createMcpTest` named export와 기존 throw 동작 유지

### 필수 테스트 이름과 핵심 단언

| 테스트 이름 | 핵심 단언 |
|---|---|
| `유효한 listTools와 callTool 명세를 검증한다` | `valid === true`, 반환 `value`가 입력과 deep equality |
| `명세의 모든 구조 오류를 경로 순서대로 반환한다` | issue code가 `MISSING_REQUIRED_FIELD`, `INVALID_TIMEOUT`, `INCOMPATIBLE_ASSERTION` 순서이고 각 `path`가 정확히 일치 |
| `중복된 케이스 ID를 거절한다` | `DUPLICATE_CASE_ID`, `path === "cases[1].id"` |
| `JSON Schema와 validator의 fixture 판정이 일치한다` | dev evaluator와 validator가 같은 valid fixture를 수용하고 invalid fixture를 거절하며 깨진 `$ref`와 0개/2개 `oneOf` match를 탐지 |
| `유한하지 않은 JSON 숫자를 거절한다` | `NaN`, `Infinity`, `-Infinity`가 각각 `INVALID_JSON_VALUE` |
| `목록에 존재하는 툴 assertion을 통과시킨다` | assertion status가 `passed`, `listTools` 호출 횟수가 1 |
| `없는 툴의 실제 목록을 locale 없이 정렬한다` | `['가', 'a', 'A', 'a']`가 JavaScript UTF-16 비교 기준 `['A', 'a', '가']`이고 `localeCompare`를 호출하지 않음 |
| `isError 기대값 true와 false를 각각 비교한다` | 일치 시 `passed`, 불일치 시 `IS_ERROR_MISMATCH`와 boolean expected·actual |
| `한 작업 결과로 모든 assertion을 평가한다` | MCP 메서드 호출 횟수가 1이고 assertion result 수와 순서가 명세와 같음 |
| `assertion 실패 후 다음 케이스를 실행한다` | 호출 기록과 report case 순서가 `a`, `b`, `c` |
| `MCP 메서드 reject 후 다음 케이스를 실행한다` | 현재 operation은 `failed`, assertion은 `skipped`, 다음 case는 실행됨 |
| `성공 이벤트를 고정 순서로 발행한다` | type 배열이 `suiteStarted`부터 `suiteCompleted`까지 승인 순서와 같고 sequence가 `0..n` |
| `이벤트 listener의 객체 변경이 보고서를 바꾸지 않는다` | listener가 `caseStarted.case.name`을 바꿔도 최종 `TestCaseResult.spec.name`은 원래 값 |
| `timeout 시 후속 케이스를 시작하지 않는다` | 현재 case `timedOut`, 후속 case `notRun`, suite `failed`, `stopReason.type === "timeout"` |
| `AbortSignal 취소 시 스위트를 aborted로 끝낸다` | 현재 case `cancelled`, 후속 case `notRun`, suite `aborted`, client `close` 호출 0회 |
| `drain 설정을 동기 검증한다` | 0/NaN/Infinity/음수/소수/60_001은 event·MCP 전 `RangeError`, 1과 60_000 허용 |
| `timeout 뒤 정상 drain 후 graceful close한다` | report가 먼저 resolve되고 deadline 전 operation settle 후 `settled`, finalizer close 1회 |
| `drain deadline 뒤 transport를 강제 종료한다` | permanently pending listTools/callTool 각각 `5_000ms` 후 `deadlineExceeded`, 독립 force close 1회, 늦은 operation reject에 unhandled rejection 없음 |
| `drain deadline 경계 결과를 결정적으로 고정한다` | settlement가 `deadlineAt`에 관찰되면 항상 `deadlineExceeded`, callback 등록 순서와 무관 |
| `graceful close와 force close를 유한 상한으로 끝낸다` | close 2,000ms 초과/정확 경계 시 deadline reason, 경계 전 close reject만 `gracefulCloseFailed`, force 2,000ms 초과/정확 경계 시 structured timeout error, finalize pending 없음 |
| `execution과 shutdown client identity를 강제한다` | 다른 client controller와 위조 execution은 report/drain·transport 접근 전 동기 `TypeError` |
| `report reject와 cleanup 오류를 보존한다` | undefined rejection도 실패로 유지; 여러 실패는 report→drain→close→force 순서 `AggregateError`, 종료 동작 1회 |
| `event와 report에서 민감정보를 제거한다` | `apiKey`, `Authorization`, caller 지정 sentinel 값이 모두 `[REDACTED]`이며 실제 client 호출에는 원본 값 전달 |
| `observer payload 제한을 적용한다` | case 초과는 MCP/event 전 `RunnerPayloadLimitError`, report 초과는 `suiteCompleted` 없이 같은 오류 |
| `같은 입력에 같은 결과를 만든다` | 두 실행의 event 배열과 report가 deep equality이고 timestamp·duration 키가 없음 |
| `실패 보고서를 repair 입력으로 직렬화한다` | `JSON.stringify` 성공, sanitized `spec`과 diagnostic 존재, 직렬화 문자열에 `raw`와 sentinel secret이 없음 |
| `신뢰할 수 없는 repair 결과를 문맥 검증한다` | duplicate, unknown, unselected ID와 ID/operation mismatch, invalid replacement가 각각 고정 issue code로 거절됨 |
| `repair 결과를 UI 전에 다시 마스킹한다` | provider가 넣은 `Authorization`과 caller PII sentinel이 preview에서 `[REDACTED]`, candidate `applicable === false` |
| `검토한 sanitized replacement만 적용한다` | request binding의 original selection만 사용; raw/redacted/oversize/승인 후 변조 결과는 적용 불가; 재입력·재승인된 applicable preview만 해당 case 변경 |
| `compile provider 경계를 검증한다` | immutable request snapshot만 승인 후 호출; stdout streaming limit은 parse 전에 중단; result 재검증 뒤 같은 fingerprint의 opaque execution snapshot만 Runner에 전달 |
| `invalid provider issue에서 raw 값을 제거한다` | compile/repair unknown key·value·message sentinel이 모든 returned issue code/path/message/hint와 직렬화 결과에 없음; 101개/byte-boundary fixture도 truncation sentinel 포함 최종 배열이 100개·65,536 bytes 이하 |
| `deprecated createMcpTest 호환성을 유지한다` | named import가 유지되고 기존 호출이 동일한 `not implemented` 오류를 던짐 |

구현 계획은 위 이름과 단언을 실제 Vitest 코드로 전량 제시한다. 테스트용 client는 인메모리 객체만 사용하며 실제 MCP 서버 프로세스를 띄우지 않는다.

`toolExists` 테스트의 툴 정의는 공용 [fixtures/tools-list.sample.json](../../../fixtures/tools-list.sample.json)을 읽어 `ToolDef[]`로 사용한다. `callTool` 결과, reject, 지연 Promise와 호출 기록은 각 테스트가 인메모리 fake `McpClient`로 만든다. 공용 fixture는 Runner 작업에서 수정하지 않는다.

## 18. 예상 파일 구조

```text
packages/runner/src/
├── spec/
│   ├── types.ts
│   ├── json-schema.ts
│   ├── validation.ts
│   └── index.ts
├── assertions.ts
├── diagnostics.ts
├── sanitization.ts
├── executor.ts
├── execution-binding.ts
├── shutdown.ts
└── index.ts

packages/runner/tests/
├── helpers/schema-evaluator.ts
├── spec-validation.test.ts
├── spec-schema.test.ts
├── assertions.test.ts
├── sanitization.test.ts
├── executor.test.ts
└── shutdown.test.ts

.changeset/
└── runner-declarative-suite.md
```

`spec/`은 executor를 import하지 않는다. `src/index.ts`가 명세 계약과 executor API를 한곳에서 재수출하며 import 시 실행 부작용을 만들지 않는다.

같은 변경에서 다음 기존 파일도 수정한다.

- `packages/runner/package.json`: 설명과 공개 진입점 메타데이터 확인
- `packages/runner/README.md`: 새 선언형 API 예시로 교체
- `packages/runner/tests/index.test.ts`: 기존 스텁 테스트 제거 후 분리된 테스트로 대체
- `.changeset/runner-declarative-suite.md`: Runner 공개 API 교체와 수직 기능을 설명하는 minor changeset

`packages/runner/tsdown.config.mjs`는 루트 진입점 하나를 유지하므로 변경하지 않는다. 루트 `tsconfig.base.json`, `vitest.config.ts`, `biome.json`도 수정하지 않는다.

## 19. 구현 순서

1. 공개 타입, JSON Schema, validator와 실패 테스트
2. `toolExists`, `isError`, 구조화된 진단과 실패 테스트
3. 순차 executor, 이벤트, 보고서와 실패 테스트
4. timeout, `AbortSignal`, fake timer 테스트
5. Runner README와 generate/CLI 후속 연동 계약 확인

구현은 한 번에 `packages/runner`만 수정하며 타입 시그니처와 실패 테스트를 구현보다 먼저 제시한다. 변경량이 400줄을 크게 넘으면 리뷰 가능한 단위로 PR을 나눈다.

### 19.1 의존성 그래프와 Wave

```text
Task 1: spec 타입·Schema·validator
  ↓
Task 2: assertion·diagnostic
  ↓
Task 3: executor·event·report
  ↓
Task 4: timeout·AbortSignal
  ↓
Task 5: package 문서·전체 회귀 검증
```

모든 태스크가 같은 Runner 공개 계약과 `src/index.ts`에 순차적으로 의존한다. 병렬 터미널로 나누면 파일 소유권과 타입 변경이 겹치므로 첫 구현은 **Wave 1개, 터미널 1개, worktree 1개, 태스크 순차 실행**으로 계획한다. 각 태스크 구현은 별도 자식 에이전트가 맡고 메인 세션은 diff·테스트·계약 검토 게이트를 담당한다.

### 19.2 모델 배분

- 공개 타입, JSON Schema, 패키지 경계 판단: 상위 모델
- 실패 진단 문안과 실제값 최소 공개 판단: 상위 모델
- 승인된 계약에 따른 기계적인 assertion·executor·timeout 구현: 표준 모델
- 최종 계약·회귀 검토: 상위 모델

구체적인 `model`과 `reasoning_effort`, agent message, 허용 Files, report 경로는 구현 계획에 실제 값으로 고정한다. 자식 에이전트는 background 실행, commit, merge, push, 하위 agent spawn을 하지 않는다.

팀 `CLAUDE.md`의 “커밋과 푸시는 사람이 한다”가 일반 Wave 규약보다 우선한다. 메인 세션도 commit, merge, push를 실행하지 않는다. 각 태스크 검토가 통과하면 권장 커밋 메시지와 변경 파일을 사용자에게 제시하고, 사용자가 만든 통합 SHA를 확인한 뒤에만 후속 태스크를 시작한다.

### 19.3 작업공간 제약

- 실행 전 `git rev-parse --git-dir`, `git rev-parse --git-common-dir`, `git branch --show-current`로 기존 연결 worktree 여부를 확인한다.
- Codex App이 이미 격리한 worktree이면 중첩 worktree를 만들지 않는다.
- 새 worktree가 필요하면 프로젝트 로컬 실행 규약이 지정한 경로만 사용한다.
- 이 설계 문서와 구현 계획은 실행 기준 커밋에서 접근 가능해야 한다. 현재처럼 untracked라면 사용자가 먼저 커밋하거나 실행 프롬프트가 명시적으로 복사해야 한다.
- `.agents/`와 `docs/conventions/`는 로컬 ignore 대상이므로 새 worktree를 만들 때 원본 작업공간에서 복사하고, 작업 에이전트에게도 동일 규약을 제공한다.

### 19.4 파일 소유권

허용 범위는 `packages/runner/**`, Runner changeset 한 파일, Runner 설계·계획 문서다. 다음 공유 계약은 수정하지 않는다.

```text
packages/core/src/types.ts
package.json
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
vitest.config.ts
biome.json
packages/generate/**
packages/cli/**
```

generate 연동에 workspace dependency나 공유 설정 변경이 필요하면 구현하지 않고 별도 팀 승인 항목으로 보고한다.

## 20. 후속 결정과 명시적 한계

- `ToolResult.content`의 JSON 본문 추출은 응답 assertion 설계 시 별도로 결정한다.
- JUnit과 Vitest adapter는 RunnerReport 변환 계층으로 추가하며 executor에 결합하지 않는다.
- 병렬 실행은 필요성이 입증되기 전까지 도입하지 않는다.
- generate의 Runner workspace dependency는 팀 승인 후 추가한다.
- timeout 10초·30초 정책은 도그푸딩 결과로 재검토하되 변경 근거와 정책 버전을 기록한다.
- 응답 본문을 AI에 전송할 필요가 생기면 크기 제한, 비밀값 마스킹, 사용자 승인 정책을 먼저 설계한다.
- Runner와 generate의 계약 변경은 JSON Schema 버전 및 영향 범위를 함께 검토한다.

# 응답 본문 단언 설계 (2026-08-13)

- 상태: 초안
- 담당: runner
- 선행 문서: [Runner 설계](2026-08-11-runner-design.md) §2 비범위, [AI 보조 테스트 작성 설계](2026-08-12-ai-assisted-test-authoring-design.md) §19

## 1. 배경

Runner의 단언은 `toolExists`와 `isError` 둘뿐이다. `callTool` 결과에 대해 확인할 수 있는 것은
"오류인가 아닌가"가 전부다. 응답 본문은 검사하지 못한다.

`examples/weather-server`로 실제 확인한 상태는 다음과 같다. 서버가
`{"city":"서울","temp":21,"condition":"맑음"}`을 반환하는데, 현재 스위트는 `isError: false`만 본다.
서버가 `temp`를 삭제하거나 `temperature`로 개명해도 테스트는 통과한다.

CLAUDE.md는 실패 메시지를 제품으로 규정하며 다음 문장을 기준으로 든다.

```
→ 응답에 'temp' 필드가 없습니다. 발견된 필드: 'temperature'
→ 스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.
```

현재 계약으로는 이 문장을 만들 수 없다. 이 문장을 만들 수 있게 하는 것이 이 설계의 목적이다.

두 선행 문서가 이 작업을 이미 후속으로 예고했다. Runner 설계 §2 비범위의
`입력·응답 JSON Schema assertion`과 `ToolResult.content의 범용 JSON 본문 추출`,
AI 보조 테스트 작성 설계 §19의 `응답 본문 assertion이 Runner에 추가된 뒤 AI output schema를
확장하는 절차`가 그것이다.

## 2. 목표와 비범위

### 목표

1. `callTool` 응답 본문을 검사하는 단언을 Runner 공개 계약에 추가한다.
2. 위반을 무엇이 왜 다른지 보이는 문장으로 진단한다.
3. 같은 응답에 항상 같은 보고서를 만든다.
4. 기존 스위트의 동작을 한 바이트도 바꾸지 않는다.

### 비범위

각 항목은 후속 작업이 경계를 다시 설계하지 않도록 §11에 연동 계약을 남긴다.

- `listTools`의 `inputSchema` 단언
- 프로토콜 오류로 reject되는 호출의 기대 실패 선언(`expectFailure`)
- `structuredContent` 지원
- 조합자(`oneOf`, `anyOf`, `allOf`, `not`)와 `$ref`
- 정규식 `pattern`
- `generate` baseline이 새 단언을 생성하는 것
- CLI의 사람이 읽는 보고서 렌더링

### 완료 조건

- `packages/runner`의 `pnpm test`, `pnpm typecheck`, `pnpm lint` 통과
- 새 단언을 쓴 스위트로 `examples/weather-server`를 검사하는 E2E가 통과
- `bodyMatchesSchema`가 없는 기존 스위트의 보고서 바이트가 변경 전과 동일
- `@mcpeak/runner` minor changeset

## 3. 설계 결정 요약

| 항목 | 결정 | ADR |
|---|---|---|
| 단언 개수 | `bodyMatchesSchema` 하나로 통합 | ADR-0010 |
| 지원 키워드 | 13개. 조합자와 `$ref` 제외 | ADR-0010 |
| 문자열 검사 | `pattern` 대신 `stringContains` | ADR-0010 |
| 타입 제약 키워드 | `type` 명시를 요구 | ADR-0010 |
| 본문 추출 | JSON 객체·배열만 구조로 해석 | ADR-0011 |
| 모르는 키워드 | `validateMcpSuite`가 거부 | 본문 §4.3 |
| 위반 보고 | 전부 수집, 순서 고정, 10건 상한 | 본문 §6.4 |

### 3.1 단언을 하나로 통합한 이유

필드 존재 검사(`bodyHasField`)와 스키마 검사(`bodyMatchesSchema`)를 따로 두는 방안을 검토했다.
JSON Schema는 전자를 이미 표현한다. `required`가 필드 존재를, `const`가 값 동등을,
`type`이 타입을 담당한다. 단언을 하나로 두면 Runner 설계 §441이 요구하는 세 계약 동기화
비용을 한 번만 치른다. 실패 메시지 품질은 위반 키워드별로 문장을 나눠 쓰면 유지된다.

### 3.2 조합자를 제외한 이유

`oneOf` 위반은 "분기 셋 중 아무것과도 맞지 않는다"로 귀결한다. 사용자가 무엇을 고쳐야 하는지
알 수 없다. 실패 메시지를 제품으로 삼는 이 프로젝트에서 진단 품질이 구조적으로 가장 나빠지는
지점이다.

추가 비용도 비대칭이다. `minimum` 같은 단순 키워드는 evaluator 분기 하나, 문안 하나,
parity fixture 한 쌍이면 나중에 붙는다. 조합자는 진단 모델을 "위반 목록"에서
"분기별 위반 목록"으로 바꾸므로 이미 작성한 문장 생성 코드를 되짚는다. 따라서 단순 키워드는
미루고 조합자는 지금 명시적으로 제외한다.

### 3.3 `pattern`을 제외한 이유

Node의 정규식 엔진은 백트래킹 방식이라 입력 길이에 지수적으로 반응하는 패턴이 존재한다.
단언 평가는 동기 코드이므로 이벤트 루프가 잡히고, 케이스별 `timeoutMs`는 MCP 작업에 걸린
것이라 이를 막지 못한다. 테스트 러너 전체가 멈춘다.

검사 대상 문자열은 테스트 대상 서버가 반환하는 값이라 우리가 통제하지 못한다. 스펙의 패턴이
안전해 보여도 서버 응답이 길어지면 터지는 조합이 생긴다. AI가 생성한 패턴은 사람 검토를 거치지
않을 여지가 크다.

선형 시간 엔진(RE2 등)을 도입하면 해결되지만 런타임 의존성 추가라 CLAUDE.md 규칙에 걸린다.

문자열 검사의 실제 용도는 오류 메시지에서 특징 문구를 확인하는 것이며 리터럴 부분문자열로
충분하다. 형식 검증이 필요한 경우는 정상 응답의 필드이고, 그 자리는 `type`과 `const`가 맡는다.

`stringContains`라는 이름을 쓰는 이유는 JSON Schema 표준의 `contains`가 배열용으로 이미
존재하며 뜻이 다르기 때문이다. 같은 이름을 다른 뜻으로 쓰면 사용자와 AI 양쪽이 혼동한다.

## 4. 공개 계약

### 4.1 단언 타입

```ts
export interface BodyMatchesSchemaAssertionSpec {
  type: "bodyMatchesSchema";
  schema: ResponseSchema;
}

export type ToolResultAssertionSpec = IsErrorAssertionSpec | BodyMatchesSchemaAssertionSpec;
```

`ToolResultAssertionSpec`은 현재 `IsErrorAssertionSpec`의 별칭이며 합집합으로 바뀐다.
`callTool` 케이스의 `assertions` 배열에 두 단언을 섞어 쓸 수 있다.

`listTools` 케이스에는 사용할 수 없다. `validation.ts`가 operation 종류별 허용 단언을 고정하는
기존 규칙을 유지한다.

### 4.2 응답 스키마 부분집합

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
```

키워드는 13개다. `stringContains` 하나만 표준 밖 확장이고 나머지 12개는 JSON Schema와 같은
뜻이다.

### 4.3 모르는 키워드는 거부한다

지원하지 않는 키워드를 조용히 무시하면 검사하지 않고 통과하는 결과가 된다.
`CLAUDE.local.md`의 거짓 신호 표 첫 항목(검사 대상이 0개인데 녹색)과 같은 종류의 사고다.
`validateMcpSuite`가 스펙 검증 단계에서 거부한다.

```
- [UNSUPPORTED_SCHEMA_KEYWORD] cases[0].assertions[1].schema.properties.temp.multipleOf: 지원하지 않는 스키마 키워드입니다.
  해결: 지원 키워드는 type, const, enum, required, properties, additionalProperties, items, minItems, minLength, maxLength, stringContains, minimum, maximum 입니다.
```

### 4.4 타입 제약 키워드는 `type` 명시를 요구한다

표준 JSON Schema는 적용 대상 타입이 아닌 값에 대해 키워드를 조용히 건너뛴다.
`{ "minimum": 0 }`에 문자열이 오면 검사 없이 통과한다. 이 동작은 §4.3과 같은 이유로 채택하지
않는다.

| 키워드 | 함께 필요한 `type` |
|---|---|
| `required`, `properties`, `additionalProperties` | `object` |
| `items`, `minItems` | `array` |
| `minLength`, `maxLength`, `stringContains` | `string` |
| `minimum`, `maximum` | `number` 또는 `integer` |

```
- [SCHEMA_KEYWORD_REQUIRES_TYPE] cases[0].assertions[1].schema.properties.temp: 'minimum'은 type이 number 또는 integer일 때만 쓸 수 있습니다.
  해결: 같은 스키마에 "type": "number"를 추가하세요.
```

이 규칙 덕분에 evaluator에서 "타입이 맞지 않으니 건너뛴다"는 분기가 사라진다. `type`이 통과한
뒤의 키워드는 반드시 평가된다.

### 4.5 새 검증 이슈 코드

`SuiteValidationIssueCode`에 두 개를 추가한다.

- `UNSUPPORTED_SCHEMA_KEYWORD`
- `SCHEMA_KEYWORD_REQUIRES_TYPE`

### 4.6 갱신할 계약 세 곳

Runner 설계 §441의 규칙에 따라 같은 변경에서 함께 고친다.

| 파일 | 내용 |
|---|---|
| `src/spec/types.ts` | `BodyMatchesSchemaAssertionSpec`, `ResponseSchema` |
| `src/spec/json-schema.ts` | `$defs`에 `bodyMatchesSchemaAssertion`, `responseSchema` 추가 |
| `src/spec/validation.ts` | 런타임 검증과 새 이슈 코드 두 개 |

`MCP_SUITE_JSON_SCHEMA`에 재귀 `$ref`가 처음 들어온다. `ResponseSchema`가 자기 자신을
참조하므로 `$defs/responseSchema`가 자신을 가리킨다. 기존 `jsonValue` 정의가 같은 방식이고,
parity 평가기(`tests/helpers/schema-evaluator.ts`)가 로컬 `$ref`를 해석하므로 표현 가능하다.

### 4.7 버전

`schemaVersion`은 1을 유지한다. 단언 추가는 덧붙이기이며 기존 스위트가 전부 그대로 유효하다.
새 단언을 쓴 스위트를 옛 러너에 넣으면 `INCOMPATIBLE_ASSERTION`으로 거부되므로 조용히 틀리지
않는다. `@mcpeak/runner`는 0.1.1에서 0.2.0으로 올린다.

### 4.8 예시

```json
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
}
```

오류 응답 검증은 문자열 본문을 대상으로 한다.

```json
{
  "id": "weather-unknown-city",
  "name": "없는 도시는 사용 가능한 목록을 안내한다",
  "operation": { "type": "callTool", "tool": "get_weather", "input": { "city": "평양" } },
  "assertions": [
    { "type": "isError", "expected": true },
    { "type": "bodyMatchesSchema", "schema": {
        "type": "string",
        "stringContains": "사용 가능한 도시"
    }}
  ]
}
```

## 5. 본문 추출

`packages/runner/src/body.ts`.

```ts
export type BodyForm = "json" | "text";

export type BodyExtraction =
  | { ok: true; body: JsonValue; form: BodyForm }
  | { ok: false; failure: BodyExtractionFailure };

export type BodyExtractionFailure =
  | { code: "CONTENT_NOT_ARRAY"; actual: string }
  | { code: "CONTENT_BLOCK_COUNT"; actual: number }
  | { code: "CONTENT_BLOCK_NOT_TEXT"; actual: string };

export function extractResponseBody(result: ToolResult): BodyExtraction;
```

`core`의 `ToolResult`는 `{ content: unknown; isError: boolean; raw: unknown }`이며 5인 병렬
작업의 기준점이라 변경하지 않는다. 추출은 전적으로 Runner가 소유한다.

### 5.1 규칙

1. `content`가 배열이 아니면 실패한다.
2. 원소가 정확히 1개가 아니면 실패한다.
3. 그 원소가 text 블록이 아니면 실패한다. plain object이고 `type`이 `"text"`이며 `text`가
   문자열일 때만 text 블록으로 인정한다. `type`이 `"text"`인데 `text`가 문자열이 아닌 경우도
   `CONTENT_BLOCK_NOT_TEXT`로 실패하며 `actual`에 실제 `text` 타입을 담는다.
4. `text` 문자열을 `JSON.parse`한다.
5. 파싱 결과가 객체나 배열이면 그 값이 본문이다(`form: "json"`).
6. 그 외는 모두 `text` 문자열 자체가 본문이다(`form: "text"`).

한 줄로 줄이면 다음과 같다. JSON 객체나 배열이면 구조로 보고, 그 외는 문자열로 본다.

### 5.2 스칼라를 구조로 해석하지 않는 이유

`JSON.parse`는 스칼라도 파싱한다. `"21"`은 숫자 21이 되고 `"null"`은 null이 된다. 파싱 성공을
곧 구조로 삼으면 오류 메시지가 우연히 `null`이나 `1`일 때 본문이 문자열이 아니게 된다. 이때
진단은 `기대: string, 실제: null`이 되어 사용자를 엉뚱한 곳으로 보낸다. 원인은 추출 규칙에
있는데 메시지에 드러나지 않는다.

객체와 배열만 구조로 해석하면 오류 메시지는 항상 문자열이 된다. 대가로 응답 전체가 맨 스칼라인
서버에서 `{ "type": "number" }`가 실패하지만, 이때 진단은 `기대: number, 실제: string ("5")`가
되어 사용자가 무엇을 고칠지 즉시 안다. 두 규칙 모두 어딘가에서 어색해지므로, 어색할 때 진단이
사용자를 옳은 곳으로 보내는 쪽을 택한다.

### 5.3 비 text 블록을 무시하지 않는다

`[{text}, {image}]`에서 text만 골라 쓰는 방안은 채택하지 않는다. 무시는 조용한 통과의 원인이며
서버 응답 구조가 바뀐 사실을 감춘다. 모호하면 진단을 낸다.

### 5.4 추출 실패는 `failed`다

Runner 설계 원칙 4번의 `skipped`는 선행 결과가 없어 검사할 수 없는 경우를 뜻한다. 추출 실패는
응답이 도착했으나 모양이 계약과 다른 것이므로 검사 결과는 실패다.

### 5.5 추출 시점

`bodyMatchesSchema` 단언이 있는 케이스에서만, 케이스당 한 번 수행한다. 같은 케이스의 여러
`bodyMatchesSchema`가 같은 추출 결과를 공유한다. 해당 단언이 없는 스위트에서는 호출하지 않는다.

## 6. 스키마 평가

`packages/runner/src/schema-match.ts`. 위반 목록만 만들고 문장은 만들지 않는다.

```ts
export const MAX_SCHEMA_VIOLATIONS = 10;

export type SchemaViolationCode =
  | "TYPE_MISMATCH" | "CONST_MISMATCH" | "ENUM_MISMATCH"
  | "REQUIRED_MISSING" | "ADDITIONAL_PROPERTY"
  | "MIN_ITEMS" | "MIN_LENGTH" | "MAX_LENGTH" | "STRING_CONTAINS"
  | "MINIMUM" | "MAXIMUM";

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

export function matchResponseSchema(schema: ResponseSchema, body: JsonValue): SchemaMatchResult;
```

`observedKeys`는 `REQUIRED_MISSING` 전용이며 `발견된 필드` 문장의 재료다. 이 필드가 없으면
CLAUDE.md가 기준으로 든 메시지를 만들 수 없다.

경로 표기는 `$`, `$.temp`, `$.hourly[0].temp` 형태다.

`SchemaViolation`의 `expected`, `actual`, `observedKeys`는 **가공하지 않은 원본 값**이다.
sanitize와 크기 요약은 §8이 규정하며 `diagnostics.ts`가 수행한다. 평가기의 반환값은 보고서에
직접 들어가지 않는다.

### 6.1 노드 안 평가 순서

```
1. type      위반이면 이 노드 종료
2. const     위반이면 이 노드 종료
3. enum      위반이면 이 노드 종료
4. 타입별 제약  minLength / maxLength / stringContains / minimum / maximum / minItems
5. 하위 순회   required → properties → additionalProperties → items
```

1에서 3까지에서 종료하는 이유는 소음 제거다. `temp`가 문자열 `"21"`일 때 타입 위반과 최솟값
위반을 함께 보고하면 후자가 무의미하다.

한 노드가 종료해도 형제 노드는 계속 평가한다. Runner 설계 원칙 3번과 같은 취지다.

### 6.2 키워드 판정

| 키워드 | 판정 |
|---|---|
| `type` | `null` / `array` / `object` / `number`(유한) / `integer` / `string` / `boolean` |
| `const` | 깊은 비교 |
| `enum` | 후보 중 하나와 깊은 일치 |
| `required` | `Object.hasOwn`으로 자기 키만 본다. 값이 `null`이어도 존재로 간주 |
| `additionalProperties: false` | `properties`에 없는 키가 있으면 위반 |
| `additionalProperties: <스키마>` | `properties`에 없는 키를 그 스키마로 검사 |

`required`와 객체 키 순회에 `in` 연산자를 쓰지 않는다. `in`은 프로토타입 체인을 타므로
`"toString"`이나 `"constructor"`를 필수 필드로 선언한 스키마가 빈 객체에서 통과한다.
`examples/weather-server`가 같은 이유로 `Object.hasOwn`을 쓴다.
| `items` | 모든 원소를 같은 스키마로 검사 |
| `stringContains` | `String.prototype.includes`. 정규식이 아니다 |
| `minLength` / `maxLength` | 문자열 길이. 포함 비교 |
| `minItems` | 배열 길이. 포함 비교 |
| `minimum` / `maximum` | 포함 비교 |

### 6.3 순서 결정론

| 목록 | 순서 |
|---|---|
| `properties` 순회 | 스키마 선언 순서 |
| `items` 순회 | 배열 인덱스 순서 |
| `required` 검사 | 스펙의 배열 순서 |
| `additionalProperties: false` 위반 키 | 정렬 |
| `additionalProperties: <스키마>` 순회 | 정렬 |
| `observedKeys` | 정렬 |

정렬은 UTF-16 코드 단위 기준의 안정 비교를 쓴다. 로캘에 의존하는 비교를 쓰지 않는다.
`assertions.ts`의 `assertToolExists`가 이미 같은 방식이다.

스키마에서 온 순서는 사용자가 작성한 순서를 따라 메시지가 스펙을 읽는 순서와 일치하게 한다.
응답에서 온 목록은 정렬한다. 서버가 키 순서를 바꿔도 보고서가 바뀌면 안 된다.
`assertions.ts`의 `assertToolExists`가 툴 이름을 정렬하는 기존 규칙과 같다.

### 6.4 상한

위반 수집은 `MAX_SCHEMA_VIOLATIONS`에서 멈추되 순회는 끝까지 진행해 `totalViolations`를 센다.
순회는 응답 크기에 선형이므로 계수 비용은 무시할 수 있다. "10건"과 "20건 중 10건"은 사용자에게
다른 정보이므로 두 값을 모두 남긴다.

### 6.5 스택 안전

순회는 재귀가 아니라 명시적 프레임 스택으로 구현한다. `validation.ts`의 `json()`이 이미 같은
방식이다. 깊게 중첩한 응답에서 스택이 넘치지 않는다.

## 7. 진단

`packages/runner/src/diagnostics.ts`에 추가한다. 위반 목록을 사람이 읽는 문장으로 바꾸는
유일한 자리다.

### 7.1 진단 코드

```ts
export type RunnerDiagnosticCode =
  | "TOOL_NOT_FOUND" | "IS_ERROR_MISMATCH" | "OPERATION_FAILED"
  | "OPERATION_RESULT_UNAVAILABLE" | "CASE_TIMEOUT" | "RUN_ABORTED"
  | "BODY_SCHEMA_MISMATCH"
  | "BODY_EXTRACTION_FAILED";
```

위반 종류마다 진단 코드를 주지 않는다. `AssertionResult.diagnostic`이 단수이므로 단언 하나에
진단 하나가 기존 구조이며, 위반 종류는 `SchemaViolation.code`가 이미 담는다.

```ts
export interface SchemaViolationDiagnostic {
  code: SchemaViolationCode;
  path: string;
  /** sanitize와 요약을 거친 값. 원본이 아니다. */
  expected: JsonValue;
  actual: JsonValue;
  /** actual이 잘린 문자열일 때만. 원본 코드 포인트 길이. */
  actualChars?: number;
  /** REQUIRED_MISSING 전용. 정렬 후 MAX_OBSERVED_KEYS까지. */
  observedKeys?: string[];
  /** observedKeys가 잘렸을 때만. 원본 키 개수. */
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
```

기존 필드는 유지하고 선택 필드 두 개를 추가한다. 기존 진단 생성 함수는 변경하지 않는다.

### 7.2 위반 문장

```
$.temp         타입이 다릅니다. 기대: number, 실제: string ("21")
$.city         값이 다릅니다. 기대: "서울", 실제: "Seoul"
$.condition    기대한 값 중 하나가 아닙니다. 기대: "맑음" | "흐림" | "비", 실제: "맑음 후 비"
$.temp         필수 필드가 없습니다. 발견된 필드: 'city', 'temperature', 'condition'
$.temperature  스키마에 없는 필드입니다.
$.hourly       배열 원소가 부족합니다. 기대: 24개 이상, 실제: 3개
$.city         문자열이 너무 짧습니다. 기대: 1자 이상, 실제: 0자
$.summary      문자열이 너무 깁니다. 기대: 200자 이하, 실제: 812자
$              응답 문자열에 기대한 내용이 없습니다. 기대: "사용 가능한 도시" 포함, 실제: "→ 'city' 는 문자열이어야..."
$.temp         값이 범위를 벗어납니다. 기대: -90 이상, 실제: -273
$.temp         값이 범위를 벗어납니다. 기대: 60 이하, 실제: 210
```

각 문장은 세 가지를 담는다. 경로가 무엇이 다른지, 기대와 실제가 왜 다른지, 값 자체가 서버가
무엇을 보냈는지 보인다.

`TYPE_MISMATCH`에 실제 값을 괄호로 덧붙이는 것이 중요하다. `기대: number, 실제: string`만으로는
서버가 무엇을 보냈는지 알 수 없다. `("21")`이 붙으면 숫자를 문자열로 감싼 실수임이 즉시 보인다.

### 7.3 요약 문장

```
위반이 상한 이하일 때
  message: "응답이 기대 스키마와 다릅니다. 위반 3건."
  hint:    "스키마 변경이 의도된 것이라면 테스트를 업데이트하세요."

위반이 상한을 넘을 때
  message: "응답이 기대 스키마와 다릅니다. 위반 20건 중 10건을 표시합니다."
  hint:    "표시된 위반을 고친 뒤 나머지를 다시 확인하세요."
```

### 7.4 추출 실패 문장

```
CONTENT_NOT_ARRAY
  message: "응답에서 검사할 본문을 정할 수 없습니다. content가 배열이 아닙니다. 실제 타입: object"
  hint:    "bodyMatchesSchema는 text 블록 1개짜리 응답에만 쓸 수 있습니다."

CONTENT_BLOCK_COUNT
  message: "응답에서 검사할 본문을 정할 수 없습니다. content 블록이 2개입니다. 1개여야 합니다."
  hint:    "서버 응답 구조를 확인하거나 이 단언을 제거하세요."

CONTENT_BLOCK_NOT_TEXT
  message: "응답에서 검사할 본문을 정할 수 없습니다. content 블록이 text가 아닙니다. 실제 type: image"
  hint:    "bodyMatchesSchema는 text 블록에만 쓸 수 있습니다."
```

### 7.5 단언 함수

`packages/runner/src/assertions.ts`에 추가한다.

```ts
export function assertBodyMatchesSchema(
  extraction: BodyExtraction,
  spec: BodyMatchesSchemaAssertionSpec,
  options?: { redaction?: RunnerRedactionOptions },
): AssertionResult;
```

`ToolResult`가 아니라 `BodyExtraction`을 받는다. §5.5의 케이스당 1회 추출을 지키기 위해
`executor.ts`가 추출해 넘긴다.

```
추출 실패            → failed, BODY_EXTRACTION_FAILED
추출 성공 + 위반 0건 → passed, 진단 없음
추출 성공 + 위반 n건 → failed, BODY_SCHEMA_MISMATCH
```

## 8. 값 노출과 상한

### 8.1 위험

기존 상한은 `maxCaseBytes` 65,536과 `maxReportBytes` 1,048,576이다. 지금까지 진단에 들어가는
값은 툴 이름이나 불리언이라 작았다. 이제 서버 응답 값이 진단에 들어간다. 큰 객체가 `actual`이
되면 케이스 하나가 상한을 넘겨 `RunnerPayloadLimitError`로 보고서 생성이 실패한다. 스키마
검사가 실패했을 뿐인데 보고서 전체가 죽는 상황을 막아야 한다.

### 8.2 값 요약 규칙

```ts
export const MAX_VALUE_STRING_CHARS = 200;
export const MAX_OBSERVED_KEYS = 20;
```

| 실제 값 | 진단에 들어가는 것 |
|---|---|
| 숫자, 불리언, `null` | 그대로 |
| 200자 이하 문자열 | 그대로 |
| 200자 초과 문자열 | 앞 200자와 실제 길이(`actualChars`) |
| 객체 | `{ "kind": "object", "keys": 3 }` |
| 배열 | `{ "kind": "array", "items": 1000 }` |

문자열 자르기는 `Array.from`으로 얻은 **코드 포인트** 기준이다. `String.prototype.slice`는
UTF-16 코드 단위로 잘라 서로게이트 페어를 쪼갠다. 이모지나 일부 문자가 깨진 조각으로 진단에
남으면 안 된다. `actualChars`도 같은 코드 포인트 기준으로 센다.

객체와 배열을 통째로 담지 않는 이유는 상한이 구조적으로 보장되지 않기 때문이다. 위반 경로가
이미 위치를 가리키며, 그 지점의 값은 대개 스칼라다. 객체 전체가 `actual`이 되는 경우는 최상위
`TYPE_MISMATCH` 정도이고, 그때 필요한 정보는 객체가 왔다는 사실이지 내용이 아니다.

`observedKeys`는 정렬 후 `MAX_OBSERVED_KEYS`까지 담고 초과분은 개수로 알린다.

```
$.temp: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temperature' 외 47개
```

### 8.3 sanitize와 자르기 순서

```
값 → sanitizeJsonValue → 요약과 자르기 → 진단
```

순서를 뒤집으면 안 된다. 먼저 자르면 민감값의 일부만 남아 `sensitiveValues` 일치 검사를
통과하지 못하고 `[REDACTED]`가 적용되지 않는다.

`expected`는 스펙에서 온 값이라 sanitize 대상이 아니다. Runner 설계 §706이 assertion을 계약
식별자로 규정하며 caller의 `sensitiveValues`와 우연히 같아도 바꾸지 않는다고 이미 정했다.
다만 자르기는 적용한다. 사용자가 긴 `const`를 써도 진단이 부풀지 않아야 한다.

### 8.4 상한 계산

위반 하나의 최악 크기는 code, path, message, expected, actual을 합쳐 1KB 미만이다. 상한인
10건이면 10KB 미만이며 `maxCaseBytes` 65,536 안에 든다. 스키마 위반 때문에 상한을 넘기는 일이
구조적으로 발생하지 않는다.

### 8.5 응답 본문은 보고서에 담지 않는다

`extractResponseBody`가 만든 본문 전체를 `TestCaseResult`에 넣지 않는다. 현재도 응답을 보고서에
담지 않으며 그대로 유지한다. 보고서에 남는 것은 위반 목록뿐이며 이것이 향후 repair의 입력이
된다.

## 9. executor 통합

`executor.ts`의 단언 평가 부분만 바뀐다.

```ts
const needsBody = spec.assertions.some((a) => a.type === "bodyMatchesSchema");
const extraction = needsBody ? extractResponseBody(result.result) : undefined;

assertion.type === "isError"
  ? assertIsError(result.result, assertion)
  : assertBodyMatchesSchema(extraction, assertion, { redaction: options.redaction })
```

기존 스위트는 `needsBody`가 항상 false이므로 동작이 변하지 않는다.

이벤트 계약은 그대로다. `assertionCompleted`가 `AssertionResult`를 담고 그 안에 새 진단이 들어갈
뿐이다. 새 이벤트 종류를 추가하지 않는다.

`isError` 단언이 실패해도 `bodyMatchesSchema`는 계속 평가한다. Runner 설계 원칙 3번을 따르며,
두 진단이 함께 나와야 오류가 났고 그래서 본문도 객체가 아니라는 사실이 한 번에 보인다.

## 10. 테스트와 완료 조건

모든 유닛 테스트는 인메모리와 `fixtures/`만 사용한다. 실제 서버 프로세스를 띄우는 E2E는 직렬
전용 웨이브로 분리한다.

### 10.1 본문 추출

| 입력 | 기대 |
|---|---|
| `[{type:"text",text:'{"a":1}'}]` | `ok`, `{a:1}`, `json` |
| `[{type:"text",text:'[1,2]'}]` | `ok`, `[1,2]`, `json` |
| `[{type:"text",text:'→ 없습니다'}]` | `ok`, `"→ 없습니다"`, `text` |
| `[{type:"text",text:'21'}]` | `ok`, `"21"`, `text` |
| `[{type:"text",text:'null'}]` | `ok`, `"null"`, `text` |
| `[{type:"text",text:''}]` | `ok`, `""`, `text` |
| `[]` | `CONTENT_BLOCK_COUNT`, 0 |
| `[{text},{text}]` | `CONTENT_BLOCK_COUNT`, 2 |
| `[{type:"image"}]` | `CONTENT_BLOCK_NOT_TEXT`, image |
| `[{type:"text",text:42}]` | `CONTENT_BLOCK_NOT_TEXT`, number |
| `{a:1}` | `CONTENT_NOT_ARRAY`, object |
| `null` | `CONTENT_NOT_ARRAY`, null |

### 10.2 평가기

- 키워드 13개마다 통과 1건과 위반 1건
- `type` 위반 시 같은 노드의 `minimum`이 위반 목록에 없을 것
- `$.temp`가 종료해도 `$.condition` 위반이 잡힐 것
- 응답 키 순서를 뒤집어 넣어도 위반 목록 바이트가 같을 것
- 위반 25건 입력에서 `violations.length === 10`, `totalViolations === 25`
- 1000단계 중첩에서 스택이 넘치지 않을 것
- `required: ["toString"]`이 빈 객체 `{}`에서 `REQUIRED_MISSING`을 낼 것
- `properties`에 없는 키를 `additionalProperties` 스키마로 검사할 때 키 순서를 뒤집어도 위반
  목록이 같을 것

### 10.3 진단

- 위반 11종마다 문장 스냅샷
- 요약 문장 두 갈래
- 추출 실패 3종
- `sensitiveValues`에 걸린 응답 값이 문장에서 `[REDACTED]`가 될 것
- 같은 위반 목록을 두 번 넣으면 문장 바이트가 같을 것

### 10.4 상한

- 812자 문자열이 200자로 잘리고 `actualChars`가 812일 것
- 200번째와 201번째 문자가 서로게이트 페어인 문자열을 잘라도 깨진 조각이 남지 않을 것
- 키 50개 객체의 `observedKeys`가 20개이고 `observedKeysTotal`이 50일 것
- 긴 민감 토큰이 자르기 전에 `[REDACTED]`가 될 것
- 위반 10건 케이스가 `maxCaseBytes` 안에 들 것
- 위반 10건이 모두 큰 객체를 `actual`로 갖는 케이스도 `maxCaseBytes` 안에 들 것

### 10.5 계약 parity

Runner 설계 §441에 따라 valid와 invalid fixture를 `validateMcpSuite`와
`MCP_SUITE_JSON_SCHEMA` 양쪽에 실행해 판정이 일치함을 확인한다. 재귀 `$ref` 해석도 fixture로
확인한다.

한 가지 제약은 세 계약에 공통으로 표현되지 않는다. §4.4의 타입 짝 요구는 JSON Schema로
표현하려면 `if`/`then` 또는 `dependentRequired`가 필요한데, parity 평가기가 지원하지 않는
키워드이며 이를 위해 평가기 범위를 넓히면 검증 대상보다 검증 도구가 복잡해진다. Runner 설계
§441이 "공통으로 표현 가능한 제약마다"라고 한정한 것이 이 경우다.

따라서 §4.4는 `validateMcpSuite`만 강제하고 `MCP_SUITE_JSON_SCHEMA`는 강제하지 않는다.
parity fixture는 이 항목을 대조 대상에서 제외하며, 제외 사실과 이유를 fixture 파일에 주석으로
남긴다. §4.3의 모르는 키워드 거부는 `additionalProperties: false`로 양쪽에 표현되므로 대조
대상이다.

### 10.6 회귀

- `bodyMatchesSchema`가 없는 기존 스위트에서 `extractResponseBody`가 호출되지 않을 것
- 기존 스위트의 보고서 바이트가 변경 전과 동일할 것
- `isError` 실패 케이스에서 `bodyMatchesSchema`가 `skipped`가 아니라 평가될 것

### 10.7 E2E

`examples/weather-server`를 대상으로 새 단언을 쓴 스위트를 실행한다. 정상 응답의 구조 검증과
오류 응답의 문자열 검증을 모두 포함한다. 같은 입력으로 두 번 실행해 출력 바이트가 같은지
확인한다.

## 11. 후속 작업 연동 계약

### 11.1 `generate` baseline의 새 단언 생성

다음 웨이브의 주제이며 단순 구현이 아니다. 착수 전 결정이 필요하다.

현재 baseline은 `ToolDef`에서 입력을 합성한다(`synthesize.ts`의 `synthesizeValue`).
`const`, `default`, `examples[0]`, `enum[0]` 순으로 근거를 찾고 없으면 타입별 기본값을 쓴다.
`buildGeneratedCase`가 만드는 케이스의 단언은 `{ type: "isError", expected: false }` 하나다.

문제는 근거의 부재다. `core`의 `ToolDef`는 `{ name, description?, inputSchema }`이며 응답
모양에 대한 정보가 없다. baseline이 결정론적으로 `bodyMatchesSchema`를 만들 재료가 현재 없다.

선택지는 셋이다.

1. **baseline은 응답 단언을 만들지 않는다.** 새 단언은 사람이 직접 작성하거나 AI authoring이
   제안할 때만 등장한다. 결정론성을 해치지 않으며 추가 작업이 가장 작다. 대신 `--baseline-only`
   사용자는 응답 검증을 전혀 받지 못한다.
2. **`core`에 `outputSchema` 노출을 제안한다.** MCP 사양 2025-06-18에 툴의 `outputSchema`가
   있으나 `core`의 어댑터가 `name`, `description`, `inputSchema`만 복사한다(`client.ts`).
   `core`는 다른 오너의 패키지이며 `ToolDef`는 5인 병렬 작업의 기준점이므로 제안만 가능하고
   임의 수정은 금지다. 노출되면 baseline이 응답 스키마를 그대로 옮겨 쓸 수 있어 가장 깔끔하다.
3. **실제 호출 결과를 관찰해 스키마를 역생성한다.** 근거는 확실하지만 생성 결과가 서버 상태에
   의존하므로 결정론성과 충돌한다. `record` 카세트와 연결해야 의미가 있으며 `record`는 아직
   미구현이다.

권고는 1번으로 시작하고 2번을 `core` 오너에게 제안하는 것이다. 3번은 `record` 구현 이후에
재검토한다.

AI authoring 쪽은 별도 갱신이 필요하다. `packages/generate/src/authoring-schema.ts`의
`PROVIDER_OUTPUT_SCHEMA`와 `AUTHORING_OUTPUT_SCHEMA`가 provider가 반환할 수 있는 단언 종류를
규정하므로 `bodyMatchesSchema`를 추가해야 한다. AI 보조 테스트 작성 설계 §19의
`응답 본문 assertion이 Runner에 추가된 뒤 AI output schema를 확장하는 절차`가 이 항목이다.
suite는 JSON 문자열로 전송하므로(ADR-0007) provider 전송 스키마 자체는 바뀌지 않고,
`validateAuthoringProviderResult`가 통과시키는 단언 종류만 넓히면 된다.

### 11.2 CLI 보고서 렌더링

현재 `mcpeak test`는 `RunnerReport`를 `JSON.stringify`로 표준 출력에 덤프한다
(`test-command.ts`). 이 설계로 진단 품질이 올라가도 사용자가 보는 것은 여전히 JSON이다.
§7.2의 문장들이 사람에게 닿으려면 CLI 렌더링이 필요하다. 다음 웨이브 우선순위가 높다.

이 작업은 향후 repair의 선행 조건이기도 하다. 실패 케이스를 사용자가 선택해 AI에 보내려면
케이스를 읽고 고를 수 있는 화면이 있어야 한다.

### 11.3 `listTools`의 `inputSchema` 단언

`toolExists`는 이름만 확인하므로 서버가 필수 파라미터를 추가해도 통과한다. 증상은 `callTool`
테스트의 실패로 나타나며 원인 진단이 한 단계 늦는다.

메커니즘은 이 설계와 같다. `ToolDef.inputSchema`를 검사 대상 JSON 값으로 두고 `ResponseSchema`로
매칭한다. 다만 스키마로 스키마를 검사하는 형태라 작성 난이도가 높다. `inputSchema`의 `required`가
우리 스키마에서 `const` 값으로 등장해 읽기 어렵다. `required` 비교 같은 흔한 경우를 위한 전용
단언을 둘지 범용 매칭으로 갈지가 별도 결정이다.

### 11.4 프로토콜 오류의 기대 실패

MCP 서버가 `isError` 대신 JSON-RPC 오류를 던지는 경우 `callTool`이 reject되고, Runner는 이를
`OPERATION_FAILED`로 기록하며 단언을 전부 `skipped` 처리한다. 따라서 "잘못된 입력을 보내면
서버가 거부해야 한다"는 테스트를 작성할 수 없다.

단언을 확장해도 해결되지 않는다. 검사할 응답 본문이 없기 때문이다. operation 수준의 기대
선언(`expectFailure` 등)이 필요하며 이는 케이스 상태 판정 로직의 변경이다.

`isError`를 쓰는 서버는 이 설계로 충분히 덮인다. 문자열 메시지는 `stringContains`가,
구조화된 오류 JSON은 스키마 매칭이 담당하며 후자가 문구 변경에 더 강하다.

### 11.5 `structuredContent`

MCP 사양의 구조화 결과 필드다. `core`의 어댑터가 `content`만 꺼내므로 이 설계의 추출 규칙에
들어오지 않는다. `core`는 다른 오너 소관이라 제안만 가능하다. §11.1의 2번과 함께 다루면 좋다.

### 11.6 조합자와 `pattern`

필요해지면 추가하는 경로를 남긴다. `pattern`은 진단 모델을 바꾸지 않으므로 evaluator 분기,
문안, parity fixture를 더하면 되지만 §3.3의 ReDoS 대책을 함께 설계해야 한다. 조합자는 진단
모델 변경을 수반하므로 §7의 문장 생성을 재설계해야 한다.

## 12. 작업 분할

`packages/runner` 단일 패키지이며 의존이 직렬이라 병렬 실행은 불가능하다. worktree 1개에서
태스크 3개를 순차로 실행한다.

| 태스크 | 파일 | 모델 |
|---|---|---|
| T1 공개 계약 | `spec/types.ts`, `spec/json-schema.ts`, `spec/validation.ts`, parity fixture | 표준 |
| T2 추출과 평가 | `body.ts`, `schema-match.ts` | 표준 |
| T3 진단과 통합 | `diagnostics.ts`, `assertions.ts`, `executor.ts` | 상위 |

T3에 상위 모델을 쓰는 근거는 `CLAUDE.local.md`의 예외 기준이다. 계획서에 코드로 못 박기 어려운
판단이 필요한 태스크가 대상이며 첫 항목이 실패 메시지 문안 설계다. T1과 T2는 사양이 이 문서에
코드 수준으로 적혀 있으므로 표준 모델로 충분하다.

## 13. ADR

- `docs/adr/0010-응답-스키마-부분집합-경계.md`: §3.2, §3.3, §4.4
- `docs/adr/0011-응답-본문-추출-규칙.md`: §5.2

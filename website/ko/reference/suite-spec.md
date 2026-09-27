# 명세 형식

이 문서는 `mcpeak test` 가 읽는 JSON 명세의 모든 필드를 타입과 함께 정리한다. 어떻게 쓰는지는
[명세 작성](/ko/guide/writing-suites)에 있다.

## 스위트

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "날씨 서버",
  "approval": { "fingerprint": "…", "cases": [] },
  "defaultTimeoutMs": 10000,
  "cases": []
}
```

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `schemaVersion` | `1` | 예 | 명세 형식 버전. 다른 값은 `UNSUPPORTED_SCHEMA_VERSION` |
| `id` | string | 예 | 스위트 식별자 |
| `name` | string | 예 | 보고서 첫 줄에 찍힌다 |
| `approval` | object | 아니오 | `generate` 가 붙이는 승인 블록. 손으로 쓴 명세에는 없다 |
| `defaultTimeoutMs` | number | 아니오 | 케이스 기본 제한 시간. 없으면 10초 |
| `cases` | array | 예 | 하나 이상. 비어 있으면 `EMPTY_CASES` |

목록에 없는 필드는 `UNKNOWN_FIELD` 로 거절한다. 오타로 필드가 조용히 무시되는 것을 막는다.

### `approval`

| 필드 | 타입 | 뜻 |
|---|---|---|
| `fingerprint` | string | 승인 시점 명세의 요약. 소문자 hex 64자. 파싱된 객체에서 계산하므로 들여쓰기·키 순서에 영향받지 않는다. `approval` 자신은 계산에서 뺀다 |
| `cases[]` | `{ id, status }` | 시험 실행에서의 분류. `status` 는 `passed` 또는 `serverDefect` |

## 케이스

```json
{
  "id": "seoul-succeeds",
  "name": "서울 날씨를 정상 조회한다",
  "timeoutMs": 5000,
  "operation": { "type": "callTool", "tool": "get_weather", "input": { "city": "서울" } },
  "assertions": [{ "type": "isError", "expected": false }]
}
```

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `id` | string | 예 | 스위트 안에서 유일. 겹치면 `DUPLICATE_CASE_ID` |
| `name` | string | 예 | 보고서의 케이스 줄에 찍힌다 |
| `timeoutMs` | number | 아니오 | 이 케이스의 제한 시간. `defaultTimeoutMs` 보다 우선 |
| `operation` | object | 예 | 아래 둘 중 하나 |
| `assertions` | array | 예 | 하나 이상. 비어 있으면 `EMPTY_ASSERTIONS` |

## 작업

| `type` | 다른 필드 | 뜻 |
|---|---|---|
| `listTools` | 없음 | 서버의 `tools/list` 를 부른다 |
| `callTool` | `tool: string`, `input: object` | 툴을 그 입력으로 호출한다. `input` 은 JSON 객체여야 한다 |

## 단언

작업마다 쓸 수 있는 단언이 정해져 있다. 맞지 않으면 `INCOMPATIBLE_ASSERTION` 이다.

| `type` | 작업 | 다른 필드 | 뜻 |
|---|---|---|---|
| `toolExists` | `listTools` | `tool: string` | 그 이름의 툴이 목록에 있다 |
| `isError` | `callTool` | `expected: boolean` | 응답의 `isError` 가 그 값이다 |
| `bodyMatchesSchema` | `callTool` | `schema` | 응답 text 본문(JSON 이면 파싱한 값)이 스키마와 맞다 |
| `structuredContentMatchesSchema` | `callTool` | `schema` | 응답의 `structuredContent` 가 스키마와 맞다 |

## 응답 스키마

두 스키마 단언이 받는 JSON Schema 부분집합이다. 목록 밖 키워드는 `UNSUPPORTED_SCHEMA_KEYWORD`
로 거절한다.

| 키워드 | 타입 | 뜻 |
|---|---|---|
| `type` | `object` · `array` · `string` · `number` · `integer` · `boolean` · `null` | 값의 타입. 하나만 |
| `const` | JSON 값 | 정확히 이 값 |
| `enum` | JSON 값 배열 | 이 중 하나 |
| `required` | string[] | 있어야 하는 프로퍼티 |
| `properties` | 스키마 맵 | 프로퍼티별 스키마 |
| `additionalProperties` | boolean 또는 스키마 | `false` 면 `properties` 밖 필드를 거절 |
| `items` | 스키마 | 배열 원소의 스키마 |
| `minItems` | number | 배열 최소 길이 |
| `minLength` · `maxLength` | number | 문자열 길이 |
| `stringContains` | string | 문자열이 이 부분 문자열을 담는다. 표준 키워드가 아니다 |
| `minimum` · `maximum` | number | 숫자 범위 |

타입에 따라 의미가 있는 키워드는 그 `type` 을 함께 적어야 한다. `type` 없이 `minLength` 만 있으면
`SCHEMA_KEYWORD_REQUIRES_TYPE` 이다.

## 검증 오류

명세가 잘못되면 서버를 띄우기 전에 멈추고, 문제마다 코드 · 경로 · 메시지 · 힌트를 낸다.

| 코드 | 뜻 |
|---|---|
| `MISSING_REQUIRED_FIELD` | 필수 필드가 없다 |
| `UNKNOWN_FIELD` | 목록에 없는 필드가 있다 |
| `UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` 이 1 이 아니다 |
| `INVALID_TYPE` · `INVALID_VALUE` | 필드의 타입이나 값이 맞지 않는다 |
| `DUPLICATE_CASE_ID` | 케이스 `id` 가 겹친다 |
| `EMPTY_CASES` · `EMPTY_ASSERTIONS` | 배열이 비어 있다 |
| `INCOMPATIBLE_ASSERTION` | 작업과 맞지 않는 단언이다 |
| `INVALID_JSON_VALUE` | `input` 이나 `const` · `enum` 에 JSON 이 아닌 값이 있다 |
| `INVALID_TIMEOUT` | 제한 시간이 양의 정수가 아니다 |
| `UNSUPPORTED_SCHEMA_KEYWORD` | 응답 스키마에 지원하지 않는 키워드가 있다 |
| `SCHEMA_KEYWORD_REQUIRES_TYPE` | 키워드에 필요한 `type` 이 없다 |

## TypeScript 타입

`@mcpeak/runner` 가 같은 형식을 `TestSuiteSpec` 으로 내보낸다. `defineMcpSuite` 는 리터럴
타입을 유지하면서 검증하고, `validateMcpSuite` 는 외부 JSON 을 검증해 `{ valid, value }` 또는
`{ valid, issues }` 를 돌려준다.

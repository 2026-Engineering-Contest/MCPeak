# 입력 계약 대조와 단언 실질성 검사 설계 (2026-08-14)

- 담당 패키지: `runner`
- 작성자: @seodduu (runner 파트)
- 로드맵 단계 2
- 참조: ADR-0009(generate가 runner에 의존하는 예외), ADR-0010(응답 스키마 부분집합 경계)
- 신규 ADR 대상: 입력 스키마 부분집합 경계와 미지원 키워드 처리 (§11)

## 1. 배경

명세가 실패했을 때 사용자가 원인을 셋 중에서 고른다.

1. 서버가 고장났다
2. 명세가 서버 선언과 어긋난다
3. 명세는 맞는데 서버의 실제 동작이 다르다

지금은 셋이 구분되지 않는다. 서버가 이렇게 선언했다고 하자.

```json
{
  "name": "get_weather",
  "inputSchema": {
    "type": "object",
    "properties": { "city": { "type": "string" }, "units": { "enum": ["c", "f"] } },
    "required": ["city"]
  }
}
```

AI가 만든 케이스가 이렇다.

```json
{
  "id": "weather-ok",
  "operation": { "type": "callTool", "tool": "get_weather",
                 "input": { "citi": "서울", "units": "celsius" } },
  "assertions": [{ "type": "isError", "expected": false }]
}
```

오타 `citi`, 필수 `city` 누락, enum 밖 값 `celsius`. 셋 다 틀렸는데 현재 출력은 이렇다.

```
✗ weather-ok
  → isError false 를 기대했지만 true 를 받았습니다
```

서버를 의심하게 된다. 실제로는 2번이다.

`runner`가 이미 가진 검증은 명세의 **형식**만 본다(`validateMcpSuite`). 명세가 서버가 선언한
`inputSchema`를 지키는지는 아무도 안 본다. `runner` 전체를 통틀어 `ToolDef.inputSchema`를 읽는
코드가 한 줄도 없다.

두 번째 구멍은 통과가 보장된 케이스다.

```json
{ "type": "bodyMatchesSchema", "schema": { "minLength": 0 } }
{ "type": "bodyMatchesSchema", "schema": {} }
```

초록불을 켜지만 아무것도 검증하지 않는다. 커버리지 숫자만 올리고 신뢰를 준다.

이 문서는 **서버를 켜지 않고** 잡을 수 있는 위 둘을 다룬다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

1. 명세의 `callTool` 입력을 서버가 선언한 `inputSchema`와 대조해 어긋난 지점을 구조화된
   결과로 돌려준다. **서버 호출 0회.**
2. 통과가 보장된 단언을 찾아 같은 형태로 돌려준다.
3. 오탐을 내지 않는다. 서버 스키마를 우리가 해석하지 못하는 경우 위반이 아니라 **"판정 불가"**
   로 보고한다. 승인 화면에서 차단 근거로 쓰이므로 오탐 1건의 비용이 미탐 1건보다 크다.
4. 결과가 결정론적이다. 같은 `(suite, tools)` 쌍은 항상 같은 결과 배열을 같은 순서로 낸다.
5. 실패 문장을 `runner`가 소유한다. 소비자가 문안을 각자 지어내지 않는다.

### 비범위

- **값의 도메인 검사.** `{"city": "example"}`은 `city: string` 선언을 통과한다. 유효한 도시
  목록은 선언 어디에도 없다. 단계 3에서만 드러난다.
- **서버 실행.** 이 문서의 모든 함수는 순수 함수다.
- **소비자 배선.** `generate` 승인 화면과 `cli test` 출력에 붙이는 작업은 이 PR이 아니다.
  단계 3의 PR 2-B에서 한다. 근거는 CLAUDE.md의 "한 번에 한 패키지만 작업한다"이다.
- **단언 0개 케이스.** `validateMcpSuite`가 `EMPTY_ASSERTIONS`로 이미 잡는다
  (`packages/runner/src/spec/types.ts:71`). 로드맵이 이 항목을 단계 2에 넣어뒀는데 중복이므로
  뺀다.
- **`listTools` 케이스.** 입력이 없어서 대조할 계약이 없다. `toolExists` 단언은 항상 실질적이다.
- **`isError` 단언의 실질성.** 항상 실질적이다. 검사하지 않는다.

### 완료 조건

- `pnpm test`, `pnpm typecheck`, `pnpm lint` 전부 통과. 검사 파일 수가 출력에 0이 아님
- `packages/runner/tests/input-contract.test.ts`와 `assertion-substance.test.ts`의 §10 케이스가
  전부 통과
- 같은 `(suite, tools)`로 두 번 호출한 결과가 `JSON.stringify` 기준 동일 (§9.1 테스트)
- 미지원 JSON Schema 키워드가 포함된 툴에 대해 `REQUIRED_MISSING`·`TYPE_MISMATCH`·
  `UNDECLARED_FIELD`·`ENUM_MISMATCH`가 **한 건도** 나오지 않음 (§10.3 테스트)
- `packages/runner/src/index.ts`에서 §3.2의 심볼이 전부 export됨
- `core`, 다른 패키지, 루트 빌드 설정 변경 0건

## 3. 아키텍처

### 3.1 배치

```
packages/runner/src/
  input-contract.ts        신규   서버 inputSchema 정규화 + 입력 대조
  assertion-substance.ts   신규   단언 실질성 판정
  spec-findings.ts         신규   두 결과의 공통 타입과 문장 렌더링
  index.ts                 수정   export 추가만
```

세 파일로 나누는 이유. 입력 대조와 실질성 검사는 입력이 다르다(전자는 `tools`가 필요하고
후자는 명세만 있으면 된다). 한 함수로 묶으면 실질성만 쓰려는 소비자가 `tools`를 억지로
넘겨야 한다. 문장 렌더링을 셋째 파일로 빼는 것은 두 검사가 같은 출력 문법을 공유해야 하기
때문이다.

`runner`에 이미 `diagnostics.ts`가 있으나 그것은 실행 결과 진단이다. 이름이 겹치지 않게
`spec-findings.ts`로 둔다.

### 3.2 공개 계약 (전량)

여러 소비자가 동시에 의존하므로 전량으로 적는다.

```ts
// spec-findings.ts

/** 검사 한 건의 결과. 두 검사가 같은 모양을 쓴다. */
export interface SpecFinding {
  /** 무엇이 어긋났는지. 소비자가 분기하는 유일한 키다. */
  readonly code: SpecFindingCode;
  /** 지위. blocking은 승인 차단 근거, advisory는 참고. §6 참고. */
  readonly severity: "blocking" | "advisory";
  /** TestCaseSpec.id */
  readonly caseId: string;
  /**
   * 명세 안의 위치. 점 표기.
   *   "input.city"                       입력 필드
   *   "assertions[0].schema.minLength"   단언 안의 위치
   */
  readonly path: string;
  /** 선언에서 기대한 값. 없으면 생략한다. 가공하지 않은 원본이다. */
  readonly expected?: JsonValue;
  /** 명세에 적힌 값. 없으면 생략한다. 가공하지 않은 원본이다. */
  readonly actual?: JsonValue;
  /** 오타 후보 등 단일 제안. §5.4의 규칙으로 정해지며 없으면 생략한다. */
  readonly suggestion?: string;
}

export type SpecFindingCode =
  // 입력 계약 대조
  | "TOOL_NOT_DECLARED"      // 서버가 선언하지 않은 툴을 호출한다
  | "REQUIRED_MISSING"       // 선언된 required 필드가 입력에 없다
  | "UNDECLARED_FIELD"       // 선언에 없는 필드가 입력에 있다
  | "TYPE_MISMATCH"          // 선언된 type과 입력 값의 타입이 다르다
  | "ENUM_MISMATCH"          // 선언된 enum 밖의 값이다
  | "SCHEMA_NOT_ANALYZABLE"  // 서버 스키마를 해석하지 못했다. 위반이 아니다
  // 단언 실질성
  | "UNCONSTRAINED_SCHEMA"   // 제약이 하나도 없는 스키마
  | "VACUOUS_MIN_LENGTH"     // minLength: 0
  | "VACUOUS_MIN_ITEMS";     // minItems: 0

/** 한 케이스에서 목록에 담는 finding의 최대 개수. schema-match.ts의 선례를 따른다. */
export const MAX_FINDINGS_PER_CASE = 10;

export interface SpecFindingsResult {
  /** §9.2의 순서로 정렬돼 있다. */
  readonly findings: readonly SpecFinding[];
  /** MAX_FINDINGS_PER_CASE로 잘리기 전의 총 개수. */
  readonly totalFindings: number;
}

/**
 * finding 한 건을 사용자가 읽는 한 문장으로 만든다.
 * 문안은 §7에 전량으로 있다. 소비자는 이 함수만 쓰고 문장을 새로 짓지 않는다.
 * 반환에 줄바꿈이 없다. 들여쓰기와 화살표는 소비자가 붙인다.
 */
export function describeSpecFinding(finding: SpecFinding): string;
```

```ts
// input-contract.ts
import type { ToolDef } from "@ohmymcp/core";
import type { TestSuiteSpec } from "./spec/types.js";

export interface InputContractOptions {
  readonly suite: TestSuiteSpec;
  /** McpClient.listTools()의 결과를 그대로 넘긴다. 순서는 결과에 영향을 주지 않는다. */
  readonly tools: readonly ToolDef[];
}

/**
 * 명세의 callTool 입력을 서버가 선언한 inputSchema와 대조한다. 서버를 호출하지 않는다.
 * 해석하지 못하는 스키마는 SCHEMA_NOT_ANALYZABLE 하나만 내고 그 툴의 다른 검사를 전부 건너뛴다.
 */
export function checkInputContract(options: InputContractOptions): SpecFindingsResult;
```

```ts
// assertion-substance.ts
import type { TestSuiteSpec } from "./spec/types.js";

/**
 * 통과가 보장된 단언을 찾는다. 명세만 보고 판정하며 서버도 tools도 필요하지 않다.
 */
export function checkAssertionSubstance(suite: TestSuiteSpec): SpecFindingsResult;
```

### 3.3 의존 방향

`runner` → `core`뿐이다. `ToolDef`는 `@ohmymcp/core`에서 가져온다. `McpClient`와 `ToolResult`는
쓰지 않으므로 동결 인터페이스에 저촉되지 않는다. 역참조와 순환은 생기지 않는다.

## 4. 서버 inputSchema를 어디까지 해석하는가

이 절이 이 설계의 핵심이다.

### 4.1 문제

우리 `ResponseSchema`는 우리가 정한 부분집합이다(ADR-0010). 반면 `ToolDef.inputSchema`는
타입이 `unknown`이고 **남의 서버가 쓴 임의의 JSON Schema**다. `anyOf`, `$ref`,
`patternProperties`, `if`/`then`, `dependentRequired` 같은 것이 얼마든지 올 수 있다.

여기서 오탐이 나는 경로가 명확하다. 서버가 이렇게 선언했다고 하자.

```json
{
  "type": "object",
  "properties": { "city": { "type": "string" } },
  "anyOf": [
    { "required": ["city"] },
    { "required": ["lat", "lon"] }
  ]
}
```

`anyOf`를 무시하고 `properties`만 보면 `{ "lat": 37.5, "lon": 127 }`이 `UNDECLARED_FIELD` 2건에
`REQUIRED_MISSING` 0건으로 잡힌다. **명세가 맞는데 승인이 차단된다.** 목표 3을 정면으로 어긴다.

### 4.2 규칙: 모르면 전부 침묵한다

정규화 단계를 둔다. 스키마를 우리가 이해하는 구조로 줄이되, **줄이는 과정에서 정보를 잃으면
그 부분의 검사를 포기한다.**

**루트 차단 키워드.** 아래가 스키마 루트에 하나라도 있으면 그 툴은 해석 불가로 처리한다.
`SCHEMA_NOT_ANALYZABLE` 한 건만 내고 그 툴을 쓰는 모든 케이스의 입력 검사를 건너뛴다.

```
anyOf  oneOf  allOf  not  if  then  else  $ref  $dynamicRef
patternProperties  dependentSchemas  dependentRequired  propertyNames  unevaluatedProperties
```

**루트가 객체가 아닌 경우.** `type`이 `"object"`가 아니거나 `properties`가 없거나 스키마가
객체가 아니면 역시 해석 불가다. MCP의 툴 입력은 객체지만 서버가 다르게 선언할 자유가 있다.

**필드 단위 포기.** 개별 필드의 스키마에 위 키워드가 있으면 **그 필드만** 타입·enum 검사를
건너뛴다. 나머지 필드와 `required` 검사는 계속한다. 필드 하나 때문에 툴 전체를 포기하면
미탐이 과해진다.

**`additionalProperties`.** 값이 `false`일 때만 `UNDECLARED_FIELD`를 낸다. 값이 없거나 `true`
이거나 스키마 객체이면 선언에 없는 필드를 내는 것이 허용되므로 검사하지 않는다. JSON Schema의
기본값이 "허용"이기 때문이다. 여기서 기본값을 반대로 잡으면 오탐이 대량으로 난다.

### 4.3 정규화 타입 (전량)

```ts
type DeclaredType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

interface NormalizedField {
  /** 선언된 타입. 판정하지 않기로 한 필드는 null이다. */
  readonly type: DeclaredType | null;
  /** 선언된 enum. 없거나 판정하지 않기로 했으면 null이다. */
  readonly enumValues: readonly JsonValue[] | null;
}

interface NormalizedInputSchema {
  readonly fields: ReadonlyMap<string, NormalizedField>;
  readonly required: readonly string[];
  /** additionalProperties가 정확히 false일 때만 true. */
  readonly rejectsUndeclared: boolean;
}

/** 해석 불가면 null을 반환한다. 부분 성공은 없다. */
function normalizeInputSchema(schema: unknown): NormalizedInputSchema | null;
```

`type`이 배열인 경우(`"type": ["string", "null"]`)는 필드 포기로 처리한다(`type: null`).
합집합 타입을 정확히 다루려면 검사 규칙이 커지는데, 얻는 값이 작다.

## 5. 검사 규칙

### 5.1 툴 존재

케이스의 `operation.tool`이 `tools`에 없으면 `TOOL_NOT_DECLARED`, `severity: "blocking"`.
그 케이스의 나머지 입력 검사는 건너뛴다. 대조할 계약이 없기 때문이다.

`generate`의 기존 `knownTools` 검사와 겹치지만 여기서도 낸다. `runner`의 함수가 단독으로
호출됐을 때 조용히 통과시키면 안 된다.

### 5.2 필수 필드

`required`의 각 이름이 `operation.input`의 키에 없으면 `REQUIRED_MISSING`, `blocking`.
`expected`에 필드 이름을 넣는다. 오타 후보가 있으면 `suggestion`에 넣는다(§5.4).

### 5.3 선언에 없는 필드

`rejectsUndeclared`가 참일 때만 검사한다. `operation.input`의 키 중 `fields`에 없는 것마다
`UNDECLARED_FIELD`, `blocking`.

### 5.4 오타 후보 (결정론 규칙)

`REQUIRED_MISSING`과 `UNDECLARED_FIELD`에 후보를 하나만 붙인다.

1. 후보군은 반대편 이름 집합이다. `REQUIRED_MISSING`이면 입력에 있는데 선언에 없는 키들,
   `UNDECLARED_FIELD`면 선언에 있는데 입력에 없는 키들
2. 레벤슈타인 거리를 계산한다
3. 거리가 `2` 이하이고 동시에 `floor(긴 쪽 길이 / 2)` 이하인 것만 남긴다
4. 남은 것 중 거리가 가장 작은 것을 고른다
5. 거리가 같으면 UTF-16 코드 단위 오름차순으로 앞선 것을 고른다
   (`schema-match.ts:43`의 `byCodeUnit`과 같은 기준)
6. 남은 것이 없으면 `suggestion`을 생략한다

3번의 두 번째 조건이 필요한 이유. 거리 2만 쓰면 `id`와 `at` 같은 짧은 이름이 서로 후보가 된다.
5번이 없으면 후보 둘의 거리가 같을 때 `Object.keys` 순서에 결과가 달라져 결정론이 깨진다.

### 5.5 타입

필드의 `type`이 null이 아니고 입력 값의 타입이 다르면 `TYPE_MISMATCH`, `blocking`.

타입 이름은 `schema-match.ts:39`의 `typeName`을 재사용한다. 두 벌을 두면 `null`과 배열 판정이
갈라진다.

`integer` 판정만 따로 둔다. `typeName`은 `number`를 반환하므로, 선언이 `integer`인데 값이
`Number.isInteger`를 만족하지 않을 때만 위반이다. 선언이 `number`이고 값이 정수인 것은 위반이
아니다.

### 5.6 enum

필드의 `enumValues`가 null이 아니고 입력 값이 그중 어느 것과도 같지 않으면 `ENUM_MISMATCH`,
`blocking`. 비교는 `schema-match.ts`의 `jsonEqual`을 재사용한다. `expected`에 enum 배열 전체를,
`actual`에 입력 값을 넣는다.

문자열 enum이고 후보와의 거리가 §5.4 규칙을 만족하면 `suggestion`을 붙인다.

### 5.7 단언 실질성

`bodyMatchesSchema` 단언만 대상이다.

**`UNCONSTRAINED_SCHEMA`** (`advisory`): 스키마에 아래 중 **하나도** 없을 때.

```
type  const  enum  required(길이 1 이상)  properties(키 1개 이상)  items
minItems(1 이상)  minLength(1 이상)  maxLength  stringContains
minimum  maximum  additionalProperties가 false
```

`type`만 있는 스키마는 실질적이다. 응답이 배열인지 객체인지 확인하는 것은 진짜 검증이다.
`required: []`와 `properties: {}`는 제약으로 세지 않는다. 아무것도 요구하지 않기 때문이다.

**`VACUOUS_MIN_LENGTH`** (`advisory`): `minLength`가 정확히 `0`. 모든 문자열이 통과한다.

**`VACUOUS_MIN_ITEMS`** (`advisory`): `minItems`가 정확히 `0`. 모든 배열이 통과한다.

두 경우 모두 다른 제약이 함께 있으면 스키마 전체는 실질적일 수 있다. 그래도 해당 키워드
자체는 무의미하므로 `path`를 그 키워드로 찍어 낸다. `UNCONSTRAINED_SCHEMA`와 동시에 나지는
않는다. `minLength: 0`이 있어도 제약으로 안 세므로 다른 제약이 없으면
`UNCONSTRAINED_SCHEMA`만 나고, 다른 제약이 있으면 `VACUOUS_MIN_LENGTH`만 난다.

중첩 스키마(`properties.*`, `items`)도 순회한다. `path`는 `assertions[0].schema.properties.temp`
처럼 전체 경로를 적는다.

## 6. 결과의 지위: 누가 차단하고 누가 참고만 하는가

`runner`는 판정하지 않는다. `severity`를 붙여서 돌려줄 뿐이고 해석은 소비자가 한다. 이 문서는
소비자가 그것을 어떻게 쓸지까지 정해두되 배선은 하지 않는다(§2 비범위).

| 소비자 | blocking | advisory |
|---|---|---|
| `generate` 승인 화면 | 케이스에 경고를 달고 사용자가 승인 여부 판단 | 같은 자리에 낮은 강조로 표시 |
| `cli test` 실행 | 실패한 케이스에만 참고 문장 추가. 통과·실패 판정은 안 바꿈 | 표시하지 않음 |

`test`에서 비차단인 이유. 서버가 `inputSchema`를 느슨하게 선언해놓고 실제로는 더 받아주는
경우가 있다. 그것을 실패로 만들면 멀쩡한 테스트가 깨진다. 그리고 판정을 바꾸면 `runner`
설계의 결정론 계약(같은 스위트 두 번 실행 시 `RunnerReport` deep equality)에 새 입력이
끼어든다. `tools`는 서버가 언제든 바꿀 수 있으므로 보고서를 오염시킨다.

`SCHEMA_NOT_ANALYZABLE`은 `advisory`다. 위반이 아니라 우리 한계의 고백이다.

## 7. 문장 (전량)

실패 메시지가 곧 제품이다. `describeSpecFinding`이 반환하는 문장을 전량으로 고정한다.
`{}`는 치환 지점이다.

```
TOOL_NOT_DECLARED
  서버가 선언하지 않은 툴입니다: {actual}
  (suggestion 있으면) 서버가 선언하지 않은 툴입니다: {actual}. 비슷한 툴: {suggestion}

REQUIRED_MISSING
  필수 필드 {expected} 가 입력에 없습니다
  (suggestion 있으면) 필수 필드 {expected} 가 입력에 없습니다. 비슷한 필드: {suggestion}

UNDECLARED_FIELD
  {actual} 는 서버가 선언하지 않은 필드입니다
  (suggestion 있으면) {actual} 는 서버가 선언하지 않은 필드입니다. 비슷한 필드: {suggestion}

TYPE_MISMATCH
  {path} 의 타입이 다릅니다. 선언: {expected}, 명세: {actual}

ENUM_MISMATCH
  {path} 값 {actual} 는 선언된 값이 아닙니다. 허용: {expected}
  (suggestion 있으면) ... 허용: {expected}. 비슷한 값: {suggestion}

SCHEMA_NOT_ANALYZABLE
  {actual} 의 입력 스키마를 해석하지 못해 이 툴의 입력 검사를 건너뜁니다

UNCONSTRAINED_SCHEMA
  {path} 스키마에 제약이 없어 어떤 응답이든 통과합니다

VACUOUS_MIN_LENGTH
  {path} 는 0이라 모든 문자열이 통과합니다

VACUOUS_MIN_ITEMS
  {path} 는 0이라 모든 배열이 통과합니다
```

치환 규칙은 하나뿐이다. **문자열이면 작은따옴표로 감싸고, 그 외 JSON 값이면
`JSON.stringify` 결과를 그대로 쓴다.** `suggestion` 은 언제나 문자열이므로 항상 작은따옴표가
붙는다. 위 템플릿에 따옴표를 직접 적지 않은 이유가 이것이다. 두 군데에서 따옴표를 붙이면
문자열에 따옴표가 두 번 감긴다.

문자열 안의 제어 문자는 이스케이프한다. 툴 이름 · 필드 이름 · enum 값 · 스키마 프로퍼티
이름은 모두 남의 서버나 남이 쓴 명세에서 오므로 개행이 들어 있을 수 있다. 그대로 넣으면
"반환에 줄바꿈이 없다" 는 계약이 깨진다. `path` 에도 같은 규칙을 적용한다.

그래서 `enum` 배열은 `JSON.stringify` 결과인 `["c","f"]` 로 찍힌다(공백 없음).
`TYPE_MISMATCH` 의 `expected` 와 `actual` 은 타입 이름 문자열이므로 작은따옴표가 붙어
`선언: 'string', 명세: 'number'` 가 된다.

문장에 "어떻게 고치는지"를 넣지 않은 항목이 있는 이유. 고치는 방법이 상황에 따라 갈린다.
명세를 고칠 수도 있고 서버 선언을 고칠 수도 있다. 그 안내는 소비자가 자기 맥락에서 덧붙인다.
`generate` 승인 화면은 "명세를 고치세요", `cli test`는 "스키마 변경이 의도된 것이라면 테스트를
업데이트하세요"가 맞는 문장이다.

## 8. 소비자가 보게 될 모습 (참고, 이 PR 비범위)

`generate` 승인 화면:

```
⚠ weather-ok  입력이 서버 선언과 어긋납니다
  → 필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'
  → input.units 값 'celsius' 는 선언된 값이 아닙니다. 허용: ["c","f"]
```

`units` 쪽에는 `비슷한 값` 이 붙지 않는다. `"celsius"` 와 `"c"` 는 편집 거리가 6 이라
§5.4 의 거리 2 조건에서 탈락하고, 통과하더라도 `floor(7 / 2) = 3` 조건에 다시 걸린다.
한 글자짜리 enum 값은 구조적으로 후보가 될 수 없다. `suggestion` 이 붙는 것은
`enum: ["celsius", "fahrenheit"]` 에 `"celcius"` 를 넣은 것 같은 경우다.

`cli test`의 실패 케이스 뒤:

```
✗ weather-ok
  → isError false 를 기대했지만 true 를 받았습니다

  참고: 이 케이스의 입력이 서버 선언과 어긋납니다
  → 필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'
```

## 9. 결정론성

### 9.1 계약

같은 `(suite, tools)`에 대해 `checkInputContract`가 항상 같은 배열을 낸다. `tools` 배열의
순서가 달라도 결과가 같다. 내부에서 이름으로 조회하는 맵을 만들고 배열 순서를 안 쓴다.

시간·난수·환경 변수·로캘에 의존하지 않는다. 문자열 비교는 전부 UTF-16 코드 단위다.

### 9.2 정렬 순서

`findings`는 아래 순서로 정렬한다.

1. `suite.cases`에서의 케이스 인덱스 오름차순
2. 같은 케이스 안에서는 검사 종류 순서: `TOOL_NOT_DECLARED` → `SCHEMA_NOT_ANALYZABLE` →
   `REQUIRED_MISSING` → `UNDECLARED_FIELD` → `TYPE_MISMATCH` → `ENUM_MISMATCH`
3. 같은 종류 안에서는 `path`의 UTF-16 코드 단위 오름차순

`Object.keys` 순회 순서에 기대지 않는다. 키를 모아 정렬한 뒤 순회한다.

### 9.3 스택 안전

중첩 스키마를 순회할 때 **재귀를 쓰지 않는다.** `schema-match.ts:125` 의 `frames` 패턴대로
명시적 스택과 `while` 루프로 돈다.

`validateMcpSuite` 에는 스키마 깊이 제한이 없다. 깊이 20000 짜리 중첩 `properties` 를 가진
명세가 `valid: true` 로 통과한다. 그것을 `matchResponseSchema` 는 처리하는데 여기서 재귀를
쓰면 `RangeError: Maximum call stack size exceeded` 로 죽는다. 같은 명세를 한쪽은 처리하고
한쪽은 못 하는 비대칭이 생긴다.

`tests/deep-and-cyclic-input.test.ts` 가 이 계약의 기존 회귀 테스트다. 파일 이름의
"결함 1" · "결함 2" 가 가리키듯 과거에 실제로 밟은 문제다.

### 9.4 상한

한 케이스에서 `MAX_FINDINGS_PER_CASE`(10)를 넘으면 자르고 `totalFindings`에는 자르기 전 총합을
센다. `schema-match.ts`의 `MAX_SCHEMA_VIOLATIONS`와 같은 값이고 같은 이유다. 상한을 넘은 사실을
소비자가 알 수 있어야 하므로 개수를 숨기지 않는다.

## 10. 테스트

전부 인메모리다. 서버를 띄우지 않고 픽스처 파일도 만들지 않는다. 스위트와 `ToolDef` 배열을
테스트 안에서 리터럴로 만든다. 터미널 병렬 실행에 안전하다.

### 10.1 `packages/runner/tests/input-contract.test.ts` (신규)

```
checkInputContract
  · 선언과 완전히 일치하는 입력은 finding 0건
  · 선언되지 않은 툴을 호출하면 TOOL_NOT_DECLARED 1건, 그 케이스의 다른 finding은 0건
  · required 필드가 없으면 REQUIRED_MISSING
  · required가 없고 입력에 오타 후보가 있으면 suggestion에 그 이름이 들어간다
  · additionalProperties: false 이고 선언에 없는 필드가 있으면 UNDECLARED_FIELD
  · additionalProperties가 없으면 선언에 없는 필드가 있어도 finding 0건
  · additionalProperties: true 이면 선언에 없는 필드가 있어도 finding 0건
  · 선언 type이 string인데 숫자를 넣으면 TYPE_MISMATCH, expected "string", actual "number"
  · 선언 type이 integer인데 1.5를 넣으면 TYPE_MISMATCH
  · 선언 type이 integer인데 2를 넣으면 finding 0건
  · 선언 type이 number인데 2를 넣으면 finding 0건
  · 선언 type이 array인데 객체를 넣으면 TYPE_MISMATCH, actual "object"
  · null을 넣고 선언이 string이면 TYPE_MISMATCH, actual "null"
  · enum 밖 값이면 ENUM_MISMATCH, expected에 enum 배열 전체
  · enum 안 값이면 finding 0건
  · type이 ["string","null"] 이면 그 필드의 타입 검사를 건너뛴다 (finding 0건)
  · 케이스가 listTools면 입력 검사를 하지 않는다

오타 후보 규칙
  · 'citi' 와 'city' 는 거리 1이라 후보가 된다
  · 'id' 와 'at' 는 거리 2지만 길이 절반 조건에 걸려 후보가 아니다
  · 거리가 같은 후보가 둘이면 UTF-16 코드 단위로 앞선 것을 고른다
  · 후보가 없으면 suggestion 키가 아예 없다

상한
  · 한 케이스에서 위반 12건이면 findings는 10건, totalFindings는 12
```

### 10.2 `packages/runner/tests/assertion-substance.test.ts` (신규)

```
checkAssertionSubstance
  · schema {} 는 UNCONSTRAINED_SCHEMA
  · schema { type: "array" } 는 finding 0건
  · schema { required: [] } 는 UNCONSTRAINED_SCHEMA
  · schema { properties: {} } 는 UNCONSTRAINED_SCHEMA
  · schema { minLength: 0 } 는 UNCONSTRAINED_SCHEMA 만, VACUOUS_MIN_LENGTH 는 안 난다
  · schema { type: "string", minLength: 0 } 는 VACUOUS_MIN_LENGTH 만 난다
  · schema { type: "array", minItems: 0 } 는 VACUOUS_MIN_ITEMS
  · schema { type: "array", minItems: 1 } 는 finding 0건
  · schema { additionalProperties: false } 는 finding 0건
  · 중첩 properties 안의 빈 스키마도 잡고 path 가 assertions[0].schema.properties.temp 다
  · items 안의 빈 스키마도 잡는다
  · isError 단언만 있는 케이스는 finding 0건
  · toolExists 단언만 있는 케이스는 finding 0건
  · 모든 finding 의 severity 가 "advisory"
```

### 10.3 미지원 키워드 (오탐 방지, 완료 조건에 걸림)

```
해석 불가 처리
  · 루트에 anyOf 가 있으면 SCHEMA_NOT_ANALYZABLE 1건만 나고 다른 코드는 0건
  · oneOf · allOf · not · if · $ref · patternProperties · dependentRequired 각각 같음
  · 루트 type 이 "object" 가 아니면 SCHEMA_NOT_ANALYZABLE
  · properties 가 없으면 SCHEMA_NOT_ANALYZABLE
  · inputSchema 가 null 이나 문자열이면 SCHEMA_NOT_ANALYZABLE
  · SCHEMA_NOT_ANALYZABLE 의 severity 는 "advisory"
  · 필드 하나에만 anyOf 가 있으면 그 필드만 건너뛰고 다른 필드의 REQUIRED_MISSING 은 난다
  · §4.1 의 anyOf 예시 스키마에 { lat, lon } 입력을 주면 finding 이 SCHEMA_NOT_ANALYZABLE
    1건뿐이다 (UNDECLARED_FIELD 가 나면 실패)
```

### 10.4 결정론성

```
· 같은 (suite, tools) 로 2회 호출한 결과가 JSON.stringify 기준 동일
· tools 배열 순서를 뒤집어도 결과가 동일
· 케이스 3개 각각에 위반이 있으면 findings 가 케이스 인덱스 순으로 정렬돼 있다
· 한 케이스 안에서 REQUIRED_MISSING 이 TYPE_MISMATCH 보다 앞에 온다
· path 가 다른 같은 코드의 finding 이 UTF-16 코드 단위 순으로 정렬돼 있다
```

### 10.5 문장

```
describeSpecFinding
  · 9개 코드 각각이 §7 의 문장과 정확히 일치한다
  · suggestion 이 있을 때와 없을 때 문장이 다르다
  · 반환 문자열에 개행이 없다
  · 문자열 expected 는 작은따옴표로 감싸이고 배열 expected 는 JSON 표기다
```

### 10.6 회귀

```
· pnpm test packages/runner 전체 통과
· 기존 spec-validation.test.ts · schema-match.test.ts 단언 변경 0건
```

표적 검증: `pnpm test packages/runner`
전체 회귀: `pnpm test`, `pnpm typecheck`, `pnpm lint`

## 11. ADR

**신규 ADR 대상: 입력 스키마 부분집합 경계와 미지원 키워드 처리.**

다르게 갈 수 있었던 판단이다. 선택지가 셋이었다.

- A안: 미지원 키워드를 무시하고 아는 것만 검사한다. 구현이 가장 쉽지만 §4.1의 오탐이 난다
- B안: 완전한 JSON Schema 검증기를 넣는다. 정확하지만 새 런타임 의존성이 필요하고
  (CLAUDE.md상 임의 추가 금지), 우리가 통제하지 못하는 코드가 승인 차단 권한을 갖는다
- C안: 해석 가능한 부분집합만 검사하고 나머지는 침묵한다. 미탐이 생기지만 오탐이 0이다

C안을 택한다. 승인 화면에서 차단 근거로 쓰이므로 오탐 1건이 미탐 1건보다 비싸다. 오탐은
사용자가 맞는 명세를 의심하게 만들고 도구 자체의 신뢰를 깎는다.

ADR-0010(응답 스키마 부분집합)과 뿌리가 같지만 대상이 다르다. 응답 스키마는 **우리가 정의하고
사용자가 쓰는** 것이고, 입력 스키마는 **남의 서버가 쓰고 우리가 읽기만 하는** 것이다. 전자는
지원 범위를 우리가 정하면 끝이지만 후자는 못 읽는 경우의 행동을 정해야 한다. 별도 ADR로 남긴다.

## 12. 거짓 신호

CLAUDE.local.md의 표에서 이 작업에 해당하는 항목.

| 거짓 신호 | 이 작업에서의 모습 | 진실 기준 |
|---|---|---|
| 타입체크·린트 녹색 | 새 파일이 `index.ts`에서 export 안 돼 빌드 대상에서 빠짐 | export 문 확인, 검사 파일 수 확인 |
| 유닛테스트 녹색 | 리터럴 스키마만 검증. 실제 서버 선언은 훨씬 지저분함 | §10.3의 미지원 키워드 케이스 |
| 결함이 계속 재현 | `runner` 빌드 산출물이 낡음 | `pnpm build` 후 재확인 |

추가로 이 작업 고유의 것 하나.

| 거짓 신호 | 원인 | 진실 기준 |
|---|---|---|
| finding 0건이라 명세가 깨끗해 보임 | 스키마가 해석 불가라 전부 건너뛴 것 | `SCHEMA_NOT_ANALYZABLE` 개수를 따로 본다 |

이것 때문에 `SCHEMA_NOT_ANALYZABLE`을 조용히 삼키지 않고 finding으로 낸다. 소비자가 "검사했는데
깨끗함"과 "검사를 못 했음"을 구분할 수 있어야 한다.

## 13. 소유권과 PR

- 수정 대상: `packages/runner` 만
- 신규 파일 3개, 수정 파일 1개(`index.ts`, export 추가만)
- `core/src/types.ts` 변경 없음. `ToolDef`를 읽기만 한다
- 다른 패키지 변경 없음. 소비자 배선은 단계 3의 PR 2-B
- 커밋: `feat(runner): 입력 계약 대조와 단언 실질성 검사 추가`

## 14. 후속 연동

- 단계 3 PR 2-B가 `generate` 승인 화면과 `cli test`에 붙인다. 그때 §8의 화면이 실제가 된다
- 단계 5(커버리지 축)가 `normalizeInputSchema`를 재사용한다. 빠진 축을 선언에서 도출하는 일이
  같은 정규화를 필요로 한다. 그래서 `NormalizedInputSchema`를 내부 타입으로 두되 구조를 단순하게
  유지한다
- 단계 6(동적 입력 계약 검사)이 이 검사의 반대편이다. 여기서는 명세가 선언을 지키는지 보고,
  거기서는 일부러 어긴 입력을 서버가 거절하는지 본다

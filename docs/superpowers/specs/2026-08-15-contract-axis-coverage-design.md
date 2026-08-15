# 계약 축 커버리지와 동적 입력 계약 검사 설계 (2026-08-15)

- 담당 패키지: `runner`, `generate`, `cli`
- 작성자: @seodduu (runner·generate 파트)
- 로드맵 단계 5(커버리지 축) + 단계 6(동적 입력 계약 검사)
- 참조: ADR-0009(generate가 runner에 의존하는 예외), ADR-0015(입력 스키마 부분집합 경계),
  ADR-0018(입력 계약 대조 소비자 배선),
  `docs/superpowers/specs/2026-08-14-input-contract-check-design.md`
- 신규 ADR 대상 2건: 거절 기대 케이스의 입력 계약 대조 제외(§11.1), 위반 케이스 생성 정책(§11.2)

## 1. 배경

서버가 `get_weather` 를 이렇게 선언한다(`fixtures/tools-list.sample.json`).

```json
{
  "name": "get_weather",
  "inputSchema": {
    "type": "object",
    "properties": { "city": { "type": "string" } },
    "required": ["city"]
  }
}
```

지금 `generate` 가 만드는 명세는 툴당 케이스 하나다(`packages/generate/src/render.ts:62`).

```json
{
  "id": "get-weather-success",
  "operation": { "type": "callTool", "tool": "get_weather", "input": { "city": "example" } },
  "assertions": [{ "type": "isError", "expected": false }]
}
```

정상 경로만 본다. 서버가 스스로 `city` 를 필수로 선언했는데, `city` 를 빼고 불렀을 때 거절하는지는
아무도 확인하지 않는다. 서버 핸들러에 입력 검증이 없으면 이런 응답이 나간다.

```
undefined의 날씨: 맑음
```

오류도 아니고 정상 응답이다. 현재 도구는 이 결함을 **구조적으로** 못 찾는다. 그런 케이스를 만들지
않기 때문이다. 그리고 못 찾는다는 사실조차 화면에 나타나지 않는다. 명세가 전부 초록이므로
사용자는 검증을 다 받은 것으로 읽는다.

이 문서가 두 구멍을 함께 닫는다.

- **단계 5**: 서버 선언에서 "확인해야 할 축" 을 도출하고, 명세가 덮지 않은 축을 **미검증**으로
  보여준다. 없음이 아니라 미검증이다. 통과도 실패도 아닌 세 번째 상태를 화면에 만든다.
- **단계 6**: 그 축을 실제 케이스로 채운다. 선언을 일부러 어긴 입력을 보내 서버가 거절하는지 본다.

두 단계를 한 문서로 묶는 이유는 시작점이 하나이기 때문이다. 서버 선언을 읽어 "이 툴에는 확인할
축이 셋 있다" 를 도출하는 코드가 같다. 나누면 화면이 "축 3개" 라고 말하는데 생성기는 2개만 만드는
상태가 생긴다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

1. 서버가 선언한 `inputSchema` 에서 검증해야 할 축 목록을 도출한다. 서버 호출 0회.
2. 명세가 그 축을 덮는지 판정하고, 덮지 않은 축을 미검증으로 보고한다.
3. 규칙 기반 생성이 위반 케이스를 **기본으로** 만든다. 별도 옵션을 켜지 않아도 나온다.
4. 생성에 개수 상한을 두지 않는다. 도구가 스스로 커버리지 구멍을 만들지 않는다.
5. 위반 케이스가 단계 2 의 입력 계약 대조에서 위반으로 신고되지 않는다.
6. 결과가 결정론적이다. 같은 `(tools)` 는 항상 같은 케이스를 같은 순서로 만든다.

### 비범위

- **`UNDECLARED_INJECTED` 축.** `additionalProperties: false` 인 툴에 선언 없는 필드를 넣어 보는
  축이다. `generate` 의 `validateSchema` 가 `additionalProperties` 를 허용 키워드로 갖고 있지
  않아(`packages/generate/src/schema.ts:37`) 그런 툴은 생성 경로에 아예 들어오지 못하고
  `UNSUPPORTED_SCHEMA` 로 실패한다. 축만 만들고 케이스를 못 만들면 영구 미검증 한 줄이 남는다.
  선행 작업은 `generate` 의 허용 키워드 확대이고 이 문서 밖이다.
- **값의 도메인.** `{"city": "example"}` 이 유효한 도시인지는 선언에 없다. 단계 3 에서만 드러난다.
- **응답 본문 검사.** 위반 케이스의 단언은 `isError: true` 하나다. 오류 메시지 문구를 단언하지
  않는다. MCP 규격에 오류 본문 형식이 없어 서버마다 다르다.
- **`test` 실행 화면.** 커버리지는 `generate` 시점에만 보여준다. `test` 경로와 `--json` 은
  손대지 않는다.
- **dry run 승인 게이트.** 단계 3 이다. 이 문서의 케이스는 사용자 승인을 받되 실행되지는 않는다.
- **기존 케이스 이름 형식의 조사 문제.** §6.3 에 적는다.

### 완료 조건

- `pnpm test`, `pnpm typecheck`, `pnpm lint` 전부 통과. 검사 파일 수가 출력에서 0이 아님
- `deriveContractAxes` 가 §4.2 의 축을 §4.4 순서로 낸다(§10.1 테스트)
- `fixtures/tools-list.sample.json` 의 두 툴로 만든 baseline 이 케이스 8개이고 §5.5 의 id·입력·
  단언과 정확히 일치함(§10.2 테스트)
- 같은 `tools` 로 두 번 생성한 결과가 `JSON.stringify` 기준 동일(§8.1 테스트)
- 생성한 위반 케이스를 `checkInputContract` 에 넣으면 `REQUIRED_MISSING`·`TYPE_MISMATCH`·
  `ENUM_MISMATCH` 가 **한 건도** 안 나옴(§10.3 테스트, 이것이 §11.1 의 완료 조건이다)
- 같은 위반 케이스로 `computeCoverage` 를 돌리면 `verified === total` 임(§10.4 테스트). 위 조건과
  이 조건이 동시에 참이어야 §11.1 의 침묵과 §6.2 의 판정이 서로를 무효화하지 않는다는 것이
  증명된다. 둘 중 하나만 보면 놓친다
- `packages/cli/tests/generate-integration.test.ts` 의 실서버 E2E 가 갱신된 기대값으로 통과
- `docs/adr/0009-...` 의 승인 심볼 표와 `dependency-boundary.test.ts` 의
  `APPROVED_RUNNER_SYMBOLS` 가 일치
- `core` 변경 0건. `McpClient`·`ToolResult` 변경 0건

## 3. 아키텍처

### 3.1 배치

```
packages/runner/src/
  contract-axes.ts     신규   서버 inputSchema -> 축 목록 도출, 케이스 -> 덮는 축 판정
  input-contract.ts    수정   거절 기대 케이스 제외 규칙 (§11.1)
  index.ts             수정   export 추가

packages/generate/src/
  violation-cases.ts   신규   축 -> 위반 케이스 합성
  coverage.ts          신규   명세와 축을 대조해 커버리지 계산
  render.ts            수정   buildSuite 가 위반 케이스를 함께 만든다, 케이스 타입 확장
  baseline.ts          수정   POLICY_VERSION 승격, 커버리지를 결과에 싣는다
  filename.ts          수정   fieldSlug 추가 (§5.4)
  index.ts             수정   export 추가

packages/cli/src/
  generate-command.ts  수정   커버리지 블록 출력
```

축 도출을 `runner` 에 두는 이유가 둘이다.

첫째, 정규화를 한 벌로 유지한다. `input-contract.ts:83` 의 `normalizeInputSchema` 가 이미
`required`·필드 `type`·`enum`·차단 키워드를 정규화한다. 축 도출이 필요한 것이 정확히 이 구조체다.
두 벌이 되면 단계 2 가 "이 툴 스키마는 해석 못 했다" 며 침묵하는데 단계 5 가 "축 3개 미검증" 이라고
세는 상태가 만들어진다. 같은 화면 두 줄이 서로를 부정한다.

둘째, `generate` 의 파서로는 이 일을 할 수 없다. `validateSchema` 는 허용 키워드 밖(`anyOf` 등)을
만나면 **던진다**. 커버리지 표시는 규칙 기반 baseline 뿐 아니라 AI 가 만든 명세와 손으로 쓴 명세에도
필요한데, 그 경로는 서버 선언을 `generate` 파서에 통과시키지 않는다
(`authoring-session.ts:198` 이 서버 `tools` 를 `checkInputContract` 에 그대로 넘긴다). `anyOf` 하나
쓴 서버를 만나면 `generate` 파서 기반 도출은 화면 전체를 죽이고, `runner` 파서 기반 도출은 그 툴만
해석 불가로 빼고 나머지를 정상 표시한다.

단계 2 설계서 §14 가 이 재사용을 이미 예고해 뒀다("단계 5가 `normalizeInputSchema` 를 재사용한다").

### 3.2 공개 계약 (전량)

여러 패키지가 동시에 의존하므로 전량으로 적는다.

```ts
// packages/runner/src/contract-axes.ts

/**
 * 서버 선언에서 도출되는 검증 축의 종류.
 * 선언에 근거가 있는 것만 넣는다. "이 툴은 느릴 것이다" 같은 추측은 축이 아니다.
 */
export type ContractAxisKind =
  | "HAPPY_PATH" // 선언을 지킨 입력에 정상 응답한다
  | "REQUIRED_OMITTED" // 필수 필드를 뺀 입력을 거절한다
  | "TYPE_VIOLATION" // 선언 type 을 어긴 값을 거절한다
  | "ENUM_VIOLATION"; // 선언 enum 밖 값을 거절한다

/** 축 한 개. 같은 툴 안에서 (kind, field) 쌍은 유일하다. */
export interface ContractAxis {
  readonly kind: ContractAxisKind;
  /** 서버가 선언한 툴 이름. 원문 그대로다. */
  readonly tool: string;
  /** 대상 필드. HAPPY_PATH 는 null 이다. */
  readonly field: string | null;
  /** 필드에 선언된 type. TYPE_VIOLATION 에서만 값이 있고 그 밖에는 null 이다. */
  readonly declaredType: ContractDeclaredType | null;
  /** 선언된 enum. ENUM_VIOLATION 에서만 값이 있고 그 밖에는 null 이다. */
  readonly declaredEnum: readonly JsonValue[] | null;
}

export type ContractDeclaredType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

export interface ContractAxesResult {
  /** §4.4 순서로 정렬돼 있다. analyzable 이 false 면 빈 배열이다. */
  readonly axes: readonly ContractAxis[];
  /**
   * 스키마를 해석했는지. false 면 축을 하나도 세지 않는다.
   * checkInputContract 가 SCHEMA_NOT_ANALYZABLE 을 내는 조건과 정확히 같다.
   */
  readonly analyzable: boolean;
  /**
   * analyzable 이 false 인 사유. true 면 null 이다.
   * 차단 키워드면 그 키워드 이름("anyOf"), 루트 type 이 object 가 아니면 "type",
   * properties 가 없거나 객체가 아니면 "properties", 스키마가 객체가 아니면 "schema",
   * 툴 이름이 중복 선언이면 "duplicateTool" 이다. 화면이 §7.3 의 괄호에 그대로 넣는다.
   * 사유를 안 적으면 사용자가 자기 서버의 어디를 볼지 모른다.
   */
  readonly unanalyzableReason: string | null;
  /**
   * 해석하지 못해 축을 못 만든 필드 이름. UTF-16 코드 단위 오름차순.
   * 커버리지 분모에 안 들어가므로 이것을 숨기면 "축을 다 덮었다" 로 잘못 읽힌다.
   */
  readonly unanalyzedFields: readonly string[];
}

/**
 * 툴 하나의 선언에서 축을 도출한다. 서버를 호출하지 않는다.
 *
 * duplicated 는 호출자가 `tools` 배열 전체를 보고 판정해 넘긴다. 같은 이름이 두 번 선언됐다는
 * 사실은 툴 하나만 봐서는 알 수 없다. true 면 analyzable false, unanalyzableReason
 * "duplicateTool" 로 끝낸다. 호출자가 ContractAxesResult 를 손으로 만들지 않게 하려고
 * 파라미터로 받는다.
 */
export function deriveContractAxes(
  tool: ToolDef,
  options?: { readonly duplicated?: boolean },
): ContractAxesResult;

/**
 * 케이스 하나가 어느 축을 덮는지 판정한다. 서버를 호출하지 않는다.
 * 판정 규칙은 §6.2 다. 덮는 축이 없으면 빈 배열이다.
 *
 * checkInputContract 의 결과를 재료로 쓰지 않는다. 그쪽은 §11.1 규칙 때문에 거절 기대 케이스의
 * REQUIRED_MISSING · TYPE_MISMATCH · ENUM_MISMATCH 를 내지 않는데, 커버리지가 판정해야 하는 것이
 * 정확히 그 케이스들이다. 두 함수가 normalizeInputSchema 와 필드 판정을 내부에서 공유하고
 * 출력만 다르게 낸다.
 */
export function matchCoveredAxes(options: {
  readonly testCase: TestCaseSpec;
  readonly tool: ToolDef;
}): readonly ContractAxis[];
```

```ts
// packages/generate/src/violation-cases.ts

/**
 * 생성한 케이스 한 개. render.ts 의 GeneratedSuiteSpec["cases"][number] 를 이 이름으로
 * 승격시켜 두 파일이 공유한다.
 *
 * 기존 타입은 assertions 를 `[{ type: "isError"; expected: false }]` 로 못 박아 두었다
 * (render.ts:14). 위반 케이스는 expected 가 true 라 그대로는 대입되지 않는다. expected 를
 * boolean 으로 넓히지 말고 두 리터럴의 유니온으로 둔다. boolean 으로 넓히면 정상 케이스에
 * true 를 넣는 실수를 컴파일러가 못 잡는다.
 */
export interface GeneratedCase {
  readonly id: string;
  readonly name: string;
  readonly operation: { readonly type: "callTool"; readonly tool: string; readonly input: JsonObject };
  /**
   * 튜플의 배열 자체에는 readonly 를 걸지 않는다. baseline.ts 가 이 케이스를 runner 의
   * TestSuiteSpec(`cases: TestCaseSpec[]`, 그 안의 `assertions` 도 가변 배열)에 그대로 싣는데,
   * 읽기 전용 배열은 가변 배열에 대입되지 않아 거기서 컴파일이 깨진다(TS2322). 구현 중
   * 실측으로 확인해 고쳤다.
   *
   * expected 는 두 리터럴의 유니온으로 남는다. boolean 으로 넓히면 정상 케이스에 true 를
   * 넣는 실수를 컴파일러가 못 잡는다.
   */
  readonly assertions: [
    { readonly type: "isError"; readonly expected: true } | { readonly type: "isError"; readonly expected: false },
  ];
}

/** 한 툴의 위반 케이스 전량. 정상 케이스는 포함하지 않는다. */
export function buildViolationCases(options: {
  readonly tool: ToolDef;
  /** 정상 경로 입력. render.ts 의 synthesizeValue 결과를 그대로 받는다. */
  readonly happyInput: JsonObject;
  /** 케이스 id 접두사. render.ts 의 baseName 과 같은 값이다. */
  readonly baseName: string;
}): readonly GeneratedCase[];
```

```ts
// packages/generate/src/coverage.ts

export interface AxisCoverage {
  readonly kind: ContractAxisKind;
  readonly field: string | null;
  /** 이 축을 덮는 케이스의 id. 없으면 미검증이다. */
  readonly caseId: string | null;
}

export interface ToolCoverage {
  readonly tool: string;
  readonly analyzable: boolean;
  /** ContractAxesResult 의 것을 그대로 싣는다. 중복 선언이면 "duplicateTool" 이다. */
  readonly unanalyzableReason: string | null;
  /** §4.4 순서. analyzable 이 false 면 빈 배열이다. */
  readonly axes: readonly AxisCoverage[];
  /** caseId 가 있는 축의 개수. */
  readonly verified: number;
  /** axes.length. analyzable 이 false 면 0 이다. */
  readonly total: number;
  readonly unanalyzedFields: readonly string[];
}

export interface CoverageResult {
  /** 서버가 선언한 순서가 아니라 툴 이름 UTF-16 코드 단위 오름차순. */
  readonly tools: readonly ToolCoverage[];
  /** 모든 툴의 verified 합. */
  readonly verified: number;
  /** 모든 툴의 total 합. */
  readonly total: number;
}

/** 명세가 각 축을 덮는지 판정한다. 서버를 호출하지 않는다. */
export function computeCoverage(options: {
  readonly suite: TestSuiteSpec;
  readonly tools: readonly ToolDef[];
}): CoverageResult;
```

`BaselineGenerationResult` 에 필드 하나가 늘어난다.

```ts
export interface BaselineGenerationResult {
  readonly policyVersion: typeof BASELINE_POLICY_VERSION;
  readonly suite: TestSuiteSpec;
  readonly suiteFingerprint: string;
  readonly baselineFingerprint: string;
  readonly coverage: CoverageResult; // 신규
}
```

### 3.3 의존 방향

`cli` → `generate` → `runner` → `core`. 새 간선이 없다. `generate` 가 `runner` 에서 가져오는
심볼이 셋 늘어나므로 ADR-0009 의 표와 `dependency-boundary.test.ts` 의
`APPROVED_RUNNER_SYMBOLS` 를 함께 고친다(§13).

```
deriveContractAxes
matchCoveredAxes
ContractAxis
ContractAxisKind
ContractDeclaredType
```

`ContractAxesResult` 는 넣지 않는다. `deriveContractAxes` 의 반환을 구조 분해로만 쓰고 타입
이름을 적을 자리가 없다.

`ContractDeclaredType` 은 착수 전 예상에서 빠져 있었는데 실제로 필요하다. 위반값 표를
`Readonly<Record<ContractDeclaredType, JsonValue>>` 로 두고 `declaredTypeByField` 맵의 값 타입에
쓰려면 이름을 적어야 한다. 구현 중 실측으로 확인해 고쳤다.

**목록은 한 번에 넓히지 않는다.** 경계 테스트가 정확한 일치를 요구하므로, 아직 import 하는 코드가
없는 심볼을 미리 넣으면 반대 방향으로 깨진다. 심볼을 실제로 쓰기 시작하는 태스크에서 그때그때
ADR 을 먼저 고치고 목록을 넓힌다.

**승인 목록은 실제 import 문에서 수집되고 테스트가 정확한 일치를 요구한다**
(`dependency-boundary.test.ts` 의 `expect([...used].sort()).toEqual(APPROVED_RUNNER_SYMBOLS)`).
쓰지 않는 심볼을 목록에 넣으면 테스트가 깨진다. 위 넷은 예상이고, 구현이 끝난 뒤 실제 import 문을
보고 목록과 ADR-0009 의 표를 확정한다.

## 4. 축을 어떻게 세는가

### 4.1 축의 자격

**서버 선언에 근거가 있는 것만 축이다.** 근거가 곧 실패 메시지의 재료가 된다. "필수라고
선언했는데 거절하지 않았습니다" 는 사용자가 반박할 수 없는 문장이고, "보통 이런 건 거절합니다" 는
반박당한다.

### 4.2 도출 규칙

`normalizeInputSchema(tool.inputSchema)` 가 `null` 이면 `analyzable: false` 로 끝낸다. 축을 하나도
세지 않는다. 축을 세면서 "이 툴은 사실 해석 못 했다" 를 병기하면 커버리지 숫자가 거짓이 된다.

서버가 같은 툴 이름을 두 번 선언하면 `analyzable: false` 다. 두 선언의 `inputSchema` 가 다르면
어느 쪽이 참인지 알 방법이 없고, 배열 순서로 첫 선언을 고르면 `tools` 를 뒤집는 것만으로 축이
바뀐다. `checkInputContract:197` 가 같은 이유로 같은 처리를 한다. 중복 판정은 배열 전체를 봐야
하므로 `deriveContractAxes` 가 아니라 `computeCoverage` 와 `buildSuite` 쪽에서 판정해 넘긴다.

`analyzable` 이면 아래 순서로 축을 만든다.

```
HAPPY_PATH                       항상 1개. field 는 null
REQUIRED_OMITTED  필드마다 1개    normalized.required 의 각 이름
TYPE_VIOLATION    필드마다 1개    normalized.fields 중 type !== null 인 것
ENUM_VIOLATION    필드마다 1개    normalized.fields 중 enumValues !== null 인 것
```

`type` 과 `enum` 을 함께 선언한 필드는 축이 둘 생긴다. 서버가 둘 중 하나만 검사할 수 있어서다.
`{ type: "string", enum: ["c","f"] }` 에 `typeof value === "string"` 검사만 있으면 타입 축은
통과하고 enum 축은 실패한다. 하나로 합치면 그 구분이 사라진다.

`normalized.fields` 중 `type` 과 `enumValues` 가 **둘 다 `null`** 인 필드는 축을 만들지 않고
`unanalyzedFields` 에 이름을 넣는다. 정규화가 그 필드를 포기한 경우다(필드 스키마가 객체가 아님,
차단 키워드가 있음, `type` 이 배열). 요구할 근거가 없으므로 축이 아니고, 그렇다고 조용히 버리면
분모가 줄어 커버리지가 실제보다 좋아 보인다.

### 4.3 선형이다

툴당 축 수는 `1 + |required| + |type 있는 필드| + |enum 있는 필드|` 다. 필드 조합을 곱하지 않는다.
필드 20개 툴이면 축이 최대 41개다. 폭발이 아니라 상수배다. 이것이 상한을 두지 않는 근거의 절반이고
나머지 절반은 §9 다.

### 4.4 정렬 순서

1. `kind` 순서: `HAPPY_PATH` → `REQUIRED_OMITTED` → `TYPE_VIOLATION` → `ENUM_VIOLATION`
2. 같은 `kind` 안에서는 `field` 의 UTF-16 코드 단위 오름차순

`normalizeInputSchema` 가 `properties` 키를 이미 정렬해 `Map` 에 넣으므로(`input-contract.ts:92`)
그 순회 순서를 쓸 수 있다. `required` 배열은 서버가 준 순서라 **정렬해서 쓴다.** 서버가 `required`
순서를 바꾸면 케이스 순서가 바뀌고, `cases` 배열 순서는 지문에 들어가는 의미다(단계 8 결정).

## 5. 위반 케이스를 어떻게 만드는가

### 5.1 정상 입력을 재료로 쓴다

`render.ts` 가 이미 `synthesizeValue` 로 정상 입력을 만든다. 위반 케이스는 그 입력을 한 군데만
고친 것이다. 정상 입력을 따로 합성하지 않는다. 두 벌이면 "정상 케이스는 통과하는데 위반 케이스는
다른 이유로 실패" 하는 상황을 디버깅할 수 없다.

### 5.2 축별 입력 변형 규칙 (전량)

```
REQUIRED_OMITTED f
  정상 입력에 키 f 가 없으면 케이스를 만들지 않는다 (아래 단서)
  입력 = 정상 입력에서 키 f 만 제거

TYPE_VIOLATION f
  입력 = 정상 입력에 f = 위반값 대입 (f 가 정상 입력에 없으면 새로 추가)
  위반값은 선언 type 으로 결정한다:
    string   -> 0
    number   -> "example"
    integer  -> 1.5
    boolean  -> "example"
    object   -> "example"
    array    -> "example"
    null     -> "example"

ENUM_VIOLATION f
  입력 = 정상 입력에 f = enum 밖 값 대입
  enum 밖 값:
    선언 type 이 number 또는 integer 이고 enum 에 유한한 수가 있으면
      max(유한한 수) + 1. 이 값이 Number.isSafeInteger 를 벗어나면 다음 규칙으로 넘어간다
    그 밖에는 "__ohmymcp_invalid_enum__"
      enum 에 이 문자열이 있으면 뒤에 "_2", "_3" 을 붙여 첫 미충돌 값을 쓴다
```

**단서: 뺄 것이 없으면 만들지 않는다.** 정상 입력에 그 키가 없으면 "뺀 입력" 이 정상 입력과
같아진다. 그대로 만들면 입력이 같고 단언만 반대인 케이스가 되어 서버가 옳은데도 항상 실패한다.
그 축은 케이스 없이 남고 커버리지가 미검증으로 보고한다. 이 상황은 `required` 에 있지만
`properties` 에 없는 필드에서 나온다. `generate` 의 `validateSchema` 는 그런 스키마를 거부하지만
`runner` 의 축 도출은 허용하므로 손으로 쓴 명세와 AI 경로에서 도달할 수 있다.

`integer` 만 `1.5` 인 이유는 그것이 이 타입에서 유일하게 예리한 위반이기 때문이다. `"example"` 을
넣으면 `typeof value === "number"` 검사만 있는 서버도 잡히지만, `1.5` 는 그 검사를 통과하고
정수 검사가 없는 것까지 잡는다. `matchResponseSchema` 도 `integer` 에 `1.5` 를 `TYPE_MISMATCH` 로
판정한다(단계 2 설계서 §10.1).

`number` 축과 `enum` 축의 값이 겹치지 않는다. 같은 필드에 `{ type: "number", enum: [1,2] }` 가
선언되면 타입 축은 `"example"`, enum 축은 `3` 이다.

### 5.3 단언

전부 하나다.

```json
{ "type": "isError", "expected": true }
```

`isError: true` 를 기대하는 것이 "테스트가 실패하기를 기대" 하는 것이 아니다. 서버가 거절하면
**통과**다. 오류 메시지 본문은 단언하지 않는다(§2 비범위).

### 5.4 케이스 id

```
<baseName>-success                    기존 유지
<baseName>-missing-<fieldSlug>
<baseName>-type-<fieldSlug>
<baseName>-enum-<fieldSlug>
```

`fieldSlug` 는 `safeBaseName` 과 같은 슬러그 규칙(NFKD, 소문자, 비영숫자를 `-` 로, 80자 절단)을
쓰되 fallback 이 `field-<sha256 앞 8자>` 다. `safeBaseName` 의 fallback 은 `tool-<hash>` 라서
필드에 쓰면 이름이 거짓이 된다. `filename.ts` 에 `fieldSlug` 를 추가하고 슬러그 계산 본체는
공유한다.

슬러그 충돌은 `createBaselineSuite:64` 의 `usedNames` 패턴으로 푼다. 같은 슬러그가 두 번 나오면
뒤에 `-2`, `-3` 을 붙인다. 필드 `a-b` 와 `a_b` 가 둘 다 `a-b` 가 되는 경우다.
`validateMcpSuite` 가 `DUPLICATE_CASE_ID` 로 잡는 안전망이 있지만(`spec/validation.ts:403`)
거기까지 가면 생성이 실패한다. 우리가 먼저 막는다.

### 5.5 사람이 읽는 케이스 이름

```
`${tool.name}가 오류 없이 응답한다`                            (기존)
`${tool.name}가 필수 필드 '${field}' 누락을 거절한다`
`${tool.name}가 '${field}' 타입 위반을 거절한다`
`${tool.name}가 '${field}' 의 선언되지 않은 값을 거절한다`
```

`fixtures/tools-list.sample.json` 두 툴에 적용한 결과 전량이 이렇다. 이것이 §10.2 의 기대값이다.

```
get-weather-success              { city: "example" }               isError false
get-weather-missing-city         { }                               isError true
get-weather-type-city            { city: 0 }                       isError true
add-success                      { a: 0, b: 0 }                    isError false
add-missing-a                    { b: 0 }                          isError true
add-missing-b                    { a: 0 }                          isError true
add-type-a                       { a: "example", b: 0 }            isError true
add-type-b                       { a: 0, b: "example" }            isError true
```

툴 2개에서 케이스 8개다. `get_weather` 는 축 3개를 다 덮고 `add` 는 5개를 다 덮는다.

### 5.6 기존 이름 형식의 조사 문제를 여기서 고치지 않는다

`generate-command.ts:483` 주석이 "변수 바로 뒤에 조사를 붙이지 않는다" 를 규칙으로 적고 있다.
한국어 조사가 앞말 받침에 따라 갈리는데 툴 이름과 필드 이름은 어떤 값이 올지 모른다. 위 형식은
`${tool.name}가` 로 그 규칙을 어긴다.

그래도 기존 형식을 따른다. 기존 정상 케이스가 이미 `get_weather가 오류 없이 응답한다` 이고
(`render.ts:65`), 새 케이스만 라벨 형식으로 쓰면 한 보고서 안에 두 문체가 섞인다. 조사 문제는
**기존 형식까지 함께 바꿔야** 풀리므로 별도 작업이다. 후속으로 §14 에 남긴다.

## 6. 커버리지를 어떻게 판정하는가

### 6.1 케이스 id 로 매칭하지 않는다

우리가 만든 id 를 찾는 방식은 손으로 쓴 명세와 AI 가 만든 명세에서 전부 실패한다. 그 경로가
커버리지 표시가 가장 필요한 곳이다(§3.1). **입력과 단언의 내용으로 판정한다.**

### 6.2 판정 규칙

`matchCoveredAxes` 가 케이스 하나를 선언과 대조해 덮는 축을 낸다.

```
케이스가 callTool 이 아니거나 대상 툴이 선언되지 않았으면 빈 배열

isError expected false 단언이 있고 입력이 선언을 어긴 곳이 없으면
  -> HAPPY_PATH

isError expected true 단언이 있으면 입력을 선언과 대조해
  required f 가 입력에 없다        -> REQUIRED_OMITTED f
  입력의 f 가 선언 type 을 어긴다  -> TYPE_VIOLATION f
  입력의 f 가 선언 enum 밖이다     -> ENUM_VIOLATION f
```

`isError` 단언이 없는 케이스는 어떤 축도 덮지 않는다. 서버가 거절했는지 아닌지를 그 케이스가
판정하지 않기 때문이다.

**`checkInputContract` 의 출력을 재료로 쓰지 않는다.** 처음 설계에서는 그 함수의 `SpecFinding` 을
뒤집어 읽으려 했는데 §11.1 과 정면으로 충돌한다. 그 규칙이 거절 기대 케이스의
`REQUIRED_MISSING`·`TYPE_MISMATCH`·`ENUM_MISMATCH` 를 없애는데, 커버리지가 판정해야 하는 것이 바로
그 케이스들이다. 그대로 두면 위반 케이스가 하나도 축을 덮지 못해 커버리지가 영원히 1/N 이 된다.

두 함수는 `normalizeInputSchema` 와 필드 판정(`judgeField`)을 내부에서 공유하고 출력만 다르게
낸다. 같은 판정을 두 벌 만들지 않으면서 지위가 다른 두 질문("명세가 선언을 어겼나", "이 케이스가
어느 축을 덮나")에 답한다. 그래서 둘을 같은 패키지에 둔다.

한 케이스가 축 여럿을 덮을 수 있다. 사람이 `{ }` 를 보내면서 필수 필드 둘을 동시에 뺐으면
`REQUIRED_OMITTED a` 와 `REQUIRED_OMITTED b` 를 함께 덮는다. 우리 생성기는 한 케이스가 한 축만
덮게 만들지만(§5.2) 판정은 그것을 요구하지 않는다.

같은 축을 여러 케이스가 덮으면 `caseId` 에 **첫 케이스**를 넣는다. `suite.cases` 순서를 쓰므로
결정론적이다.

이 재사용이 §11.1 의 규칙 변경을 필연으로 만든다. 다음 절이다.

### 6.3 `checkInputContract` 를 그대로 쓰면 우리 케이스가 위반으로 신고된다

`add-missing-a` 는 `checkInputContract` 가 보기에 `REQUIRED_MISSING`, severity `blocking` 이다.
승인 화면(`generate-command.ts:451` `confirmSpecFindings`)이 이렇게 뜬다.

```
입력 계약 위반 6건 (선택한 변경 기준)
  → 3 add-missing-a
     필수 필드 'a' 가 입력에 없습니다
...
위반 6건이 남아 있습니다. 그래도 적용합니까?
```

도구가 스스로 만든 케이스를 스스로 고발한다. 사용자는 자기가 뭘 잘못했는지 알 수 없다. 위반
케이스를 기본 생성으로 정한 순간(§2 목표 3) 이 화면은 모든 실행에서 뜬다.

그래서 `runner` 에 규칙을 추가한다.

> **거절을 기대하는 케이스는 입력 계약 대조 대상이 아니다.** `isError expected true` 단언이 있는
> 케이스에서는 `REQUIRED_MISSING`·`UNDECLARED_FIELD`·`TYPE_MISMATCH`·`ENUM_MISMATCH` 를 내지
> 않는다.

의미상으로도 이것이 맞다. 단계 2 의 전제는 "명세의 입력은 서버 선언을 지켜야 한다" 인데, 그
전제는 정상 응답을 기대하는 케이스에만 성립한다. 거절을 기대하는 케이스에서 선언을 어긴 입력은
결함이 아니라 **그 케이스의 목적**이다.

계속 내는 것이 둘 있다.

- `TOOL_NOT_DECLARED`. 선언되지 않은 툴을 부르는 것은 거절 기대와 무관하게 명세 오류다. 서버가
  모르는 툴 이름은 오타이지 검사 대상이 아니다.
- `SCHEMA_NOT_ANALYZABLE`. 위반이 아니라 "검사를 못 했다" 는 보고다. 삼키면 §12 의 거짓 신호가
  살아난다.

대가는 미탐 하나다. 사용자가 `isError: true` 를 쓴 케이스에 진짜 오타가 있어도 조용하다. ADR-0015
가 "오탐 1건이 미탐 1건보다 비싸다" 를 이미 결정해 뒀고, 여기서 오탐은 모든 사용자가 매 실행마다
보는 것이라 비용이 훨씬 크다. ADR 대상이다(§11.1).

### 6.4 미검증의 정의

| 상태 | 화면 | 뜻 |
|---|---|---|
| 축이 있고 덮는 케이스가 있다 | 숫자에 포함 | 검증한다 |
| 축이 있고 덮는 케이스가 없다 | `? 미검증` | 확인해야 하는데 안 한다 |
| 축을 못 만들었다(필드) | `해석 못 한 필드 N개` | 요구할 근거가 없다 |
| 스키마 전체를 못 읽었다 | `해석 불가` | 이 툴은 커버리지를 셀 수 없다 |

셋째와 넷째를 미검증으로 세지 않는다. 우리가 요구하지 못하는 것을 사용자 숙제로 적으면 영구히
지워지지 않는 경고가 된다. 대신 개수를 숨기지도 않는다.

기본 생성이 축을 다 채우므로(§5) 미검증은 다음 경우에만 남는다. 사용자가 케이스를 지웠거나, AI 가
만든 명세를 승인했거나, 손으로 쓴 명세이거나, `--baseline-only` 없이 대화형에서 일부 변경만
선택한 경우다.

## 7. 화면 (전량)

`cli` 가 찍는 문장 전량이다. `generate` 실행 시점에만 나온다.

### 7.1 전부 검증된 경우

```
커버리지  2 tools, 8 axes 전부 검증
```

한 줄이다. 툴별 상세를 찍지 않는다. 기본 생성이 축을 다 채우므로 이것이 대다수 실행의 모습이고,
여기서 툴 30개를 나열하면 매 실행 30줄이 영구 소음이 된다. 단계 8 의 조건부 표시와 같은 판단이다.

**한 줄로 줄이는 조건은 "숨길 것이 하나도 없을 때" 다.** `verified === total` 만으로는 부족하다.
해석 불가 툴이나 해석 못 한 필드가 있으면 숫자가 다 차 있어도 상세를 찍는다. 그 사실이 화면에서
사라지면 "전부 확인했다" 로 읽히고, 그것이 §6.4 가 막으려는 상태다. 구현 중 발견해 고쳤다.

### 7.2 미검증이 있는 경우

```
커버리지  3 tools, 12/14 axes 검증
  add           5/5
  get_weather   3/3
  search_docs   4/6
    ? filters 의 타입 위반 거절             미검증
    ? filters 의 선언되지 않은 값 거절      미검증
```

전부 검증된 툴도 한 줄로 함께 찍는다. 미검증 툴만 찍으면 사용자가 나머지 툴의 상태를 모른다.
미검증 축만 `?` 로 들여쓴다.

### 7.3 해석 불가가 있는 경우

```
커버리지  3 tools, 8/8 axes 검증
  add           5/5
  get_weather   3/3
  search_docs   해석 불가
    → 입력 스키마를 해석하지 못해 이 툴의 축을 세지 못했습니다 (anyOf)
    → 이 툴은 커버리지 숫자에 들어가지 않습니다
```

괄호 안은 `ContractAxesResult.unanalyzableReason` 을 그대로 넣은 것이다(§3.2).

필드 단위 해석 불가는 이렇게 붙는다. 이 툴은 축이 5개이고 그중 하나가 미검증이다.

```
  search_docs   4/5
    ? query 의 타입 위반 거절     미검증
    → 해석 못 한 필드 1개: filters. 이 필드의 축은 세지 않았습니다
```

### 7.4 1MB 벽 고지

```
→ 케이스 1842개를 만들었습니다. runner 보고서 상한(1MB)에 가까워 test 실행이
  RunnerPayloadLimitError 로 실패할 수 있습니다.
→ 툴을 나눠 여러 명세 파일로 생성하면 피할 수 있습니다.
```

임계는 케이스 1500개다. 근거는 §9.2 다. 막지 않고 알린다.

## 8. 결정론성

### 8.1 계약

같은 `tools` 배열은 항상 같은 `cases` 배열을 같은 순서로 만든다. `tools` 순서가 바뀌어도
`computeCoverage` 결과는 같다(`tools` 는 이름으로 정렬해 순회한다). 시간·난수·환경 변수·로캘에
의존하지 않는다. 문자열 비교는 전부 UTF-16 코드 단위다.

`cases` 배열 순서는 툴 순서(서버가 준 순서, `createBaselineSuite` 가 이미 그렇게 한다) 안에서
§4.4 축 순서다. `required` 배열은 정렬해서 쓴다(§4.4).

### 8.2 스택 안전

축 도출은 `properties` 한 겹만 본다. 중첩 스키마를 내려가지 않으므로 재귀가 없다. 이는 단계 2
설계서 §9.3 이 정한 계약("중첩 스키마를 순회할 때 재귀를 쓰지 않는다")을 자동으로 만족한다.

다만 `synthesizeValue`(`packages/generate/src/synthesize.ts:70`)는 **재귀다.** 우리는 그것을
호출만 하고 호출 횟수를 늘린다(위반 케이스마다 정상 입력을 재사용하므로 실제로는 툴당 1회
그대로다). 깊이는 안 늘어난다. 이 사실을 확인만 하고 `synthesizeValue` 를 고치지 않는다.
단계 8 이 남긴 교훈("소비자가 바뀌면 무손실이 안전을 보장하지 않는다")에 걸리는지 확인한 결과,
소비자가 바뀌지 않으므로 걸리지 않는다.

### 8.3 지문과 정책 버전

케이스가 늘어나므로 `suiteFingerprint` 와 `baselineFingerprint` 가 바뀐다. 같은 서버에 같은 명령을
돌리면 이전과 다른 파일이 나온다. `BASELINE_POLICY_VERSION` 을 `"schema-baseline-v1"` 에서
`"schema-baseline-v2"` 로 올린다. 이 값이 `baselineFingerprint` 계산에 들어가 있어
(`baseline.ts:93`) 정책이 바뀐 사실이 지문에 남는다.

`coverage` 는 지문 계산에 넣지 않는다. 커버리지는 명세에서 파생되는 값이라 지문 재료가 되면
순환이다. 명세가 바뀌면 커버리지가 바뀌고, 커버리지가 지문에 들어가면 지문이 또 바뀐다.
지문이 답해야 할 질문은 "테스트의 의미가 바뀌었나" 이고 커버리지는 그 의미의 결과다.

이미 저장된 사용자 명세 파일은 영향을 받지 않는다. 그 파일의 `approval.fingerprint` 는 그 파일
내용으로 계산돼 있고 우리가 그 파일을 다시 쓰지 않는다.

## 9. 상한을 두지 않는다

### 9.1 왜 두지 않는가

목표가 "빈틈 없는 명세" 인데 도구가 스스로 빈틈을 만드는 것은 목적과 반대다. 툴당 상한 8을
기본값으로 두면 필드 20개짜리 툴을 가진 사용자는 영구히 미검증 33개를 안고 산다. 그 상태가
화면에 정직하게 표시된다는 것은 위안이 못 된다. 사용자가 할 수 있는 조치가 없다.

축 수가 선형이라(§4.3) 상한의 근거였던 폭발이 실제로는 없다.

### 9.2 진짜 벽은 하류에 있다

`packages/runner/src/executor.ts:388` 이 보고서 크기를 검사한다.

```ts
const size = byteLength(report);
if (size > limits.maxReportBytes) throw new RunnerPayloadLimitError({ ... });
```

`DEFAULT_MAX_REPORT_BYTES` 는 1MB 이고 **올릴 수 없다.** `resolvePayloadLimits` 가 기본값을
최대치로 쓴다(`sanitization.ts:61`, `value > maximum` 이면 `RangeError`). 넘으면 테스트 실패가
아니라 예외로 죽는다.

케이스당 보고서가 대략 300에서 600 바이트이므로 벽은 2000 케이스 근처다. 툴 30개 × 필드 30개인
서버가 약 1800 케이스로 여기에 닿는다. 흔하지 않지만 도달 가능하다.

**생성을 막지 않고 고지한다**(§7.4). 임계를 1500으로 잡는 근거는 케이스당 600 바이트(관측
범위의 상한)로 계산해도 900KB 로 1MB 안에 들어가고, 그보다 크면 사용자가 조치할 시간이 필요하다는
것이다.

상수는 `packages/cli/src/generate-command.ts` 에 `CASE_COUNT_WARNING_THRESHOLD = 1500` 으로 두고
위 계산을 주석에 적는다. `generate` 에 두지 않는 이유는 이것이 화면 판단이고, 임계의 근거가
`runner` 의 `DEFAULT_MAX_REPORT_BYTES` 인데 그 값을 아는 것은 실행 경로를 조립하는 `cli` 라서다.
`generate` 는 케이스를 몇 개 만들었는지만 알려주고 그 수가 위험한지는 판단하지 않는다.

고지는 상한이 아니다. 이미 존재하는 상한을 사용자에게 보이게 하는 것이다. 지금은 벽에 부딪히면
이유를 모르는 예외만 뜬다.

### 9.3 단계 3 과의 상호작용

단계 3(dry run 전량 실행)이 오면 케이스 수만큼 서버 호출이 나간다. 8 케이스면 8회다. 로드맵이
카세트(이슈 #59)를 단계 3 의 전제로 잡은 이유가 이 작업으로 커진다.

위반 케이스는 정상 케이스보다 싸다. 서버가 입력 검증에서 거절하면 외부 API 호출까지 가지 않기
때문이다. 단 검증이 없는 서버(우리가 잡으려는 결함)에서는 그대로 나간다. 즉 **비용이 가장 큰
경우가 결함이 있는 경우**다. 이것을 단계 3 설계에 전달한다(§14).

## 10. 테스트

전부 인메모리다. `ToolDef` 배열과 스위트를 테스트 안에서 리터럴로 만든다. 예외는 §10.5 의 실서버
E2E 하나이고 그것은 이미 직렬 전용이다(`describe.sequential`).

### 10.1 `packages/runner/tests/contract-axes.test.ts` (신규)

```
deriveContractAxes
  · required 없고 properties 없는 object 스키마는 SCHEMA_NOT_ANALYZABLE 조건이라 analyzable false
  · { type: object, properties: { city: { type: string } }, required: [city] } 는 축 3개
    (HAPPY_PATH, REQUIRED_OMITTED city, TYPE_VIOLATION city)
  · required 가 빈 배열이면 축은 HAPPY_PATH 와 TYPE_VIOLATION 뿐이다
  · optional 필드에도 TYPE_VIOLATION 축이 생긴다
  · type 과 enum 을 함께 선언한 필드는 TYPE_VIOLATION 과 ENUM_VIOLATION 축이 둘 다 생긴다
  · enum 만 있고 type 이 없는 필드는 ENUM_VIOLATION 축만 생긴다
  · type 이 ["string","null"] 인 필드는 축이 없고 unanalyzedFields 에 이름이 들어간다
  · 필드에 anyOf 가 있으면 축이 없고 unanalyzedFields 에 들어간다
  · 루트에 anyOf 가 있으면 analyzable false, axes 빈 배열, unanalyzedFields 빈 배열
  · 루트 type 이 object 가 아니면 analyzable false
  · inputSchema 가 null 이면 analyzable false
  · axes 가 §4.4 순서로 정렬돼 있다 (kind 우선, 같은 kind 안에서 field 코드 단위)
  · required 배열 순서를 뒤집어도 axes 가 같다
  · 같은 tool 로 2회 호출한 결과가 JSON.stringify 기준 동일
  · declaredType 은 TYPE_VIOLATION 에서만 값이 있고 나머지는 null
  · declaredEnum 은 ENUM_VIOLATION 에서만 값이 있고 나머지는 null
  · unanalyzableReason 이 anyOf 루트에서 "anyOf", 루트 type 위반에서 "type",
    properties 없음에서 "properties", 스키마가 객체 아님에서 "schema" 다
  · analyzable true 면 unanalyzableReason 이 null 이다

matchCoveredAxes
  · 정상 입력 + isError false 케이스는 HAPPY_PATH 하나를 덮는다
  · 선언을 어긴 입력 + isError false 케이스는 아무 축도 안 덮는다
  · required 를 뺀 입력 + isError true 케이스는 REQUIRED_OMITTED 그 필드를 덮는다
  · 타입을 어긴 입력 + isError true 케이스는 TYPE_VIOLATION 그 필드를 덮는다
  · enum 밖 값 + isError true 케이스는 ENUM_VIOLATION 그 필드를 덮는다
  · 필수 필드 둘을 동시에 뺀 케이스는 REQUIRED_OMITTED 둘을 덮는다
  · isError 단언이 없는 케이스는 빈 배열이다
  · listTools 케이스는 빈 배열이다
  · 선언되지 않은 툴을 부르는 케이스는 빈 배열이다
  · 반환 배열이 §4.4 순서로 정렬돼 있다
  · §11.1 규칙과 무관하게 동작한다 (checkInputContract 가 침묵하는 케이스에서도 축을 낸다)
```

### 10.2 `packages/generate/tests/violation-cases.test.ts` (신규)

```
buildViolationCases
  · fixtures/tools-list.sample.json 의 get_weather 로 §5.5 의 케이스 2개가 정확히 나온다
    (id, name, input, assertions 전량 비교)
  · fixtures/tools-list.sample.json 의 add 로 §5.5 의 케이스 4개가 정확히 나온다
  · REQUIRED_OMITTED 케이스의 입력에 나머지 필수 필드는 남아 있다
  · TYPE_VIOLATION string 필드에 0 이 들어간다
  · TYPE_VIOLATION number 필드에 "example" 이 들어간다
  · TYPE_VIOLATION integer 필드에 1.5 가 들어간다
  · TYPE_VIOLATION boolean · object · array · null 필드에 "example" 이 들어간다
  · TYPE_VIOLATION 이 optional 필드면 정상 입력에 없던 키가 추가된다
  · ENUM_VIOLATION 문자열 enum 에 "__ohmymcp_invalid_enum__" 이 들어간다
  · enum 에 "__ohmymcp_invalid_enum__" 이 있으면 "__ohmymcp_invalid_enum___2" 를 쓴다
  · ENUM_VIOLATION number enum [1,2] 에 3 이 들어간다
  · ENUM_VIOLATION number enum 의 max 가 Number.MAX_SAFE_INTEGER 면 문자열 규칙으로 넘어간다
  · type 과 enum 이 함께 있는 필드의 두 케이스 입력이 서로 다르다
  · 모든 위반 케이스의 단언이 [{ type: isError, expected: true }] 하나다
  · 케이스 id 슬러그가 충돌하면 -2 가 붙는다 (필드 "a-b" 와 "a_b")
  · 슬러그가 빈 문자열이 되는 필드 이름은 field-<hash> 로 대체된다
  · analyzable false 인 툴은 위반 케이스가 0개다
  · 같은 tool 로 2회 호출한 결과가 JSON.stringify 기준 동일
```

### 10.3 `packages/runner/tests/input-contract.test.ts` (수정)

§11.1 의 규칙이다. 이 블록이 완료 조건에 걸린다.

```
거절 기대 케이스 제외
  · isError expected true 인 케이스는 REQUIRED_MISSING 을 내지 않는다
  · isError expected true 인 케이스는 TYPE_MISMATCH 를 내지 않는다
  · isError expected true 인 케이스는 ENUM_MISMATCH 를 내지 않는다
  · isError expected true 인 케이스는 UNDECLARED_FIELD 를 내지 않는다
  · isError expected true 인 케이스도 TOOL_NOT_DECLARED 는 낸다
  · isError expected true 인 케이스도 SCHEMA_NOT_ANALYZABLE 은 낸다
  · isError expected false 인 케이스는 기존과 같이 전부 낸다
  · isError 단언이 없는 케이스는 기존과 같이 전부 낸다
  · isError expected true 와 false 단언이 한 케이스에 함께 있으면 전부 낸다
    (모순된 명세다. 침묵하면 그 모순을 숨긴다)
  · buildViolationCases 가 만든 케이스 전량을 넣으면 finding 이 0건이다
```

마지막 항목이 두 패키지를 잇는 계약 테스트다. `generate` 쪽에 두면 `runner` 만 고칠 때 안 돌고,
`runner` 쪽에 두면 `generate` 를 import 해야 해서 의존 방향이 뒤집힌다. 그래서 `runner` 테스트
안에 §5.5 의 케이스 8개를 **리터럴로** 적는다. 두 곳에 같은 값이 있는 것이 의도이고, 어긋나면
이 테스트가 깨져 알린다.

### 10.4 `packages/generate/tests/coverage.test.ts` (신규)

```
computeCoverage
  · §5.5 의 8케이스 스위트는 verified 8, total 8
  · REQUIRED_OMITTED 케이스를 지우면 그 축의 caseId 가 null 이고 verified 가 1 줄어든다
  · 손으로 쓴 스위트(id 규칙과 무관한 이름)도 입력 내용으로 축이 잡힌다
  · isError 단언이 없는 케이스는 어떤 축도 덮지 않는다
  · isError expected false 이고 finding 이 있는 케이스는 HAPPY_PATH 를 덮지 않는다
  · 필수 필드 둘을 동시에 뺀 케이스 하나가 REQUIRED_OMITTED 축 둘을 덮는다
  · 같은 축을 두 케이스가 덮으면 caseId 가 suite.cases 순서상 첫 케이스다
  · analyzable false 인 툴은 total 0 이고 verified 0 이며 axes 빈 배열
  · unanalyzedFields 가 결과에 그대로 실린다
  · tools 배열 순서를 뒤집어도 결과가 동일
  · tools 가 툴 이름 코드 단위 오름차순으로 정렬돼 있다
  · 명세에 있지만 서버가 선언하지 않은 툴은 결과에 안 들어간다
  · 같은 (suite, tools) 로 2회 호출한 결과가 JSON.stringify 기준 동일
```

### 10.5 `packages/cli/tests/generate-integration.test.ts` (수정)

실서버 E2E 다. 현재 `expect(suite.cases).toHaveLength(2)` 가 있고(`:112`) 이 작업으로 깨진다.
기대값을 갱신한다.

```
· examples/weather-server 로 만든 baseline 의 케이스 수가 서버 선언에서 도출한 축 수와 같다
· 그 baseline 을 test 로 실행하면 위반 케이스의 결과가 보고서에 있다
· 커버리지 한 줄이 stdout 에 있다
```

케이스 수를 상수로 박지 않고 `deriveContractAxes` 로 계산한 수와 비교한다. `examples` 서버 선언이
바뀔 때 테스트가 그 사실을 알려야 하는데, 상수로 박으면 "선언이 바뀌었다" 와 "생성이 깨졌다" 가
구분되지 않는다.

**이 E2E 가 실제로 서버 결함을 잡는지 확인한다.** `examples/weather-server` 가 입력 검증을 하지
않으면 위반 케이스가 실패한다. 그 경우 선택지가 둘이다. 서버에 검증을 넣거나, 실패를 기대값으로
적는 것이다. `examples` 는 우리 도구의 도그푸딩 대상이므로 **서버에 검증을 넣는다.** 이것이
"우리 도구로 우리를 검증한다" 의 실제 모습이다. 구현 시점에 실행해서 확인하고, 서버 수정이
필요하면 그 사실을 보고한다(`examples` 소유권을 §13 에서 확인할 것).

### 10.6 회귀

```
· pnpm test packages/runner 전체 통과, 기존 spec-validation · schema-match 단언 변경 0건
· pnpm test packages/generate 전체 통과
· dependency-boundary.test.ts 가 갱신된 승인 목록과 일치
· 기존 baseline 스냅샷 테스트가 있으면 새 케이스를 반영해 갱신
```

표적 검증: `pnpm test packages/runner`, `pnpm test packages/generate`, `pnpm test packages/cli`
전체 회귀: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`

`--force` 를 쓰는 이유는 turbo 캐시가 이전 녹색을 재생하기 때문이다. `Cached: 0 cached` 를
확인한다(CLAUDE.local.md 거짓 신호 표).

## 11. ADR

번호는 `docs/adr/` 의 다음 빈 번호인 **0021**(§11.1)과 **0022**(§11.2)다. 0016 번호 충돌 사례가
있었으므로 착수 시점에 `docs/adr/` 을 다시 읽어 빈 번호를 확인한다.

### 11.1 거절 기대 케이스는 입력 계약 대조에서 제외한다 (ADR-0021)

다르게 갈 수 있었던 판단이다. 선택지가 넷이었다.

- A안: 명세에 의도 필드를 넣는다(`intent: "contractViolation"`). 가장 명시적이지만 `TestCaseSpec`
  확장이라 `runner` 스펙 변경과 `MCP_SUITE_JSON_SCHEMA` 변경, 파일 형식 변경이 따라온다. 손으로
  쓴 명세는 그 필드를 안 쓰므로 여전히 오탐이 난다
- B안: `isError expected true` 를 신호로 쓴다. 파일 형식이 안 바뀌고 손으로 쓴 명세에도 적용된다
- C안: `cli` 승인 화면에서 걸러낸다. `runner` 를 안 고치지만 `test` 경로에도 같은 오탐이 남고
  필터가 두 소비자에 중복된다
- D안: 위반 케이스를 옵션으로 돌려 기본 화면에서 안 보이게 한다. 목표 3 을 포기한다

B안을 택한다. 신호가 이미 명세 안에 있고 의미가 정확하다. "거절을 기대한다" 는 곧 "이 입력은
선언을 어길 것이다" 다. 두 소비자(`generate` 승인 화면, `cli test`)가 코드를 안 고쳐도 함께
고쳐진다.

대가는 미탐이다. `isError: true` 케이스의 진짜 오타를 못 잡는다. ADR-0015 가 "오탐 1건이 미탐
1건보다 비싸다" 를 이미 결정했고, 여기서 오탐은 위반 케이스 수만큼(툴 30개면 100건 이상) 매
실행마다 나오므로 비교가 되지 않는다.

ADR-0018 개정이 아니라 신규다. 0018 은 결과를 어디에 싣고 누가 차단하는지의 배선 결정이고, 이것은
검사 대상 자체의 경계 결정이다.

### 11.2 위반 케이스 생성 정책 (ADR-0022)

다르게 갈 수 있었던 판단 셋을 한 ADR 에 묶는다.

**기본 생성 대 옵트인.** 기본 생성을 택한다. 옵트인은 옵션을 아는 사용자만 혜택을 받고, 로드맵의
"미확인 상태로 승인되는 케이스를 0으로" 와 어긋난다. 대가는 명세 파일이 3배 이상 커지는 것이고,
서버가 거절하지 않는 설계라면 사용자가 케이스를 지워야 하는 것이다. 승인 화면에서 케이스별로
빼는 흐름이 이미 있어(AI 후보 승인과 같은 경로) 그 대가가 감당 가능하다.

**필드마다 대 축마다.** 필드마다 하나씩 만든다. 서버 코드가 필드별로 갈리기 때문이다.
`if (!args.a) throw` 만 쓰고 `b` 검사를 빼먹는 것이 정확히 우리가 잡으려는 결함이다. 대표 필드
하나만 쓰면 그것을 놓치고, `{}` 하나로 합치면 어느 필드 검사가 빠졌는지 못 짚는다. 실패 메시지가
제품이라는 원칙에서 `'b' 를 뺀 입력을 거절하지 않았습니다` 가 나와야 한다.

**상한 대 무제한.** 무제한이다. §9 전체가 근거다.

## 12. 거짓 신호

CLAUDE.local.md 의 표에서 이 작업에 해당하는 항목.

| 거짓 신호 | 이 작업에서의 모습 | 진실 기준 |
|---|---|---|
| 타입체크·린트 녹색 | 새 파일이 `index.ts` 에서 export 안 돼 빌드 대상에서 빠짐 | export 문과 검사 파일 수 확인 |
| 유닛테스트 녹색, 실행 시 실패 | 리터럴 스키마만 검증. 실제 서버 선언은 지저분함 | §10.5 의 실서버 E2E |
| `pnpm typecheck` 가 `Tasks: N successful` | turbo 캐시 재생 | `--force` 로 돌려 `Cached: 0 cached` 확인 |
| 결함이 계속 재현 | `runner` 빌드 산출물이 낡음 | `pnpm build` 후 재확인 |

이 작업 고유의 것 셋.

| 거짓 신호 | 원인 | 진실 기준 |
|---|---|---|
| 커버리지 100% | 스키마 해석 불가로 축이 0개라 분모가 0 | `analyzable` 과 `unanalyzedFields` 를 따로 본다 |
| 위반 케이스가 전부 통과 | 서버가 거절한 것이 아니라 툴 이름 오타로 거절된 것 | `TOOL_NOT_DECLARED` finding 이 0건인지 확인 |
| 위반 케이스가 전부 통과 | `isError: true` 라 무엇이든 오류면 통과. 서버가 다른 이유로 죽어도 초록 | 단계 1 의 stderr 진단으로 종료 원인 확인 |

마지막 항목이 이 기능의 구조적 한계다. `isError: true` 는 "거절했다" 와 "서버가 다른 이유로
실패했다" 를 구분하지 못한다. 오류 본문을 단언하면 구분되지만 MCP 규격에 형식이 없어 서버마다
다르다(§2 비범위). 단계 4(repair)가 stderr 를 AI 에 넘길 때 이 구분이 요구로 올라온다. 그때
오류 본문 단언을 재검토한다.

## 13. 소유권과 PR

수정 대상 패키지가 셋이라 PR 을 나눈다. `cli` 는 공동 소유이므로 CONTRIBUTING §2.2 에 걸린다.

| PR | 패키지 | 내용 |
|---|---|---|
| 1 | `runner` | `contract-axes.ts` 신규, `input-contract.ts` 에 §11.1 규칙, export 추가 |
| 2 | `generate` + `cli` | 위반 케이스 생성, 커버리지 계산, 화면, ADR-0009 개정, E2E 갱신 |

**PR 1 을 `runner` 만으로 끊는 이유.** PR 1 은 사용자에게 보이는 동작을 하나 바꾼다(§11.1 의 제외
규칙). 그것만으로 독립적으로 옳고, 테스트가 그것을 단독으로 판정한다. 축 도출은 아직 소비자가
없지만 §10.1 이 계약을 고정한다.

**PR 2 가 `generate` 와 `cli` 를 함께 담는 이유.** 위반 케이스가 늘면
`packages/cli/tests/generate-integration.test.ts:112` 의 `toHaveLength(2)` 가 깨진다. `generate`
만 담은 PR 은 CI 가 빨간불이라 머지되지 않는다. 나누려면 기대값을 먼저 느슨하게 고치는 PR 을
`cli` 에 따로 내야 하는데, 그 PR 은 단독으로 아무 의미가 없고 그 사이 경계가 비어 있게 된다.
로드맵의 PR 2-B(`generate` + `cli` 배선)가 같은 이유로 한 PR 이었던 선례다.

**스택 PR 로 만들지 않는다.** 베이스가 피처 브랜치면 CodeRabbit 이 리뷰를 건너뛴다(단계 8 에서
확인한 도구 제약). PR 1 이 `main` 에 머지된 뒤 PR 2 를 `main` 기준으로 연다. 즉 순차다.

**터미널 1개, 순차.** 두 PR 이 같은 개념을 나누므로 병렬로 하면 PR 2 가 PR 1 의 미머지 코드를
참조한다. `.claude/worktrees/contract-axes-a` 와 `-b` 를 순차로 쓴다. §10.5 의 E2E 가 실서버를
띄우므로 PR 2 태스크는 직렬 전용이다.

**확인할 것 하나.** `examples/weather-server` 의 소유자를 확인해야 한다. §10.5 가 그 서버에 입력
검증을 넣는 것을 요구할 수 있고, `examples` 가 내 소유가 아니면 수정하지 않고 보고한다.
CONTRIBUTING §2.1 의 오너 표를 착수 전에 읽는다.

커밋 메시지.

```
feat(runner): 서버 선언에서 계약 축을 도출한다
fix(runner): 거절 기대 케이스를 입력 계약 대조에서 제외한다
feat(generate): 선언을 어긴 입력 케이스를 생성한다
feat(generate): 계약 축 커버리지를 계산한다
feat(cli): generate 화면에 커버리지를 표시한다
```

## 14. 후속 연동

- **단계 3(dry run 승인 게이트)**: 케이스 수만큼 서버 호출이 나간다. §9.3 의 "비용이 가장 큰
  경우가 결함이 있는 경우" 를 단계 3 설계에 전달한다. 위반 케이스의 승인 판정("서버 결함" 대
  "명세 오류")은 정상 케이스와 다르다. 위반 케이스가 실패했다면 그것은 거의 항상 서버 결함이다.
- **단계 4(repair)**: §12 의 마지막 항목. `isError: true` 가 거절과 다른 실패를 구분하지 못하는
  한계가 여기서 요구로 올라온다. 오류 본문 단언을 그때 재검토한다.
- **`UNDECLARED_INJECTED` 축**: `generate` 의 `validateSchema` 허용 키워드에
  `additionalProperties` 를 넣는 선행 작업이 있어야 한다. 지금은 그 키워드를 쓴 서버가 `generate`
  자체를 못 쓴다. 이것은 이 작업과 별개의 기존 제약이고 이슈로 올린다.
- **케이스 이름의 조사 문제**: §5.6. 기존 형식까지 함께 바꾸는 별도 작업이다.
- **지문 상수의 소재를 한 곳에 적는다**: baseline 출력이 바뀌면 후보 지문 상수를 박아 둔 테스트가
  함께 깨진다. 이 작업에서 실제로 두 곳이 깨졌다(`authoring-session.test.ts` 의
  `KNOWN_CLEAN_FINGERPRINT`, `authoring-request.test.ts` 의 `KNOWN_PROVIDER_FINGERPRINT`).
  계획서가 그 소재를 세지 않아 태스크 범위에서 빠졌다. 앞으로 출력 형태를 바꾸는 계획을 쓸 때는
  파생 상수를 `grep` 으로 먼저 세고, 그 목록을 한 곳에 적어 둔다.

- **로드맵 갱신**: 단계 5·6 을 완료로 옮기고, 웨이브 표의 "이후 단계 5·6·7" 에서 5·6 을 뺀다.
  단계 2 의 "남은 정리" 에 적힌 실패 문안 개선 3건은 이 작업 범위가 아니다(단계 3 화면 작업).

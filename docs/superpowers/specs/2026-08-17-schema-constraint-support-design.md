# 스키마 제약 지원과 값 출처 계층 설계

- 상태: 초안
- 날짜: 2026-08-17
- 대상 패키지: `runner` · `generate` · `cli`
- 선행: ADR-0004(생성 범위) · ADR-0015(해석 포기 규칙) · ADR-0025(교정의 판정 주체) · ADR-0036(부분 생성)

## 1. 목표와 한 문장 정의

**`generate` 가 서버 선언의 제약 키워드를 읽고 그것을 지키는 입력값을 만든다. 그리고 값마다
근거의 유무를 표시해, 근거가 없는 값에만 AI 를 부른다.**

지금은 `minimum` 같은 키워드를 만나면 그 툴의 케이스를 하나도 만들지 못한다. 고유 서버 8개 중
5개가 이 벽에 걸렸고, PR #145 의 부분 생성은 실패 반경을 툴 단위로 줄였을 뿐 원인을 없애지
못했다. 단일 툴 서버 둘(`server-sequential-thinking` · `mcp-server-fetch`)은 여전히 0개다.

### 1.1 완료 조건

검증 가능한 문장으로 고정한다.

1. `{ "type": "integer", "minimum": 1, "maximum": 10 }` 을 가진 툴이 케이스를 생성하고, 합성된
   값이 `1` 이다.
2. `{ "type": "string", "format": "uri" }` 를 가진 툴이 케이스를 생성하고, 합성된 값이
   `"https://example.com"` 이다.
3. `mcp-server-fetch`(툴 1개, `exclusiveMaximum` 보유)에 `generate --baseline-only` 를 돌려
   케이스가 1개 이상 나온다.
4. 모든 필드가 근거 있는 값으로 채워진 툴에서는 AI 사전보완 요청이 만들어지지 않는다.
5. `RANGE_VIOLATION` 축이 커버리지 화면에 나타나고, 해당 위반 케이스가 합성된다.
6. 같은 서버 선언으로 두 번 생성한 baseline 의 `baselineFingerprint` 가 같다.

### 1.2 이 설계를 뒷받침하는 실측

2026-08-17 에 서버 6개, 툴 51개를 대상으로 세 가지 값 생성 방식을 실행해 비교했다. 원자료는
스크래치패드에 있었고 휘발됐다. 재현 방법은 §10 에 적는다.

| 서버 | 툴 | 현행 규칙 | 이 설계의 하드코딩 | AI 사전보완 |
|---|---|---|---|---|
| `mcp-server-time` | 2 | 0 | 0 | **2** |
| `mcp-server-fetch` | 1 | 0 | **1** | 1 |
| `mcp-server-git` | 12 | 0 | 0 | 0 |
| `server-filesystem` | 14 | 6 | 6 | 1 |
| `server-memory` | 9 | 9 | 9 | 9 |
| `server-everything` | 13 | 12 | 12 | 12 |
| 합계 | 51 | 27 | 28 | 25 |

총계만 보면 AI 가 하드코딩보다 나쁘다. 서버별로 보면 **값이 세 범주로 갈리고 각 범주의 해결
주체가 다르다**는 것이 드러난다.

| 범주 | 예 | 해결 주체 | 근거 |
|---|---|---|---|
| 선언된 제약 | `format: "uri"` | 하드코딩 | `fetch` 0 → 1 |
| 보편 도메인 지식 | 타임존 `Asia/Seoul`, 시각 `"14:30"` | AI 사전보완 | `time` 0 → 2 |
| 환경 의존 값 | 이 서버가 묶인 repo 경로 | AI 사후수리 | `git` 0 → 12 |

세 번째는 추가 실험이다. `git` 12개가 전부 실패한 뒤 **서버 오류 메시지를 붙여** AI 에
재질의하니 12/12 가 복구됐다. 오류 메시지에 허용 경로가 그대로 적혀 있었기 때문이다.

**AI 가 하드코딩보다 나빠지는 경우도 관측했다.** `server-filesystem` 에서 6 → 1 로 떨어졌다.

```
하드코딩  통과  {"path": "example"}                     상대 경로라 허용 디렉터리 안에서 풀린다
AI       실패  {"path": "/private/tmp/.../scratchpad"}  자기 환경에서 본 절대 경로를 확신 있게 찍었다
                → Access denied - path outside allowed directories
```

이 관측이 §4 의 "후보 추가" 규칙의 근거다. AI 값이 baseline 값을 덮어쓰면 이 툴들에서 손해가
난다.

### 1.3 값 출처 판정이 실패를 예측한다

baseline 이 만든 값의 출처를 세어 실행 결과와 대조했다.

| | 통과 | 실패 |
|---|---|---|
| 확실 (전 필드가 근거 있음) | 13 | **0** |
| 애매 (근거 없는 값 하나 이상) | 15 | 23 |

**확실 쪽 실패가 0건이다.** 실패 23건은 전부 애매 쪽에 몰렸다. 즉 "근거 없는 값이 있으면
AI 를 부른다" 는 규칙은 미탐이 없다. 오탐(부를 필요 없는데 부름)은 15건이다.

이 표가 §3.3 의 판정 기준을 정당화한다. 미탐 0 이 중요한 이유는 ADR-0015 가 이미 정한
"오탐 1건이 미탐 1건보다 비싸다" 와 방향이 같기 때문이다. 여기서 미탐은 "AI 를 불렀어야 하는데
안 불러서 실패를 그대로 사용자에게 넘기는 것" 이다.

### 1.4 경쟁 도구와의 위치

2026-08-17 공개 문서 기준 조사다. 소스까지 확인한 것은 Specmatic 의 공개 글 하나뿐이고,
나머지는 README 기준이다.

| 도구 | 값 합성 | AI | 승인 게이트 | 녹화·재생 |
|---|---|---|---|---|
| Specmatic MCP Auto-Test | 스키마 제약 준수 | 없음 | 없음 | 언급 없음 |
| `r-huijts/mcp-server-tester` | LLM 이 통째로 생성 | 있음 | 없음 | 없음 |
| `haakco/mcp-testing-framework` | Zod 스키마 분석 | 불명 | 없음 | 불명 |
| `devhelmhq/mcp-recorder` · Agent VCR | 해당 없음 | 없음 | 해당 없음 | 있음 |

Specmatic 이 자기 한계로 적어 둔 문장이 이 설계의 2층 구조를 정확히 정당화한다.

> 기계가 읽을 수 있는 제약만 존중한다. 개발자가 규칙을 `description` 에만 적어 두면 잘못된
> 입력을 만든다.

우리 실측의 `mcp-server-time` 이 같은 실패다. `timezone` 필드에 제약 키워드가 없고
`description` 에만 IANA 이름이라 적혀 있다. 하드코딩만으로는 도달할 수 없는 값이고, 이것이
AI 층이 필요한 이유다.

반대로 `mcp-server-tester` 는 LLM 이 만든 케이스를 그대로 오라클로 쓴다. 우리는 AI 를 후보
생성기로만 쓰고 판정은 실제 서버가 한다(ADR-0025). `server-filesystem` 관측이 이 결정의 값어치를
보여준다.

## 2. 비범위

- `pattern`(정규식). 만족하는 문자열 합성은 별개 난이도다. 종전대로 거절한다.
- `multipleOf` · `uniqueItems` · `dependentRequired` · `oneOf`/`anyOf`/`allOf`/`$ref`. 실측에서
  나온 것만 지원한다(YAGNI). `anyOf` 는 `mcp-server-git` 에서 관측됐으나 조합 스키마라
  ADR-0015 의 해석 포기 규칙에 걸린다. 별건이다.
- 자연어 요약 화면("이런 테스트를 진행합니다"). 별개 UX 작업이다.
- 사후수리층의 구조 변경. 이미 구현돼 있고(`packages/cli/src/input-repair.ts`) 이 설계는
  건드리지 않는다.
- `test` 에 `--reset-cmd` 를 추가하는 것. 단계 7(결정론성)의 선행이지 이 작업이 아니다.

## 3. 값 합성 규칙

### 3.1 지원 키워드

`generate` 의 `SUPPORTED_SCHEMA_KEYS`(`packages/generate/src/schema.ts:37`)에 아래를 더한다.

| 분류 | 키워드 |
|---|---|
| 숫자 | `minimum` · `maximum` · `exclusiveMinimum` · `exclusiveMaximum` |
| 배열 | `minItems` · `maxItems` |
| 문자열 | `minLength` · `maxLength` · `format`(표에 있는 값만) |

키워드 값 자체도 검증한다. 실패하면 **새 코드 `INVALID_SCHEMA_CONSTRAINT`** 로 던진다.
`GenerateTestsErrorCode`(`packages/generate/src/schema.ts:6`)에 더한다.

```ts
export type GenerateTestsErrorCode =
  | "INVALID_OPTIONS"
  | "INVALID_TOOL"
  | "OUTPUT_FILE_EXISTS"
  | "UNSUPPORTED_SCHEMA"
  | "INVALID_SCHEMA_CONSTRAINT" // 제약 키워드의 값이 깨졌거나 서로 모순이다
  | "GENERATED_SUITE_INVALID";
```

`UNSUPPORTED_SCHEMA` 와 나누는 이유는 **부분 생성의 발동 조건이 다르기 때문**이다.
`baseline.ts:104` 는 `UNSUPPORTED_SCHEMA` 만 툴 단위로 건너뛰고 나머지는 전체를 멈춘다
(ADR-0036). "우리가 아직 지원하지 않는다" 는 건너뛰어도 되지만 "서버 선언이 깨졌다" 는 사용자가
알아야 할 결함이므로 멈추는 쪽이 맞다. 같은 코드를 쓰면 깨진 선언이 조용히 건너뛰어진다.

- `minimum` · `maximum` · `exclusiveMinimum` · `exclusiveMaximum`: 유한한 숫자
- `minItems` · `maxItems` · `minLength` · `maxLength`: 음이 아닌 정수
- `format`: 문자열. 값이 문자열이 아니면 `INVALID_SCHEMA_CONSTRAINT` 다

### 3.2 값 선택 규칙: 하한 경계값

ADR-0004 의 「값 선택 규칙」을 개정한다. 기존 우선순위(`const` → `default` → `examples[0]` →
`enum[0]`)는 그대로 두고, **타입별 고정값 단계에만** 제약을 반영한다.

숫자(`number` · `integer`):

| 선언 | 값 | 비고 |
|---|---|---|
| `minimum: n` | `n` | 하한을 그대로 쓴다 |
| `exclusiveMinimum: n`, `integer` | `n + 1` | |
| `exclusiveMinimum: n`, `number` | `n + 1` | 정수 단위로 올린다. 임의의 엡실론은 부동소수 재현성이 나쁘다 |
| `maximum: n` (하한 없음) | `n` | |
| `exclusiveMaximum: n`, `integer` | `n - 1` | |
| `exclusiveMaximum: n`, `number` | `n - 1` | |
| 제약 없음 | `0` | 종전과 동일 |

하한이 상한보다 우선한다. 둘 다 있으면 하한을 쓴다.

**중간값을 쓰지 않는 이유:** 한쪽 경계만 선언된 경우(`minimum: 1` 만 있고 상한 없음)에 규칙이
정의되지 않는다. `+1` 인지 `+100` 인지 근거가 없고, 근거 없는 매직넘버는 나중에 아무도 못
고친다. 하한 규칙은 어느 조합에서도 정의된다.

**경계값이 서버의 off-by-one 을 밟을 수 있다는 것은 감수한다.** 그것이 정상 경로 케이스의
목적은 아니지만, 밟으면 dry run 에서 실패로 드러나고 사용자가 분류한다. 오히려 서버 결함을
찾는 쪽이다.

문자열 길이:

`"example"`(7자)에서 시작해 `minLength` 에 못 미치면 `"x"` 를 채워 늘리고, `maxLength` 를
넘으면 앞에서 자른다. `minLength > maxLength` 는 §3.5 의 모순으로 거절한다.

배열:

원소 개수는 `max(minItems, 1)` 이다. `maxItems: 0` 이면 빈 배열이다. 원소는 `items` 스키마에서
재귀 합성하며 전부 같은 값이다(결정론성).

### 3.3 `format` 표

표에 있는 것만 지원한다. 표 밖의 `format` 은 §3.4 로 간다.

| `format` | 값 |
|---|---|
| `uri` · `uri-reference` · `iri` | `"https://example.com"` |
| `date` | `"2000-01-01"` |
| `date-time` | `"2000-01-01T00:00:00Z"` |
| `time` | `"00:00:00"` |
| `duration` | `"P1D"` |
| `email` · `idn-email` | `"user@example.com"` |
| `uuid` | `"00000000-0000-4000-8000-000000000000"` |
| `hostname` | `"example.com"` |
| `ipv4` | `"192.0.2.1"` |
| `ipv6` | `"2001:db8::1"` |

값의 근거: 전부 문서용으로 예약된 것을 쓴다. `example.com`(RFC 2606), `192.0.2.0/24`
(RFC 5737), `2001:db8::/32`(RFC 3849). 실존 자원을 가리키지 않으므로 dry run 이 외부에 부작용을
내지 않는다. UUID 는 버전 4 형식을 만족하는 최소값이다.

**`minLength`·`maxLength` 가 `format` 과 함께 오면 `format` 값을 그대로 쓰고 길이 제약은
무시한다.** 자르면 형식이 깨져 둘 다 못 지킨다. 이 경우 §3.6 의 출처는 `format` 기준으로
`declared` 다. 길이가 안 맞으면 dry run 이 잡는다.

### 3.4 표 밖 `format`: 그 필드는 근거 없음으로 표시하고 값은 종전대로

표 밖 `format` 을 만나면 **거절하지 않는다.** `"example"` 을 넣되 §3.6 의 출처를
`unknownFormat` 으로 표시한다. 그러면 §4 의 판정이 그 툴을 AI 사전보완 대상으로 보낸다.

AI 를 부를 수 없는 경로(`--baseline-only`, provider 자격증명 없음, 비대화형)에서는 **그 툴을
건너뛰고 고지한다.** ADR-0036 의 부분 생성과 같은 방식이다.

```text
경고: 툴 'lookup_host' 를 건너뜁니다.
      format 'hostname' 은 AI 없이 채울 수 없습니다.
      AI 검토(--baseline-only 없이 실행)를 켜면 생성됩니다.
```

문안 근거: 이 프로젝트는 실패 메시지가 곧 제품이다. "지원하지 않는다" 로 끝내면 사용자가 할 수
있는 일이 없다. 해결 수단을 같은 문장에 적는다.

### 3.5 모순 제약은 거절한다

아래는 만족 가능한 값이 없으므로 `INVALID_SCHEMA_CONSTRAINT` 로 거절한다. 경로와 두 값을
메시지에 싣는다.

- `minimum > maximum`
- `exclusiveMinimum >= maximum`, `minimum >= exclusiveMaximum`, `exclusiveMinimum >= exclusiveMaximum`
- `minItems > maxItems`
- `minLength > maxLength`
- `type: "integer"` 인데 `minimum` 과 `maximum` 사이에 정수가 없는 경우
  (예: `minimum: 1.2, maximum: 1.8`)

빈 `enum` 을 거절하는 기존 판단과 같은 계열이다.

### 3.6 값 출처

합성한 값마다 출처를 남긴다. 이것이 §4 판정의 입력이다.

```ts
export type ValueProvenance = "declared" | "placeholder" | "unknownFormat";
```

| 출처 | 언제 |
|---|---|
| `declared` | `const` · `default` · `examples[0]` · `enum[0]` · 표에 있는 `format` · 범위 제약 · `boolean` · `null` · 필수 필드 없는 객체 |
| `placeholder` | 제약이 하나도 없어 `"example"` · `0` 을 넣은 경우 |
| `unknownFormat` | §3.4 |

`boolean` 과 `null` 이 `declared` 인 이유: 후보가 사실상 하나뿐이라 AI 가 개선할 여지가 없다.

출처는 **케이스에 저장하지 않는다.** baseline 생성 결과의 부속 정보로만 전달한다. 명세 파일에
들어가면 승인 지문의 계산 대상이 되고, 우리 판정 규칙이 바뀔 때마다 사용자 명세의 지문이
흔들린다.

## 4. AI 사전보완층

### 4.1 발동 조건

툴 단위로 판정한다. 그 툴의 baseline 케이스에 `placeholder` 또는 `unknownFormat` 출처의 값이
하나라도 있으면 대상이다. 전부 `declared` 면 부르지 않는다.

판정은 결정론적이다. 같은 선언이면 같은 대상 목록이 나온다.

### 4.2 사용자 요청을 받지 않는다

이 층은 **자동**이다. 기존 authoring 층(`authoring-session.ts`)은 사용자의 자연어 요구를 받아
케이스를 추가하는 곳이고, 이 층은 그 앞에서 baseline 의 빈틈을 메운다. 둘은 목적이 다르므로
프롬프트도 출력 스키마도 공유하지 않는다.

ADR-0034 가 진단 통로를 authoring 통로와 분리한 것과 같은 이유다. authoring 출력 스키마는
`suiteJson` 을 요구하므로 재사용하면 AI 가 케이스 구조 전체를 바꿀 수 있다. 여기서 받을 것은
**값뿐**이다.

### 4.3 요청과 응답

요청에 싣는 것: 툴 이름, `description`, `inputSchema`(원문), baseline 이 넣은 값, 그리고 각
값의 출처. 서버를 호출하지 않는다.

응답 스키마는 값만 받는다. `caseId` 는 요청별 `enum` 으로 못 박는다. PR #131 에서 이것을 안
해서 provider 가 여러 id 를 한 항목에 이어 붙였고 검증이 통째로 버렸다.

```ts
interface PreFillProposal {
  readonly caseId: string;   // 요청별 enum 으로 제한
  readonly field: string;    // baseline 이 placeholder 를 넣은 필드만 허용
  readonly value: JsonValue;
}
```

`field` 를 `declared` 인 필드로 지정한 제안은 **버린다.** 근거 있는 값을 AI 가 덮어쓰는 것을
막는다. 버린 개수와 사유를 화면에 적는다(이슈 #120 이 `discarded` 가 개수뿐이라고 지적한 것과
같은 계열이므로 처음부터 사유를 남긴다).

### 4.4 후보로만 추가한다

**AI 값이 baseline 값을 덮어쓰지 않는다.** 케이스마다 baseline 값과 AI 값 두 벌을 들고 dry run
에 넘긴다. 실행 결과로 채택한다.

| baseline | AI | 채택 |
|---|---|---|
| 통과 | 통과 | **baseline** |
| 통과 | 실패 | baseline |
| 실패 | 통과 | **AI** |
| 실패 | 실패 | baseline (분류 화면으로. 사후수리가 이어받는다) |

둘 다 통과하면 baseline 을 쓴다. 결정론적이고 재현 가능한 쪽이 기본값이다.

이 규칙이 `server-filesystem` 관측(6 → 1)을 막는다. 그 툴들에서 baseline 은 통과했고 AI 는
실패했으므로 baseline 이 남는다.

**서버 호출이 케이스당 최대 2회로 는다.** 대상은 §4.1 로 걸러진 툴뿐이다. 실측 기준 51개 중
38개다.

### 4.5 provider 호출 횟수

서버당 1회로 묶는다. 대상 툴 전부를 한 요청에 싣는다. 실측에서 이 방식으로 돌렸다.
`MAX_TOOLS_BYTES` 상한(`authoring-request.ts:283`)과 같은 상한을 쓰고, 넘치면 잘린 사실을
화면에 적는다.

전송 전 확인 화면은 authoring 의 것을 그대로 태운다. 새 문안을 만들지 않는다.

## 5. `RANGE_VIOLATION` 축

### 5.1 축 추가

`runner` 의 `ContractAxisKind`(`packages/runner/src/contract-axes.ts:13`)에 더한다.

```ts
export type ContractAxisKind =
  | "HAPPY_PATH"
  | "REQUIRED_OMITTED"
  | "TYPE_VIOLATION"
  | "ENUM_VIOLATION"
  | "RANGE_VIOLATION"; // 선언된 범위 밖 값을 거절한다
```

`ContractAxis` 에 필드를 더한다. 기존 `declaredType` · `declaredEnum` 과 같은 방식으로,
`RANGE_VIOLATION` 에서만 값이 있고 그 밖에는 `null` 이다.

```ts
/** 선언된 범위. RANGE_VIOLATION 에서만 값이 있고 그 밖에는 null 이다. */
readonly declaredRange: ContractRange | null;

export interface ContractRange {
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly exclusiveMinimum: number | null;
  readonly exclusiveMaximum: number | null;
  readonly minItems: number | null;
  readonly maxItems: number | null;
  readonly minLength: number | null;
  readonly maxLength: number | null;
}
```

축은 필드마다 하나다. 하한과 상한을 따로 축으로 만들지 않는다. 이유는 §5.2 다.

### 5.2 위반 값

`generate` 의 `violation-cases.ts` 가 합성한다. **하한을 한 칸 밖으로 넘긴 값**을 쓴다.
정상 경로가 하한 경계값이므로 위반도 같은 쪽에서 만들어야 사용자가 대응을 읽기 쉽다.

| 선언 | 위반 값 |
|---|---|
| `minimum: n` | `n - 1` |
| `exclusiveMinimum: n` | `n` |
| `minItems: n` (n ≥ 1) | 원소 `n - 1` 개 |
| `minLength: n` (n ≥ 1) | 길이 `n - 1` 문자열 |
| 하한 없이 `maximum: n` | `n + 1` |
| 하한 없이 `exclusiveMaximum: n` | `n` |
| 하한 없이 `maxItems: n` | 원소 `n + 1` 개 |
| 하한 없이 `maxLength: n` | 길이 `n + 1` 문자열 |

**하한이 `0` 이고 타입이 `integer` 이면 위반 값은 `-1` 이다.** 음수를 못 받는 서버가 있을 수
있으나 그것이 곧 검증 대상이다.

**축을 만들지 않는 경우:** `minItems: 0` · `minLength: 0` 처럼 위반 값이 존재하지 않고 상한도
없는 경우다. 위반을 만들 수 없으면 축이 아니다. 이것은 단계 2 의 `VACUOUS_MIN_ITEMS` 와 같은
판단이다.

### 5.3 커버리지 분모

`RANGE_VIOLATION` 축이 커버리지 분모에 들어간다. 기존 축과 같은 계산이다.

**주의:** 이 변경으로 기존 명세의 커버리지 수치가 내려간다. 범위 제약이 있는 툴에 축이 하나
늘고 그것을 덮는 케이스가 없기 때문이다. 이것은 결함이 아니라 이전에 안 보이던 빈틈이 드러난
것이다. 화면에 그 사실을 적는다.

### 5.4 ADR-0021 과의 정합

거절 기대 케이스는 입력 계약 대조에서 제외된다(ADR-0021). `RANGE_VIOLATION` 케이스도 거절 기대
케이스이므로 같은 규칙을 받는다. 그리고 PR #144 가 넣은 `REJECTION_WITHOUT_VIOLATION` advisory
의 판정 재료가 `checkInputContract` 의 위반 목록이므로, 범위 위반을 그 목록에 넣어야 새 케이스가
"아무것도 위반하지 않는다" 로 잘못 걸리지 않는다.

## 6. `runner` 의 제약 해석

`NormalizedField`(`packages/runner/src/input-schema.ts:24`)에 범위를 더한다.

```ts
export interface NormalizedField {
  readonly type: DeclaredType | null;
  readonly enumValues: readonly JsonValue[] | null;
  /** 선언된 범위. 없거나 판정하지 않기로 했으면 null 이다. */
  readonly range: ContractRange | null;
}
```

`BLOCKING_KEYWORDS`(`input-schema.ts:50`)는 **바꾸지 않는다.** 범위 키워드는 지금도 차단 목록에
없어 조용히 무시되고 있었다. 이제 읽기만 하면 된다.

`checkInputContract` 가 범위 위반을 새 `SpecFindingCode` 로 낸다.

```ts
| "RANGE_MISMATCH"   // 명세의 입력값이 선언된 범위를 벗어난다
```

이름이 `RANGE_MISMATCH` 인 이유: 기존 코드가 `TYPE_MISMATCH` · `ENUM_MISMATCH` 로 통일돼 있어
그 계열을 따른다. 축 이름(`RANGE_VIOLATION`)과 finding 이름이 다른 것은 기존 `ENUM_VIOLATION`
축과 `ENUM_MISMATCH` finding 이 이미 그런 관계라서다. 축은 "검증해야 할 것", finding 은
"명세에서 발견한 것" 이다.

**비차단이다.** 단계 2 의 결정을 그대로 따른다. `generate` 승인 화면에서는 경고 후 확인을 한 번
더 받고, `test` 실행에서는 실패한 케이스에만 참고 문장을 덧붙인다.

문장은 `describeSpecFinding` 만 만든다. 다른 패키지가 문장을 만들지 않는다.

```
→ 'count' 값 0 이 선언된 범위를 벗어납니다. 서버 선언: 1 이상 10 이하
→ 값을 범위 안으로 고치거나, 거절을 기대하는 케이스라면 expectError 를 지정하세요.
```

## 7. 패키지 경계와 의존

의존 방향은 그대로다. `cli` → `runner`/`generate` → `core`.

| 심볼 | 소유 | 소비 |
|---|---|---|
| `ContractAxisKind` · `ContractRange` · `NormalizedField.range` | `runner` | `generate` |
| `RANGE_MISMATCH` · `describeSpecFinding` | `runner` | `generate` · `cli` |
| `ValueProvenance` | `generate` | `cli` |
| `format` 표 · 값 선택 규칙 | `generate` | 없음 |

**`generate` → `runner` 승인 심볼 목록이 넓어진다.** `packages/generate/tests/dependency-boundary.test.ts`
가 ADR-0009 의 목록을 코드로 고정하므로, 목록을 넓히려면 **ADR-0009 를 먼저 고쳐야 한다.**
단계 5·6 이 T6b 로 같은 벽에 부딪혔고 그때는 목록을 넓히고 ADR 을 고쳤다. 같은 길로 간다.

`ValueProvenance` 를 `generate` 가 소유하는 이유: 출처 판정은 합성 규칙의 부산물이고 합성은
`generate` 몫이다. `runner` 는 값을 만들지 않으므로 출처를 알 방법이 없다.

## 8. 화면

### 8.1 표 밖 `format` 으로 툴을 건너뛸 때

§3.4 의 문안을 쓴다. 부분 생성(ADR-0036)의 기존 고지와 같은 자리에 붙인다.

### 8.2 AI 사전보완 결과

```text
AI 사전보완: 툴 8개 중 5개에 값 제안을 받았습니다.
  채택 3 (실제 서버에서 baseline 값이 실패하고 제안 값이 통과)
  미채택 2 (baseline 값이 이미 통과)
  버림 1 (근거 있는 값을 덮어쓰려 해서 버렸습니다: get_weather.unit)
```

`버림` 의 사유를 반드시 적는다. 개수만 적으면 이슈 #120 과 같은 문제가 된다.

### 8.3 커버리지

`RANGE_VIOLATION` 을 기존 축과 같은 형식으로 표시한다. §5.3 의 분모 변화 고지를 한 줄 붙인다.

## 9. 테스트

유닛테스트는 인메모리와 `fixtures/` 만 쓴다. 실서버를 띄우는 E2E 는 직렬 전용 웨이브다.

### 9.1 `generate` 값 합성 (`packages/generate/tests/synthesize.test.ts`)

`{ type, 제약 } → 기대값` 표를 케이스로 전개한다.

```
{ type: "integer", minimum: 1, maximum: 10 }        → 1
{ type: "integer", minimum: 0 }                     → 0
{ type: "integer", exclusiveMinimum: 0 }            → 1
{ type: "number",  exclusiveMinimum: 0 }            → 1
{ type: "integer", maximum: 10 }                    → 10
{ type: "integer", exclusiveMaximum: 1000000 }      → 999999
{ type: "integer" }                                 → 0
{ type: "string",  minLength: 10 }                  → "examplexxx"
{ type: "string",  maxLength: 3 }                   → "exa"
{ type: "string",  format: "uri" }                  → "https://example.com"
{ type: "string",  format: "uri", maxLength: 5 }    → "https://example.com"   (format 우선)
{ type: "array", items: { type: "string" }, minItems: 2 } → ["example", "example"]
{ type: "array", items: { type: "string" }, maxItems: 0 } → []
```

우선순위 유지 확인:

```
{ type: "integer", minimum: 5, default: 7 }         → 7   (default 가 범위를 만족)
{ type: "integer", minimum: 5, default: 1 }         → UNSUPPORTED_SCHEMA (default 가 범위 밖)
{ type: "integer", minimum: 5, enum: [7, 9] }       → 7
```

모순 거절:

```
{ type: "integer", minimum: 10, maximum: 1 }        → INVALID_SCHEMA_CONSTRAINT
{ type: "integer", minimum: 1.2, maximum: 1.8 }     → INVALID_SCHEMA_CONSTRAINT (정수 없음)
{ type: "array", minItems: 3, maxItems: 1 }         → INVALID_SCHEMA_CONSTRAINT
{ type: "string", minLength: 5, maxLength: 2 }      → INVALID_SCHEMA_CONSTRAINT
{ type: "integer", minimum: "1" }                   → INVALID_SCHEMA_CONSTRAINT (타입)
{ type: "array", minItems: -1 }                     → INVALID_SCHEMA_CONSTRAINT (음수)
```

이 여섯은 **툴 단위 건너뜀이 아니라 전체 중단**이다. 부분 생성 경로를 타지 않는 것을 단언한다.

### 9.2 값 출처 (`packages/generate/tests/provenance.test.ts`)

```
{ type: "string" }                        → placeholder
{ type: "string", format: "uri" }         → declared
{ type: "string", format: "hostname" }    → unknownFormat
{ type: "integer", minimum: 1 }           → declared
{ type: "integer" }                       → placeholder
{ type: "boolean" }                       → declared
{ type: "object", properties: {}, required: [] } → declared
{ type: "object", required: ["a"], properties: { a: { type: "string" } } } → placeholder
```

툴 단위 판정: 필드 하나라도 `placeholder`·`unknownFormat` 이면 그 툴은 AI 대상이다.

### 9.3 회귀: 기존 거절 테스트를 뒤집는다

`packages/generate/tests/index.test.ts:624-666` 의 세 건(`maximum·minimum` · `minimum 단독` ·
`format`)이 이제 **생성 성공**을 단언하도록 바꾼다. `packages/generate/tests/baseline.test.ts:62`
의 부분 생성 테스트는 `maximum` 대신 여전히 지원하지 않는 키워드(`pattern`)로 바꿔 유지한다.
부분 생성 자체는 살아 있어야 한다.

### 9.4 결정론성 (`packages/generate/tests/baseline.test.ts`)

같은 `ToolDef[]` 로 두 번 생성해 `baselineFingerprint` 가 같은지 단언한다. 범위 제약과 `format`
을 가진 툴을 포함한다.

### 9.5 `runner` 축 (`packages/runner/tests/contract-axes.test.ts`)

```
{ type: "integer", minimum: 1 }        → RANGE_VIOLATION 축 1개, 위반 값 0
{ type: "integer", minimum: 0 }        → RANGE_VIOLATION 축 1개, 위반 값 -1
{ type: "array", minItems: 0 }         → 축 없음 (위반 불가, 상한 없음)
{ type: "array", minItems: 0, maxItems: 3 } → RANGE_VIOLATION 축 1개, 원소 4개
{ type: "integer" }                    → 축 없음
```

축 순서가 결정론적인지 단언한다. 기존 축과 같이 코드 단위 오름차순이다.

### 9.6 `checkInputContract` (`packages/runner/tests/input-contract.test.ts`)

```
선언 { count: { type: "integer", minimum: 1 } }, 입력 { count: 0 }
  → RANGE_MISMATCH 1건
선언 같음, 입력 { count: 1 }
  → 0건
거절 기대 케이스(expectError)에서는 억제된다 (ADR-0021)
REJECTION_WITHOUT_VIOLATION 판정 재료에 범위 위반이 포함된다 (PR #144)
```

### 9.7 AI 사전보완 (`packages/generate/tests/pre-fill.test.ts`)

provider 는 가짜로 주입한다. 실제 호출하지 않는다.

```
전 필드 declared 인 툴만 있는 서버       → 요청이 만들어지지 않는다
placeholder 있는 툴 포함                 → 그 툴만 요청에 실린다
제안이 declared 필드를 가리킴            → 버려지고 사유가 결과에 남는다
제안 caseId 가 요청 enum 밖              → 버려진다
baseline 통과 + AI 통과                  → baseline 채택
baseline 실패 + AI 통과                  → AI 채택
baseline 실패 + AI 실패                  → baseline 유지, 분류 대상
```

### 9.8 E2E (직렬 웨이브)

`mcp-server-fetch` 를 실제로 띄워 `generate --baseline-only` 로 케이스가 1개 이상 나오는지
확인한다. 이 서버는 Python `mcp` 2.x 에서 `McpError` 임포트가 깨지므로 `uvx --with "mcp<2"` 로
고정해 띄운다(`docs/adoption.md` §1.5).

`examples/weather-server` 대상 기존 E2E 가 계속 통과하는지 확인한다.

## 10. 실측 재현 방법

§1.2 의 표는 스크래치패드에서 만들었고 원자료는 휘발됐다. 재현이 필요하면 아래 순서다.

1. 대상 서버 6개를 stdio 로 띄워 `tools/list` 로 선언을 받는다. Python 서버는
   `uvx --with "mcp<2" <name>` 으로 고정한다.
2. 툴마다 세 가지 값을 만든다. (a) 현행 규칙 (b) §3 의 규칙 (c) provider 에 스키마만 주고 받은 값
3. 셋을 같은 서버에 `tools/call` 로 실행해 `isError` 를 기록한다
4. 사후수리 확인은 (b) 로 실패한 케이스에 **서버 오류 메시지를 붙여** provider 에 재질의하고
   다시 실행한다

`server-filesystem` 과 `mcp-server-git` 은 임시 디렉터리를 만들어 그것만 허용 경로로 준다.
부작용이 그 안에 갇힌다.

## 11. ADR

| 번호 | 내용 |
|---|---|
| ADR-0004 개정 | 「값 선택 규칙」에 범위 제약과 `format` 표를 더한다. 「자동 생성하지 않는 범위」에서 `minimum`·`maximum`·`format` 을 뺀다 |
| ADR-0009 개정 | `generate` → `runner` 승인 심볼 목록에 `ContractRange` 등을 더한다 |
| 신규 | AI 사전보완층. 자동 provider 호출의 경계, 후보 추가 규칙, `declared` 필드 보호 |
| 신규 | 값 출처 계층. 세 범주와 각 범주의 해결 주체, 실측 근거 |

**번호는 착수 시점에 빈 것을 잡되 머지 시점에 밀릴 수 있다.** 단계 4 에서 0028 이 먼저 들어와
0034 로 밀린 전례가 있다. 착수 확인으로 못 막는다.

## 12. 미결

- **`exclusiveMinimum` 의 boolean 형식.** JSON Schema draft-04 는 `exclusiveMinimum: true` 로
  쓰고 draft-06 이후는 숫자다. 실측에서 boolean 형식을 보지 못했다. 지금은 숫자만 받고
  boolean 이면 `INVALID_SCHEMA_CONSTRAINT` 로 거절한다. 실제로 나오면 그때 정한다.
- **`format` 표 확장 기준.** 실측에서 나온 것만 넣는다는 원칙은 정했으나, 사용자가 표에 없는
  `format` 을 자주 만나면 이슈로 받을지 옵션으로 열지 정하지 않았다.
- **AI 사전보완의 provider 실패 처리.** 실패하면 baseline 값으로 진행하고 화면에 적는 것이
  기본이나, `--baseline-only` 가 아닌데 provider 가 죽은 경우 §3.4 의 툴 건너뜀을 적용할지
  결정하지 않았다.

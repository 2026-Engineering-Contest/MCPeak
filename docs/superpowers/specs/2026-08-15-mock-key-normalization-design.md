# 목 매칭 키 정규화 경계 설계 (2026-08-15)

- 대상 패키지: `@ohmymcp/mock`
- 파트: ③ mock server (`@storyrago`)
- 관련 결정: ADR-0003(카세트 매칭 키), ADR-0005(목 데이터 생성 전략), ADR-0007(목 stdio 트랜스포트)
- 관련 변경: #69(인자 매칭 키에서 `undefined` 키 제외)

## 1. 배경

### 1.1 `stableKey` 가 하는 일

`mock` 은 주입한 응답을 `Map` 에 담고, 그 키를 `stableKey` 가 만든다.

```
put()    ← mock.on() 주입 · 정의 파일 시드      사용자가 코드/JSON 으로 쓴 값
lookup() ← 들어온 호출마다                      와이어(JSON-RPC)를 건너온 값
```

이 함수의 임무는 두 가지다.

1. 같은 의미의 인자면 같은 문자열 — 아니면 주입해두고 못 찾는다
2. 다른 의미의 인자면 다른 문자열 — 아니면 엉뚱한 응답이 나간다

### 1.2 여섯 부류에서 둘 다 깨진다

현재 구현을 `record` 의 `stableStringify` 와 같은 입력으로 대조한 결과다.

| 입력 | `record` | `mock` (현재) | 결과 |
|---|---|---|---|
| 순환 참조 | `TypeError` | `RangeError: Maximum call stack size exceeded` | 프로세스가 읽을 수 없는 오류로 죽는다 |
| 희소 배열 `[1,,3]` | `TypeError` | `[1,,3]` | 와이어는 `[1,null,3]` 로 도착 — 영영 못 찾는다 |
| `NaN` · `Infinity` | `TypeError` | `null` | `null` 주입과 같은 키 — 엉뚱한 응답 |
| 함수 · 심볼 | `TypeError` | `null` | 위와 같음 |
| `Date` | `TypeError` | `{}` | 모든 `Date` 가 같은 키 |
| `BigInt` | `TypeError`(한국어) | `TypeError`(영어, `JSON.stringify` 것) | 문장만 어긋남 |

앞의 둘은 **못 찾는** 실패이고, 뒤의 셋은 **잘못 찾는** 실패다. 후자가 더 나쁘다.

```js
mock.on("t", { n: NaN },      A);   // 키 {"n":null}
mock.on("t", { n: Infinity }, B);   // 키 {"n":null}  ← A 를 덮어쓴다
// 호출 { n: null } → B. 오류도 경고도 없다.
```

여섯 부류는 전부 **와이어로 도달할 수 없다.** JSON 에 `NaN` · `Date` · 함수 · 순환 · 희소가 없기
때문이다. 즉 `mock.on()` 주입으로만 생긴다. #69 에서 고친 `undefined` 건과 같은 부류이며, 그때
하나만 맞추고 나머지를 남겨둔 것이다.

### 1.3 깊이는 다르다 — 와이어로 도달한다

측정값이다.

```
깊이  2000 → JSON.parse OK,  stableKey OK
깊이  4000 → JSON.parse OK,  stableKey RangeError: Maximum call stack size exceeded
깊이 10000 → JSON.parse OK,  stableKey RangeError
```

`JSON.parse` 는 1만 단계를 만들고 재귀인 `stableKey` 는 4000 쯤에서 스택이 터진다. **1.2 의
여섯과 달리 이것은 실제 MCP 호출로 도달한다.** 목은 테스트 대상 프로세스라 여기서 죽으면
테스트 전체가 무너진다.

### 1.4 무엇을 만드는가

주입 경로에 거부 검사를 넣고, 공유 경로에 깊이 상한을 넣는다. 판정 집합은 `record` 와 같게
맞추고 문장은 `mock` 관례로 쓴다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

- `record` 의 `stableStringify` 와 **거부하는 입력 집합이 같다**
- 거부할 때 사용자가 **어느 인자가 왜 문제인지, 무엇을 하면 되는지** 읽을 수 있다
- 깊은 중첩이 프로세스를 죽이지 않는다
- #69 에서 맞춘 `undefined` 동작이 유지된다

### 비범위

- **해시 키로 바꾸지 않는다.** §10 의 1번 참조
- `stableKey` 를 반복문으로 재작성하지 않는다. §7.2 참조
- 사용자 정의 매칭 함수 · 부분 일치 · 와일드카드 (ADR-0005 가 이미 비범위로 둠)
- 공개 API 변경 없음 — 이 설계의 함수는 전부 모듈 내부이며 `index.ts` 에서 export 하지 않는다

### 완료 조건

1. 여섯 부류 전부 주입 시점에 거부되고, 문장 6종이 전문 그대로 테스트에 고정돼 있다
2. `mock.on(tool, ANY, result)` 와 정의 파일의 `args` 생략이 그대로 동작한다
3. 깊이 초과가 주입에서는 throw, 조회에서는 `isError: true` 응답이며 **프로세스가 살아 있다**
4. 각 회귀 테스트를 수정 없이 돌려 실패하는 것을 확인했다
5. `pnpm test` · `typecheck` · `lint` · `build` · `test:e2e` 통과

## 3. 거부 집합 (전량)

`record` 의 술어를 그대로 옮긴다.

| `kind` | 판정 | 예 |
|---|---|---|
| `circular` | 조상 집합에 이미 있는 객체 | `o.self = o` |
| `sparse` | `Object.hasOwn(arr, i)` 가 false 인 자리 | `[1,,3]` |
| `nonFinite` | `typeof v === "number" && !Number.isFinite(v)` | `NaN`, `Infinity`, `-Infinity` |
| `notJson` | 배열도 plain object 도 아닌 것 | `Date`, 함수, 심볼, `BigInt`, `Map`, `Set`, `RegExp`, 클래스 인스턴스 |
| `tooDeep` | 깊이 > `MAX_KEY_DEPTH` | §7 |

**`undefined` 는 거부하지 않는다.** 객체 프로퍼티면 제외하고, 배열 원소면 `null` 로 둔다.
#69 에서 맞춘 동작이자 ADR-0003 과 같은 규칙이다.

## 4. 검사 배치

| 무엇 | 어디 | 왜 |
|---|---|---|
| `circular` · `sparse` · `nonFinite` · `notJson` | `put()` — 주입 시점 | 와이어로 도달 불가. 호출마다 도는 조회 경로에 검사 비용을 지울 이유가 없다 |
| `tooDeep` | `stableKey()` — 공유 | 와이어로 도달 가능(§1.3). 조회 경로도 막아야 한다 |

같은 규칙을 두 군데 두는 것이 아니라 **도달 경로가 다른 두 문제**라 자리가 다르다. 두 함수는
소스에서 나란히 두고 주석으로 묶는다.

### 4.1 `ANY` 는 심볼이다 — 검사 순서

```ts
function put(registry, tool, args, result, source) {
  if (args === ANY) { registry.any.set(tool, result); return; }   // ← 검사는 반드시 이 뒤
  assertKeyable(args ?? {}, tool, source);
  registry.exact.set(`${tool}|${stableKey(args ?? {})}`, result);
}
```

`ANY` 는 `Symbol.for("ohmymcp.mock.any")` 라서 `notJson` 에 걸린다. 검사를 `ANY` 분기보다 앞에
두면 **정상 기능이 죽는다.** §8-③ 이 이것을 고정한다.

### 4.2 조회 경로의 깊이 초과

`stableKey` 가 던지는 `KeyDepthError` 를 **`CallToolRequestSchema` 핸들러가 잡아**
`missMessage` 와 같은 방식으로 `isError: true` 응답(§6.6)으로 바꾼다. 목 서버가 죽으면
테스트 전체가 무너지기 때문이다.

`KeyDepthError` 외의 예외는 잡지 않는다. 목의 버그를 조용히 삼키면 §1.2 와 같은 종류의
결함이 다시 생긴다.

## 5. 타입 시그니처 (전량)

```ts
/**
 * stableKey 로 키를 만들 수 없는 값. 판별 유니온이라 문장(§6)이 쓰는 필드가
 * kind 마다 정확히 하나로 정해진다 — 없는 필드를 참조할 수 없다.
 *
 * path 는 루트가 "args", 중첩은 `args.items[2].when`.
 * tooDeep 에는 path 가 없다. 512 단계짜리 경로는 문장에 넣을 수 없기 때문이다.
 */
type KeyViolation =
  | { kind: "circular"; path: string }                   // §6.1
  | { kind: "sparse"; path: string }                     // §6.2
  | { kind: "nonFinite"; path: string; found: string }   // §6.3 — "NaN" · "Infinity"
  | { kind: "notJson"; path: string; found: string }     // §6.4 — "Date" · "function" · "Map"
  | { kind: "tooDeep"; depth: number };                  // §6.5

/** 위반을 찾는다. 없으면 undefined. 순수 함수 — 던지지 않는다. */
function findKeyViolation(value: unknown): KeyViolation | undefined;

/** 주입 경로 전용. 위반이면 §6 의 문장으로 throw. */
function assertKeyable(value: unknown, tool: string, source: string): void;

/** 깊이 상한. 넘으면 KeyDepthError. */
const MAX_KEY_DEPTH = 512;
class KeyDepthError extends Error {
  readonly depth: number;
}

/** 시그니처 확장 — depth 는 재귀 내부용이며 외부 호출자는 넘기지 않는다. */
function stableKey(value: unknown, depth?: number): string;

/** source 는 문장에 들어갈 진입점 표기. "mock.on('add', ...)" 또는 "정의 파일의 responses[0]" */
function put(registry: Registry, tool: string, args: unknown, result: unknown, source: string): void;
```

`findKeyViolation` 을 던지지 않는 순수 함수로 둔 이유는 **판정과 문장을 분리**하기 위해서다.
그래야 판정을 표 기반 테스트로 전량 고정할 수 있고, 문장은 `assertKeyable` 한 곳에서만 만든다.

### 5.1 깊이를 두 곳에서 세는 이유

`tooDeep` 만 검출 지점이 둘이다. 중복이 아니라 **경로가 둘이기 때문**이다.

| 경로 | 검출 | 결과 |
|---|---|---|
| 주입 | `findKeyViolation` — 어차피 값을 순회하므로 깊이를 함께 센다 | `assertKeyable` 이 §6.5 로 throw |
| 조회 | `stableKey` 의 깊이 인자 — `findKeyViolation` 을 부르지 않는다 | `KeyDepthError` → 핸들러가 §6.6 응답으로 변환 |

두 곳이 **같은 `MAX_KEY_DEPTH` 상수를 참조**한다. 상수를 공유하지 않으면 두 경로의 판정이
갈리고, 그것이 바로 이 설계가 고치려는 종류의 결함이다.

## 6. 오류 문안 (전량)

기존 두 오류(`missMessage`, `assertMockDefinition`)의 형태를 따른다 — `→` 접두사, 값은 콜론이나
대시 뒤에, 마지막 줄은 무엇을 하면 되는지.

```
→ {진입점} 의 인자로 매칭 키를 만들 수 없습니다: {원인}
→ 위치: {경로} {발견}
→ {왜 도달 불가한지} {어떻게 고치는지}
```

### 6.1 순환 참조

```
→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 순환 참조
→ 위치: args.self
→ JSON 에는 순환 참조가 없어서 이 주입은 어떤 호출과도 맞지 않습니다. 참조를 끊고 값을 펼쳐 넘기세요.
```

### 6.2 희소 배열

```
→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 희소 배열
→ 위치: args.items[1] — 비어 있는 자리
→ 와이어를 건너오면 빈 자리가 null 로 채워집니다. 빈 자리에 null 을 명시하세요.
```

### 6.3 유한하지 않은 수

```
→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 유한하지 않은 수
→ 위치: args.n — 발견: NaN
→ JSON 에는 NaN · Infinity 가 없습니다. 유한한 수를 쓰거나 그 상태를 나타내는 문자열을 쓰세요.
```

### 6.4 JSON 으로 표현할 수 없는 값

```
→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: JSON 으로 표현할 수 없는 값
→ 위치: args.when — 발견: Date
→ 매칭 키가 되는 것은 객체 · 배열 · 문자열 · 유한한 수 · 불리언 · null 뿐입니다. 직렬화한 값으로 바꿔 넘기세요 (예: Date → toISOString()).
```

### 6.5 너무 깊은 중첩 — 주입 시점

```
→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 중첩이 너무 깊습니다
→ 위치: 깊이 513 — 상한: 512
→ 목에 넘기는 인자는 테스트가 읽을 수 있는 크기여야 합니다. 필요한 필드만 넘기세요.
```

### 6.6 너무 깊은 중첩 — 조회 시점 (`isError: true` 응답)

```
→ 툴 'add' 의 호출 인자로 매칭 키를 만들 수 없습니다: 중첩이 너무 깊습니다 (깊이 513, 상한 512)
→ 목은 이 인자를 주입된 어떤 응답과도 비교할 수 없습니다. 호출 쪽 인자를 줄이세요.
```

### 6.7 정의 파일 경로

`{진입점}` 만 바뀐다.

```
→ 정의 파일의 responses[0] 의 인자로 매칭 키를 만들 수 없습니다: 유한하지 않은 수
```

### 6.8 문장 규칙

**변하는 값 뒤에 은/는 · 이/가 · 을/를 · 로/으로를 붙이지 않는다.** 경로(`args.n` vs
`args.items`)와 발견 표기(`Date` vs `Map`)는 받침 유무가 갈려 어느 쪽으로 고정해도 한쪽이
틀린다. `docs/reports/task-b6.md` 가 모델 이름에서 같은 문제를 겪고 내린 결론이다. 그래서 변하는
값은 전부 콜론이나 대시 뒤에 둔다.

## 7. 깊이 상한

- `MAX_KEY_DEPTH = 512`
- 루트가 깊이 0. 512 를 **넘을 때** 거부한다
- 주입 경로는 throw(§6.5), 조회 경로는 `isError` 응답(§6.6)

### 7.1 512 인 이유

측정상 실패는 2000~4000 사이에서 난다. 상한을 실패 지점 가까이 두면 Node 버전 · 스택 여유에
따라 흔들린다. 512 는 실패 지점에서 충분히 멀고, 테스트가 읽을 수 있는 인자의 현실적인 상한보다
충분히 크다.

### 7.2 왜 반복문으로 재작성하지 않는가

`record` 의 `stableStringify` 는 명시적 프레임 스택 40여 줄이고 `mock` 의 `stableKey` 는 8 줄이다.
고칠 가치가 있는 것은 "4000 단계를 지원하는 것"이 아니라 **"프로세스가 읽을 수 없는 오류로
죽는 것"** 이며, 상한 하나로 그것이 닫힌다. 상한값과 반복문 재작성이 업그레이드 경로라는 것을
소스 주석에 남긴다.

## 8. 테스트 (전량)

**① `findKeyViolation` 판정 — 표 기반**

4 부류 × 위치 3 종(루트 / 중첩 객체 / 배열 원소). `kind` 와 `path` 를 함께 단언해 위치 계산까지
고정한다.

```
{ n: NaN }              → nonFinite, "args.n"
{ a: { b: Infinity } }  → nonFinite, "args.a.b"
{ items: [1, NaN] }     → nonFinite, "args.items[1]"
{ items: [1, , 3] }     → sparse,    "args.items[1]"
{ when: new Date() }    → notJson,   "args.when"
{ f: () => {} }         → notJson,   "args.f"
순환                     → circular,  "args.self"
```

통과 케이스도 같은 표에 둔다 — `{}`, `{ a: undefined }`, `[1, undefined, 3]`, 중첩 객체 · 배열.
**#69 에서 맞춘 `undefined` 동작이 이번 변경으로 깨지지 않는 것**을 여기서 고정한다.

**② 문장 전문 고정**

§6 의 6 종을 글자 그대로 단언한다. PR #56 이 `BODY_SCHEMA_MISMATCH` 에서 쓴 방식과 같다.

**③ `ANY` 회귀**

`mock.on(tool, ANY, result)` 와 정의 파일의 `args` 생략이 그대로 동작한다. 인자 지정본이 `ANY`
보다 우선하는 것도 함께 본다. **검사 순서를 틀리면 여기서 잡힌다.**

**④ 깊이 양쪽 경로**

주입은 throw, 조회는 `isError: true` 응답. 조회 쪽은 **응답을 받은 뒤 서버가 살아 있어 다음
호출에 정상 응답하는 것**까지 확인한다.

**⑤ 기존 동작 불변**

키 순서 무관, 같은 호출 3 회 바이트 동일.

**⑥ 역검증**

각 회귀 테스트를 수정 없이 한 번 돌려 실패하는 것을 본다 (`CLAUDE.local.md` §2). 통과만 보고
넘기면 아무것도 검증하지 않는 테스트가 섞인다.

**E2E 는 추가하지 않는다.** stdio 정의 파일은 `JSON.parse` 결과라 네 부류가 구조적으로 들어올 수
없다. #70 의 4 케이스로 충분하며, 억지 케이스는 실행 시간만 늘린다.

## 9. 릴리스와 호환성

**breaking change** 다. 지금 통과하던 주입이 거부된다.

| | |
|---|---|
| 버전 | `0.1.2` → **`0.2.0`** (minor). CONTRIBUTING §7 상 0.x 에서 breaking 허용, CHANGELOG 필수 |
| 저장소 내부 영향 | 없음 — 해당 주입이 0 건인 것을 확인했다 |
| 외부 사용자 | 0 명 — npm 미배포(#71) |
| changeset | CONTRIBUTING §7 대로 릴리스 노트로 읽히게 쓴다 |

## 10. ADR 대상

"다르게 갈 수도 있었던" 판단 세 가지를 한 건으로 남긴다.

1. **`record` 처럼 해시 키로 가지 않는다.** 정규화는 공유하고 직렬화는 다르게 둔다.
   ADR-0003 이 `matchKey` 를 SHA-256 hex 로 정한 이유는 결정론성이 아니라 **비밀값 누출** 이다 —
   카세트는 파일로 남고 키 문자열은 `redact()` 를 거치지 않는다. `mock` 의 키는 디스크에 가지
   않으므로 그 구멍이 없고, 반대로 **키가 실패 메시지에 그대로 찍히는 사용자 화면**이다.
   해시로 바꾸면 `→ 이 툴에 주입된 인자: 3f2a9c...` 가 되어 "실패 메시지가 곧 제품" 에 어긋난다.
   **적어두지 않으면 나중에 두 패키지를 통일하려는 시도가 나온다.**
2. **검사를 두 곳에 나눈다.** 도달 경로가 다르기 때문이다(§4).
3. **깊이는 상한으로 막고 반복문 재작성을 미룬다.** 업그레이드 경로를 남긴다(§7.2).

번호는 **작성 직전에 다시 확인한다.** 이 설계를 쓰는 사이에도 ADR 이 0019 에서 0024 까지
늘었고, 이미 `0007` 이 두 개 있다.

## 11. 미결

- `0007` 번호 충돌(`0007-mock-stdio-transport` 와 `0007-provider-전송-스키마-분리`) 해소는 이
  작업의 범위가 아니다. 별도로 처리한다.
- ADR-0005 · ADR-0007 이 아직 "제안" 상태다. 이 작업의 ADR 을 낼 때 함께 승인으로 올릴지는
  오너 판단이다.

# CodeRabbit 지적 코드 3건 수정 보고

## 실행 환경

```
$ pwd
<worktree>/ohmymcp-body-fix

$ git rev-parse HEAD
43554cf139f0837d31cc459b0158c370c67831e0
```

브랜치 `feat/runner-body-assertion`. git 명령은 조회만 했고 커밋·머지·푸시는 실행하지 않았다.

## 변경 파일

```
 M packages/runner/src/schema-match.ts
 M packages/runner/src/spec/json-schema.ts
 M packages/runner/src/spec/validation.ts
 M packages/runner/tests/spec-schema.test.ts
?? packages/runner/tests/deep-and-cyclic-input.test.ts
?? docs/reports/task-fix2.md
```

`packages/cli` 와 다른 패키지는 무변경이다. 기존 `docs/reports/*.md` 와 ADR 은 건드리지 않았다.

재현 테스트는 `packages/runner/tests/deep-and-cyclic-input.test.ts` 에 결함 1과 2를,
결함 3의 parity fixture 는 지시대로 `packages/runner/tests/spec-schema.test.ts` 에 넣었다.
구현 전에 실행해 7개 실패를 확인했다.

```
$ pnpm vitest run packages/runner/tests/deep-and-cyclic-input.test.ts packages/runner/tests/spec-schema.test.ts
 × 안전 정수 상한을 두 계약이 같이 본다
 × 깊이 10000 배열 const 비교에서 예외가 없다        RangeError: Maximum call stack size exceeded
 × 깊이 20000 객체 const 비교에서 예외가 없다        RangeError: Maximum call stack size exceeded
 × 깊이 10000 enum 비교에서 예외가 없다              RangeError: Maximum call stack size exceeded
 × 깊이 10000 구조가 서로 같으면 위반이 없다         RangeError: Maximum call stack size exceeded
 × 자기 자신을 가리키는 properties를 거부한다         RangeError: Invalid string length  (18954ms)
 × items와 additionalProperties의 순환도 거부한다     RangeError: Invalid string length  (44354ms)
 Test Files  2 failed (2)
```

순환 테스트 두 개가 각각 19초와 44초를 태운 것이 결함 2의 심각성을 그대로 보여준다.
수정 뒤에는 두 테스트 모두 1ms 미만이다.

## 결함별 재현과 수정

### 1. (Major) `jsonEqual` 재귀

**재현** 서로 다른 깊은 구조를 `const` 나 `enum` 으로 비교하면 스택이 넘친다.
같은 객체를 넣으면 `left === right` 로 단락돼 터지지 않으므로 잎의 값을 다르게 둔 구조 두 개를
만들었다(`deepArray(10_000, 1)` 대 `deepArray(10_000, 2)`).

이 PR 은 "순회는 재귀가 아니라 명시적 프레임 스택" 을 계약으로 내세웠는데 `const` 와 `enum`
경로에만 재귀가 남아 있었다. 노드 순회는 스택 안전한데 값 비교는 아니었다.

**수정** `jsonEqual` 을 비교 프레임 스택으로 바꿨다. `{ left, right }` 쌍을 스택에 쌓고
pop 하면서 판정한다.

동작을 재귀판과 같게 유지한 부분은 다음과 같다.

- `left === right` 이면 그 쌍은 더 보지 않는다(참조가 같으면 깊이 비교가 필요 없다).
- 배열은 길이가 다르면 즉시 `false`.
- 객체는 키를 정렬한 뒤 개수가 다르거나 같은 자리의 키 이름이 다르면 즉시 `false`.
- 정렬은 그대로 `Array.prototype.sort` 기본 비교(UTF-16 코드 단위)다.
- 한쪽만 배열이거나 둘 다 plain object 가 아니면 `false`.

**확인** 빌드 산출물로도 확인했다.

```
D1 depth5000: CONST_MISMATCH
D1 depth20000: CONST_MISMATCH
```

리뷰가 재현에 쓴 깊이 5000 과 20000 이 모두 예외 없이 위반을 낸다.

### 2. (Major) 순환 스키마가 프로세스를 멈춘다

**재현** `properties.self` 가 자기 자신을 가리키면 프레임이 무한히 늘고 경로 문자열이 계속
길어져 `RangeError: Invalid string length` 로 죽는다. 라이브러리 호출자가 JSON 이 아닌 객체를
그대로 넘기면 프로세스가 멈춘다.

**수정** 같은 파일의 `json()` 과 같은 방식을 썼다. 프레임을 `visit` 과 `leave` 두 종류로 나누고
활성 조상 집합(`active`)을 둔다. 방문할 때 집합에 넣고 `leave` 프레임을 함께 쌓아 그 서브트리를
빠져나올 때 지운다. 이미 활성 집합에 있는 객체를 다시 만나면 순환이다.

새 이슈 코드를 만들지 않고 기존 `INVALID_JSON_VALUE` 를 쓴다. `json()` 이 순환 JSON 값에
쓰는 코드와 같고, 순환하는 스키마는 애초에 JSON 으로 직렬화할 수 없는 값이라 뜻이 맞는다.
문안만 전용으로 썼다.

```
스키마가 자기 자신을 참조해 순환합니다.
힌트: 순환 참조를 없애세요. 명세는 JSON으로 직렬화할 수 있어야 합니다.
```

`properties.self`, `items`, `additionalProperties` 세 경로를 모두 테스트로 걸었다.
같은 하위 스키마 객체를 여러 자리에 공유하는 것은 순환이 아니므로 계속 통과한다
(`leave` 프레임이 서브트리를 빠져나올 때 집합에서 지우기 때문이다). 이 대조군도 테스트에 있다.

**확인**

```
D2 cyclic: false | 스키마가 자기 자신을 참조해 순환합니다.
```

### 3. (Minor) `nonNegativeInteger` 의 상한 누락

**재현** 공개 스키마는 `{type:"integer",minimum:0}` 이라 `2^53` 을 허용하는데 런타임
`nonNegativeInt` 는 `Number.isSafeInteger` 로 거부한다. `minItems: 2**53` 이 런타임에서만
`INVALID_VALUE` 였다.

**수정** `nonNegativeInteger` 에 `maximum: Number.MAX_SAFE_INTEGER` 를 추가했다.
parity 평가기는 `maximum` 을 이미 지원하므로(`schema-evaluator.ts` 의 `maximum mismatch` 판정)
평가기를 넓힐 필요는 없었다. 설계 §441 이 요구하는 parity fixture 는
`spec-schema.test.ts` 에 넣었고 두 경계를 함께 고정한다.

- `minItems: 2 ** 53` 은 양쪽 계약 모두 invalid
- `minItems: Number.MAX_SAFE_INTEGER` 는 양쪽 계약 모두 valid

## 검증 명령과 출력

```
$ pnpm vitest run packages/runner
 Test Files  12 passed (12)
      Tests  207 passed (207)
```

2회 실행 모두 `207 passed` 로 동일했다.

```
$ pnpm build
 Tasks:    6 successful, 6 total

$ pnpm typecheck
 Tasks:    6 successful, 6 total

$ pnpm lint
> biome check .
Checked 114 files in 24ms. No fixes applied.

$ pnpm test
 Test Files  34 passed (34)
      Tests  506 passed | 1 skipped (507)

$ node packages/cli/tests/dist-cli-e2e.mjs
E2E EXIT 0
```

린트는 첫 실행에서 `validation.ts` 포맷 1건이 걸려 그 파일만 고쳤다.
전체 테스트는 이전 497 에서 재현 테스트 9개가 늘어 506 이다.

E2E 는 `pnpm build` 뒤에 돌렸고 종료 코드 0 이다. E2E 의 문장 고정
(`$.temperature: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temp'`)과
`bodyMatchesSchema` 가 없는 기존 스위트의 보고서 바이트 회귀 테스트가 그대로 통과한다.

## 내가 임의로 판단한 부분

1. **결함 2의 이슈 코드로 `INVALID_JSON_VALUE` 를 골랐다.** 후보는 `INVALID_VALUE` 와
   `INVALID_JSON_VALUE` 둘이었다. 같은 파일의 `json()` 이 순환에 쓰는 코드가
   `INVALID_JSON_VALUE` 라 선례가 있고, 순환 스키마는 JSON 으로 직렬화할 수 없다는 사실이
   원인을 정확히 가리킨다. 새 코드는 만들지 않았다.

2. **순환 판정의 범위를 "지금 내려가는 경로" 로 잡았다.** 같은 객체를 형제 자리 여럿에서
   공유하는 것은 정상이므로 거부하면 안 된다. 방문 기록을 영구히 쌓는 대신 `leave` 프레임으로
   서브트리를 빠져나올 때 지운다. `json()` 과 같은 방식이다. 대조군 테스트를 함께 넣었다.

3. **`jsonEqual` 의 순환 입력은 이번 범위 밖으로 뒀다.** 재귀판은 순환 값에서 `RangeError` 로
   죽었고 스택판은 무한 루프가 된다. 다만 `const` 와 `enum` 값은 명세에서 오고
   `validateResponseSchema` 가 `json()` 으로 순환을 이미 거부한다. 응답 본문은 `JSON.parse`
   결과라 순환이 없다. 즉 정상 경로로는 순환 값이 `jsonEqual` 에 도달하지 않는다.
   `matchResponseSchema` 를 검증을 건너뛰고 직접 부르는 호출자만 해당하며, 지금 계약에는 그런
   경로가 없다. 필요하다고 판단하면 별건으로 알려달라.

4. **결함 1 테스트의 깊이를 10000 과 20000 으로 잡았다.** 지시가 "10000 이상" 이고 리뷰가
   5000 과 20000 으로 재현했다. 배열은 10000, 객체는 20000 으로 두어 두 분기를 모두 덮었다.
   수정 전에는 두 깊이 모두 실제로 `RangeError` 를 냈음을 확인했다.

5. **결함 1의 단락 동작을 별도 테스트로 고정했다.** 깊이만 보면 정렬과 단락이 조용히 바뀌어도
   드러나지 않는다. 배열 길이 불일치, 객체 키 이름 불일치, 키 순서만 다른 동일 객체 세 가지를
   함께 걸었다.

## 계약 관련 확인 사항

- `core/src/types.ts` 무변경. 의존성 추가 없음. sdk 버전 변경 없음.
- 문안 변경 없음. 결함 2가 문장을 하나 추가할 뿐 기존 11종 위반 문장과 요약 문장은 그대로다.
- 공개 JSON Schema 변경은 `nonNegativeInteger` 의 `maximum` 하나이며 parity fixture 로 고정했다.
- 유닛테스트는 인메모리 값만 쓴다. 실제 서버 프로세스를 띄우지 않는다.

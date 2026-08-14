# T2: `deriveContractAxes`

계획서 `docs/superpowers/plans/2026-08-15-contract-axis-coverage-implementation.md` 의 Task 2 를
Step 1~6 그대로 구현했다. 타입 4개는 설계서 §3.2 의 것을 주석까지 그대로 옮겼다.

## 바꾼 파일

- 신규 `packages/runner/src/contract-axes.ts`
  - `ContractAxisKind`, `ContractAxis`, `ContractDeclaredType`, `ContractAxesResult` 를 설계서
    §3.2 원문 그대로 선언했다.
  - `deriveContractAxes(tool, options?)` 는 계획서 Step 3 코드 그대로다. `duplicated` 가 true 면
    `duplicateTool` 사유로 끝내고, `analyzeInputSchema` 가 포기하면 그 사유를 그대로 옮긴다.
  - `matchCoveredAxes` 는 만들지 않았다. T3 범위다.
- 신규 `packages/runner/tests/contract-axes.test.ts` (18개)
  - 계획서 Step 1 의 7개 + 설계서 §10.1 의 `deriveContractAxes` 블록 전량을 옮겼다.
  - 오케스트레이터가 지목한 케이스를 포함했다: `required` 에 있지만 `properties` 에 없는 필드는
    `REQUIRED_OMITTED` 축만 생기고 `TYPE_VIOLATION` 축은 안 생긴다.
- 수정 `packages/runner/src/index.ts` (계획서 Step 5 의 export 블록 추가만. 기존 export 는
  그대로다)

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/runner/tests/contract-axes.test.ts` (구현 전) | `Test Files  1 failed (1)` / `Tests  18 failed (18)` |
| `pnpm vitest run packages/runner/tests/contract-axes.test.ts` (구현 후) | `Test Files  1 passed (1)` / `Tests  18 passed (18)` |
| `pnpm vitest run packages/runner` | `Test Files  21 passed (21)` / `Tests  435 passed (435)` |
| `pnpm typecheck --force` | `Tasks:    6 successful, 6 total` / `Cached:    0 cached, 6 total` |
| `pnpm lint` | `Checked 143 files in 28ms. No fixes applied.` |

T1 기준 417 개에서 18 개가 늘어 435 개다.

## 리뷰 지적 수정: 중복 `required` 이름

리뷰에서 결함 하나를 받아 고쳤다. `required: ["a", "a"]` 처럼 서버가 같은 이름을 두 번 적으면
`REQUIRED_OMITTED:a` 축이 두 개 생겼다. `ContractAxis` 주석의 "같은 툴 안에서 (kind, field)
쌍은 유일하다" 계약이 깨지고, 커버리지 분모가 부풀어 케이스 하나가 덮는 축이 둘로 세어진다.

`contract-axes.ts` 안에서만 고쳤다. `REQUIRED_OMITTED` 순회를
`[...new Set(analysis.schema.required)].sort(byCodeUnit)` 로 바꾸고 근거를 주석으로 남겼다.
`Set` 이 삽입 순서를 보존하고 그 뒤에 정렬하므로 결정론은 그대로다. `input-schema.ts` 의
`required` 는 T1 의 무손실 계약이라 건드리지 않았다.

테스트 두 개를 추가했다.

- `required` 에 같은 이름이 두 번이면 `REQUIRED_OMITTED` 축이 하나만 생긴다
- 그 경우 축이 `HAPPY_PATH`, `REQUIRED_OMITTED:a`, `TYPE_VIOLATION:a` 셋이다

수정 후 판정 줄이다.

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/runner/tests/contract-axes.test.ts` | `Test Files  1 passed (1)` / `Tests  20 passed (20)` |
| `pnpm vitest run packages/runner` | `Test Files  21 passed (21)` / `Tests  437 passed (437)` |
| `pnpm typecheck --force` | `Tasks:    6 successful, 6 total` / `Cached:    0 cached, 6 total` |
| `pnpm lint` | `Checked 143 files in 34ms. No fixes applied.` |

## 임의로 판단한 지점

1. 설계서 §10.1 의 항목 중 여러 개를 한 테스트로 합친 곳이 둘 있다. `declaredType` 은
   TYPE_VIOLATION 에서만, `declaredEnum` 은 ENUM_VIOLATION 에서만 값이 있다는 두 항목을 한
   테스트에서 모든 축을 순회하며 확인한다. 항목별로 쪼개도 같은 것을 두 번 도는 셈이라 합쳤다.
2. "required 없고 properties 없는 object 스키마는 analyzable false" 항목은 사유가 `properties`
   임까지 함께 단언했다. 설계서 §3.2 가 사유 문자열을 계약으로 못 박고 있어서다.
3. 정렬 테스트의 입력에 `A`(대문자)와 `a`(소문자)를 함께 넣었다. 코드 단위 비교와 로캘 비교가
   갈리는 지점이라 `byCodeUnit` 이 아닌 비교자를 쓰면 이 테스트가 깨진다.
4. `index.ts` 의 export 는 알파벳 순서를 지켜 `canonical.js` 다음에 넣었다. 기존 export 블록은
   손대지 않았다.

## 남은 위험

- `deriveContractAxes` 는 `properties` 한 겹만 본다. 중첩 객체 안의 필드는 축이 되지 않고
  `unanalyzedFields` 에도 안 들어간다. 설계서 §4.2 의 의도이지만 커버리지 분모가 중첩 필드를
  세지 않는다는 사실 자체는 화면에 드러나지 않는다.
- `duplicated` 판정은 호출자 몫이다. T7 의 `computeCoverage` 와 `buildSuite` 가 이것을 안 넘기면
  중복 툴이 조용히 축으로 세어진다. 이 파일 안에서는 막을 수 없다.
- `unanalyzedFields` 는 `analyzeInputSchema` 의 배열을 그대로 재노출한다. 복사하지 않으므로
  호출자가 이 배열을 변형하면 원본이 함께 바뀐다. 현재 타입이 `readonly string[]` 이라
  타입 수준에서는 막혀 있다.

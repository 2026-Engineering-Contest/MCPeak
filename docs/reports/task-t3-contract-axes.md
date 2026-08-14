# T3: `matchCoveredAxes`

계획서 `docs/superpowers/plans/2026-08-15-contract-axis-coverage-implementation.md` 의 Task 3 을
Step 1~6 그대로 구현했다. 판정 규칙은 설계서 §6.2 다.

## 바꾼 파일

- 수정 `packages/runner/src/contract-axes.ts`
  - `matchCoveredAxes({ testCase, tool })` 와 비공개 `violatedAxes`, 비공개 축 생성 헬퍼
    `contractAxis(tool, ...)` 를 추가했다.
  - `checkInputContract` 를 호출하지 않는다. `analyzeInputSchema`, `judgeField`(T1 의
    `input-schema.ts`), `expectedIsError`(T1 의 `case-expectation.ts`) 를 직접 쓴다. T4 가
    거절 기대 케이스의 finding 을 침묵시켜도 이 판정은 영향을 받지 않는다.
  - `deriveContractAxes` 는 고치지 않았다.
- 수정 `packages/runner/src/index.ts` (`matchCoveredAxes` 한 줄 추가만)
- 수정 `packages/runner/tests/contract-axes.test.ts` (`matchCoveredAxes` 블록 13개 추가. 기존
  20개 단언은 그대로다)

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/runner/tests/contract-axes.test.ts` (구현 전) | `Tests  12 failed | 20 passed | 1 todo (33)` |
| `pnpm vitest run packages/runner/tests/contract-axes.test.ts` (구현 후) | `Test Files  1 passed (1)` / `Tests  32 passed | 1 todo (33)` |
| `pnpm vitest run packages/runner` | `Test Files  21 passed (21)` / `Tests  449 passed | 1 todo (450)` |
| `pnpm typecheck --force` | `Tasks:    6 successful, 6 total` / `Cached:    0 cached, 6 total` |
| `pnpm lint` | `Checked 143 files in 29ms. No fixes applied.` |

todo 1개는 지시대로 남긴 "checkInputContract 가 침묵하는 케이스에서도 축을 낸다" 다. 지금은
`checkInputContract` 가 `add-missing` 류 케이스에 finding 을 1건 내므로 T4 없이는 실패한다. T4 의
Step 에서 켠다.

## 임의로 판단한 지점

1. **축 생성 헬퍼를 `deriveContractAxes` 와 공유하지 않았다.** 계획서 Step 3 은 두 곳의 축 생성
   코드를 지역 헬퍼로 합치라고 하는데, 배정 프롬프트가 `deriveContractAxes` 를 고치지 말라고
   해서 그쪽의 지역 `axis` 클로저를 그대로 뒀다. 새 `contractAxis` 는 계획서가 요구한 대로
   `tool` 을 인자로 받는 모듈 수준 순수 함수이고 `matchCoveredAxes` 쪽만 쓴다. 완전히 합치려면
   `deriveContractAxes` 의 두 줄을 바꿔야 하므로 판단을 넘긴다.
2. `violatedAxes` 의 `required` 순회에도 T2 리뷰에서 고친 것과 같은 중복 제거를
   (`[...new Set(schema.required)]`) 넣었다. 안 넣으면 `required: ["a","a"]` 인 서버에서 한
   케이스가 같은 축을 두 번 덮는 것으로 세어져 `deriveContractAxes` 의 분모와 어긋난다.
3. 설계서 §10.1 의 "선언되지 않은 툴을 부르는 케이스는 빈 배열이다" 는 `matchCoveredAxes` 가
   툴을 인자로 받는 형태라 "케이스의 tool 이름이 넘어온 툴과 다르면 빈 배열" 로 옮겼다.
   선언 목록 조회는 이 함수의 책임이 아니고 T7 의 `computeCoverage` 몫이다.
4. §10.1 의 "반환 배열이 §4.4 순서로 정렬돼 있다" 는 세 종류 축이 한 번에 나오는 입력
   (`{ b: 0, units: "k" }`, 필수 `a` 누락)으로 확인한다.
5. 해석 불가 스키마 툴에서 빈 배열이 나오는 것을 테스트로 추가했다. §6.2 규칙에는 있지만
   §10.1 목록에는 없다.

## 남은 위험

- todo 하나가 남아 있다. T4 를 하기 전까지 "두 함수가 서로 독립"이라는 이 태스크의 핵심 성질은
  코드로만 보장되고 테스트로는 안 잡힌다.
- `matchCoveredAxes` 는 `analyzeInputSchema` 를 케이스마다 다시 부른다. T7 이 케이스 N개를
  돌리면 같은 툴 스키마를 N번 정규화한다. 결정론에는 영향이 없고 성능만의 문제다. 필요하면
  T7 에서 호출자가 캐시한다.
- 중복 툴 이름(`duplicateTool`)은 이 함수가 모른다. 툴 하나만 받기 때문이다.
  **T7 구현으로 무해함이 확인됐다.** `coverage.ts` 의 `computeCoverage` 는 `AxisCoverage` 를
  `derived.axes` 로만 만들고 `matchCoveredAxes` 결과는 그 축에 `caseId` 를 채우는 데만 쓴다.
  `verified` 와 `total` 도 그 배열에서 세므로 중복 툴이면 축이 빈 배열이라 채울 자리가 없고
  분자도 0이다. 즉 분자만 늘어나는 상황은 `computeCoverage` 경로에서는 생기지 않는다.
  남는 위험은 **이 함수를 직접 부르는 다른 호출자**다. 축 목록과 짝지어 쓰지 않고 반환 개수를
  그대로 세면 중복 툴에서 과대 집계가 된다. `computeCoverage` 의 구조가 그 짝지음을 강제한다.

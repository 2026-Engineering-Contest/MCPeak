# T4: 거절 기대 케이스를 입력 계약 대조에서 제외

계획서 `docs/superpowers/plans/2026-08-15-contract-axis-coverage-implementation.md` 의 Task 4 를
Step 1~6 그대로 구현했다. 규칙은 설계서 §6.3 · §11.1 이다.

## 바꾼 파일

- 수정 `packages/runner/src/input-contract.ts`
  - `SUPPRESSED_WHEN_REJECTION_EXPECTED: ReadonlySet<SpecFindingCode>` 를 추가했다
    (`REQUIRED_MISSING`, `UNDECLARED_FIELD`, `TYPE_MISMATCH`, `ENUM_MISMATCH`).
  - 케이스 루프에서 `expectedIsError(testCase) === true` 이면 그 넷을 걸러낸다. 걸러내기를
    정렬·절단·합산 **전에** 하고 `totalFindings` 도 걸러낸 뒤 개수로 센다.
  - `expectedIsError` 가 `null` 이면 침묵시키지 않는다. isError 단언이 없는 케이스와 expected 가
    서로 다른 단언이 둘인 모순된 명세가 여기 해당한다.
  - `TOOL_NOT_DECLARED` 와 `SCHEMA_NOT_ANALYZABLE` 은 그대로 낸다.
- 수정 `packages/runner/tests/input-contract.test.ts`
  - `거절 기대 케이스 제외` describe 를 추가했다(11개). 기존 56개 단언은 그대로다.
  - 설계서 §10.3 목록 전량 + 계획서 Step 1 의 6개를 덮는다. 마지막 항목은 §5.5 표의 케이스
    8개를 리터럴로 적어 검증한다. `generate` 를 import 하지 않았다.
- 수정 `packages/runner/tests/contract-axes.test.ts`
  - T3 에서 `it.todo` 로 남긴 "checkInputContract 가 침묵하는 케이스에서도 축을 낸다" 를 `it` 으로
    켰다. 그 테스트가 쓰는 `checkInputContract` import 를 추가했다. 다른 단언은 안 고쳤다.
- 신규 `docs/adr/0021-거절-기대-케이스의-입력-계약-대조-제외.md` (상태 `제안`)

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/runner/tests/input-contract.test.ts` (구현 전) | `Tests  6 failed \| 61 passed (67)` |
| `pnpm vitest run packages/runner/tests/input-contract.test.ts` (구현 후) | `Test Files  1 passed (1)` / `Tests  67 passed (67)` |
| `pnpm vitest run packages/runner/tests/contract-axes.test.ts` | `Test Files  1 passed (1)` / `Tests  33 passed (33)` (todo 0개) |
| `pnpm vitest run packages/runner` | `Test Files  21 passed (21)` / `Tests  461 passed (461)` |
| `pnpm typecheck --force` | `Tasks:    6 successful, 6 total` / `Cached:    0 cached, 6 total` |
| `pnpm lint` | `Checked 143 files in 29ms. No fixes applied.` |

`ls docs/adr/` 로 확인한 결과 마지막 번호가 0020 이라 0021 이 비어 있었다.

## 임의로 판단한 지점

1. 설계서 §10.3 목록에 없는 테스트를 하나 더 넣었다. "침묵시킨 finding 은 totalFindings 에도
   남지 않는다" 다. 필수 누락·선언되지 않은 필드·enum 위반이 한 케이스에 겹친 입력으로
   `{ findings: [], totalFindings: 0 }` 을 확인한다. 이 순서(걸러내기가 합산보다 먼저)가 이
   태스크에서 틀리기 쉬운 지점이라 단독 테스트를 뒀다.
2. 계획서 Step 1 의 테스트 코드는 `rejecting({}).cases[0]` 를 펼치며 `as never` 를 쓴다. 기존
   파일의 `suiteOf(...)` 헬퍼로 케이스 리터럴을 직접 넘겨 `as never` 없이 같은 것을 확인하도록
   바꿨다. 타입 단언을 테스트에 남기면 나중에 스펙이 바뀌어도 컴파일러가 안 잡는다.
3. 침묵 대상 코드 목록에 `SpecFindingCode` 타입을 붙였다(`ReadonlySet<SpecFindingCode>`).
   지시받은 대로이고, 이 때문에 T1 에서 지웠던 `SpecFindingCode` import 가 다시 살아났다.
4. ADR 본문은 설계서 §11.1 의 선택지 A~D 와 결정·이유를 옮기되, 결과 절에 커버리지 판정이 이
   침묵과 독립이어야 한다는 항목을 추가했다. T3 의 테스트가 그 성질을 고정하고 있어 ADR 이
   그것을 가리키는 편이 낫다고 봤다.

## 남은 위험

- **`docs/adr/README.md` 의 색인 표에 0021 행이 없다.** 그 파일이 허용 Files 밖이라 고치지
  않았다. 다른 ADR 은 전부 그 표에 있으므로 통합 시점에 한 줄 추가가 필요하다.
- 미탐이 생겼다. `isError: true` 케이스에 진짜 오타가 있어도 조용하다. ADR-0021 이 감수한
  비용으로 적혀 있지만 사용자에게 보이는 신호는 아무것도 없다.
- 이 규칙은 `isError expected true` 하나에 걸려 있다. 사용자가 정상 케이스에 실수로
  `expected: true` 를 적으면 그 케이스의 입력 오타가 전부 침묵한다. 구분할 방법이 현재 없다
  (설계서 §12 의 마지막 항목과 같은 뿌리다).
- §5.5 의 케이스 8개가 테스트에 리터럴로 박혀 있다. `generate` 쪽 생성 규칙이 바뀌면 이 테스트가
  깨지는 것이 의도지만, 반대로 이 테스트만 고치고 넘어가면 계약이 조용히 갈라진다.

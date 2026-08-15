# Task R1: 교정 대상 판별 (`cli`)

계획서 `docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md` §4 R1 을 구현했다.
설계 근거는 `docs/superpowers/specs/2026-08-15-dry-run-input-repair-design.md` §4.2 다.

브랜치 `feat/dry-run-repair-target`, 기반 커밋 `d10a50a`.

## 바꾼 파일

| 파일 | 상태 |
|---|---|
| `packages/cli/src/repair-target.ts` | 신규 |
| `packages/cli/tests/repair-target.test.ts` | 신규 |

허용 목록 밖의 파일은 건드리지 않았다. `git status --short` 에 위 두 개만 나온다.

```
?? packages/cli/src/repair-target.ts
?? packages/cli/tests/repair-target.test.ts
```

공개 계약(`RepairTarget`, `RepairAttempt`, `selectRepairTargets`)은 계획서에 적힌 그대로다.
`RepairAttempt` 는 R5(분류 화면의 시도 이력)가 쓸 타입이라 이번 태스크에서는 소비처가 없다.
계약에 적혀 있으므로 함께 내보낸다.

판별 규칙 여섯 개를 계획서 표 순서대로 구현했다.

1. `outcome.status !== "passed"`
2. `case.operation.type === "callTool"`
3. `Object.keys(case.operation.input).length > 0`
4. `origins.get(caseId) !== "user"` (`origins` 에 없으면 `schemaBaseline` 으로 본다)
5. `isError` 단언의 `expected !== true`
6. `outcome.detail` 에 `isError` 로 시작하는 단언 줄이 있다

반환 배열은 `outcomes` 순서이고 정렬하지 않는다.

## 검증

### `pnpm test`

첫 실행은 계획서에 이미 적혀 있던 것과 같은 증상으로 1건 실패했다. 내 변경과 무관한
`packages/core/tests/stdio-integration.test.ts` 의 좀비 프로세스 검사다.

```
 ❯ assertNoResidue packages/core/tests/stdio-integration.test.ts:39:15
     39|   expect(pid).toSatisfy(

 Test Files  1 failed | 54 passed (55)
      Tests  1 failed | 1150 passed | 1 skipped (1152)
```

재실행하면 통과한다. 이후 두 번 더 돌렸고 모두 통과했다.

```
 Test Files  55 passed (55)
      Tests  1151 passed | 1 skipped (1152)
   Start at  18:07:27
   Duration  1.78s (transform 2.48s, setup 0ms, import 4.75s, tests 6.89s, environment 2ms)
```

신규 스펙 단독 실행도 12건 전부 통과한다.

```
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

### `pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
  Time:    1.754s
```

`Cached: 0 cached` 를 확인했다. turbo 캐시가 이전 녹색을 재생한 것이 아니다.

### `pnpm lint`

```
> biome check .

Checked 160 files in 41ms. No fixes applied.
```

첫 실행에서 신규 두 파일의 포매팅 오류 2건이 났고 `biome check --write` 로 그 두 파일만
고쳤다. 규칙 위반이 아니라 줄바꿈 위치 문제였다.

## 임의로 판단한 지점

### 1. `serverMessage` 를 어느 줄에서 뽑는가

계획서는 "`outcome.detail` 에서 서버 오류 본문 줄만 뽑는다" 까지만 적고 어느 줄인지는
말하지 않는다. 실제 렌더러를 읽고 정했다.

`renderReport` 가 그리는 케이스 본문 줄은 세 종류다. 단언 줄(`isError  정상 응답을 ...`),
위반 줄(`→ ...`), 해결 줄(`해결: ...`). 이 중 **서버가 돌려준 값이 실려 있는 것은 위반 줄뿐이다.**
`isErrorMismatchDiagnostic` 은 `violations` 를 만들지 않고 문장도 우리가 쓴 고정 문구라
서버 응답이 한 글자도 들어가지 않는다. 반면 `bodyMatchesSchema` 의 위반 줄은
`실제: string ("city 는 서울/부산 중 하나여야 합니다.")` 처럼 응답 본문을 담는다.

그래서 `→ ` 로 시작하는 줄에서 표시만 떼고 순서대로 개행으로 이어 붙인다. 문장을 새로
만들지 않는다. 위반 줄이 없으면 빈 문자열이다.

**따르는 결과 하나를 적어 둔다.** `isError` 단언 하나만 달린 케이스는 위반 줄이 생기지
않으므로 `serverMessage` 가 항상 빈 문자열이다. 즉 설계서 §8.6.1(근거가 없을 때) 화면으로
간다. 근거 있는 화면 §8.6 은 케이스에 `bodyMatchesSchema` 가 함께 달려 있을 때 나온다.
R3 가 이 전제 위에서 동작한다. 다른 뜻이었다면 이 함수의 추출 규칙을 고쳐야 한다.

### 2. 명세에 없는 `caseId` 는 건너뛴다

`outcomes` 에 있는데 `suite.cases` 에 없는 `caseId` 는 대상에서 뺐다. 입력도 단언도 모르는
채로 고칠 방법이 없다. 계획서에 안 적힌 경우라 방어적으로 처리했고 별도 테스트는 두지 않았다.

### 3. 테스트가 `detail` 을 손으로 적지 않는다

`runDryRun` 에 인메모리 가짜 클라이언트를 물려 실제 실행을 거친 `outcomes` 를 만든다.
`detail` 문자열을 테스트 안에서 지어내면 렌더러 형식이 바뀌었을 때 테스트만 통과하고
제품이 깨진다. 서버 프로세스는 띄우지 않고 `examples/` 도 쓰지 않는다.

### 4. "통과한 케이스" 테스트에 단언을 하나 더 붙였다

계획서가 준 이름 12개를 그대로 썼고 개수도 늘리지 않았다. 다만 `통과한 케이스는 대상이 아니다`
는 그대로 두면 규칙 1을 검사하지 못한다. 통과한 케이스는 `detail` 이 비어 있어 규칙 6에서
먼저 걸러지기 때문이다. 실제로 `status` 검사를 지우고 돌려 봤더니 테스트가 그대로 통과했다.

그래서 같은 테스트 안에서, 실패한 케이스의 `outcome` 에 `status: "passed"` 만 붙여
`selectRepairTargets` 를 직접 부르는 단언을 하나 더 넣었다. 이제 규칙 여섯 개를 하나씩
지웠을 때 각각 정확히 한 건씩 실패한다.

| 지운 규칙 | 결과 |
|---|---|
| `status === "passed"` | 1 failed |
| `operation.type !== "callTool"` | 1 failed |
| 입력 키 0개 | 1 failed |
| `origin === "user"` | 1 failed |
| `expected === true` | 1 failed |
| `isError` 줄 없음 | 1 failed |

## 남은 위험

- **`serverMessage` 의 근거가 `bodyMatchesSchema` 에 달려 있다.** 위 임의 판단 1의 결과다.
  베이스라인 생성이 `isError` 단언만 붙이는 경로가 있다면 그 케이스들은 AI 제안 없이 곧바로
  사람 입력으로 간다. R3 를 시작하기 전에 이 전제가 맞는지 확인하는 편이 좋다.
- **`isError` 로 시작하는 줄을 찾는 방식은 단언 타입 이름에 묶여 있다.** 지금 단언 타입은
  `toolExists` / `isError` / `bodyMatchesSchema` 셋뿐이라 `isError` 로 시작하는 다른 타입이
  없다. 나중에 `isErrorCode` 같은 타입이 생기면 오탐이 난다.
- `packages/core/tests/stdio-integration.test.ts` 의 첫 실행 실패는 이 태스크와 무관하지만
  통합 게이트에서 다시 만날 수 있다.

## 커밋 메시지

```
feat(cli): 시험 실행 실패에서 입력값 교정 대상을 가려낸다
```

커밋은 하지 않았다.

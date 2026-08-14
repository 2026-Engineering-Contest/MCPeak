# T3b · T4 보고서

T3b(provider→세션 경로 회귀 테스트)와 T4(`cli` 승인 화면 표시와 재확인)를 이어서 수행했다.
커밋은 하지 않았다.

**판정: READY_FOR_REVIEW.** 내 판정 대상 게이트는 전부 녹색이다. 남은 lint 오류 넷은 전부
동시 작업자(T5)의 `test-command.ts` · `test-command.test.ts` 것이라 손대지 않았다.

---

## T3b: provider→세션 경로 회귀 테스트

### 바꾼 파일

`packages/generate/tests/authoring-request.test.ts` 하나뿐이다. 소스는 변경 0건이며
`git diff --stat -- packages/generate/src/` 가 빈 출력임을 확인했다.

- `dispatchWithProviderSuite` 에 `withSession?: boolean` 를 더했다. `true` 면 같은 baseline 으로
  만든 세션을 dispatch 에 넘겨 `reviewLocalAuthoringCandidate` 경로를 타게 한다.
- 테스트 `session 을 넘긴 경로에서도 ENUM_MISMATCH 가 나지 않는다` 를 추가했다.

### 되돌려 빨간불을 확인했다 (지시대로)

`authoring-request.ts` 의 세션 경로 `tools: state.unredactedTools` 를 `state.tools` 로 되돌리자
새 테스트가 정확히 그것만 잡았다.

```
FAIL  session 을 넘긴 경로에서도 ENUM_MISMATCH 가 나지 않는다
AssertionError: expected [ { code: 'ENUM_MISMATCH', …(5) } ] to deeply equal []
Tests  1 failed | 34 passed (35)
```

확인 뒤 원래대로 돌려놨다.

### 여기서 발견한 결함 하나 (중요)

**기존 T3 의 enum 테스트가 회귀를 못 잡고 있었다.** 입력이 `units: "f"` 였는데 민감 값으로 지정한
것은 `"c"` 다. 치환된 도구 목록에서도 선언 enum 이 `["[REDACTED]", "f"]` 가 되어 `"f"` 는 여전히
허용값에 남는다. 즉 치환 여부와 무관하게 통과하는 테스트였다. 계획서 스니펫이 그렇게 적혀
있었고 내가 T3 에서 그대로 옮겼다. 내 잘못이다.

입력을 `units: "c"` 로 바꿔 고쳤다. 이제 치환된 목록에서는 enum 이 `["[REDACTED]", "f"]` 가 되어
`"c"` 가 위반으로 뒤집힌다. 두 테스트(provider 경로 · 세션 경로) 모두 각각 소스를 되돌려 실제로
빨간불이 나는 것을 확인했다.

| 되돌린 줄 | 빨간불이 난 테스트 |
|---|---|
| `checkInputContract({ suite, tools: state.tools })` | `enum 값이 민감 값과 같아도 ENUM_MISMATCH 가 나지 않는다` |
| `reviewLocalAuthoringCandidate({ ..., tools: state.tools })` | `session 을 넘긴 경로에서도 ENUM_MISMATCH 가 나지 않는다` |

### 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/generate/tests/authoring-request.test.ts` | `Test Files  1 passed (1)` / `Tests  35 passed (35)` |
| `git diff --stat -- packages/generate/src/` | 빈 출력 (소스 변경 0) |

---

## T4: `cli` 승인 화면 표시와 재확인

### 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/src/generate-command.ts` | `describeSpecFinding`·`SpecFinding` import, 지역 함수 `isViolation`·`findingsForSelection`·`confirmSpecFindings` 추가, `select`/`apply-all` 분기의 기존 확인 **앞**에 호출 |
| `packages/cli/tests/generate-command.test.ts` | 헬퍼 넷과 테스트 일곱 추가 |

`packages/cli/src/test-command.ts` 와 `packages/cli/tests/test-command.test.ts` 는 건드리지
않았다. `packages/core`·`packages/runner`·`packages/generate`·루트 빌드 설정도 변경 0건이다.

### 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/cli/tests/generate-command.test.ts packages/cli/tests/generate-integration.test.ts` | `Test Files  2 passed (2)` / `Tests  91 passed (91)` |
| `npx turbo typecheck --force` | `Tasks:    6 successful, 6 total` / `Cached:    0 cached, 6 total` |
| `npx biome check packages/cli/src/generate-command.ts packages/cli/tests/generate-command.test.ts` | `No fixes applied` (내 파일 통과) |
| `pnpm lint` (전체) | `Found 2 errors. Found 2 warnings.` — 넷 전부 `packages/cli/src/test-command.ts` · `packages/cli/tests/test-command.test.ts` 의 미사용 import 와 정렬. T5 작업 중 상태다 |

`pnpm test` 전체는 지시대로 돌리지 않았다.

### 표시 규칙 다섯 항목을 어떻게 지켰는가

1. **change ID 선택 뒤에 찍는다.** `showDiff` 직후가 아니라 `selected` 가 정해진 다음, 기존
   `io.confirm("선택한 변경을 적용할까요?")` 앞이다.
2. **caseId 없는 change 는 집합에 아무것도 안 넣는다.** `"caseId" in change` 로 거른다.
   `suiteMetadata` · `caseOrder` 만 고르면 집합이 비어 finding 이 하나도 안 걸린다.
3. **`SCHEMA_NOT_ANALYZABLE` 은 개수에서 뺀다.** `isViolation` 이 그 코드만 제외하고, 빠진
   개수를 별도 줄로 알린다.
4. **문장은 `describeSpecFinding` 만 만든다.** CLI 는 `     ` 들여쓰기와 `  → ` 만 붙인다.
5. **거부하지 않는다.** 확인을 하나 더 받을 뿐이고, `false` 면 메뉴로 돌아간다.

`byCase` 는 `Map` 삽입 순서 그대로 순회한다. 정렬 호출이 없다.

### 임의로 판단한 지점

**1) 헬퍼 이름 대응.** 계획서 스니펫의 `fakeIO([...])` · `runGenerate({ io, candidate })` 는 이
파일에 없다. 실존 헬퍼 `reviewDeps(choices, inputs, confirms)` 와 `runGenerateCommand(argv, deps)`
를 쓰고, 그 위에 `findingsDeps(...)` 를 새로 만들었다.

| 계획서 | 실제 |
|---|---|
| `fakeIO(["select", "change-001", "y", "cancel"])` | `reviewDeps(["edit","select","cancel"], ["candidate.json","change-001"], [true])` — choices·inputs·confirms 가 세 배열로 갈려 있다 |
| `runGenerate({ io, candidate })` | `runGenerateCommand(interactiveArgv, d.value)` |
| `io.written` | `d.io.write.mock.calls` (지역 헬퍼 `writtenText` 로 모은다) |
| `io.confirms` | `d.io.confirm.mock.calls` (지역 헬퍼 `confirmMessages`) |
| `candidateWithFindings` 등 | `findingsDeps(...)` 가 리터럴 candidate·diff 를 만들어 주입한다 |

**2) candidate·diff·apply 를 전부 리터럴로 주입했다.** 계획서가 "실제 `generate` 함수를 부르지
않고 리터럴로 만든다" 고 지시한 대로다. 다만 `createAuthoringDiff` 와 `applyAuthoringChanges` 도
함께 주입해야 했다. 실제 `createAuthoringDiff` 는 candidate 가 자기 `WeakMap` 에 등록돼 있어야
하는데 리터럴 candidate 는 등록되지 않아 `등록되지 않은 authoring candidate입니다.` 로 던진다.
이 테스트가 지키려는 것은 표시와 게이트 조건이지 검사 로직이 아니다(그쪽은 `runner` 테스트가
덮는다).

**3) 계획서에 없는 테스트 둘을 더했다.**
   - `caseId 가 없는 change 만 고르면 경고가 없다` — 표시 규칙 2번을 직접 고정한다.
   - `assertionSubstance finding 도 같은 목록에 함께 센다` — `findingsForSelection` 이 두 배열을
     이어 붙인다는 사실을 고정한다. 계획서 테스트 다섯 개는 전부 `inputContract` 만 쓴다.

**4) `confirmSpecFindings` 를 함수로 뽑았다.** 계획서 스니펫은 코드를 `runInteractiveReview`
본문에 인라인으로 넣는다. 그 함수가 이미 길고 `continue` 가 여러 개라, 표시와 게이트를 한
함수로 묶고 `boolean` 을 돌려받게 했다. 동작은 스니펫과 같다.

**5) mock 호출 인자를 좁히는 지역 헬퍼 둘.** `reviewDeps` 의 `vi.fn` 이 파라미터를 선언하지
않아 `mock.calls` 원소가 빈 튜플로 추론되고, `([text]) => text` 가 `TS2493` 로 깨진다.
`reviewDeps` 는 다른 테스트가 함께 쓰므로 시그니처를 바꾸지 않고 `writtenText` ·
`confirmMessages` 두 헬퍼에서 한 번만 좁혔다.

### 새 테스트가 실제로 무는지 확인했다

`confirmSpecFindings` 호출 줄을 지우고 돌려 넷이 빨간불이 나는 것을 확인한 뒤 되돌렸다.

```
FAIL  위반 케이스를 고르면 문장과 재확인이 나온다
FAIL  재확인에서 거부하면 적용하지 않는다
FAIL  SCHEMA_NOT_ANALYZABLE 은 위반 개수에서 빠지고 별도 줄로 나온다
FAIL  assertionSubstance finding 도 같은 목록에 함께 센다
Tests  4 failed | 83 passed (87)
```

나머지 셋(`선택한 change 의 케이스에 걸린 finding 만 센다`, `finding 이 없으면 아무 줄도 늘지
않는다`, `caseId 가 없는 change 만 고르면 경고가 없다`)은 **부재를 단언하는 테스트**라 기능이
없어도 통과한다. 의도한 것이다. 이 셋이 막는 것은 반대 방향의 회귀, 즉 나중에 누가 선택 필터를
빼서 고르지도 않은 케이스의 위반을 찍는 경우다.

## 남은 위험

1. **표시 코드가 `select`/`apply-all` 분기에만 있다.** `edit` 로 candidate 를 새로 만든 직후에는
   diff 만 보이고 finding 은 안 보인다. 사용자가 `apply-all`/`select` 로 넘어가야 나온다.
   계획서 표시 규칙 1번이 그렇게 정한 것이라 의도대로지만, "왜 아까는 경고가 없었지" 로 읽힐
   여지는 있다.
2. **리터럴 주입 테스트는 실제 `generate` 가 채우는 `specFindings` 모양과 어긋나도 모른다.**
   타입으로만 묶여 있고, 두 패키지를 함께 태우는 것은 `generate-integration.test.ts` 인데 거기에
   finding 이 나오는 경로는 없다. T6 실환경 확인에서 실제로 문장이 찍히는지 봐야 한다.
3. **`byCase` 순서가 `runner` 순서라는 사실을 고정하는 테스트가 없다.** 지금 테스트는 두 finding
   이 같은 caseId 라 한 그룹이다. 서로 다른 caseId 두 개가 섞였을 때의 그룹 순서는 안 덮는다.
4. **동시 작업 중인 T5 파일 때문에 `pnpm lint` 전체가 빨간불이다.** 내 파일은 통과하고
   `npx turbo typecheck --force` 는 6/6 녹색이다. 통합 시점에 T5 가 자기 파일을 정리하면 함께
   녹색이 된다.

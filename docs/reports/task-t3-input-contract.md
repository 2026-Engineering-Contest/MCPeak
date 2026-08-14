# T3 보고서: 단언 실질성 검사

- 브랜치: `feat/runner-assertion-substance`
- 기점: `33e8e6d`
- worktree: `.claude/worktrees/ohmymcp-t3-input-contract`

## 선행 조건 확인

| 항목 | 결과 |
|---|---|
| pwd | 지정된 worktree 경로 일치 |
| `git log --oneline -1` | `33e8e6d` 일치 |
| `packages/runner/src/spec-findings.ts` | 존재 |
| `checkAssertionSubstance` 시그니처 | `assertion-substance.ts:9` 에 존재 |
| `git status --short` | 시작 시점 비어 있음 |

## 변경 사항

허용 Files 2개만 건드렸다.

- 수정: `packages/runner/src/assertion-substance.ts` (스텁 본문을 구현으로)
- 생성: `packages/runner/tests/assertion-substance.test.ts` (설계 §10.2 전량 13개 + 스택 안전 회귀 2개)

보고서 파일(`docs/reports/task-t3-input-contract.md`)은 지시받은 산출물이라 별도로 만들었다.
`spec-findings.ts`, `index.ts`, `input-contract.ts`, `core`, 루트 빌드 설정은 손대지 않았다.
새 의존성 추가 없음.

## 구현 요약

- `hasConstraint`가 제약 키워드 12개를 본다. `minLength`와 `minItems`는 값이 1 이상일 때만,
  `required`는 길이 1 이상일 때만, `properties`는 키 1개 이상일 때만, `additionalProperties`는
  정확히 `false`일 때만 제약으로 센다.
- `walk`가 `bodyMatchesSchema`의 스키마를 훑는다. 제약이 있으면 `VACUOUS_*`만 보고, 제약이
  없으면 `UNCONSTRAINED_SCHEMA` 하나만 낸다. 두 코드가 같은 스키마에서 동시에 날 수 없는
  구조다(`if`/`else` 분기 하나).
- `path`는 `UNCONSTRAINED_SCHEMA`가 스키마 자체(`assertions[0].schema`)에서 끝나고,
  `VACUOUS_*`는 키워드까지(`assertions[0].schema.minLength`) 찍는다. `describeSpecFinding`의
  문장이 "{path} 는 0이라 ..." 이므로 path 끝이 키워드 이름이어야 말이 된다.
- 중첩은 `properties.*`와 `items`를 모두 따라간다. 순회는 재귀가 아니라 명시적 프레임 스택이다
  (아래 1차 리뷰 반려 항목 참고).
- 모든 finding의 `severity`는 `"advisory"`.
- `isError`·`toolExists`는 `type !== "bodyMatchesSchema"`에서 걸러진다. 단언 0개는 아무것도
  내지 않는다(`validateMcpSuite`의 `EMPTY_ASSERTIONS` 담당).

## 1차 리뷰 반려 항목: 재귀 순회의 스택 오버플로

**지적.** `walk`가 재귀라서 깊이 20000 중첩 스키마에서 `RangeError: Maximum call stack size
exceeded`로 죽는다. `validateMcpSuite`는 그런 명세를 유효하다고 통과시키므로 사용자가 도달할 수
있고, 같은 명세를 `matchResponseSchema`는 처리하는데 이쪽만 죽는 비대칭이 된다.

**타당하다.** 이 패키지에는 명시된 스택 안전 계약이 있다. `schema-match.ts`가 같은 중첩을 명시적
프레임 스택으로 도는 이유가 `schema-match.ts:48` 주석에 적혀 있고,
`tests/deep-and-cyclic-input.test.ts`가 그 계약의 회귀 테스트다. 내가 재귀로 쓴 것이 그 계약을
깼다.

**고친 방법.** `walk`를 `schema-match.ts:125`의 `frames` 패턴 그대로 바꿨다. `Frame` 인터페이스
(스키마 + 경로), `frames` 배열, `while` + `pop`, 자식은 역순 `push`다. 새 패턴을 만들지 않았다.

**순회 순서 보존.** 자식을 `items` 먼저 push하고 `properties`를 정렬해서 역순으로 push해,
`pop` 순서가 이전 재귀판과 같은 `properties`(키 오름차순) 다음 `items`가 되게 했다. 기존 13개
테스트가 손대지 않고 그대로 통과한다.

**고친 것이 실제로 문제였는지 확인.** 이전 재귀 로직만 떼어내 스크래치패드 스크립트로 깊이
20000에 돌렸다.

```
재귀판 THREW: RangeError Maximum call stack size exceeded
```

새 회귀 테스트 2개가 통과하는 것만으로는 그 테스트가 무엇을 막는지 알 수 없어서 따로 확인했다.
이 스크립트는 저장소 밖(스크래치패드)에 있고 커밋 대상이 아니다.

**추가한 회귀 테스트 2개.**

- 깊이 20000 `properties` 중첩에서 예외가 없고, finding이 맨 안쪽 빈 스키마의
  `UNCONSTRAINED_SCHEMA` 1건이다
- 깊이 10000 `items` 중첩에서 같다

finding의 `path`가 맨 안쪽까지 이어진 전체 경로인지 단언했다. 예외가 없다는 것만 보면 순회가
중간에 멈춰도 통과하므로, 끝까지 갔다는 증거를 함께 고정했다.

**부수 정리.** 정렬 비교를 `schema-match.ts`의 `byCodeUnit`과 같은 이름의 지역 헬퍼로 빼서
`perCase.sort`와 키 정렬이 같은 비교를 쓰게 했다. 동작은 이전과 같다.

## 내가 임의로 판단한 부분

1. **정렬 순서.** 설계 문서 §9.2의 검사 종류 순서 목록은 입력 계약 코드 6개만 적고 있고 단언
   실질성 코드 3개의 상대 순서는 정해두지 않았다. `UNCONSTRAINED_SCHEMA` → `VACUOUS_MIN_LENGTH`
   → `VACUOUS_MIN_ITEMS`로 잇고, 같은 코드 안에서는 §9.2의 3번대로 `path`를 UTF-16 코드 단위로
   정렬했다. `CODE_ORDER` 상수에 근거를 주석으로 남겼다. 다른 순서를 원하면 그 상수만 고치면
   된다.
2. **`Object.keys` 순회.** §9.2가 "키를 모아 정렬한 뒤 순회한다"고 했으므로 `properties`의 키를
   정렬해서 훑는다. 결과는 어차피 뒤에서 정렬되지만, 상한(`MAX_FINDINGS_PER_CASE`)에 걸려 잘릴
   때 무엇이 남는지가 순회 순서에 의존하면 안 되므로 순회 자체를 고정했다.
3. **상한 적용 지점.** §9.3의 "한 케이스에서"를 그대로 읽어 케이스마다 정렬 후 10건으로 자르고,
   `totalFindings`에는 자르기 전 전체 합을 넣었다.
4. **단언 배열 타입 넓히기.** `TestCaseSpec`이 유니온이라 `testCase.assertions`도 배열 유니온이
   된다. `AssertionSpec[]`로 한 번 받아서 순회했다. 런타임 동작은 같고 타입만 푼 것이다.
5. **`severity` 테스트의 스키마.** §10.2의 마지막 항목이 어떤 스키마를 쓸지 정하지 않아서,
   루트 `VACUOUS_MIN_LENGTH`·`VACUOUS_MIN_ITEMS`와 중첩 `UNCONSTRAINED_SCHEMA`·중첩
   `VACUOUS_MIN_LENGTH`가 한꺼번에 나오는 스키마를 만들어 세 코드를 모두 덮었다.

## 검증 (실제 출력, 2차)

`pnpm test packages/runner`

```
 Test Files  15 passed (15)
      Tests  278 passed (278)
```

기점의 14 파일 262 테스트에서 1 파일 16 테스트가 늘었다. 1차 제출 때가 276이었고 스택 안전
회귀 2개를 더해 278이 됐다. 기존 13개는 고치지 않고 그대로 통과한다.

`pnpm test` (전체 회귀)

```
 Test Files  38 passed (38)
      Tests  641 passed | 1 skipped (642)
```

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`Cached: 0 cached`라 FULL TURBO 로 건너뛴 것이 아니고 6개 패키지를 실제로 검사했다.

`pnpm lint`

```
Checked 123 files in 44ms. No fixes applied.
```

1차 제출 때 `import type` 목록의 정렬 위반 1건이 났고 그때 고쳤다. 2차에서는 위반이 없다.

## 미실행

git commit / merge / push 미실행. 백그라운드 실행 없음. 하위 에이전트 미스폰.
다른 작업자의 변경 되돌리기 없음.

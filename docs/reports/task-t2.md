# Task T2 완료 보고 (본문 추출과 스키마 평가)

## 실행 환경

```
$ pwd
/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-runner-body-assertion

$ git rev-parse HEAD
6f8d73e0817a4c75cdf36120defcae61cbf4d3cd
```

브랜치 `feat/runner-body-assertion`. git 명령은 조회만 했고 커밋·머지·푸시는 실행하지 않았다.

## 변경 파일

```
 M packages/runner/src/index.ts
?? packages/runner/src/body.ts
?? packages/runner/src/schema-match.ts
?? packages/runner/tests/body.test.ts
?? packages/runner/tests/schema-match.test.ts
?? docs/adr/0011-응답-본문-추출-규칙.md
?? docs/reports/task-t2.md
```

T1이 만든 `spec/types.ts` `spec/validation.ts` `spec/json-schema.ts`와 기존 테스트는 건드리지
않았다. `packages/runner` 밖 소스 변경 없음. `core/src/types.ts` 무변경. sdk 버전 무변경.
의존성 추가 없음.

## 무엇을 했나

### `schema-match.ts` (신규)

- `MAX_SCHEMA_VIOLATIONS`, `SchemaViolationCode`, `SchemaViolation`, `SchemaMatchResult`,
  `matchResponseSchema`를 §4-8 계약 그대로 구현.
- `plainObject`와 `typeName`을 여기서 export 한다. `body.ts`가 가져다 쓰며 반대 방향 참조는
  만들지 않았다.
- `jsonEqual`은 계획서 §5 Task T2에 전량 기재된 코드를 그대로 썼다. `generate`의 것을 참조하지
  않는다.
- `byCodeUnit`은 UTF-16 코드 단위 안정 비교다. `charCount`는 `Array.from(value).length`로 코드
  포인트를 센다.
- 노드 평가 단락 순서는 설계 문서 §6.1 그대로다. type, const, enum에서 위반이면 그 노드를
  종료하고, 타입별 제약은 minLength, maxLength, stringContains, minimum, maximum, minItems
  순, 하위 순회는 required, properties, additionalProperties, items 순이다.
- 순회는 명시적 프레임 스택이며 재귀가 없다.
- 위반 수집은 `MAX_SCHEMA_VIOLATIONS`(10)에서 멈추되 순회는 끝까지 진행해 `totalViolations`를
  센다.
- 길이 계열(`MIN_ITEMS` `MIN_LENGTH` `MAX_LENGTH`)의 `actual`은 값이 아니라 길이(숫자)다.
- 키 존재 판정은 전부 `Object.hasOwn`이다. `in` 연산자를 쓰지 않았다.
- `REQUIRED_MISSING`의 `observedKeys`는 자기 키 전량을 정렬해 담는다. 잘라내기는 T3 몫이다.
- `ADDITIONAL_PROPERTY`의 `path`는 위반 키를 포함한다(`$.city`).

### `body.ts` (신규)

계획서 §5 Task T2에 전량 기재된 `extractResponseBody`를 그대로 썼다.

### `index.ts` (수정)

`extractResponseBody`, `BodyExtraction`, `BodyExtractionFailure`, `BodyForm`,
`matchResponseSchema`, `MAX_SCHEMA_VIOLATIONS`, `SchemaMatchResult`, `SchemaViolation`,
`SchemaViolationCode` 재수출.

### 테스트

- `body.test.ts`: 계획서 입력 17종 전량.
- `schema-match.test.ts`: 키워드 13개 각각 통과 1 + 위반 1(총 26), 추가 표 13개. 각 위반
  테스트는 `code` `path` `expected` `actual`을 모두 단언한다.

### ADR

`docs/adr/0011-응답-본문-추출-규칙.md`. 배경 / 선택지 / 결정 / 이유 / 결과 다섯 항목.

## 테스트 우선 확인

구현 전에 테스트를 먼저 쓰고 실패를 실제로 확인했다.

```
$ pnpm vitest run packages/runner/tests/body.test.ts packages/runner/tests/schema-match.test.ts
 Test Files  2 failed (2)
      Tests  56 failed (56)
```

## 검증 명령과 출력

### 표적 검증

```
$ pnpm vitest run packages/runner/tests/body.test.ts packages/runner/tests/schema-match.test.ts

 RUN  v4.1.10 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-runner-body-assertion

 Test Files  2 passed (2)
      Tests  56 passed (56)
   Start at  17:23:56
   Duration  118ms (transform 77ms, setup 0ms, import 99ms, tests 6ms, environment 0ms)
```

2회 실행 모두 `56 passed`로 동일했다.

### 빌드

```
$ pnpm build

 Tasks:    6 successful, 6 total
Cached:    3 cached, 6 total
  Time:    1.944s
```

### 타입체크

```
$ pnpm typecheck

 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    747ms
```

`tsc --noEmit`은 성공 시 무출력이라 검사 대상 0개와 구분되지 않는다. 파일 수를 따로 셌다.

```
$ cd packages/runner && npx tsc --noEmit --listFiles | grep "packages/runner" | grep -vc node_modules
23
```

T1 시점 19개에서 이번 신규 4개(`body.ts` `schema-match.ts` `body.test.ts`
`schema-match.test.ts`)가 늘어 23개다.

### 린트

```
$ pnpm lint
> biome check .

Checked 109 files in 19ms. No fixes applied.
```

첫 실행에서 `index.ts`의 export 정렬 1건(`assist/source/organizeImports`)이 걸렸다.
`npx biome check --write packages/runner/src/index.ts`로 그 파일만 고쳤다.

### 전체 회귀

```
$ pnpm test
> vitest run

 RUN  v4.1.10 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-runner-body-assertion

 Test Files  31 passed (31)
      Tests  438 passed | 1 skipped (439)
   Duration  1.40s
```

T1 시점 382 passed에서 이번 56개가 늘어 438이다. `1 skipped`는 이전부터 있던 스킵이다.

## 내가 임의로 판단한 부분

1. **`Frame`을 두 종류로 나눴다.** `{kind:"node"}`와 `{kind:"additionalFalse"}`다.
   `additionalProperties: false`의 `ADDITIONAL_PROPERTY` 위반을 부모 노드에서 즉시 내면
   `properties` 하위 위반보다 앞서 나온다. 요구된 하위 순회 순서(required, properties,
   additionalProperties, items)를 지키려면 이 위반도 스택의 제자리에서 나와야 해서 전용 프레임을
   뒀다. 계획서는 순서만 못 박고 구현 형태는 지정하지 않았다.

2. **`additionalProperties: true`는 아무 검사도 하지 않는다.** 계획서와 설계 문서 §6.2 표는
   `false`와 스키마 두 경우만 규정한다. `true`는 "추가 키를 허용한다"는 뜻이므로 위반이 없는
   것으로 처리했다.

3. **타입별 제약을 값의 실제 타입으로 가드했다.** `typeof value === "string"`일 때만 문자열
   제약을, `typeof value === "number"`일 때만 숫자 제약을, `Array.isArray`일 때만 `minItems`를
   본다. T1의 명세 검증이 `type` 짝을 강제하므로 정상 경로에서는 항상 맞지만,
   `matchResponseSchema`가 검증을 거치지 않은 스키마로도 호출될 수 있어 가드를 뒀다.

4. **`properties`는 응답에 있는 키만 순회한다.** 없는 키는 `required`가 담당한다. `properties`가
   빠진 키까지 위반으로 내면 같은 사실이 두 번 보고된다.

5. **테스트 케이스의 구체 값.** 계획서 표는 키워드와 코드만 지정하고 값은 지정하지 않아
   `temp` `condition` `맑음` `서울` 등 프로젝트 예제와 같은 어휘로 직접 골랐다.
   `body.test.ts`의 스칼라 5종과 `CONTENT_NOT_ARRAY` 3종은 `it.each`로 묶었다.

6. **`schema-match.test.ts`를 describe 두 개로 나눴다.** 키워드 26개는
   `matchResponseSchema 키워드 판정`, 추가 13개는 `matchResponseSchema 평가 순서와 상한`이다.

## 계약 관련 확인 사항

- 의존 방향: `body.ts` → `schema-match.ts` 한 방향. 역참조 없음. `runner`는 `core`만 참조하고
  `cli` `generate` `record` `mock`을 참조하지 않는다.
- `Object.hasOwn`만 쓰고 `in`은 쓰지 않았다. `required: ["toString"]` 테스트가 이를 고정한다.
- 순회에 재귀 없음. 깊이 1000 테스트가 이를 고정한다. `jsonEqual`은 계획서 코드 그대로
  재귀이며 `const`와 `enum` 후보 비교에만 쓰인다.
- 유닛테스트는 인메모리 값만 쓰며 `examples/`의 실제 서버 프로세스를 띄우지 않는다.

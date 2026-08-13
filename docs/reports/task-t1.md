# Task T1 완료 보고 (공개 계약)

## 실행 환경

```
$ pwd
/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-runner-body-assertion

$ git rev-parse HEAD
15b695cd6c811722962a9c425af868ec990a9871
```

브랜치 `feat/runner-body-assertion`. git 명령은 조회만 했고 커밋·머지·푸시는 실행하지 않았다.

## 변경 파일

```
 M packages/runner/src/index.ts
 M packages/runner/src/spec/json-schema.ts
 M packages/runner/src/spec/types.ts
 M packages/runner/src/spec/validation.ts
 M packages/runner/tests/helpers/schema-evaluator.ts
 M packages/runner/tests/spec-schema.test.ts
 M packages/runner/tests/spec-validation.test.ts
?? docs/adr/0010-응답-스키마-부분집합-경계.md
?? docs/reports/task-t1.md
```

수정 허용 목록 밖의 파일은 건드리지 않았다. `packages/core` `packages/generate` `packages/cli`
`packages/record` `packages/mock`, 루트 `package.json` `turbo.json` `tsconfig.base.json`
`vitest.config.ts` 모두 변경 없음.

## 무엇을 했나

계획서 §4-1부터 §4-6까지의 코드를 그대로 반영했다.

- `spec/types.ts`: `ResponseSchema`, `BodyMatchesSchemaAssertionSpec` 추가.
  `ToolResultAssertionSpec`을 `IsErrorAssertionSpec | BodyMatchesSchemaAssertionSpec` 합집합으로
  바꾸고 `CallToolCaseSpec.assertions`의 원소 타입을 `ToolResultAssertionSpec`으로 교체.
  `SuiteValidationIssueCode`에 `UNSUPPORTED_SCHEMA_KEYWORD`와
  `SCHEMA_KEYWORD_REQUIRES_TYPE` 추가.
- `spec/validation.ts`: 상수 `RESPONSE_SCHEMA_KEYWORDS` `RESPONSE_SCHEMA_TYPES`
  `KEYWORD_TYPES` `SUPPORTED_KEYWORD_LIST` `ALLOWED_ASSERTIONS` `KNOWN_ASSERTIONS`, 헬퍼
  `nonNegativeInt` `finiteNumber` `issueWith`, 함수 `validateResponseSchema` 추가.
  `validateAssertions`의 허용 판정과 분기를 §4-4대로 교체. 기존 `toolExists`와 `isError`
  블록은 내용을 바꾸지 않고 분기 조건만 `else if (type === "isError")`로 명시했다.
- `spec/json-schema.ts`: `$defs`에 `nonNegativeInteger` `responseSchema`
  `bodyMatchesSchemaAssertion` 추가. `callToolCase.properties.assertions.items`를
  `oneOf`로 교체.
- `src/index.ts`: `BodyMatchesSchemaAssertionSpec`과 `ResponseSchema` 타입 재수출.
- `tests/helpers/schema-evaluator.ts`: `allowed` Set에 `enum`과 `maxLength` 추가,
  두 판정과 `deepEqual` 헬퍼 추가.
- `tests/spec-validation.test.ts`: `bodyMatchesSchema 단언 검증` describe 23개와 기존
  describe 안의 `기존 isError 전용 스위트가 그대로 통과한다` 1개, 계획서 표의 24개 전량.
- `tests/spec-schema.test.ts`: parity 테스트 5개, 계획서 표의 전량.
- `docs/adr/0010-응답-스키마-부분집합-경계.md`: 배경 / 선택지 / 결정 / 이유 / 결과 다섯 항목.

## 테스트 우선 확인

구현 전에 테스트를 먼저 쓰고 실패를 실제로 확인했다.

```
$ pnpm vitest run packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts
 Test Files  2 failed (2)
      Tests  25 failed | 24 passed (49)
```

## 검증 명령과 출력

### 표적 검증

```
$ pnpm vitest run packages/runner/tests/spec-validation.test.ts packages/runner/tests/spec-schema.test.ts

 RUN  v4.1.10 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-runner-body-assertion

 Test Files  2 passed (2)
      Tests  49 passed (49)
   Start at  17:16:24
   Duration  122ms (transform 82ms, setup 0ms, import 102ms, tests 11ms, environment 0ms)
```

2회 실행 모두 `49 passed`로 동일했다.

### 빌드

```
$ pnpm build

 Tasks:    6 successful, 6 total
Cached:    3 cached, 6 total
  Time:    3.817s
```

### 타입체크

```
$ pnpm typecheck

 Tasks:    6 successful, 6 total
Cached:    2 cached, 6 total
  Time:    1.536s
```

`tsc --noEmit`은 성공 시 아무것도 출력하지 않아 검사 대상이 0개인 거짓 신호와 구분되지 않는다.
검사 파일 수를 따로 확인했다.

```
$ cd packages/runner && npx tsc --noEmit --listFiles | grep -c "packages/runner"
19
$ npx tsc --noEmit --listFiles | grep "packages/runner" | grep -c "node_modules"
0
```

`node_modules`를 제외한 `packages/runner` 소스 19개가 실제로 검사됐다.

### 린트

```
$ pnpm lint
> biome check .

Checked 105 files in 19ms. No fixes applied.
```

105개 파일을 검사했다. 첫 실행에서 `spec-validation.test.ts`의 한 줄이 포맷 위반으로 걸렸고
biome이 제시한 형태로 고쳐 통과시켰다.

### 전체 회귀

```
$ pnpm test
> vitest run

 RUN  v4.1.10 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-runner-body-assertion

 Test Files  29 passed (29)
      Tests  382 passed | 1 skipped (383)
   Duration  1.43s
```

`1 skipped`는 이번 변경 이전부터 있던 스킵이며 새로 생긴 것이 아니다.

## 내가 임의로 판단한 부분

1. **테스트 파일 배치.** 계획서 표는 24개 테스트를 나열하지만 어느 describe에 넣을지는 적혀
   있지 않다. `기존 isError 전용 스위트가 그대로 통과한다`만 기존 `MCP suite validation`
   describe 안에 두고, 나머지 23개는 새 `bodyMatchesSchema 단언 검증` describe로 묶었다.
   회귀 성격의 단언과 신규 계약 단언을 분리하는 편이 읽기 쉽다고 봤다.

2. **테스트 헬퍼 이름과 형태.** 계획서에 지정이 없어 `callToolSuite` `bodySuite` `issuesOf`
   `SCHEMA_PATH`(`spec-validation.test.ts`), `bodyFixture`(`spec-schema.test.ts`)를 직접
   지었다.

3. **`이슈 순서가 properties, additionalProperties, items 순이다` 테스트의 fixture.**
   `properties`와 `items`를 한 스키마에 함께 두면 `type`은 하나뿐이라 짝 요구를 둘 다 만족할
   수 없다. `type: "object"`로 두어 `items`에 `SCHEMA_KEYWORD_REQUIRES_TYPE`이 하나 더
   발생하며, 기대 배열에 그 이슈를 첫 원소로 포함시켰다. 순서 검증이 목적이므로 이 추가
   이슈가 오히려 루트 이슈와 자식 이슈의 상대 순서까지 고정해 준다.

4. **`else if (type === "isError")` 분기 명시.** 계획서 §4-4의 코드 블록은 기존 `else`
   블록을 그대로 옮기라고만 적혀 있다. 세 번째 분기가 생겼으므로 두 번째 분기의 조건을
   `type === "isError"`로 명시했다. 내용은 바꾸지 않았다.

5. **ADR-0010의 문서 형식.** 기존 `docs/adr/0009-*.md`의 머리말 형식(상태·날짜·담당·작성자·
   승인·참조)을 따랐다. 상태는 `제안`, 승인은 `미승인`으로 두었다.

## 계약 관련 확인 사항

- `packages/generate/src/render.ts`가 자체 로컬 타입으로 `assertions: [{type:"isError";
  expected:false}]`를 선언한다. 합집합으로 넓히는 변경이라 여전히 대입 가능하며,
  `pnpm typecheck`와 `pnpm test` 전부 통과해 실제로 확인됐다. `generate`는 수정하지 않았다.
- `core/src/types.ts`의 `McpClient` / `ToolResult` 변경 없음.
- `@modelcontextprotocol/sdk` 버전 변경 없음. 의존성 추가 없음.
- `runner`가 `cli` `generate` `record` `mock`을 참조하지 않는다.
- `schemaVersion`은 1 그대로다.
- 유닛테스트는 인메모리 fixture만 쓰며 `examples/`의 실제 서버 프로세스를 띄우지 않는다.

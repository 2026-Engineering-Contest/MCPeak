# Task T3 완료 보고 (진단, 단언, executor 통합)

## 실행 환경

```
$ pwd
<repo>/.claude/worktrees/ohmymcp-runner-body-assertion

$ git rev-parse HEAD
323ce2e (T2 커밋)
```

브랜치 `feat/runner-body-assertion`. git 명령은 조회만 했고 커밋·머지·푸시는 실행하지 않았다.
이 세션의 모델은 Opus 5(상위 모델)이므로 모델 전환이나 하위 에이전트 스폰 없이 진행했다.

## 변경 파일

```
 M packages/runner/src/assertions.ts
 M packages/runner/src/diagnostics.ts
 M packages/runner/src/executor.ts
 M packages/runner/src/index.ts
 M packages/runner/tests/assertions.test.ts
 M packages/runner/tests/executor.test.ts
?? packages/runner/tests/body-diagnostics.test.ts
?? .changeset/warm-donkeys-shave.md
?? docs/reports/task-t3.md
```

`packages/runner` 밖 소스 변경 없음(`.changeset/` 신규 파일만 예외). `core/src/types.ts` 무변경.
T1·T2 산출물(`spec/*`, `body.ts`, `schema-match.ts`, 그 테스트)은 되돌리지 않았다.

## 무엇을 했나

### `diagnostics.ts`

- `RunnerDiagnosticCode`에 `BODY_SCHEMA_MISMATCH`, `BODY_EXTRACTION_FAILED` 추가.
- `MAX_VALUE_STRING_CHARS`(200), `MAX_OBSERVED_KEYS`(20), `SchemaViolationDiagnostic` 추가.
  `RunnerDiagnostic`에 선택 필드 `violations`, `totalViolations` 추가. 기존 필드와 기존 진단
  생성 함수는 그대로다.
- `summarizeValue`는 계획서 코드를 그대로 쓰되 `key` 인자 하나를 더 받는다(아래 임의 판단 1번).
  sanitize를 먼저 하고 자르기를 나중에 하는 순서는 그대로다.
- `truncateExpected`는 `expected`에 sanitize 없이 자르기만 적용한다.
- 위반 문장 11종을 계획서 문안 그대로 만든다. `observedKeys`는 작은따옴표, 나머지 문자열 값은
  큰따옴표다. `TYPE_MISMATCH`의 `기대:`는 타입 이름이라 따옴표를 붙이지 않는다.
- 요약 문장 2종, 추출 실패 문장 3종.
- `operationResultUnavailableDiagnostic`을 추가했다. 같은 문장을 `assertions.ts`와
  `executor.ts`가 함께 쓰므로 출처를 하나로 뒀다.

### `assertions.ts`

`assertBodyMatchesSchema(extraction, spec, options?)` 추가. `undefined`면 `skipped`와
`OPERATION_RESULT_UNAVAILABLE`, 추출 실패면 `failed`와 `BODY_EXTRACTION_FAILED`, 위반이 있으면
`failed`와 `BODY_SCHEMA_MISMATCH`, 위반이 없으면 `passed`다.

### `executor.ts`

단언 평가 블록만 바꿨다. `needsBody`와 `extraction`을 계획서 코드 그대로 넣고 단언 분기에
`assertBodyMatchesSchema`를 더했다. `result === undefined`인 기존 `skipped` 경로는 그대로 두고
새 이벤트 종류를 만들지 않았다. 지역 `unavailable`은
`operationResultUnavailableDiagnostic`을 가리키게 바꿨다. 출력 문자열은 같다.

### `index.ts`

`assertBodyMatchesSchema`, `bodySchemaMismatchDiagnostic`, `bodyExtractionFailedDiagnostic`,
`MAX_VALUE_STRING_CHARS`, `MAX_OBSERVED_KEYS`, `SchemaViolationDiagnostic` 재수출.

### 테스트

- `body-diagnostics.test.ts` 신규 25개. 계획서 표의 25행 전량이다.
- `assertions.test.ts` 추가 4개.
- `executor.test.ts` 추가 9개.

### changeset

`.changeset/warm-donkeys-shave.md`. `@ohmymcp-hsu/runner` minor, 본문은 계획서 그대로다.

## 테스트 우선 확인

구현 전에 테스트를 먼저 쓰고 실패를 실제로 확인했다.

```
$ pnpm vitest run packages/runner
 Test Files  3 failed | 7 passed (10)
      Tests  33 failed | 144 passed (177)
```

38개 중 5개는 신규 코드 없이도 통과하는 회귀 성격 테스트라(예:
`bodyMatchesSchema가 없으면 추출을 호출하지 않는다`, `기존 isError 전용 스위트의 보고서가
변하지 않는다`) 33개가 실패했다.

## 검증 명령과 출력

### 표적 검증

```
$ pnpm vitest run packages/runner

 RUN  v4.1.10 <repo>/.claude/worktrees/ohmymcp-runner-body-assertion

 Test Files  10 passed (10)
      Tests  177 passed (177)
   Start at  17:34:59
```

2회 실행 모두 `177 passed`로 동일했다.

### 빌드

```
$ pnpm build

 Tasks:    6 successful, 6 total
Cached:    3 cached, 6 total
  Time:    1.939s
```

### 타입체크

```
$ pnpm typecheck

 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    769ms
```

`tsc --noEmit`은 성공 시 무출력이라 검사 대상 0개와 구분되지 않는다. 파일 수를 따로 셌다.

```
$ cd packages/runner && npx tsc --noEmit --listFiles | grep "packages/runner" | grep -vc node_modules
24
```

T2 시점 23개에서 신규 `body-diagnostics.test.ts` 1개가 늘어 24개다.

첫 실행에서 실제 오류를 하나 잡았다.

```
src/executor.ts(26,8): error TS2305: Module '"./spec/index.js"' has no exported member 'BodyMatchesSchemaAssertionSpec'.
```

`packages/runner/src/spec/index.ts`는 이번 태스크의 수정 허용 목록에 없어 배럴을 고치지 않고
`executor.ts`가 `./spec/types.js`에서 직접 타입을 가져오도록 했다. 공개 API는 영향이 없다
(`src/index.ts`가 이미 `./spec/types.js`에서 재수출한다).

### 린트

```
$ pnpm lint
> biome check .

Checked 110 files in 21ms. No fixes applied.
```

첫 실행에서 포맷 2건이 걸려 `npx biome check --write`로 해당 두 파일만 고쳤다.

### 전체 회귀

```
$ pnpm test
> vitest run

 Test Files  32 passed (32)
      Tests  476 passed | 1 skipped (477)
   Duration  1.43s
```

T2 시점 438 passed에서 이번 38개가 늘어 476이다. `1 skipped`는 이전부터 있던 스킵이다.

## 내가 임의로 판단한 부분

1. **`summarizeValue`에 `key` 인자를 더했다.** 계획서 코드는 `sanitizeJsonValue(value, options)`를
   그대로 호출한다. 그런데 `sanitizeJsonValue`의 민감 **키** 규칙은 객체의 키를 보고 판정하므로
   스칼라 값 하나만 넘기면 절대 적용되지 않는다. 응답이 `{"token":"abc"}`이고 위반이 `$.token`에
   생기면 `actual`은 문자열 `"abc"`이고 토큰이 그대로 진단에 남는다. 계획서 테스트 표의
   `민감 키를 REDACTED로 바꾼다` 행이 이 동작을 요구한다.

   그래서 위반 경로의 마지막 객체 키(`leafKey`)를 넘겨, 키를 알 때는 `{ [key]: value }`로 감싸
   sanitize한 뒤 다시 꺼내도록 했다. **sanitize 먼저, 자르기 나중**이라는 순서와 나머지 코드는
   계획서 그대로다. 이 판단만 계획서 코드에서 벗어났고, 벗어난 이유는 값 노출이기 때문이다.
   되돌리라면 되돌릴 수 있으나 그러면 위 테스트 행을 삭제해야 한다.

2. **`REQUIRED_MISSING`의 진단 `path`를 빠진 필드까지 포함하게 했다.** T2의 위반은 `path`가
   객체(`$`)이고 `expected`가 빠진 키(`temp`)다. 계획서 문안은 `{path}: 필수 필드가 없습니다.`
   인데 기대 문장은 `$.temp: 필수 필드가 없습니다. ...`이다. 문장과 구조화 필드가 어긋나면
   나중에 CLI가 둘을 나란히 렌더링할 때 모순되므로, 진단의 `path`를 `${violation.path}.${키}`로
   합성하고 문장은 그 `path`를 그대로 쓴다. 덕분에 `{path}: ` 템플릿이 11종 전부에서 문자 그대로
   성립한다. `expected`에는 키 이름이 그대로 남는다.

3. **`expected`의 자르기 범위.** 계획서는 "자르기만 적용"이라고만 적는다. `ENUM_MISMATCH`의
   `expected`는 배열이고 문장에 원소별로 들어가므로 배열은 원소마다 적용하고, 객체는
   `{kind:"object",keys:N}` 요약으로 바꿨다. 객체까지 원본으로 두면 긴 `const` 하나가 위반 10건에
   곱해져 `maxCaseBytes`를 넘길 수 있다.

4. **`TYPE_MISMATCH`의 `기대:`에 따옴표를 붙이지 않았다.** 설계 문서 §7.2 예시가
   `기대: number, 실제: string ("21")`이다. 이 자리의 값은 타입 이름이지 문자열 값이 아니다.
   `실제:`의 괄호 안 값에는 큰따옴표 규칙을 적용한다.

5. **`operationResultUnavailableDiagnostic`을 diagnostics.ts로 옮겼다.** 같은 문장을
   `assertions.ts`가 새로 쓰게 되어 출처가 둘이 되는 것을 피했다. `executor.ts`의 지역
   `unavailable`은 이 함수를 가리키게만 바꿨고 출력 바이트는 같다.
   `기존 isError 전용 스위트의 보고서가 변하지 않는다` 테스트가 이를 고정한다.

6. **회귀 고정 문자열의 출처.** 그 테스트의 기대 문자열은 **구현 전(HEAD 323ce2e)** 에 같은
   fixture를 실행해 얻은 실제 보고서다. 구현 후 값을 베껴 넣으면 회귀 테스트가 아니게 된다.

7. **`byteLength`를 공개 API로 만들지 않았다.** `executor.test.ts`가 케이스 바이트를 재야 해서
   `../src/sanitization.js`에서 직접 가져왔다. 계획서에 없는 공개 export를 늘리지 않기 위해서다.

8. **테스트 개수.** 실행 요청 메시지는 `body-diagnostics` 23개라고 했으나 계획서 표의 행은
   25개다. 표를 따라 25개를 모두 썼다.

9. **`서로게이트 페어를 쪼개지 않는다` 테스트의 단언.** 처음에 마지막 UTF-16 코드 단위가
   서로게이트가 아닌지 보게 썼는데, 온전한 이모지도 마지막 코드 단위는 하위 서로게이트라 틀린
   단언이었다. 짝을 잃은 서로게이트만 잡는 정규식으로 바꿨다.

## 계약 관련 확인 사항

- 진단 문장 11종, 요약 2종, 추출 실패 3종을 계획서 문안 그대로 만들었다.
- `summarizeValue`는 sanitize 먼저, 자르기 나중이다. 문자열 자르기는 `Array.from` 기준이다.
- `expected`는 sanitize하지 않는다. `expected는 sanitize하지 않는다` 테스트가 고정한다.
- `observedKeys`는 20개까지 담고 잘렸을 때만 `observedKeysTotal`을 넣는다.
- executor는 케이스당 추출 1회다. `content` getter 접근 횟수 1을 세는 테스트가 고정한다.
  `bodyMatchesSchema`가 없으면 접근 횟수 0이다.
- 새 이벤트 종류를 만들지 않았고 기존 `skipped` 경로를 그대로 뒀다.
- 유닛테스트는 인메모리 값과 `fixtures/`만 쓴다. `examples/` 실제 서버 프로세스를 띄우지 않는다.

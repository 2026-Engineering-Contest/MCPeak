# Task T8 보고서: `render` · `baseline` 배선

## 무엇을 했나

위반 케이스를 baseline 생성에 배선하고 정책 버전을 올리고 커버리지를 결과에 실었다. 계획서
Task 8 의 Step 1~6 을 따랐다. **여기서 처음으로 사용자에게 보이는 출력이 바뀐다.**

- `render.ts` 의 `buildSuite` 가 `cases` 에 `...buildViolationCases({ tool, happyInput: input, baseName })`
  를 붙인다. `synthesizeValue` 가 만든 정상 입력을 그대로 넘긴다. 정상 입력을 따로 합성하지
  않는다
- `buildGeneratedCase` 를 `buildGeneratedCases` 로 바꾸고 `buildSuite(...).cases` 를 그대로
  반환한다. `renderTool` 이 만드는 파일과 baseline suite 가 같은 케이스를 갖는 원칙이 유지된다
  (`buildSuite` 하나만 고쳤다)
- `baseline.ts` 의 `tools.map` 이 `flatMap` 이 됐다
- `BASELINE_POLICY_VERSION` 이 `"schema-baseline-v2"` 다. 왜 올리는지 주석에 적었다
- `BaselineGenerationResult` 에 `coverage: CoverageResult` 가 늘었고
  `computeCoverage({ suite, tools })` 를 `deepFreeze` 대상 안에 넣었다

## 기대값 확인

`fixtures/tools-list.sample.json` 두 툴로 만든 baseline 의 케이스 id 순서가 계획서 기대값과
정확히 같다.

```
get-weather-success  get-weather-missing-city  get-weather-type-city
add-success  add-missing-a  add-missing-b  add-type-a  add-type-b
```

`coverage.verified === coverage.total === 8` 이고 `validateMcpSuite(result.suite).valid` 가
`true` 다. `DUPLICATE_CASE_ID` 는 나오지 않는다.

## 변경 파일

- Modify: `packages/generate/src/render.ts`
- Modify: `packages/generate/src/baseline.ts`
- Modify: `packages/generate/tests/baseline.test.ts`
- Create: `docs/reports/task-t8-contract-axes.md`

`index.test.ts` 는 건드리지 않았다. 생성 파일을 `toContain` 으로만 보는 테스트라 케이스가 늘어도
그대로 통과한다. 스냅샷이 없다.

`dependency-boundary.test.ts` 와 ADR-0009 도 건드리지 않았다. T8 이 새로 import 한 `runner` 심볼이
없다. 승인 목록은 T7 이후 그대로다.

허용 목록 밖 파일은 건드리지 않았다. git 명령은 실행하지 않았다.

## 고친 기존 기대값 (전량)

`packages/generate/tests/baseline.test.ts` 의 **"툴 순서대로 한 baseline suite와 case를 만든다"**
하나다.

| 무엇을 | 왜 |
|---|---|
| `cases.map(operation)` 기대값을 2개에서 6개로 | 이 테스트의 로컬 툴 둘이 각각 정상 1 + 위반 2 를 낸다. `get_weather` 는 `{city:"example"}` / `{}` / `{city:0}`, `add` 는 `{value:2}` / `{}` / `{value:1.5}` 다 |
| "모든 케이스의 첫 단언이 `isError` `false`" 를 id 별 단언 목록 비교로 | 그 단언은 이제 거짓이다. 위반 케이스는 `expected: true` 다. 느슨하게 고치는 대신 id 와 단언을 함께 못 박아 정상/위반 구분이 테스트에 남게 했다 |

같은 파일의 나머지 6개(fingerprint 동일성, 동결, 스키마 거절, package dependency, suiteFingerprint)는
고치지 않았고 그대로 통과한다.

## 범위 확장분: authoring 테스트 5건 (전량)

두 파일이 처음 허용 Files 에 없어 남겨 뒀다가, 범위 확장 승인을 받아 고쳤다. 다섯 다 baseline
출력이 바뀐 직접적 결과이고 회귀가 아니다. `safeBaseName`·`synthesizeValue` 같은 무관한 테스트는
하나도 깨지지 않았다.

### 지문 상수 둘

값은 손으로 계산하지 않고 실제 실행 결과를 넣었다. 주석에는 두 가지를 적었다. 이 상수가 무엇을
고정하는지(specFindings 가 지문에 들어가지 않는다는 계약), 그리고 2026-08-15 에 값이 갈린
이유(baseline 정책이 v2 로 올라 툴당 케이스가 늘었다, ADR-0022)다. 계약이 깨진 것이 아니라
suite 내용이 바뀐 것이므로 지문이 바뀌는 것이 정상이라는 문장을 남겼다.

| 파일 | 상수 | 옛 값 | 새 값 |
|---|---|---|---|
| `tests/authoring-session.test.ts` | `KNOWN_CLEAN_FINGERPRINT` | `45dc0744...` | `5eb8858d...` |
| `tests/authoring-request.test.ts` | `KNOWN_PROVIDER_FINGERPRINT` | `77840d3e...` | `54c9288a...` |

### 케이스 목록 셋

`authoring-session.test.ts` 의 로컬 툴 둘(`weather`, `echo`)이 v2 에서 6케이스를 만든다.
`weather-success`·`weather-missing-city`·`weather-type-city`·`echo-success`·`echo-missing-text`·
`echo-type-text` 다. 셋 다 **정확한 전체 목록**으로 고쳤다. `toContain` 이나 부분 일치로 바꾸지
않았다. 그렇게 하면 그 테스트가 잡던 순서 고정이 사라진다.

| 테스트 | 무엇을 | 왜 |
|---|---|---|
| 승인 draft 기준으로 고정 순서 diff를 만든다 | `changes[2].caseId` 를 `echo-success` 에서 `weather-missing-city` 로. `changes[3].candidateIndex` 를 1 에서 5 로. `caseOrder` 의 `before`·`after` 를 각각 6개 전량으로 | `splice(0,1)` 이 첫 케이스를 지우므로 이름을 고친 `next.cases[0]` 이 승인본의 두 번째 케이스다. v2 에서 그것은 `weather-missing-city` 다. `weather-error` 는 5개 뒤에 붙어 인덱스 5 다 |
| 선택한 변경만 적용해 revision을 한 번 증가시킨다 | 적용 결과 id 목록을 3개에서 7개로 | 승인본 6개에 `weather-error` 가 더해진다 |
| 적용 결과가 세션에 전달된 도구 목록 밖의 도구를 남기면 거절한다 | candidate 구성을 `id !== "echo-success"` 필터에서 **`echo` 툴 케이스 전량 제거**로. 기대 issue 경로를 `cases[1].operation.tool` 하나에서 `cases[3]`·`cases[4]`·`cases[5]` 셋으로 | 하나만 지우면 남은 echo 케이스가 선언되지 않은 툴을 불러 candidate 가 `invalid` 로 먼저 막힌다. 이 테스트가 보려는 것은 그 앞이 아니라 "삭제를 선택하지 않은 승인본" 이다. 승인본에 남는 echo 케이스가 셋이므로 경로도 셋이다 |

세 번째는 회귀가 아니다. `reviewLocalAuthoringCandidate` 가 `preview` 를 안 낸 이유는 candidate 가
실제로 선언되지 않은 툴(`echo`)을 부르고 있었기 때문이고, 그 거절은 원래 옳은 동작이다. 테스트가
만들려던 상황이 v2 에서 다른 방식으로 만들어져야 했을 뿐이다.

### `pnpm typecheck --force` 는 `cli` 에서 실패한다

```
ohmymcp:typecheck: tests/generate-command.test.ts(81,5): error TS2322:
  Type 'Mock<() => { suite: TestSuiteSpec; baselineFingerprint: string;
  suiteFingerprint: string; policyVersion: "schema-baseline-v1"; }>' is not
  assignable to type '(tools, options) => BaselineGenerationResult'.
```

`cli` 테스트의 `createBaselineSuite` 목이 `policyVersion: "schema-baseline-v1"` 을 내고 `coverage`
가 없다. `packages/cli` 는 T9 의 것이라 고치지 않았다.

`pnpm lint` 는 통과한다(`Checked 148 files in 30ms. No fixes applied.`).

### `packages/cli` 실패 목록 (T9 프롬프트용)

```
Test Files  1 failed | 6 passed (7)
     Tests  3 failed | 241 passed (244)
```

전부 `packages/cli/tests/generate-integration.test.ts` 의 `generate 실제 weather-server` 블록이다.

| 테스트 | 증상 |
|---|---|
| weather-server에서 baseline JSON을 만들고 process를 종료한다 | `112:27` 의 `toHaveLength(2)` 가 실제 8 이다 |
| weather baseline은 실제 test에서 신뢰도 한계를 드러낸다 | 같은 원인. 케이스 수 기대값이 낡았다 |
| 사용자 지시를 반영한 승인 candidate는 실제 test를 통과한다 | 같은 원인 |

여기에 위 `generate-command.test.ts` 의 타입 오류가 더해진다. T9 는 화면 출력 외에 이 넷을 함께
봐야 한다.

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/generate/tests/baseline.test.ts` (구현 전) | `Tests  3 failed \| 9 passed (12)` |
| `pnpm vitest run packages/generate/tests/baseline.test.ts` | `Test Files  1 passed (1)` / `Tests  12 passed (12)` |
| `pnpm vitest run packages/generate` | `Test Files  2 failed \| 8 passed (10)` / `Tests  5 failed \| 182 passed \| 1 skipped (188)` |
| `pnpm typecheck --force` | 실패. `Failed: ohmymcp#typecheck` (`cli` 테스트 목) |
| `pnpm lint` | `Checked 148 files in 30ms. No fixes applied.` |
| `pnpm vitest run packages/cli` | `Test Files  1 failed \| 6 passed (7)` / `Tests  3 failed \| 241 passed (244)` |

## 임의로 판단한 지점

1. baseline 테스트의 "모든 케이스가 `isError` `false`" 단언을 **느슨하게 고치지 않고** id 와 단언
   목록을 함께 비교하는 형태로 바꿨다. 그냥 지우면 정상 케이스에 `true` 가 섞여도 통과한다.
2. `buildGeneratedCases` 는 `buildSuite(...).cases` 를 그대로 반환한다. 기존
   `buildGeneratedCase` 가 쓰던 `as GeneratedCase` 단언이 필요 없어져 지웠다.
3. `coverage` 를 `BaselineGenerationResult` 의 마지막 필드에 넣었다. 기존 필드 순서와 값은
   그대로다. 지문 계산(`sha256({ policyVersion, suite })`)에는 `coverage` 가 들어가지 않는다.
   커버리지는 명세에서 파생되는 값이라 지문의 재료가 되면 순환이다.

## 남은 위험

- `baselineFingerprint` 가 전부 바뀐다. 정책 버전을 올린 목적이 그것이지만, 기존 사용자가
  승인해 둔 지문이 전부 무효가 된다는 뜻이다. 재승인 흐름이 이 변화를 어떻게 안내하는지는
  T9 화면의 몫이다.
- `authoring-session` 의 지문 상수 둘이 낡은 채로 남아 있다. 고치기 전까지 `packages/generate`
  게이트는 빨간불이다.

## 커밋 제안

```
feat(generate): baseline 에 위반 케이스와 커버리지를 포함한다
```

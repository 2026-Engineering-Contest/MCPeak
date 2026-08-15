# Task T7 보고서: `computeCoverage`

## 무엇을 했나

명세가 각 축을 덮는지 판정해 집계하는 `computeCoverage` 를 만들었다. 계획서 Task 7 의
Step 1~5 를 그대로 따랐다.

- `packages/generate/src/coverage.ts` 신규. `AxisCoverage`·`ToolCoverage`·`CoverageResult` 와
  `computeCoverage`. 전량 시그니처는 설계서 §3.2 그대로다
- `packages/generate/src/index.ts` 에 넷 export 추가
- `packages/generate/tests/coverage.test.ts` 신규. 15개
- ADR-0009 와 `dependency-boundary.test.ts` 를 T6b 와 같은 절차로 넓혔다(아래)

### 지킨 것 넷

1. **`byCodeUnit` 을 `runner` 에서 가져오지 않았다.** `packages/runner/src/ordering.ts` 는
   패키지 내부 전용이라 `index.ts` 로 나오지 않는다. `coverage.ts` 안에 같은 비교자를 지역
   상수로 두고, 의도된 중복이라는 사유와 `localeCompare` 를 쓰지 않는 이유를 주석에 적었다.
2. `seen` / `duplicated` 두 Set 으로 중복 툴 이름을 판정해
   `deriveContractAxes(tool, { duplicated })` 로 넘긴다.
3. 축은 `derived.axes` 로만 만들고 `matchCoveredAxes` 결과는 `coveredBy` 맵을 통해 `caseId` 를
   채우는 데만 쓴다. 축 키는 `${kind} ${field ?? ""}` 다. 중복 툴처럼 축이 빈 경우에 분모가 0인데
   분자만 느는 일이 구조적으로 생기지 않는다.
4. `if (!coveredBy.has(key))` 로 `suite.cases` 순서상 첫 케이스를 남긴다.

### 0/0

모든 툴이 해석 불가면 `total` 이 0 이고 `verified === total` 이 참이 된다. 계산은 숫자만 정직하게
낸다(0/0). 그것을 "전부 검증" 으로 읽지 않는 판정은 T9 화면의 일이다. `total === 0` 인 경우를
테스트로 고정해 뒀다.

## 승인 심볼 목록을 넓혔다 (ADR 먼저, 그다음 테스트)

T6b 와 같은 순서를 지켰다. ADR-0009 를 먼저 고치고 그다음 `APPROVED_RUNNER_SYMBOLS` 를 넓혔다.

ADR-0009 배경 절 표에 넣은 것.

| 종류 | 추가한 심볼 |
|---|---|
| 타입 | `ContractAxisKind` |
| 함수 | `matchCoveredAxes` |

사유는 새 단락을 쓰지 않고 T6b 단락 끝에 한 줄로 붙였다("같은 이유로 커버리지 판정이
`matchCoveredAxes` 와 `ContractAxisKind` 를 쓴다"). 이유가 이미 그 단락에 있다.

T7 이후 `APPROVED_RUNNER_SYMBOLS` 전량은 아래와 같다. 굵게 표시할 수 없어 T5~T7 이 더한 다섯을
따로 적는다.

```
ContractAxis ContractAxisKind ContractDeclaredType DEFAULT_SENSITIVE_KEYS
MCP_SUITE_JSON_SCHEMA REDACTED RunnerRedactionOptions SpecFindingsResult
SuiteValidationIssue TestCaseSpec TestSuiteSpec canonicalJson
checkAssertionSubstance checkInputContract deepFreeze deriveContractAxes
matchCoveredAxes sha256 validateMcpSuite
```

계약 축 작업이 더한 것 다섯: `ContractAxis`, `ContractAxisKind`, `ContractDeclaredType`,
`deriveContractAxes`, `matchCoveredAxes`.

`coverage.ts` 가 실제로 import 하는 것은 `ContractAxisKind`, `deriveContractAxes`,
`matchCoveredAxes`, `TestSuiteSpec` 넷이다. `ContractAxis` 와 `ContractDeclaredType` 은
`violation-cases.ts` 가 쓴다.

## 변경 파일

- Create: `packages/generate/src/coverage.ts`
- Modify: `packages/generate/src/index.ts`
- Create: `packages/generate/tests/coverage.test.ts`
- Modify: `packages/generate/tests/dependency-boundary.test.ts`
- Modify: `docs/adr/0009-generate가-runner에-의존하는-예외.md`
- Create: `docs/reports/task-t7-contract-axes.md`

허용 목록 밖 파일은 건드리지 않았다. git 명령은 실행하지 않았다.

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/generate/tests/coverage.test.ts` (구현 전) | `Test Files  1 failed (1)` / `Tests  no tests` (모듈 해석 실패) |
| `pnpm vitest run packages/generate/tests/coverage.test.ts` | `Test Files  1 passed (1)` / `Tests  15 passed (15)` |
| `pnpm vitest run packages/generate` | `Test Files  10 passed (10)` / `Tests  182 passed \| 1 skipped (183)` |
| `pnpm typecheck --force` | `Tasks: 6 successful, 6 total` / `Cached: 0 cached, 6 total` |
| `pnpm lint` | `Checked 148 files in 30ms. No fixes applied.` |

경계 테스트는 초록이다. 167 에서 182 로 15개가 늘었다.

### 8케이스 스위트가 8/8 이다

`suiteOf([weather, add])` 가 정상 케이스 2개와 T6 의 `buildViolationCases` 결과 6개로 스위트를
조립하고, `computeCoverage` 가 `verified 8, total 8` 을 낸다. §11.1 의 제외 규칙(거절 기대 케이스를
입력 계약 대조에서 뺀다)과 커버리지 판정이 서로를 무효화하지 않는다는 증거의 절반이다. 나머지
절반은 T4 의 리터럴 테스트다.

## 임의로 판단한 지점

1. `index.ts` 의 export 순서를 계획서 Step 5 의 코드 블록과 다르게 썼다. biome 의 정렬 규칙이
   `type CoverageResult` 를 `computeCoverage` 앞에 요구한다. 계획서 순서 그대로면 lint 가
   깨진다. 심볼 집합은 같다.
2. 테스트의 입력 타입을 `Record<string, unknown>` 대신 `generate` 의 `JsonObject` 로 썼다.
   `unknown` 은 `TestCaseSpec` 의 `input: JsonObject` 에 대입되지 않아 타입체크가 깨진다.
3. 설계서 §10.4 의 13개에 중복 툴(§4.2)과 0/0 두 개를 더해 15개다. 계획서 Step 1 의 목록에는
   중복 툴 항목이 있고 §10.4 목록에는 없다. 둘을 합집합으로 넣었다.
4. "isError 단언이 없는 케이스" 테스트는 `bodyContains` 단언 케이스로 만들었고 타입 단언을
   하나 썼다. `TestCaseSpec` 이 그 조합을 허용하는지는 이 테스트의 관심사가 아니고,
   `matchCoveredAxes` 가 `isError` 단언이 없을 때 빈 배열을 내는지만 본다.
5. `coverage.ts` 는 `ContractAxis` 를 import 하지 않는다. 계획서 Interfaces 절이 소비 목록에
   적어 뒀지만 실제 구현이 그 타입 이름을 적을 자리가 없다(`matchCoveredAxes` 의 반환을 그대로
   순회한다). 승인 목록에는 `violation-cases.ts` 때문에 이미 들어 있다.

## 남은 위험

- ADR-0009 표와 `APPROVED_RUNNER_SYMBOLS` 를 잇는 자동 검사가 여전히 없다. T6b 보고서에 적은
  것과 같은 구멍이고, 이제 두 태스크가 연달아 손으로 맞췄으므로 다음에 잊을 확률이 높다.
- `matchCoveredAxes` 는 `duplicated` 를 받지 않는다. 중복 툴에서도 축을 내지만 `coveredBy` 맵이
  `derived.axes` 가 빈 배열이라 소비되지 않는다. 지금은 옳지만 축 생성 쪽을 바꾸면 이 무해함이
  깨진다. 중복 툴 테스트가 `verified 0, total 0` 으로 그것을 잡는다.
- `computeCoverage` 는 `suite.cases` 를 툴마다 전부 순회한다. 툴 N개 케이스 M개면 N×M 이다.
  지금 규모에서는 문제가 아니지만 툴이 수백 개인 서버에서는 비용이 보인다.

## 커밋 제안

```
feat(generate): 계약 축 커버리지를 계산한다
```

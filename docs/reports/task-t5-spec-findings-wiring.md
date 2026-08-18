# T5 보고서: `cli test` 참고 문장과 `--json`

계획서 `docs/superpowers/plans/2026-08-14-spec-findings-wiring-implementation.md` 의
"Task 5" 절, 설계 문서 §7 을 구현했다.

## 바꾼 파일

- `packages/cli/src/test-command.ts`
- `packages/cli/tests/test-command.test.ts`
- `docs/reports/task-t5-spec-findings-wiring.md` (이 문서)

허용 목록 밖 파일은 건드리지 않았다. 같은 worktree 에서 T4 가 쓰는
`packages/cli/src/generate-command.ts` · `packages/cli/tests/generate-command.test.ts` 는
읽지도, 고치지도 않았다.

## 실제 값으로 확인한 기대값 (계획서 Step 1 요구)

`path` 와 `severity` 를 리터럴로 추측하지 않고, 빌드된 `packages/runner/dist/index.mjs` 의
`checkInputContract` 를 테스트와 같은 입력으로 직접 불러 확인했다.

입력: 툴 `get_weather` 의 `inputSchema` 가
`{ type: "object", properties: { city: { type: "string" }, units: { enum: ["c","f"] } },
required: ["city"], additionalProperties: false }`,
케이스 `seoul-weather` 의 입력이 `{ citi: "Seoul" }`.

확인한 반환값:

```json
{
  "findings": [
    { "code": "REQUIRED_MISSING",  "severity": "blocking", "caseId": "seoul-weather",
      "path": "input.city", "expected": "city", "suggestion": "citi" },
    { "code": "UNDECLARED_FIELD",  "severity": "blocking", "caseId": "seoul-weather",
      "path": "input.citi", "actual": "citi",  "suggestion": "city" }
  ],
  "totalFindings": 2
}
```

`describeSpecFinding` 의 실제 문장도 같은 방법으로 확인했다.

```
필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'
'citi' 는 서버가 선언하지 않은 필드입니다. 비슷한 필드: 'city'
```

`checkAssertionSubstance` 는 `{ type: "string", minLength: 0 }` 단언에서
`{ code: "VACUOUS_MIN_LENGTH", severity: "advisory", caseId: "vacuous-case",
path: "assertions[0].schema.minLength" }` 를 내고, 문장은
`assertions[0].schema.minLength 는 0이라 모든 문자열이 통과합니다` 다.

**계획서 스니펫과 달랐던 점.** 계획서의 `weatherTools` 는 `additionalProperties` 가 없는데,
그 상태에서는 `UNDECLARED_FIELD` 가 **나오지 않는다**(직접 확인). 선언이 닫혀 있지 않으면
선언 밖 필드는 위반이 아니기 때문이다. 계획서 Step 1 의 `--json` 기대값이 두 건이므로,
픽스처에 `additionalProperties: false` 를 넣어 두 건이 실제로 나오게 맞췄다. 테스트 파일에
그 이유를 주석으로 남겼다.

또 하나: `listTools()` 가 **빈 배열**이면 `checkInputContract` 는 모든 케이스에 대해
`TOOL_NOT_DECLARED`(blocking) 를 낸다(직접 확인). 빈 목록에서 건너뛰라는 규칙이 없으면
실패 원인과 무관한 줄이 케이스 수만큼 늘어난다. 구현 주석에 이 사실을 근거로 적었다.

## 헬퍼 이름 대체 (계획서 스니펫 대비)

계획서 스니펫의 헬퍼가 실제 파일에 없어서 기존 방식으로 새 지역 헬퍼를 만들었다. 새 픽스처
파일은 만들지 않았고, 모두 `packages/cli/tests/test-command.test.ts` 안의 인메모리 리터럴이다.

| 계획서 이름 | 실제로 쓴 것 |
|---|---|
| `runTest({ suite, tools, listTools, report, json })` | `runTest({ suite, statuses, tools?, listTools?, json? })`. 기존 `deps()` 를 그대로 쓰고 `validateSuite` · `finalize` 를 덮어쓴다 |
| `reportWith({ caseId: status })` | `reportWith(suite, statuses)`. 기존 `report()` 헬퍼는 `cases: []` 여서 케이스별 status 를 담을 수 없다. 명세의 케이스 목록이 있어야 `spec.id` 를 채울 수 있으므로 suite 를 함께 받는다 |
| `seoulSuiteWithTypo` · `suiteWithVacuousAssertion` · `cleanSuite` · `weatherTools` | 같은 이름으로 새로 만들었다 (`suiteOf` · `callCase` 지역 헬퍼로 조립) |

`listTools` 는 `deps()` 가 돌려주는 `conn.client.listTools` 를 덮어써서 주입한다. 기존 파일이
`d.conn.getDiagnostics` 를 같은 방식으로 덮어쓰고 있어 그 선례를 따랐다.

## 임의로 판단한 지점

1. **`checkInputContract` · `checkAssertionSubstance` 를 `dependencies` 의 선택 필드로 뒀다.**
   계획서 Step 4 는 주입 지점을 만들라고만 했다. 필수 필드로 두면 `packages/cli/src/index.ts`
   의 `unavailableDependencies` 와 실제 주입 두 지점이 이 필드를 채워야 하는데, `index.ts` 는
   내 Files 목록 밖이다. 그래서 `checkInputContract?(...)` · `checkAssertionSubstance?(...)` 로
   선택 필드로 두고, 생략 시 `runner` 의 실제 함수를 쓰게 했다(`?? runnerCheckInputContract`).
   `index.ts` 는 한 줄도 바뀌지 않고 기본값이 실제 함수라는 계획서 요구도 지켜진다.
   - 부수 효과: `test-command.ts` 가 `@ohmymcp-hsu/runner` 를 런타임으로 static import 한다.
     이미 `spec-approval.ts` 가 `suiteFingerprint` 를 같은 방식으로 import 하고
     `test-command.ts` 가 그 파일을 import 하므로, 런타임 의존 관계는 새로 생기지 않는다.
2. **검사 호출 전체를 `try { } catch { return [] }` 로 감쌌다.** 계획서는 `listTools()` 에만
   무음 규칙을 적었다. 그런데 검사 자체가 던지면 그 예외가 `runCli` 밖으로 나가 판정과 exit
   code 가 바뀐다(규칙 4 위반). `validated.value` 는 이미 `validateMcpSuite` 를 통과했으니
   도달 불가 경로지만, 도달했다면 그것은 비차단 진단의 결함이고 대상 서버의 결함이 아니다.
   로그는 남기지 않는다.
3. **참고 문장의 머리글은 설계 문서 §7.2 문안을 그대로 썼다.** 단언 실질성 finding
   (`VACUOUS_MIN_LENGTH`)도 같은 `… 의 입력이 서버 선언과 다릅니다` 블록 아래에 들어간다.
   이 경우 머리글이 실제 내용과 어긋난다. 아래 "남은 위험" 에 적었다. 문안을 새로 지으면
   "문장은 `describeSpecFinding` 만 만든다" 는 전역 제약과 설계 문서를 동시에 벗어나므로
   임의로 바꾸지 않았다.
4. **테스트를 구현보다 먼저 쓰지 않았다.** 계획서 Step 2 의 RED 확인 순서를 따르지 못했다.
   대신 구현이 끝난 뒤 `.filter((finding) => failedCaseIds.has(finding.caseId))` 를
   `.filter(() => false)` 로 잠시 바꿔 새 테스트가 실제로 이 코드에 걸려 있는지 확인했다.
   결과: `5 failed | 77 passed`. 실패한 것은 참고 문장·`--json` findings·exit code 불변·
   `caseId` 이스케이프 테스트다. 확인 뒤 파일을 원상 복구했다(`grep -c` 로 복구 확인).
   이 과정에서 "참고 문장은 보고서 뒤, 명세 승인 블록 앞이다" 테스트가 `indexOf` 만 비교해
   문장이 아예 없어도(-1) 통과한다는 것을 발견해, 존재를 먼저 단언하도록 고쳤다.
5. **기존 `--json` 단언 두 곳을 갱신했다.** `spec.findings` 는 항상 있어야 하므로
   `absentSpec` 에 `findings: []` 를 더하고, `spec` 전체를 `toEqual` 로 비교하는 테스트에도
   `findings: []` 를 더했다. 키 삽입 순서는 `approval` · `fingerprint` · `findings` ·
   (`approvedFingerprint`) 다. `jsonOut` 이 문자열을 그대로 비교하므로 이 순서가 계약이다.

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/cli/tests/test-command.test.ts` | `Test Files  1 passed (1)` / `Tests  82 passed (82)` |
| `npx turbo typecheck --force` | `Tasks:    6 successful, 6 total` / `Cached:    0 cached, 6 total` |
| `pnpm lint` | `Checked 134 files in 27ms. No fixes applied.` (오류 0) |
| `pnpm vitest run packages/cli/tests/{cli-integration,index,spec-approval,process-diagnostics}.test.ts` | `Test Files  4 passed (4)` / `Tests  50 passed (50)` |

전체 `pnpm test` 는 돌리지 않았다. 같은 worktree 에서 T4 가 동시에 진행 중이라 그 중간 상태가
섞인다. 오케스트레이터가 T4 와 합친 뒤 판정한다.

## 남은 위험

1. **머리글 문안.** 단언 실질성 finding 이 `… 의 입력이 서버 선언과 다릅니다` 아래에 붙는다.
   `minLength: 0` 은 입력이 아니라 단언의 문제이므로 머리글이 내용과 맞지 않는다. 설계 문서
   §7.2 를 고치는 결정이 필요하다. 케이스별로 머리글을 갈라 쓰거나(입력 계약 / 단언 실질성),
   "참고: `<caseId>` 에서 확인할 것이 있습니다" 처럼 중립적으로 바꾸는 선택지가 있다.
2. **실환경 미확인.** 참고 문장이 실제 서버 상대로 나오는지는 T6 에서 확인한다. 이 태스크는
   인메모리 주입으로만 검증했다. 특히 실제 MCP 서버의 `inputSchema` 는 대개
   `additionalProperties` 를 닫지 않으므로, 실환경에서 자주 보이는 finding 은
   `REQUIRED_MISSING` 과 `TYPE_MISMATCH` 쪽일 것이다.
3. **선택 필드 주입 지점.** `dependencies.checkInputContract` 가 선택 필드이므로 오타로 이름을
   틀리게 주입하면 조용히 기본값(실제 함수)이 쓰인다. 현재 주입 지점은 테스트뿐이라 문제가
   되지 않지만, 나중에 `index.ts` 에서 주입할 일이 생기면 필수 필드로 승격하는 편이 안전하다.
4. **`--json` 의 `spec` 키 순서.** `jsonOut` 이 문자열 비교라서 구현의 삽입 순서에 묶여 있다.
   구현에서 `findings` 를 다른 위치로 옮기면 테스트가 깨진다. 의도된 결속이다.

## 커밋 제안 (사람이 실행)

```
feat(cli): test 실패 케이스에 입력 계약 참고 문장을 덧붙인다
```

---

# T5b 추가 보고: 참고 문장 머리글을 검사 종류별로 가른다

T5 의 "남은 위험 1" 을 오케스트레이터가 승인해 이 태스크에서 고쳤다. 기점 HEAD `26d0819`.

## 바꾼 파일

- `packages/cli/src/test-command.ts`
- `packages/cli/tests/test-command.test.ts`
- `docs/superpowers/specs/2026-08-14-spec-findings-wiring-design.md` (§7.2 만, 21줄 추가)
- `docs/reports/task-t5-spec-findings-wiring.md` (이 절)

같은 worktree 에서 T4b 가 고치는 `packages/cli/src/generate-command.ts` ·
`packages/cli/tests/generate-command.test.ts` 와 설계 문서 §6 은 건드리지 않았다. 설계 문서는
Edit 로 §7.2 구간만 치환했고, `git diff` 의 hunk 헤더가 `@@ -170,11 +170,32 @@` 한 개인 것으로
다른 절이 안 바뀌었음을 확인했다.

## 무엇을 바꿨나

- `FINDING_GROUP: Readonly<Record<SpecFindingCode, FindingGroup>>` 로 코드를 두 종류로 가른다.
  `SpecFindingCode` 전체를 키로 갖는 `Record` 라서 `runner` 가 코드를 늘리면 이 표에서 타입
  오류가 난다. 문자열 배열이면 새 코드가 조용히 입력 계약 쪽으로 흘러간다.
- `FINDING_HEADING` 이 종류별 머리글을 만든다.
  - 입력 계약: `참고: <caseId> 의 입력이 서버 선언과 다릅니다` (기존 문안 유지)
  - 단언 실질성: `참고: <caseId> 의 단언은 무엇이 와도 통과합니다` (신규)
- `FINDING_GROUP_ORDER` 가 블록 순서를 정한다. 한 케이스에 둘 다 있으면 입력 계약이 먼저다.
- 케이스 사이 순서와 블록 안 순서는 그대로 `runner` 가 준 순서다. 재정렬하지 않는다.
- `escapeTerminalText(caseId)` 는 두 머리글 모두에 그대로 적용된다.
- `--json` 의 `spec.findings` 는 한 배열 그대로다. 한 줄도 바꾸지 않았다.

## 추가·갱신한 테스트

- 갱신: "항상 참인 단언은 툴 목록 없이도 참고 문장이 나온다" 에 새 머리글 기대를 넣고,
  입력 머리글이 **없다는** 것도 함께 고정했다.
- 신규: "한 케이스에 둘 다 있으면 머리글을 갈라 찍고 입력 계약이 먼저다". `both-case`
  (입력 `{ citi: "Seoul" }` + `minLength: 0`) 로 두 머리글의 위치를 비교하고, 머리글 경계로
  출력을 잘라 각 finding 이 맞는 블록 안에 있는지 확인한다.
- 신규: "`--json` 의 findings 는 한 배열로 그대로 둔다". 같은 입력에서 코드 순서가
  `REQUIRED_MISSING` · `UNDECLARED_FIELD` · `VACUOUS_MIN_LENGTH` 인 것을 고정한다.

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/cli/tests/test-command.test.ts` | `Test Files  1 passed (1)` / `Tests  84 passed (84)` |
| `npx turbo typecheck --force` | `Tasks: 6 successful, 6 total` / `Cached: 0 cached, 6 total` |
| `npx biome check packages/cli/src/test-command.ts packages/cli/tests/test-command.test.ts` | `Checked 2 files in 29ms. No fixes applied.` |

새 테스트가 실제로 이 분기에 걸려 있는지도 확인했다. `FINDING_GROUP` 의
`VACUOUS_MIN_LENGTH` 를 잠시 `"inputContract"` 로 바꾸니 `2 failed | 82 passed` 가 되고,
실패한 것이 위의 갱신 테스트와 신규 혼합 테스트였다. 확인 뒤 원복했다(`grep -c` 로 확인).

전체 `pnpm test` 와 `pnpm lint` 는 T4b 중간 상태가 섞이므로 돌리지 않았다.

## 임의로 판단한 지점

1. **분류를 `Record` 표로 뒀다.** "union 을 좁히는 방식" 요구를 `Record<SpecFindingCode, …>`
   로 읽었다. `switch` 문으로 짜도 exhaustiveness 는 같지만, 표는 두 종류의 대응이 한눈에
   보이고 머리글 함수와 나란히 둘 수 있다.
2. **머리글 문안에 `caseId` 위치를 그대로 유지했다.** `참고: <caseId> 의 …` 형태를 두 문안이
   공유하므로 사용자가 케이스 이름을 같은 자리에서 찾는다.
3. **블록 사이에 빈 줄이 하나 들어간다.** 각 블록이 `\n` 으로 시작하는 기존 레이아웃 규칙을
   그대로 따른 결과다. 같은 케이스의 두 블록도 빈 줄로 갈린다. 별도 규칙을 만들지 않았다.

## 남은 위험

1. **`SCHEMA_NOT_ANALYZABLE` 이 입력 계약 머리글 아래 붙는다.** 이것은 위반이 아니라 건너뜀
   이므로 `… 의 입력이 서버 선언과 다릅니다` 가 정확하지 않다. T4 승인 화면은 이 코드를 개수
   에서 빼고 별도 줄로 알리는데, `cli test` 에는 그런 규칙이 설계 문서에 없다. 세 번째 머리글
   (건너뜀)을 둘지는 별도 결정이 필요하다. 이번 태스크의 지시 범위 밖이라 손대지 않았다.
2. **실환경 미확인.** 새 머리글이 실제 서버 상대로 나오는 것은 T6 에서 확인한다.

## T5b 커밋 제안 (사람이 실행)

```
fix(cli): test 참고 문장 머리글을 검사 종류별로 가른다
```

---

# T5c 추가 보고: 건너뜀을 세 번째 그룹으로 가른다

T5b 의 "남은 위험 1" 을 오케스트레이터가 승인해 이 태스크에서 닫았다. T5b 미커밋 변경 위에
이어서 작업했다.

## 바꾼 파일

- `packages/cli/src/test-command.ts`
- `packages/cli/tests/test-command.test.ts`
- `docs/superpowers/specs/2026-08-14-spec-findings-wiring-design.md` (§7.2 만)
- `docs/reports/task-t5-spec-findings-wiring.md` (이 절)

설계 문서의 `git diff` hunk 는 둘이다. `@@ -133,20 +133,36 @@`(§6, ohmymcp-0a 의 T4b)와
`@@ -170,11 +186,46 @@`(§7.2, 내 것). 그쪽 변경 위에 얹혔고 되돌리지 않았다.

## 무엇을 바꿨나

- `FindingGroup` 에 `"skipped"` 를 더하고 `SCHEMA_NOT_ANALYZABLE` 을 그 그룹으로 옮겼다.
  `Record<SpecFindingCode, FindingGroup>` 이라 옮기는 순간 컴파일러가 빠짐을 잡는다.
- 머리글: `참고: <caseId> 의 입력 검사를 건너뛰었습니다`
- `FINDING_GROUP_ORDER` 는 입력 계약, 단언 실질성, 건너뜀 순이다.
- `--json` 의 `spec.findings` 는 이번에도 손대지 않았다. 한 배열 그대로다.

## 추가한 테스트

- "해석하지 못한 스키마는 건너뜀 머리글만 낸다". 입력 머리글이 **없다는** 것도 함께 고정한다.
- "건너뜀 블록은 단언 실질성 블록 뒤에 온다".
- "케이스가 여럿이면 케이스별로 세 머리글이 각자 나온다".

픽스처는 `unanalyzableTools`(루트에 `anyOf` 가 있는 `inputSchema`)다. `checkInputContract` 를
그 입력으로 직접 불러 확인한 실제 결과는 finding 한 건이다.

```
{ code: "SCHEMA_NOT_ANALYZABLE", severity: "advisory", caseId: "…", path: "operation.tool" }
문장: 'get_weather' 의 입력 스키마를 해석하지 못해 이 툴의 입력 검사를 건너뜁니다
```

## 임의로 판단한 지점

**"세 그룹이 한 케이스에 다 있을 때의 순서" 테스트는 만들 수 없어서 만들지 않았다.** 대신
케이스를 갈라 세 머리글이 각자 나오는 것을 고정했다.

이유는 실제로 확인했다. 한 케이스는 툴 하나만 부르고, 루트 스키마를 해석하지 못하면 그 툴의
입력 검사가 통째로 빠진다(ADR-0015). 그래서 같은 케이스에서 `SCHEMA_NOT_ANALYZABLE` 과
`REQUIRED_MISSING` 이 함께 나오는 입력이 존재하지 않는다. 필드 수준에 `anyOf` 를 두는 경우도
직접 확인했는데, 그 필드만 조용히 빠지고 `SCHEMA_NOT_ANALYZABLE` 은 나오지 않는다. 도달 불가한
조합을 테스트로 박으면 그 테스트가 실제로 무엇을 지키는지 아무도 모르게 된다. 이 사실을 설계
문서 §7.2 에도 한 문단으로 적었다.

대신 도달 가능한 두 조합을 테스트로 고정했다. 입력 계약 + 단언 실질성(T5b 의 `both-case`),
건너뜀 + 단언 실질성(T5c 의 `skipped-case` with `minLength: 0`).

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/cli/tests/test-command.test.ts` | `Test Files  1 passed (1)` / `Tests  87 passed (87)` |
| `npx turbo typecheck --force` | `Tasks: 6 successful, 6 total` / `Cached: 0 cached, 6 total` |
| `npx biome check packages/cli/src/test-command.ts packages/cli/tests/test-command.test.ts` | `Checked 2 files in 30ms. No fixes applied.` |

부하 확인: `SCHEMA_NOT_ANALYZABLE` 을 잠시 `"inputContract"` 로 되돌리니
`3 failed | 84 passed` 가 되고 실패한 것이 위의 신규 세 테스트였다. 확인 뒤 원복했다.

전체 `pnpm test` 와 `pnpm lint` 는 T4b 중간 상태가 섞이므로 돌리지 않았다.

## 남은 위험

1. **`cli test` 와 승인 화면의 건너뜀 문안이 다르다.** `cli test` 는
   `참고: <caseId> 의 입력 검사를 건너뛰었습니다` 이고, 승인 화면(§6.1)은
   `해석하지 못한 서버 스키마 N건은 검사에서 빠졌습니다` 다. 화면 구조가 다르므로(승인 화면은
   개수 집계, `cli test` 는 케이스별 블록) 지금은 의도된 차이로 본다. 두 화면의 문안을 하나로
   맞출지는 별도 결정이다.
2. **실환경 미확인.** 세 머리글이 실제 서버 상대로 나오는 것은 T6 에서 확인한다. 특히
   `SCHEMA_NOT_ANALYZABLE` 은 `anyOf` 나 `$ref` 를 쓰는 실제 서버에서 자주 나올 것이다.

## T5c 커밋 제안 (사람이 실행)

```
fix(cli): test 참고 문장에서 건너뜀을 위반과 가른다
```

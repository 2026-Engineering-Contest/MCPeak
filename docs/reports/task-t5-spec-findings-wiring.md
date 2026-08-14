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
   - 부수 효과: `test-command.ts` 가 `@ohmymcp/runner` 를 런타임으로 static import 한다.
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

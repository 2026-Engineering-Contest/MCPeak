# Task T2 보고서: 옵션 파싱과 진단 출력 배선

- 상태: BLOCKED
- 날짜: 2026-08-14
- 계획서: `docs/superpowers/plans/2026-08-13-cli-process-diagnostics-implementation.md` §4 Task T2
- 설계 문서: `docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md` §4.3, §6, §7, §8.2, §8.3

## 결론 먼저

구현과 새 테스트 21건은 계획서대로 완료했고 typecheck·lint·build 는 전부 통과한다.
그러나 **계획서가 요구하는 변경 자체가 기존 테스트 8건의 단언과 충돌한다.** 통합 게이트 2번
("기존 테스트의 단언이 바뀌었으면 회귀다")에 걸리므로 기존 단언을 임의로 고치지 않고 멈춘다.

충돌은 구현 결함이 아니다. 8건 전부가 계획서·설계 문서가 명시적으로 지시한 동작의 직접 결과다.
그중 1건은 **내 허용 Files 목록 밖 파일**(`packages/cli/tests/generate-integration.test.ts`)이라
어떤 경우에도 내가 고칠 수 없다.

## 실행 환경

```
pwd:  /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-cli-process-diagnostics
HEAD: 15979dd (docs(cli): T1 통합 SHA를 대장에 기록한다)
브랜치: feat/cli-process-diagnostics
```

## 변경 파일

```
 M packages/cli/src/test-command.ts
 M packages/cli/tests/cli-integration.test.ts
 M packages/cli/tests/test-command.test.ts
```

허용 Files 3개뿐이다. `process-diagnostics.ts` 는 import 만 했다. 기존 단언은 한 줄도 고치지
않았다(그래서 8건이 빨간 상태로 남아 있다).

## 구현 요약 (완료됨)

`packages/cli/src/test-command.ts`

- `TestCommandInput.stderrLines: number` 추가. 기본값 상수 `DEFAULT_STDERR_LINES = 20`.
- `usage` 끝에 ` [--stderr-lines <N>]` 추가.
- `--stderr-lines` / `--stderr-lines=N` 파싱. 검증은 `/^\d+$/` → `Number.parseInt` →
  `Number.isSafeInteger`. 실패 메시지 3종은 계획서 문자열 그대로, 전부 `CLI_USAGE` + `usage` 힌트.
  `-1` 은 값으로 받아 검증에서 "0 이상의 정수여야 합니다" 로 거절한다.
- `writeDiagnostics(leadingBlank)` 헬퍼를 계획서 §4 코드 그대로 넣고 `getDiagnostics()` 호출만
  `try/catch` 로 감쌌다(계약 3의 "던지면 기존 동작 유지").
- 호출 지점: `startRunner` 실패 → `writeDiagnostics(true)`, `finalize` 실패 →
  `writeDiagnostics(true)`, 보고서 획득 후 → `report.status !== "passed" || isAbnormalExit(...)`
  이면 `writeDiagnostics(false)`, `CLI_INTERNAL_ERROR` 경로 → 쓰지 않음.
- `connect` 거절 경로: `coreError()` 의 반환 타입을 `diagnostics?: ProcessDiagnosticsInput` 으로
  넓히고, `processDiagnostics()` 로 네 필드의 타입을 직접 확인한다. `core` 를 import 하지 않는다.
  `stderr` 가 비고 `isAbnormalExit` 이 거짓이면 블록을 쓰지 않는다.
- 종료 코드와 stdout 형식은 건드리지 않았다.

새 테스트: 설계 문서 §8.2 파싱 8건 + `runCli` 12건, §8.3 통합 1건. 전부 이름 그대로 추가했고
**21건 모두 통과한다.**

## 검증 출력

### 표적 테스트

```
$ pnpm vitest run packages/cli/tests/test-command.test.ts packages/cli/tests/cli-integration.test.ts

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  packages/cli/tests/cli-integration.test.ts > CLI 실제 weather-server > assertion 실패 report, 종료 코드와 PID 정리를 검증한다
 FAIL  packages/cli/tests/cli-integration.test.ts > CLI 실제 weather-server > --json 없이 실패 케이스의 진단 문장을 stdout에 쓴다
 FAIL  packages/cli/tests/test-command.test.ts > parseTestCommand > test 명세, command와 반복 arg를 입력 순서대로 파싱한다
 FAIL  packages/cli/tests/test-command.test.ts > parseTestCommand > equals 형식과 하이픈·빈 문자열 arg를 보존한다
 FAIL  packages/cli/tests/test-command.test.ts > runCli > 각 사용법 오류를 고정 message와 usage hint로 출력하고 읽기 전에 종료한다
 FAIL  packages/cli/tests/test-command.test.ts > runCli > 통과, 실패와 중단 report를 stdout으로만 출력한다
 FAIL  packages/cli/tests/test-command.test.ts > runCli > startRunner와 forceClose가 함께 실패해도 primary 실행 오류만 출력한다

 Test Files  2 failed (2)
      Tests  7 failed | 49 passed (56)
```

새로 추가한 21건은 이 실행에서 전부 통과했다(§8.3 단독 실행도 확인).

```
$ pnpm vitest run packages/cli/tests/cli-integration.test.ts -t "stderr-lines 0"
 Test Files  1 passed (1)
      Tests  1 passed | 4 skipped (5)
```

### 전체 테스트

```
$ pnpm test

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  packages/cli/tests/cli-integration.test.ts > ... > assertion 실패 report, 종료 코드와 PID 정리를 검증한다
 FAIL  packages/cli/tests/cli-integration.test.ts > ... > --json 없이 실패 케이스의 진단 문장을 stdout에 쓴다
 FAIL  packages/cli/tests/generate-integration.test.ts > ... > weather baseline은 실제 test에서 신뢰도 한계를 드러낸다
 FAIL  packages/cli/tests/test-command.test.ts > parseTestCommand > test 명세, command와 반복 arg를 입력 순서대로 파싱한다
 FAIL  packages/cli/tests/test-command.test.ts > parseTestCommand > equals 형식과 하이픈·빈 문자열 arg를 보존한다
 FAIL  packages/cli/tests/test-command.test.ts > runCli > 각 사용법 오류를 고정 message와 usage hint로 출력하고 읽기 전에 종료한다
 FAIL  packages/cli/tests/test-command.test.ts > runCli > 통과, 실패와 중단 report를 stdout으로만 출력한다
 FAIL  packages/cli/tests/test-command.test.ts > runCli > startRunner와 forceClose가 함께 실패해도 primary 실행 오류만 출력한다

 Test Files  3 failed | 33 passed (36)
      Tests  8 failed | 590 passed | 1 skipped (599)
```

core stdio-integration 의 알려진 간헐 실패는 나오지 않았다.

### 타입체크

```
$ pnpm typecheck
 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    955ms
```

### 린트

```
$ pnpm lint
> biome check .
Checked 118 files in 42ms. No fixes applied.
```

### 빌드

```
$ pnpm build
ohmymcp:build: ℹ [ESM] 5 files, total: 43.35 kB
ohmymcp:build: ✔ Build complete in 972ms
 Tasks:    6 successful, 6 total
```

## 충돌 8건의 원인과 근거

| # | 파일:테스트 | 기존 단언 | 깨지는 이유 | 지시한 문서 |
|---|---|---|---|---|
| 1 | `test-command.test.ts` `test 명세, command와 반복 arg를 입력 순서대로 파싱한다` | `toEqual({suitePath, command, args, json})` | 반환 객체에 `stderrLines` 가 늘어 `toEqual` 이 초과 필드로 실패 | 계획서 §3 (`TestCommandInput` 에 필드 추가) |
| 2 | 같은 파일 `equals 형식과 하이픈·빈 문자열 arg를 보존한다` | 같은 `toEqual` | 같음 | 같음 |
| 3 | 같은 파일 `각 사용법 오류를 고정 message와 usage hint로 출력하고 읽기 전에 종료한다` | `usage` 문자열 전량 비교 | `usage` 끝에 ` [--stderr-lines <N>]` 이 붙음 | 계획서 §4 T2 산출 계약 1, 설계 §6 |
| 4 | 같은 파일 `통과, 실패와 중단 report를 stdout으로만 출력한다` | `failed`·`aborted` 에서 `writes.err` 가 `[]` | 실패 보고서에 진단 블록을 stderr 로 쓰는 것이 이 기능이다 | 설계 §4.3, §7 |
| 5 | 같은 파일 `startRunner와 forceClose가 함께 실패해도 primary 실행 오류만 출력한다` | `RUNNER_EXECUTION_FAILED` stderr 전량 비교 | 그 뒤에 빈 줄 + 진단 블록이 붙음 | 설계 §7, 계획서 §4 호출 지점 1 |
| 6 | `cli-integration.test.ts` `assertion 실패 report, 종료 코드와 PID 정리를 검증한다` | `expect(err).not.toHaveBeenCalled()` | 실패 보고서라 진단 블록이 stderr 로 나감 | 설계 §4.3 |
| 7 | `cli-integration.test.ts` `--json 없이 실패 케이스의 진단 문장을 stdout에 쓴다` | 같음 | 같음 | 같음 |
| 8 | `generate-integration.test.ts` `weather baseline은 실제 test에서 신뢰도 한계를 드러낸다` | 같음 | 같음. **이 파일은 내 허용 Files 목록 밖이다** | 같음 |

8번의 실제 출력은 아래와 같다. 생성된 baseline 이 실제 실행에서 실패 판정을 받는다는 것이
이 테스트의 취지이므로, 실패 보고서에 진단이 붙는 것은 사양대로다.

```
AssertionError: expected "Mock" to not be called at all, but actually been called 1 times
  1st Mock call:
    Array [
      "서버 프로세스 진단
      종료 코드: 0  시그널: 없음
      stderr: (비어 있음)
    ",
    ]
```

## 설계 문서 안의 모순

설계 §2 완료 조건은 "변경 전 존재하던 테스트가 하나도 수정 없이 통과한다. 새 단언만 추가된다"
이다. 그런데 같은 문서 §6 이 `usage` 문자열 변경을, §4.3 이 실패 시 stderr 출력을, 계획서 §3 이
`TestCommandInput` 필드 추가를 각각 요구한다. 이 셋은 위 표의 단언들과 동시에 성립할 수 없다.
즉 T2 는 "기존 테스트 무수정" 조건을 만족시킬 수 없는 태스크다. 이것이 BLOCKED 사유다.

## 필요한 결정 (사람 몫)

셋 중 하나를 골라 지시하면 그대로 진행한다.

1. **기존 단언 8건 갱신을 승인한다(권장).** 전부 이번 기능의 의도된 동작을 반영하는 갱신이고,
   판정 로직·종료 코드·stdout 바이트를 바꾸는 것이 아니다. 다만 8번은 허용 Files 밖이므로
   `packages/cli/tests/generate-integration.test.ts` 를 내 Files 목록에 추가해 줘야 한다.
   갱신 내용은 (a) `toEqual` 에 `stderrLines: 20` 추가 2곳, (b) `usage` 기대 문자열 1곳,
   (c) 실패 경로의 `writes.err`·`err` 단언 4곳을 "진단 블록이 있다" 로 바꾸는 것이다.
2. **stderr 출력 조건을 좁힌다.** 예를 들어 `isAbnormalExit` 이 참일 때만 쓰도록 바꾸면 6·7·8 은
   살지만 설계 §4.3 의 "케이스 실패에도 붙인다" 를 포기하는 것이라 기능의 핵심이 빠진다. 권장하지
   않는다.
3. **T2 를 중단한다.** 현재 변경을 되돌린다.

## 남은 위험

- 현재 워킹트리는 `pnpm test` 가 빨간 상태다. 이 상태로 커밋·머지하면 CI 가 깨진다.
  결정이 날 때까지 통합하지 마라.
- `--stderr-lines 0` 의 stdout·stderr 바이트 동일성은 §8.3 새 테스트로 실제 서버를 띄워
  확인했다(통과).
- `pnpm --filter ohmymcp test:e2e` 는 T3 범위라 이번에 돌리지 않았다.
- 커밋·푸시 하지 않았다.

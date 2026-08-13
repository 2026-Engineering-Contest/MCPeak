# Task T2 보고서: 옵션 파싱과 진단 출력 배선

- 상태: READY_FOR_REVIEW (1차 BLOCKED → 오케스트레이터 결정 3건 반영 후 해소)
- 날짜: 2026-08-14
- 계획서: `docs/superpowers/plans/2026-08-13-cli-process-diagnostics-implementation.md` §4 Task T2
- 설계 문서: `docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md` §4.3, §6, §7, §8.2, §8.3

## 경과 요약

1차 실행에서 기존 테스트 8건이 사양과 충돌해 `BLOCKED` 으로 보고했다. 오케스트레이터가 설계
문서와 계획서를 고쳐 결정 셋을 내렸고, 그 결정을 반영해 8건이 전부 해소됐다.

- **결정 1**: 빈 진단 생략(`stderr === "" && !isAbnormalExit`)을 연결 실패 경로 전용에서
  **모든 경로 공통 규칙**으로 확대. 판정은 렌더러가 아니라 호출부(`writeDiagnostics`)에 둔다.
- **결정 2**: 공개 계약이 실제로 늘어난 기존 단언 **3곳만** 갱신 승인.
- **결정 3**: `실패해도 진단이 비어 있으면 쓰지 않는다` 테스트 1건 추가.

결정 1로 1차 충돌 8건 중 4·5·6·7·8 다섯 건이 **기존 단언 그대로 통과**한다.
`packages/cli/tests/generate-integration.test.ts`(허용 Files 밖)도 무수정 통과했다.

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
?? docs/reports/task-t2-cli-process-diagnostics.md
```

(`docs/superpowers/**` 두 문서의 수정은 오케스트레이터가 한 것이고 내 변경이 아니다.)

허용 Files 3개뿐이다. `process-diagnostics.ts` 는 import 만 했다.
기존 단언 중 실제로 지운 줄은 `usage` 기대 문자열 **1줄**뿐이고, 나머지 승인분 2곳은 기대 객체에
`stderrLines: 20` 을 **추가**한 것이다. 승인 밖 단언은 한 줄도 고치지 않았다.

```
$ git diff packages/cli/tests | grep '^-' | grep -v '^---'
-import { mkdtemp, readFile, rm } from "node:fs/promises";
-        `오류 [CLI_USAGE]: ${message}\n해결: 사용법: ohmymcp test <suite.json> --command <executable> [--arg <value> ...]\n`,
```

## 구현

`packages/cli/src/test-command.ts`

- `TestCommandInput.stderrLines: number` 추가. 기본값 상수 `DEFAULT_STDERR_LINES = 20`.
- `usage` 끝에 ` [--stderr-lines <N>]` 추가.
- `--stderr-lines` / `--stderr-lines=N` 파싱. 검증은 `/^\d+$/` → `Number.parseInt` →
  `Number.isSafeInteger`. 실패 메시지 3종은 계획서 문자열 그대로, 전부 `CLI_USAGE` + `usage` 힌트.
  `-1` 은 값으로 받아 검증에서 "0 이상의 정수여야 합니다" 로 거절한다.
- `writeDiagnostics(leadingBlank)` 는 갱신된 계획서 §4 코드 그대로다. `getDiagnostics()` 를
  `try/catch` 로 감싸고, **빈 진단이면 반환**한 뒤 렌더링한다.
- 호출 지점: `startRunner` 실패 → `writeDiagnostics(true)`, `finalize` 실패 →
  `writeDiagnostics(true)`, 보고서 획득 후 → `report.status !== "passed" || isAbnormalExit(...)`
  이면 `writeDiagnostics(false)`, `CLI_INTERNAL_ERROR` 경로 → 쓰지 않음.
- `connect` 거절 경로: `coreError()` 반환 타입을 `diagnostics?: ProcessDiagnosticsInput` 으로
  넓히고 `processDiagnostics()` 로 네 필드 타입을 직접 확인한다. `core` 를 import 하지 않는다.
  같은 빈 진단 조건을 적용한다.
- 판정·종료 코드·stdout 형식은 건드리지 않았다.

`packages/cli/tests/test-command.test.ts`: 설계 §8.2 의 파싱 8건 + `runCli` 13건(결정 3의 1건
포함) 추가. 승인된 기존 단언 3곳 갱신.

`packages/cli/tests/cli-integration.test.ts`: 설계 §8.3 의 1건 추가.

## 검증 출력

### 표적 테스트

```
$ pnpm vitest run packages/cli/tests/test-command.test.ts packages/cli/tests/cli-integration.test.ts

 Test Files  2 passed (2)
      Tests  57 passed (57)
```

### 전체 테스트

```
$ pnpm test

 Test Files  36 passed (36)
      Tests  599 passed | 1 skipped (600)
```

1차 실행의 실패 8건이 0건이 됐다. T1 통합 시점(577 passed) 대비 22건이 늘었다
(파싱 8 + `runCli` 13 + 통합 1).
core stdio-integration 의 알려진 간헐 실패는 나오지 않았다.

### 타입체크

```
$ pnpm typecheck
 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    952ms
```

### 린트

```
$ pnpm lint
> biome check .
Checked 118 files in 25ms. No fixes applied.
```

### 빌드

```
$ pnpm build
 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    739ms
```

## 1차 충돌 8건의 최종 처리

| # | 테스트 | 처리 |
|---|---|---|
| 1 | `test 명세, command와 반복 arg를 입력 순서대로 파싱한다` | 결정 2로 기대 객체에 `stderrLines: 20` 추가 |
| 2 | `equals 형식과 하이픈·빈 문자열 arg를 보존한다` | 결정 2로 같은 추가 |
| 3 | `각 사용법 오류를 고정 message와 usage hint로 출력하고 읽기 전에 종료한다` | 결정 2로 `usage` 기대 문자열 갱신 |
| 4 | `통과, 실패와 중단 report를 stdout으로만 출력한다` | 결정 1로 **무수정 통과** |
| 5 | `startRunner와 forceClose가 함께 실패해도 primary 실행 오류만 출력한다` | 결정 1로 **무수정 통과** |
| 6 | `assertion 실패 report, 종료 코드와 PID 정리를 검증한다` | 결정 1로 **무수정 통과** |
| 7 | `--json 없이 실패 케이스의 진단 문장을 stdout에 쓴다` | 결정 1로 **무수정 통과** |
| 8 | `generate-integration.test.ts` `weather baseline은 실제 test에서 신뢰도 한계를 드러낸다` | 결정 1로 **무수정 통과** (파일도 열지 않았다) |

## 임의로 판단한 부분

**§8.3 통합 테스트의 단언 구성.** 설계 §8.3 은 "옵션 없음 → 블록 있음, `--stderr-lines 0` →
블록 없음" 을 요구하는데, 결정 1 적용 후 실제 weather-server 는 정상 종료하고 stderr 도 비어서
옵션 없이 실행해도 블록이 붙지 않는다. 실제로 이 형태로 먼저 만들었다가 아래로 실패했다.

```
FAIL  cli-integration.test.ts > --stderr-lines 0 은 변경 전과 같은 바이트를 낸다
AssertionError: expected '' to contain '서버 프로세스 진단'
```

`fixtures/` 와 `examples/` 는 수정 금지 대상이라 weather-server 가 stderr 를 남기게 만들 수
없다. 그래서 테스트를 두 부분으로 나눴다.

1. weather-server 실패 명세를 두 번 실행해 **stdout 바이트가 같고** `--stderr-lines 0` 쪽
   stderr 가 비어 있음을 확인한다(설계 §8.3 의 원래 목적).
2. 임시 디렉터리에 stderr 를 남기고 즉시 죽는 최소 스크립트를 만들어 두 번 실행해,
   옵션 없음 쪽에는 `서버 프로세스 진단` 과 `BOOT_MARKER` 가 있고 `--stderr-lines 0` 쪽에는
   `MCP_CONNECTION_FAILED` 만 있음을 확인한다.

2번을 넣은 이유는 계획서 §10 의 거짓 신호("`writes.err` 가 비어서 통과") 때문이다. 통과 쪽만
단언하면 조건 판정이 잘못돼 블록이 아예 안 붙는 상태와 구분되지 않는다. 임시 파일은 테스트가
정리하고 저장소에 남지 않는다. `examples/` 를 오염시키지 않는다는 설계 §8.4 의 방침과 같은
방식이다.

## 남은 위험

- T3 의 E2E 시나리오 1·2 와 위 2번 단언이 검증 내용에서 겹친다. T3 는 배포 산출물(`dist/`)로,
  이쪽은 소스로 검증하므로 층은 다르다. 중복이 불필요하다고 판단되면 T3 쪽에서 조정하면 된다.
- `pnpm --filter ohmymcp test:e2e` 는 T3 범위라 이번에 돌리지 않았다.
- 커밋·푸시 하지 않았다.

# Task R1 보고서: PR #57 코드 리뷰 지적 6건 반영

- 상태: READY_FOR_REVIEW
- 날짜: 2026-08-14
- 대상 PR: #57 `feat(cli): 실패 시 서버 프로세스 진단을 출력한다`
- 설계 문서: `docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md`

## 실행 환경

```
pwd:  <repository-root>   (worktree 아님, 저장소 루트)
HEAD: f4a78b0 (chore(cli): 프로세스 진단 출력 changeset 추가)
브랜치: feat/cli-process-diagnostics
```

## 변경 파일

```
 M packages/cli/src/process-diagnostics.ts
 M packages/cli/src/test-command.ts
 M packages/cli/tests/process-diagnostics.test.ts
 M packages/cli/tests/test-command.test.ts
 M packages/cli/README.md
 M docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md
?? docs/reports/task-r1-cli-process-diagnostics.md
```

허용 Files 안이다. `core` 는 읽기만 했고 고치지 않았다.

## 지적별 처리

### 지적 1 (medium) — 우리가 보낸 종료 시그널을 비정상으로 보고

`packages/core/src/lifecycle.ts:4,215` 를 확인했다. `STDIN_CLOSE_GRACE_MS = 500`,
`SIGTERM_GRACE_MS = 500` 이고 `#sendKill("SIGTERM")` → `#sendKill("SIGKILL")` 순서다. 지적대로
유예 안에 못 끝나는 멀쩡한 서버가 전부 통과한 실행에서도 `시그널: SIGTERM` 을 받게 된다.

`isAbnormalExit` 을 다음으로 바꿨다.

```ts
if (diagnostics.signal !== null) return !SHUTDOWN_SIGNALS.has(diagnostics.signal);
return diagnostics.exitCode !== null && diagnostics.exitCode !== 0;
```

`SHUTDOWN_SIGNALS` 는 `SIGTERM`·`SIGKILL` 이고, 왜 이 둘인지(우리가 보낸다)를 상수 주석에
`lifecycle.ts` 의 상수 이름과 함께 적었다. `SIGSEGV`·`SIGABRT`·`SIGBUS` 는 그대로 비정상이다.

OOM killer 의 `SIGKILL` 을 놓치는 한계는 함수 doc 주석과 설계 문서 §4.3.0 두 곳에 적었다.
구분하려면 `core` 진단에 표식이 필요한데 `core` 는 수정 금지라 이번 범위 밖이다.

테스트 2건 추가: `우리가 보내는 종료 시그널은 비정상이 아니다`,
`우리가 보내지 않는 시그널은 비정상이다`.

### 지적 2 (low) — "전체" 와 "잘렸습니다" 의 모순

버린 줄이 없고 `stderrTruncated` 가 참이면 `전체` 대신 `수집된 전체` 를 쓴다.

```
  stderr (수집된 전체, 앞부분이 수집 상한으로 잘렸습니다):
```

기존 테스트 `수집 상한 잘림을 헤더에 적는다` 의 기대값을 함께 고쳤다(이 PR 에서 만든 단언이다).

### 지적 3 (low) — 줄 길이 무제한

`MAX_LINE_CHARACTERS = 1000` 을 두고, 넘으면 앞 1000자만 남기고 ` …(N자 생략)` 을 붙인다.
자르는 기준은 **이스케이프 전 원문**이고 `Array.from` 으로 코드포인트를 세어 서로게이트 페어를
쪼개지 않는다. 상수 주석에 근거(구조화 로거의 수십 KB 한 줄, 이스케이프가 6배로 부풀림)를 적었다.

테스트 2건 추가: `긴 줄을 잘라 생략 표시를 붙인다`, `상한 이하의 줄은 그대로 둔다`.
두 번째는 경계에서 불필요하게 자르지 않는지 보는 것이다.

### 지적 4 (low) — 우리가 죽인 결과를 보고

`snapshotDiagnostics()` 헬퍼를 두고 `RUNNER_EXECUTION_FAILED` 경로에서 **`forceClose()` 전에**
스냅샷을 찍어 그 값으로 출력한다. `writeDiagnostics` 는 스냅샷을 받으면 그것을 쓰고, 없으면
그 자리에서 읽는다.

테스트 추가: `실행 실패 경로는 forceClose 이전 진단을 쓴다`. `forceClose` 호출 여부에 따라 다른
값을 주는 가짜 `getDiagnostics` 로 검증하고, 출력에 `시그널: 없음` 이 있고 `SIGKILL` 이 없음을
단언한다.

### 지적 5 (low) — 빈 줄 구분이 경로마다 다름

`writeDiagnostics` 의 `leadingBlank` 인자를 없애고 항상 `\n${block}` 을 쓴다. 호출 지점 셋이
모두 같은 레이아웃이 됐다.

### 지적 6 (low) — README 갱신

- 문법 문자열에 `[--json] [--stderr-lines <N>]` 반영.
- "stdout에는 최종 RunnerReport JSON만 출력하며" 를 현재 동작으로 교체했다. 기본은 사람이 읽는
  보고서, `--json` 이면 `RunnerReport` JSON, 오류와 진단은 stderr. `--json > report.json` 이
  깨지지 않는다는 점도 적었다.
- `--stderr-lines` 설명 한 문단 추가(기본 20, `0` 이면 완전히 끔, 빈 진단은 쓰지 않음).

### 설계 문서 갱신

- §3.2: `isAbnormalExit` doc 주석을 새 규칙으로.
- §4.3.0 신설: 비정상 판정 규칙 전량, `lifecycle.ts` 근거, OOM `SIGKILL` 한계.
- §5.3: `수집된 전체` 규칙과 예시.
- §5.4: 4번 항목(줄당 1000자 상한)과 그 근거.
- §7: 모든 경로 빈 줄 통일, `RUNNER_EXECUTION_FAILED` 의 `forceClose` 이전 스냅샷.

## 검증 출력

```
$ pnpm test
 Test Files  36 passed (36)
      Tests  604 passed | 1 skipped (605)
```

PR 시점 599 → 604. 새 테스트 5건(시그널 2, 줄 상한 2, forceClose 스냅샷 1)이 늘었다.

```
$ pnpm typecheck
 Tasks:    6 successful, 6 total

$ pnpm lint
> biome check .
Checked 118 files in 30ms. No fixes applied.

$ pnpm build
 Tasks:    6 successful, 6 total

$ pnpm --filter ohmymcp test:e2e
> node ./tests/dist-cli-e2e.mjs
e2e exit=0
```

E2E 는 `pnpm build` 뒤에 돌렸다.

### 배포 산출물 실제 출력

지적 3·5 가 실제로 반영됐는지 `dist/cli.mjs` 로 확인했다. 서버가 stderr 에 1200자 한 줄과
`TypeError` 한 줄을 남기고 죽는 경우다.

```
오류 [MCP_CONNECTION_FAILED/PROCESS_EXITED]: 요청 완료 전 MCP 서버가 종료되었습니다.
해결: exit code, signal, bounded stderr를 확인하세요.

서버 프로세스 진단
  종료 코드: 1  시그널: 없음
  stderr (전체):
    AAAAA...(1000자)... …(200자 생략)
    TypeError: boom
```

잘린 줄의 꼬리를 그대로 뽑으면 이렇다.

```
AAAAAAAAAAAAAAAAAAAAAAAAAAAAA …(200자 생략)
```

## 불변 조건 확인

- 판정과 종료 코드는 건드리지 않았다. `report.status === "passed" ? 0 : 1`, 실패 경로 1 그대로다.
- stdout 바이트는 변하지 않는다. 이번 변경은 전부 stderr 쪽 문자열과 `isAbnormalExit` 판정이다.
- `--stderr-lines 0` 은 여전히 아무것도 쓰지 않는다. E2E 케이스 2가 그대로 통과한다.
- `--json` 의 stdout 은 `dist-cli-e2e.mjs` 가 `JSON.parse` 로 판정하고 통과했다.

## 임의로 판단한 부분

1. **`stderrTruncated` 가 참이고 버린 줄도 있는 경우**는 이미 `마지막 N줄` 이라 `수집된 전체` 를
   쓰지 않는다. `전체` 를 대체하는 규칙이므로 그쪽만 바꿨다.
2. **경계 테스트 1건을 더 넣었다**(`상한 이하의 줄은 그대로 둔다`). 지적에는 없지만 정확히 1000자
   에서 자르지 않는지 고정해 둘 값어치가 있다고 봤다.
3. **보고서 획득 경로의 `isAbnormalExit` 판정도 스냅샷 하나로 통일했다.** 전에는
   `connection.getDiagnostics()` 를 판정용으로 한 번, 출력용으로 또 한 번 불렀다. 두 호출 사이에
   값이 달라질 수 있어 같은 스냅샷을 쓰게 했다. 동작은 같고 호출 횟수만 줄었다.

## 남은 위험

- OOM killer 의 `SIGKILL` 은 여전히 정상으로 보고된다(지적 1 의 알려진 한계). `core` 진단에
  "우리가 보냈다" 표식을 넣는 것이 근본 해결이고, 그것은 `core` 오너의 결정이다.
- 커밋·푸시 하지 않았다. git 은 조회만 썼다.

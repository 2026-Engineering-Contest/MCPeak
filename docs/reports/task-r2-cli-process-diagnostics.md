# Task R2 보고서: CodeRabbit 인라인 지적 반영

- 상태: READY_FOR_REVIEW
- 날짜: 2026-08-14
- 대상 PR: #57 `feat(cli): 실패 시 서버 프로세스 진단을 출력한다`
- 선행: R1(`docs/reports/task-r1-cli-process-diagnostics.md`)

## 실행 환경

```
pwd:  <repository-root>
HEAD: ad54f2d (fix(cli): 진단 출력의 리뷰 지적 6건을 반영한다)
브랜치: feat/cli-process-diagnostics
```

## 변경 파일

```
 M .changeset/silly-donuts-report.md
 M packages/cli/README.md
 M packages/cli/tests/cli-integration.test.ts
 M packages/cli/tests/dist-cli-e2e.mjs
 M docs/reports/task-r1-cli-process-diagnostics.md
 M docs/reports/task-t1-cli-process-diagnostics.md
 M docs/reports/task-t2-cli-process-diagnostics.md
 M docs/reports/task-t3-cli-process-diagnostics.md
 M docs/reports/task-t4-cli-process-diagnostics.md
?? docs/reports/task-r2-cli-process-diagnostics.md
```

`packages/cli/src/` 는 건드리지 않았다. 이번 지적은 전부 문서와 테스트 쪽이다.

T1~T4 보고서 4개는 허용 Files 목록에는 없지만, 지적 4의 "다른 보고서에도 절대경로가 있으면 같이
정리해라" 를 그 4개에 대한 지시로 읽고 개인 경로만 치환했다. 그 외의 내용은 한 글자도 바꾸지
않았다. 이 판단이 어긋나면 되돌리면 된다.

## 지적별 처리

### 1. changeset 문구가 실제 동작보다 넓다 (반영)

첫 문단을 "실패했거나 서버가 비정상 종료·중단했을 때, **보여줄 진단 정보가 있으면**" 으로 좁히고,
어디에 안 붙는지 한 문단을 덧붙였다.

```
서버 프로세스와 무관한 실패에는 붙지 않습니다. 명세 검증 실패처럼 연결 이전에 끝나는 경로와
보고서 렌더링 중의 내부 오류가 그렇습니다.
```

`--json` 바이트 불변과 판정·종료 코드 불변을 적은 마지막 문단은 그대로 뒀다.

### 2. 테스트 스크립트의 `process.exit(1)` (반영, 가장 중요)

두 곳 다 `process.exitCode = 1` 로 바꿨다.

- `packages/cli/tests/cli-integration.test.ts` 의 `dies.mjs`(`BOOT_MARKER`)
- `packages/cli/tests/dist-cli-e2e.mjs` 의 `dying-server.mjs`(`TypeError ...`)

각각 왜 `exit` 을 안 쓰는지 주석을 달았다.

```
// process.exit 은 stderr 가 파이프일 때 write 버퍼를 버릴 수 있다. exitCode 만 정하고
// 이벤트 루프가 비어 자연 종료하게 둔다. 종료 코드는 1 그대로다.
```

두 스크립트 모두 쓰기 뒤에 할 일이 없어 이벤트 루프가 비고, flush 후 종료 코드 1로 끝난다.
아래 검증에서 종료 코드와 stderr 내용을 실제로 확인했다.

### 3. 통합 테스트가 기본 실행의 stderr 를 안 본다 (반영)

`expect(withBlock.stderr).toBe("")` 를 추가하고 두 실행의 stderr 를 서로 비교한다.

```ts
// weather-server 는 정상 종료하고 stderr 도 비어서 기본 실행에도 블록이 없어야 한다.
// 옵션 쪽만 보면 빈 진단이 잘못 붙어도 통과한다.
expect(withBlock.stderr).toBe("");
expect(withoutBlock.stderr).toBe(withBlock.stderr);
```

블록이 실제로 붙는 쪽은 같은 테스트의 `runDeadServer` 두 실행이 계속 담당한다
(`BOOT_MARKER` 있음 / `--stderr-lines 0` 이면 없음).

### 4. 보고서의 개인 로컬 경로 (반영)

`docs/reports/*.md` 다섯 개의 절대경로를 `<repository-root>` 로 바꿨다. worktree 경로
(`.../.claude/worktrees/ohmymcp-cli-process-diagnostics`)와 저장소 루트 둘 다 대상이다.

```
$ grep -rn "/Users/" docs/reports/
(없음)
```

### 5. README 의 진단 출력 조건 (반영)

`--stderr-lines` 문단 첫 문장을 "실패했거나 서버가 비정상 종료·중단했을 때, 진단 내용이 있으면"
으로 고쳤다.

### 6. 보고서 날짜 (기각, 지시대로 손대지 않음)

오늘은 2026-08-14 이므로 보고서 날짜가 맞다. 수정하지 않았다.

## 검증 출력

```
$ pnpm test
 Test Files  36 passed (36)
      Tests  604 passed | 1 skipped (605)
```

첫 실행에서는 알려진 간헐 실패가 다시 나왔다.

```
 FAIL  packages/core/tests/stdio-integration.test.ts > stdio 실제 프로세스 > handshake timeout 뒤 프로세스를 정리한다
 Tests  1 failed | 603 passed | 1 skipped (605)
```

단독 재실행으로 확인만 하고 `core` 는 고치지 않았다.

```
$ pnpm vitest run packages/core/tests/stdio-integration.test.ts
      Tests  5 passed (5)
```

이후 전체 재실행이 위의 604 통과다.

```
$ pnpm typecheck
 Tasks:    6 successful, 6 total

$ pnpm lint
Checked 118 files in 26ms. No fixes applied.

$ pnpm build
 Tasks:    6 successful, 6 total

$ pnpm --filter ohmymcp test:e2e
e2e exit=0
```

E2E 는 `pnpm build` 뒤에 돌렸다.

### 지적 2가 실제로 안전한지 확인

`process.exitCode = 1` 로 바꾼 스크립트에서 stderr 가 잘리지 않는지 배포 산출물로 직접 봤다.

```
$ node packages/cli/dist/cli.mjs test packages/cli/tests/fixtures/weather-suite.json \
    --command node --arg <임시>/dying.mjs
오류 [MCP_CONNECTION_FAILED/PROCESS_EXITED]: 요청 완료 전 MCP 서버가 종료되었습니다.
해결: exit code, signal, bounded stderr를 확인하세요.

서버 프로세스 진단
  종료 코드: 1  시그널: 없음
  stderr (전체):
    TypeError: Cannot read properties of undefined (reading 'temp')
exit=1
```

`종료 코드: 1` 과 `TypeError` 문자열이 그대로 잡힌다. `BOOT_MARKER` 쪽은 통합 테스트로 확인했다.

```
$ pnpm vitest run packages/cli/tests/cli-integration.test.ts -t "stderr-lines 0"
      Tests  1 passed | 4 skipped (5)
```

## 불변 조건 확인

- `packages/cli/src/` 무수정. 판정·종료 코드·stdout 바이트가 바뀔 코드 경로가 없다.
- `--json` 의 stdout 은 `dist-cli-e2e.mjs` 가 `JSON.parse` 로 판정하고 통과했다.
- `--stderr-lines 0` 경로는 E2E 케이스 2와 통합 테스트가 그대로 통과했다.

## 임의로 판단한 부분

1. **T1~T4 보고서를 함께 고쳤다.** 허용 Files 목록 밖이지만 지적 4가 "다른 보고서에도" 라고
   지시했다. 치환한 것은 개인 경로뿐이다.
2. **`docs/superpowers/plans/2026-08-13-cli-process-diagnostics-implementation.md` 는 고치지
   않았다.** 여기에도 `/Users/...` 가 세 줄 있다(365, 366, 369행). 다만 그것은 실행 프롬프트
   안의 `cp` 명령과 확인 절차라 경로가 있어야 의미가 성립하고, 보고서가 아니며 허용 Files 밖이다.
   지우려면 별도 지시가 필요하다고 보고 남겼다.

## 남은 위험

- `core` stdio-integration 의 간헐 실패는 이번에도 1회 재현됐다. 알려진 항목이고 이번 변경과
  무관하다.
- 커밋·푸시 하지 않았다. git 은 조회만 썼다.

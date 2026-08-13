# Task R3 보고서: 자체 재리뷰 지적 6건 반영

- 상태: READY_FOR_REVIEW
- 날짜: 2026-08-14
- 대상 PR: #57 `feat(cli): 실패 시 서버 프로세스 진단을 출력한다`
- 선행: R1, R2 보고서

## 실행 환경

```
pwd:  <repository-root>
HEAD: ad54f2d (fix(cli): 진단 출력의 리뷰 지적 6건을 반영한다)
브랜치: feat/cli-process-diagnostics
```

## 변경 파일

```
 M packages/cli/src/process-diagnostics.ts
 M packages/cli/src/test-command.ts
 M packages/cli/tests/process-diagnostics.test.ts
 M packages/cli/tests/test-command.test.ts
 M docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md
 M docs/superpowers/plans/2026-08-13-cli-process-diagnostics-implementation.md
?? docs/reports/task-r3-cli-process-diagnostics.md
```

(R2 의 변경분도 아직 커밋 전이라 워킹트리에 함께 있다.)
`packages/runner/src/reporter.ts` 는 읽기만 했고 고치지 않았다.

## 지적별 처리

### 1. TAB 을 이스케이프해 스택 트레이스를 뭉갠다 (반영)

이 모듈의 이스케이프에서 `0x09` 를 뺐다. 함수 doc 주석에 왜 이 사본만 갈라지는지 적었다. 다른 두
사본은 우리가 만든 메시지 문자열만 다루므로 TAB 이 들어올 일이 없고, 서버 stderr 를 그대로 그리는
것은 이 모듈이 처음이다. TAB 은 커서를 옮길 뿐이라 터미널 주입 벡터가 아니다.

설계 문서 §5.5 에 같은 내용을 적었다("거의 같은 규칙" + 다른 점 한 문단).

테스트 추가: `탭은 이스케이프하지 않는다`.

### 2. clampLine 이 이스케이프 전에 잘라 상한이 상한이 아니다 (반영)

순서를 뒤집어 **이스케이프 뒤에** 자른다. 세는 단위도 이스케이프된 문자다.

시퀀스 중간에서 잘리지 않게 하려고 이스케이프 함수가 문자열 대신 **토큰 배열**을 돌려주도록
바꿨다(`escapeTokens`). 토큰 하나는 원문 문자 하나에 대응하고 절대 쪼개지 않는다. `clampTokens`
는 상한을 넘지 않는 마지막 토큰 경계까지만 담는다. 두 함수 주석에 그 이유를 적었다.

- `긴 줄을 잘라 생략 표시를 붙인다`(기존): 입력이 `x` 1200자라 이스케이프가 길이를 바꾸지 않는다.
  기대값 `1000자 + …(200자 생략)` 이 새 규칙에서도 그대로 성립해 수정하지 않았다.
- 테스트 추가: `이스케이프한 결과를 기준으로 상한을 지킨다`. `` 300자(이스케이프 후 1800자)
  입력에 대해 남는 부분이 `/^(\\u0001)+$/` 를 만족하고(시퀀스 중간에서 안 잘림), 길이가 996자,
  생략 표시가 `(804자 생략)` 인지 본다. 996은 1000 이하의 가장 큰 토큰 경계(6×166)다.

### 3. `snapshot ?? snapshotDiagnostics()` 가 두 상태를 섞는다 (반영)

`undefined` 센티널을 없애고 래퍼를 쓴다.

```ts
type DiagnosticsSnapshot = { readonly value: ProcessDiagnosticsInput | undefined };
```

`snapshotDiagnostics()` 는 실패해도 `{ value: undefined }` 를 돌려주므로 "이미 시도했고
실패했다" 가 표현된다. `writeDiagnostics` 는 스냅샷을 받으면 그 결과가 전부이고 다시 읽지 않는다.

테스트 추가: `실행 실패 경로의 사전 스냅샷이 실패하면 다시 읽지 않는다`. 첫 호출은 던지고 두
번째는 `SIGKILL` 진단을 주는 가짜 `getDiagnostics` 로, 출력에 진단 블록이 없고 `getDiagnostics`
호출이 1회뿐임을 단언한다.

### 4. 연결 실패 분기가 억제 조건을 복제한다 (반영)

`hasDiagnosticContent(diagnostics)` 를 `process-diagnostics.ts` 에서 export 하고 두 곳이 함께
쓴다. 연결 실패 분기의 주석도 사실에 맞게 고쳤다("이 경로에만 있는 조건이다" → "같은 함수를 쓴다,
규칙이 갈라지면 진단이 가장 필요한 경로에만 미적용된다").

### 5. 주석의 줄 번호 포인터가 낡았다 (반영)

`packages/runner/src/reporter.ts:38`, `packages/cli/src/test-command.ts:143` 을 심볼 참조로
바꿨다. 왜 줄 번호를 쓰지 않는지도 한 줄 남겼다. `runner` 쪽 파일은 건드리지 않았다.

### 6. usage 에 `[--json]` 이 빠져 있다 (반영)

```
사용법: ohmymcp test <suite.json> --command <executable> [--arg <value> ...] [--json] [--stderr-lines <N>]
```

usage 를 전량 비교하는 기존 테스트 기대값도 함께 갱신했다.

### 추가 지시 — 계획서의 개인 경로 (반영)

`docs/superpowers/plans/2026-08-13-cli-process-diagnostics-implementation.md` 의 절대경로를
지시대로 처리했다.

- 실행되는 `cp` 명령 두 줄은 저장소 루트 기준 상대경로로 바꿨다
  (`cp ROADMAP.local.md .claude/worktrees/ohmymcp-cli-process-diagnostics/ ...`).
- `pwd` 확인 절차는 `<repository-root>/.claude/worktrees/...` 로 남겼다.

```
$ git ls-files | xargs grep -ln "doo\._\.hyun"
(없음)
```

`grep -rn "/Users/" docs/` 에는 아직 줄이 남지만 전부 (a) 이전 작업 보고서의 이미 익명화된
`/Users/<사용자>/...` 표기와 (b) 이번 R2 보고서가 이 사안을 서술하며 인용한 문자열이다. 실제
사용자명은 추적 대상 파일 어디에도 없다. `packages/*/.turbo/*.log` 에 절대경로가 있지만
gitignore 대상이라 커밋되지 않는다(`git check-ignore` 로 확인).

## 검증 출력

```
$ pnpm test
 Test Files  36 passed (36)
      Tests  607 passed | 1 skipped (608)
```

R2 시점 604 → 607. 새 테스트 3건(TAB 1, 이스케이프 후 상한 1, 스냅샷 실패 1)이다.
이번에는 `core` 간헐 실패가 나오지 않았다.

```
$ pnpm typecheck
 Tasks:    6 successful, 6 total

$ pnpm lint
Checked 118 files in 23ms. No fixes applied.

$ pnpm build
 Tasks:    6 successful, 6 total

$ pnpm --filter ohmymcp test:e2e
e2e exit=0
```

### dist 로 확인한 TAB 스택 트레이스

Java 스타일 트레이스를 stderr 에 남기고 죽는 서버를 임시로 만들어 배포 산출물로 실행했다.

```
오류 [MCP_CONNECTION_FAILED/PROCESS_EXITED]: 요청 완료 전 MCP 서버가 종료되었습니다.
해결: exit code, signal, bounded stderr를 확인하세요.

서버 프로세스 진단
  종료 코드: 1  시그널: 없음
  stderr (전체):
    Exception in thread "main" java.lang.NullPointerException
    	at com.example.Foo.bar(Foo.java:42)
    	at com.example.Main.main(Main.java:7)
cli exit=1
```

`cat -t` 로 같은 출력을 보면 그 자리가 실제 TAB 이다.

```
    ^Iat com.example.Foo.bar(Foo.java:42)
    ^Iat com.example.Main.main(Main.java:7)
```

## 불변 조건 확인

- 판정과 종료 코드는 그대로다. 위 실행의 종료 코드가 1이고, 전체 테스트가 종료 코드 단언을 포함해
  통과한다.
- stdout 바이트 무변경. 이번 변경은 stderr 블록의 문자열과 스냅샷 취급뿐이다. `--json` 의 stdout
  은 `dist-cli-e2e.mjs` 가 `JSON.parse` 로 판정하고 통과했다.
- `--stderr-lines 0` 은 여전히 아무것도 쓰지 않는다(E2E 케이스 2, 통합 테스트 통과).
- usage 문자열은 바뀌었지만 그것은 stderr 로 나가는 오류 힌트다. stdout 과 무관하다.

## 임의로 판단한 부분

1. **`escapeTerminalText` 를 `escapeTokens` 로 바꿨다.** 지적 2를 시퀀스 경계를 지키면서 풀려면
   문자 단위 경계 정보가 필요하다. 문자열을 다시 파싱해 시퀀스를 찾는 것보다 토큰 배열을
   그대로 넘기는 쪽이 단순하고 오해가 없다고 봤다. 외부에 노출되지 않는 내부 함수다.
2. **`긴 줄을 잘라 생략 표시를 붙인다` 는 기대값을 바꾸지 않았다.** 입력이 `x` 뿐이라 이스케이프
   전후 길이가 같아 새 규칙에서도 같은 결과다. 대신 순서가 실제로 바뀌었는지 보는 테스트를 따로
   추가했다.
3. **`hasDiagnosticContent` 를 export 했다.** 두 호출부가 같은 판정을 쓰게 하려면 모듈 밖으로
   나가야 한다. 순수 함수이고 `isAbnormalExit` 과 같은 성격이라 공개 계약에 추가해도 무리가
   없다고 봤다. 설계 문서 §3.2 의 시그니처 목록에는 추가하지 않았다. 필요하면 지시해라.

## 남은 위험

- 이스케이프 규칙 사본 셋이 이제 완전히 같지 않다(이 모듈만 TAB 제외). 주석과 설계 §5.5 에
  적었지만, 나중에 누가 "사본을 맞춘다" 며 TAB 을 되돌릴 여지는 있다.
- 커밋·푸시 하지 않았다. git 은 조회만 썼다.

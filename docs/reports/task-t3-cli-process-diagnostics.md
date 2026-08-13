# Task T3 보고서: 실환경 E2E

- 상태: READY_FOR_REVIEW
- 날짜: 2026-08-14
- 계획서: `docs/superpowers/plans/2026-08-13-cli-process-diagnostics-implementation.md` §4 Task T3
- 설계 문서: `docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md` §8.4

## 실행 환경

```
pwd:  <repository-root>
HEAD: bd99647 (docs(cli): T2 통합 SHA를 대장에 기록한다)
브랜치: feat/cli-process-diagnostics
```

## 변경 파일

```
 M packages/cli/tests/dist-cli-e2e.mjs
```

허용 Files 1개뿐이다. 기존 판정은 한 줄도 고치지 않고 블록 하나를 파일 끝에 더했다
(`writeFile` import 추가 제외).

## 선행 빌드

`pnpm build` 를 먼저 돌렸고 산출물이 새 코드인지 직접 확인했다. `dist/cli.mjs` 는 얇은 진입점이고
실제 코드는 청크에 있다.

```
$ pnpm build
 Tasks: 6 successful, 6 total

$ grep -l "stderr-lines" packages/cli/dist/*
packages/cli/dist/src-PvqiGLEr.cjs
packages/cli/dist/src-DySyV-DY.mjs
```

## 구현

계획서 §4 T3 의 세 케이스를 파일 끝에 더했다. 임시 디렉터리에 SDK 를 쓰지 않는 최소 스크립트를
만들고, 끝나면 `rm(dir, { recursive: true, force: true })` 로 지운다. `examples/` 는 건드리지
않았고 저장소 안에 파일을 남기지 않는다.

1. **기동 즉시 죽는 서버**: stderr 에 `TypeError: Cannot read properties of undefined (reading
   'temp')` 를 쓰고 `process.exit(1)`. 판정은 종료 코드 1, stdout 빈 문자열, stderr 에
   `MCP_CONNECTION_FAILED`·`서버 프로세스 진단`·`TypeError ...`·`종료 코드: 1`.
2. **같은 스크립트 + `--stderr-lines 0`**: stderr 에 `MCP_CONNECTION_FAILED` 는 있고
   `서버 프로세스 진단` 은 없다.
3. **존재하지 않는 실행 파일**: stderr 에 `PROCESS_START_FAILED` 가 있고 `서버 프로세스 진단` 은
   없다(진단이 전부 비어 §4.3 의 빈 진단 생략에 걸린다).

stderr 판정 시점은 기존 `execute()` 헬퍼를 그대로 쓴다. 이 헬퍼는 자식의 `close` 이벤트에서
resolve 하므로 프로세스 종료 뒤에 판정한다. 종료 전에 읽어 비어 있는 거짓 통과가 생기지 않는다.

실패 시 메시지에 실제 stderr 를 붙였다. 어긋났을 때 무엇이 나왔는지 바로 보이게 하려는 것이다.

## 검증 출력

### 배포 산출물 E2E

```
$ pnpm build && pnpm --filter ohmymcp test:e2e
> ohmymcp@0.3.0 test:e2e .../packages/cli
> node ./tests/dist-cli-e2e.mjs
exit=0
```

`assert` 기반 스크립트라 무출력 + 종료 코드 0 이 통과다.

### 실제 출력 확인 (거짓 통과 방지)

단언이 실제로 무엇을 보고 통과했는지 확인하려고 같은 시나리오를 손으로 돌렸다.

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

$ ... --stderr-lines 0
오류 [MCP_CONNECTION_FAILED/PROCESS_EXITED]: 요청 완료 전 MCP 서버가 종료되었습니다.
해결: exit code, signal, bounded stderr를 확인하세요.
exit=1
```

설계 §1 이 지적한 모순("exit code, signal, bounded stderr 를 확인하세요" 라고 하면서 그 셋을
보여주지 않는다)이 실제로 해소됐다.

### 전체 테스트

```
$ pnpm test
 Test Files  36 passed (36)
      Tests  599 passed | 1 skipped (600)
```

첫 실행에서는 알려진 간헐 실패가 나왔다.

```
 FAIL  packages/core/tests/stdio-integration.test.ts > stdio 실제 프로세스 > handshake timeout 뒤 프로세스를 정리한다
 Tests  1 failed | 598 passed | 1 skipped (600)
```

지시대로 단독 재실행으로 확인만 했고 `core` 는 고치지 않았다.

```
$ pnpm vitest run packages/core/tests/stdio-integration.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

이후 전체 재실행이 위와 같이 전부 통과했다.

### 타입체크

```
$ pnpm typecheck
 Tasks: 6 successful, 6 total
Cached: 5 cached, 6 total
```

### 린트

```
$ pnpm lint
> biome check .
Checked 118 files in 25ms. No fixes applied.
```

## 임의로 판단한 부분

1. **suite 파일 선택.** 세 케이스 모두 기존 `fixtures/weather-suite.json` 을 쓴다. 연결 이전
   단계(파일 읽기·JSON 파싱·명세 검증)를 통과해야 연결 실패 경로에 도달하는데, 이미 있는 유효한
   명세로 충분하고 새 픽스처를 만들 이유가 없다.
2. **stdout 단언 추가.** 계획서 판정에는 없지만 세 케이스 모두 `assert.equal(result.out, "")` 을
   넣었다. 진단이 stdout 으로 새면 `--json` 소비자가 깨진다는 것이 이 기능의 전제(설계 §4.1)라
   실환경에서도 확인할 값어치가 있다고 봤다.
3. **케이스 1·2 와 T2 의 §8.3 통합 테스트가 겹친다.** T2 보고서에 적은 대로다. T2 는 소스로,
   여기는 배포 산출물(`dist/`)로 검증하므로 층이 다르다. 중복이 불필요하다고 판단되면 어느 한쪽을
   줄이면 된다.

## 남은 위험

- `packages/core/tests/stdio-integration.test.ts` 의 간헐 실패는 이번에도 재현됐다.
  `docs/core-stdio-integration-flaky.md` 의 알려진 항목이고 이번 변경과 무관하다.
- 커밋·푸시 하지 않았다.

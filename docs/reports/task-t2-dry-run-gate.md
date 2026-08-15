# Task T2 보고서: 초기화 훅 (`cli`)

## 무엇을 했나

시험 실행 직전에 서버 상태를 되돌리는 `--reset-cmd` 의 실행부를 만들었다. 계획서 §4 T2 와
ADR-0023 을 그대로 따랐다.

- `packages/cli/src/reset-hook.ts` 신규. `ResetCommandError` 와 `runResetCommand`
- `packages/cli/tests/reset-hook.test.ts` 신규. 8개

배선은 하지 않았다. `generate-command.ts` 는 손대지 않았다. T6 의 일이다.

## 사양 대응

| 사양 | 구현 |
|---|---|
| 공백으로 나눈 첫 토큰이 실행 파일 | `command.split(/\s+/)` 후 빈 토큰 제거. 따옴표 해석 없음 |
| 셸을 거치지 않는다 | `spawn(file, args, { shell: false })` |
| 타임아웃 60초, 초과 시 프로세스 종료 | 자체 `setTimeout` 후 `SIGKILL`. `exitCode` 는 `null`, `stderr` 는 `타임아웃(60초)` |
| 종료 코드 0 이 아니면 실패 | `close` 에서 `ResetCommandError` |
| 실행 파일 없음(ENOENT) | `error` 이벤트에서 `ResetCommandError`, `exitCode` 는 `null` |
| stdout 은 버린다 | `stdio: ["ignore", "ignore", "pipe"]`. 아예 받지 않는다 |
| stderr 은 최대 8KB | `StderrTail` 이 상한까지만 모으고 `subarray(0, 8192)` |
| 공백뿐인 명령은 `TypeError` | 토큰이 0개면 `TypeError` |

## 검증

```
$ pnpm test
 Test Files  53 passed (53)
      Tests  1107 passed | 1 skipped (1108)

$ pnpm typecheck --force
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total

$ pnpm lint
Checked 157 files in 33ms. No fixes applied.
```

`pnpm test` 는 네 태스크(T2~T5)를 모두 올리고 `main`(T1·T7 머지본)을 병합한 뒤의 최종 실행
결과다. 기점 1039개에서 이 묶음이 44개(T2 8 · T3 10 · T4 14 · T5 12), `main` 병합이 24개
늘었다.

## 임의로 판단한 지점

1. **`execFile` 대신 `spawn` 을 썼다.** 계획서는 `execFile` 을 지정했다. 두 가지 이유로 바꿨다.
   `execFile` 은 stdout 을 버퍼에 모으므로 "stdout 은 버린다" 는 사양을 지키면서도 `maxBuffer`
   초과로 멀쩡한 시드 명령이 죽을 여지가 남는다. `spawn` 의 `stdio: ignore` 는 아예 받지 않는다.
   또 stderr 8KB 상한을 스트림에서 직접 끊을 수 있다. 보안 결정(셸을 거치지 않는다)은 그대로다.
   `spawn(file, args, { shell: false })` 는 `execFile` 과 같은 `execvp` 계열 실행이다.
2. **타임아웃을 옵션이 아니라 자체 타이머로 구현했다.** `spawn` 의 `timeout` 옵션에 맡기면
   시그널로 죽은 경우와 제한 시간 초과를 구분할 수 없다. 사양이 둘을 다르게 다룬다(초과는
   `stderr` 에 `타임아웃(60초)`). 자체 타이머라 테스트에서 fake timer 로 60초를 넘길 수 있다.
3. **셸 메타문자 테스트의 형태를 바꿨다.** 계획서 테스트 문구는
   `node -e '...' "a && b" 의 인자가 한 덩어리다` 인데, 이 모듈은 사양상 따옴표를 해석하지
   않으므로 `"a && b"` 는 결코 한 덩어리가 될 수 없다(설계서 §6 이 명시한 제약이다). 실제로
   검증해야 하는 성질은 **셸이 끼지 않는다** 이므로, `&& echo hacked` 를 붙여 실행하고 그것이
   `process.argv` 에 리터럴로 남는지를 단언했다. 셸을 거쳤다면 argv 에 남지 않는다.
4. `ResetCommandError.message` 문안은 사양에 없다. 화면 문구는 T6 이 만들고 이 메시지는 로그용
   이므로 `초기화 명령이 실패했습니다: <command>` 로 짧게 뒀다.
5. 시그널로 죽었는데 stderr 이 비어 있으면 `시그널 <NAME> 로 종료되었습니다.` 를 넣는다. 사양에
   없는 경우인데 stderr 이 빈 문자열이면 T6 화면이 사유 없이 실패만 알리게 된다.

## 남은 위험

- **8KB 절단이 바이트 기준이다.** 멀티바이트 문자 중간에서 잘리면 마지막 글자가 깨진다.
  꼬리를 보여주는 용도라 감수했다. 문자 기준으로 자르려면 상한의 의미가 "메모리 상한" 에서
  "글자 수" 로 바뀐다.
- **타임아웃 테스트가 fake timer 에 의존한다.** 자식 프로세스 이벤트는 libuv 가 만들고 타이머만
  가짜라서 지금은 안정적이다. `toFake` 를 `setTimeout`·`clearTimeout` 둘로 좁혀 두었다.
- 사용자가 공백이 든 경로의 실행 파일을 주면 실행되지 않는다. 사양대로다. 도움말(T8)에 이
  제약이 적혀야 실제 제품이 된다.

## 커밋 메시지

```
feat(cli): 시험 실행 전 초기화 명령 훅을 추가한다
```

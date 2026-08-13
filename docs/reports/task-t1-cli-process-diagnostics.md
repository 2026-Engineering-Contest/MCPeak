# Task T1 보고서: CLI 프로세스 진단 렌더러

- 상태: READY_FOR_REVIEW
- 날짜: 2026-08-13
- 계획서: `docs/superpowers/plans/2026-08-13-cli-process-diagnostics-implementation.md` §4 Task T1
- 설계 문서: `docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md` §5, §8.1

## 실행 환경

```
pwd:  /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-cli-process-diagnostics
HEAD: e5f2f7225da5f987db2269c16181e22f2b18d1e8
브랜치: feat/cli-process-diagnostics
```

## 변경 파일

```
?? packages/cli/src/process-diagnostics.ts
?? packages/cli/tests/process-diagnostics.test.ts
```

허용 Files 밖의 파일은 손대지 않았다. 기존 테스트는 한 줄도 고치지 않았다.
이 보고서(`docs/reports/task-t1-cli-process-diagnostics.md`)만 추가로 생성했다(실행 지시에 명시).

## 구현 요약

`packages/cli/src/process-diagnostics.ts` (순수 함수, 신규)

- `ProcessDiagnosticsInput`, `RenderProcessDiagnosticsOptions`, `isAbnormalExit`,
  `renderProcessDiagnostics` 를 계획서 §3 시그니처 그대로 export 한다.
- `isAbnormalExit` 은 `signal !== null || (exitCode !== null && exitCode !== 0)` 이다.
- `renderProcessDiagnostics` 는 `maxLines === 0` 판정을 다른 모든 판정보다 먼저 한다.
- 줄 분할은 `/\r?\n/`, 마지막 원소가 빈 문자열이면 하나만 버리고, 마지막 `maxLines` 개를 취한다.
- 이스케이프는 줄로 나눈 뒤 각 줄에 적용하고 개행으로 합친다. 개행은 이스케이프되지 않는다.
- `reporter.ts` / `test-command.ts` 의 `escapeTerminalText` 를 import 하지 않고 같은 규칙의
  사본을 이 모듈에 뒀다(ADR-0013 과 같은 근거). 규칙 값(`<= 0x1f`, `0x7f..0x9f`, `U+2028`,
  `U+2029` → `\uXXXX` 소문자 4자리)은 두 원본과 같다.
- 색상을 쓰지 않고 `process` 를 읽지 않는다.

`packages/cli/tests/process-diagnostics.test.ts` (신규)

- 설계 문서 §8.1 의 20건을 이름 그대로 작성했다(`isAbnormalExit` 4건 + `renderProcessDiagnostics` 16건).
- `종료 코드와 시그널을 한 줄에 적는다`, `stderr 가 비면 한 줄로 끝낸다` 두 건은 `toBe` 로
  전체 문자열을 비교한다.
- 이스케이프 테스트 입력은 소스에서 `"\u001b[31mred\u001b[0m"`, `"\u009b1m"`,
  `"a\u2028b\u2029c"` 처럼 이스케이프 표기로 적었다. 원문 제어문자는 소스에 없다
  (`LC_ALL=C grep '[[:cntrl:]]'` 로 확인, 개행 외 일치 없음).

## 검증

### 표적 테스트

```
$ pnpm vitest run packages/cli/tests/process-diagnostics.test.ts

 RUN  v4.1.10 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-cli-process-diagnostics

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  23:55:08
   Duration  83ms (transform 14ms, setup 0ms, import 20ms, tests 3ms, environment 0ms)
```

### 전체 테스트

```
$ pnpm test

 Test Files  36 passed (36)
      Tests  577 passed | 1 skipped (578)
   Start at  23:55:15
   Duration  1.53s (transform 1.82s, setup 0ms, import 3.16s, tests 4.16s, environment 1ms)
```

기존 테스트 파일을 고치지 않았고 새 파일 1개 / 새 테스트 20건만 늘었다. 기존 실패는 없다.
`packages/core/tests/stdio-integration.test.ts` 의 알려진 간헐 실패는 이번 실행에서 나오지 않았다.

### 타입체크

```
$ pnpm typecheck

ohmymcp:typecheck: > ohmymcp@0.3.0 typecheck .../packages/cli
ohmymcp:typecheck: > tsc --noEmit

 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    973ms
```

`ohmymcp`(cli) 패키지는 캐시가 아니라 실제로 실행됐다. 나머지 5개는 변경이 없어 캐시 적중이다.

### 린트

```
$ pnpm lint
> biome check .

Checked 118 files in 23ms. No fixes applied.
```

검사 대상 118 파일이다(0 아님).

## 임의로 판단한 부분

1. **`전체` / `마지막 N줄` 판정 기준.** 설계 문서 §5.3 본문은 "전체 줄 수가 `maxLines` 이하이고
   `stderrTruncated` 가 거짓이면 `전체`" 라고 읽히지만, 같은 문서 §8.1 의 케이스
   `수집 상한 잘림을 헤더에 적는다` 는 `stderrTruncated: true` + 3줄에 대해
   `"  stderr (전체, 앞부분이 수집 상한으로 잘렸습니다):"` 를 기대한다. 계획서 §4 의 문구
   ("잘리지 않았으면 `전체`, 잘렸으면 `마지막 ${maxLines}줄`")와 테스트 기대값이 일치하므로
   **줄 수 제한으로 버린 줄이 0개인지**만으로 판정했다. `stderrTruncated` 는 헤더의 세 번째
   조각으로만 반영된다.
2. **테스트 헬퍼.** `input()` 기본값 헬퍼와 `bodyLines()`(렌더 결과의 4번째 줄부터 마지막 개행
   앞까지를 뽑음), `manyLines(n)` 를 뒀다. 테스트 이름과 단언 내용은 §8.1 그대로다.
3. **`splitLines` 의 빈 stderr 처리.** `stderr === ""` 는 그 앞에서 이미 갈라지므로
   `splitLines` 에 도달하지 않는다. `"\n"` 만 있는 입력은 빈 줄 한 줄로 렌더된다(§5.4 의 규칙을
   그대로 적용한 결과).
4. **포맷.** `pnpm exec biome check --write` 를 새로 만든 두 파일에만 적용했다. 다른 파일은
   포맷하지 않았다.

## 남은 위험

- T2 가 이 모듈을 import 할 때 `McpProcessDiagnostics`(core) → `ProcessDiagnosticsInput` 대입이
  구조적으로 성립하는지는 T2 에서 실제 타입체크로 확인된다. 이 태스크에서는 core 를 import 하지
  않으므로 검증 범위 밖이다.
- `--stderr-lines` 파싱과 호출 지점 배선은 T2 범위다. 현재 이 모듈은 어디서도 import 되지 않아
  번들 산출물에 포함되지 않는다(`pnpm build` 판정은 T2 이후에 의미가 있다).

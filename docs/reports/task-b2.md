# Task B2 보고서 — 대화형 검토 중 stdin EOF 정상 종료

## 작업 공간

- pwd: `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-cli-stdin-eof`
- 브랜치: `fix/cli-stdin-eof`
- `git rev-parse HEAD`: `4b738488c8763413417d7f1e668b2e3b58b8c743`
- 기점 커밋: `4b73848 docs(generate): A2 통합 대장 기록` (지시받은 값과 일치)
- 진입 시 `git status --short` 비어 있음. `pnpm install` 후 `pnpm build`, `pnpm vitest run packages/cli`
  (63 passed) 실행 확인

## 변경 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/src/generate-command.ts` | sentinel + 판정 함수 추가, `nodeReviewIO` question 래핑, `runInteractiveReview` catch 추가 |
| `packages/cli/tests/generate-command.test.ts` | 테스트 4개 추가 |
| `.changeset/cli-stdin-eof.md` | 신규 (patch, `ohmymcp`) |
| `docs/reports/task-b2.md` | 이 보고서 |

허용 목록 밖 파일은 건드리지 않았다.

## 원인 분석에서 계획과 달라진 점

지시받은 구현 방향은 "readline의 `close` 이벤트로 닫힘 플래그를 세운다"였다. 실제 Node 동작을
측정해 보니 **EOF의 모양이 두 개**였고, 플래그만으로는 절반만 막힌다.

측정 스크립트(빈 `Readable`로 즉시 EOF를 만들고 `question`을 두 번 호출):

```
first: resolved ... → 나오지 않음
Warning: Detected unsettled top-level await at .../readline-eof-check.mjs:24
console.log(await probe("first"));
```

- **모양 1**: 이미 닫힌 뒤 `question`을 부르면 `ERR_USE_AFTER_CLOSE`를 던진다. 리뷰어가 실측한
  스택(`at [kQuestion] ... interface:441:13`)이 이 경우다.
- **모양 2**: `question`이 대기 중일 때 EOF가 오면 promise가 **영영 settle되지 않는다.** 던지지도
  않는다. 프로세스가 할 일이 없어 조용히 빠져나간다.

플래그만 쓰면 모양 2에서 무한 대기가 남는다. 그래서 `close` 이벤트를 promise로 만들어
`readline.question(...)`과 `Promise.race`시켰다. 같은 스크립트로 검증했다.

```
first: threw ReviewInputClosedError (closed=true)
second: threw ReviewInputClosedError (closed=true)
```

## 구현

1. `class ReviewInputClosedError extends Error {}` sentinel과 `isReviewInputClosed(error)` 판정
   함수를 추가했다. 판정은 sentinel 인스턴스와 `code === "ERR_USE_AFTER_CLOSE"`를 모두 인정한다.
   `nodeReviewIO`가 아닌 `ReviewIO` 구현이 readline을 직접 감싸도 같은 종료 경로를 타게 하려는
   것이다.
2. `nodeReviewIO`의 `input`/`choose`/`confirm`이 공통 `question()` 래퍼를 지난다. 래퍼는 (a) 이미
   닫혔으면 즉시 sentinel을 던지고, (b) 대기 중 닫히면 race로 sentinel을 던지고, (c) 그 밖의
   `ERR_USE_AFTER_CLOSE`도 sentinel로 바꾼다.
3. `runInteractiveReview`의 while 루프에 `catch`를 붙였다. `isReviewInputClosed`가 참이면
   `deps.writeStdout("입력이 종료되어 검토를 취소했습니다. 저장하지 않았습니다.\n")` 후 `return 0`.
   아니면 `throw error`로 그대로 다시 던진다. 기존 `finally { io.close?.() }`는 유지했다.
4. `choose`가 빈 문자열을 돌려주는 회피는 쓰지 않았다. 지시대로 "지원하지 않는 메뉴입니다."
   무한 반복이 생기지 않는다.

## 검증

### 1. 테스트 선작성 후 실패 확인

```
pnpm vitest run packages/cli
 Test Files  1 failed | 4 passed (5)
      Tests  2 failed | 64 passed (66)

AssertionError: promise rejected "Error [ERR_USE_AFTER_CLOSE]: readline was… { code: '…' }" instead of resolving
```

"입력 닫힘이 아닌 오류는 삼키지 않는다"는 처음부터 통과했다. 지시대로 **현재 동작을 먼저
확인하고 그 동작을 고정**했다. 현재 동작은 **오류가 그대로 전파되는 것**이다. `runGenerateCommand`
의 `try` 안에서 `return runInteractiveReview(...)`를 `await` 없이 반환하므로 그 rejection은 바깥
`catch`에 잡히지 않는다. 그래서 `rejects.toThrow("REVIEW_IO_BOOM")`으로 고정했다.

### 2. 새 테스트가 실제로 결함을 잡는지 확인

`Promise.race`를 임시로 제거하고 실제 readline 테스트만 돌렸다.

```
pnpm vitest run packages/cli -t "실제 readline"
 Test Files  1 failed | 4 skipped (5)
      Tests  1 failed | 66 skipped (67)
   Duration  5.18s
```

5초 타임아웃까지 매달렸다. 즉 이 테스트는 모양 2를 실제로 잡는다. 확인 후 원복했고
백업본과 `diff`로 동일함을 확인했다(`IDENTICAL-TO-BACKUP`).

### 3. 표적 검증

```
pnpm vitest run packages/cli
 Test Files  5 passed (5)
      Tests  67 passed (67)
```

### 4. 전체 회귀

```
pnpm build     → Tasks: 6 successful, 6 total
pnpm typecheck → Tasks: 6 successful, 6 total
pnpm lint      → Checked 97 files in 39ms. No fixes applied.
pnpm test      → Test Files 27 passed (27) / Tests 253 passed (253)
```

검사 대상 0개 거짓 신호 점검:

- 린트 `Checked 97 files` (0 아님)
- 타입체크는 `tsc --noEmit` 성공 시 무출력이라 별도로
  `cd packages/cli && npx tsc --noEmit --listFiles | grep -c "worktrees/ohmymcp-cli-stdin-eof/packages/cli/"`
  → **9**

## 추가한 테스트

- `검토 중 입력이 닫히면 스택 없이 취소로 종료한다` — `choose`가 `ERR_USE_AFTER_CLOSE` 상당 오류를
  던진다. 종료 코드 0, 문장 출력, `ERR_USE_AFTER_CLOSE`·`node:internal`·`at ` 줄 미포함,
  `openTemp`/`rename` 미호출, `io.close` 1회.
- `입력 닫힘이 아닌 오류는 삼키지 않는다` — 일반 `Error`는 그대로 전파된다.
- `input과 confirm에서 닫혀도 같은 경로로 종료한다` — 두 단계를 각각 돌린다.
- `실제 readline도 EOF에서 스택 없이 취소로 끝난다` — 스텁이 아니라 진짜 `nodeReviewIO`에
  빈 `Readable`을 물려 EOF를 만든다. 프로세스는 띄우지 않는다(인메모리 스트림).

## 임의로 판단한 부분

1. **`Promise.race`를 추가했다.** 지시는 닫힘 플래그만이었다. 위 측정대로 플래그만으로는 모양 2
   (대기 중 EOF → 무한 대기)가 남아서 근거를 갖고 확장했다.
2. **판정을 sentinel 전용이 아니라 `code === "ERR_USE_AFTER_CLOSE"`도 인정하도록 했다.**
   `reviewIO`는 주입 가능한 의존성이라 `nodeReviewIO` 밖의 구현이 들어올 수 있고, 그쪽이 raw
   readline 오류를 그대로 올려도 스택이 새지 않게 하려는 것이다.
3. **`nodeReviewIO(input, output)`에 기본값 있는 스트림 인자를 추가했다.** 기존 호출부
   (`packages/cli/src/index.ts`의 `nodeReviewIO()`)는 인자 없이 그대로 동작한다. 이렇게 하지 않으면
   결함이 실제로 사는 `nodeReviewIO` + 진짜 readline 경로를 인메모리로 검증할 방법이 없고, 스텁
   테스트만으로는 모양 2를 영원히 못 잡는다. `write`도 `process.stdout` 대신 주입된 `output`을
   쓰도록 맞췄다.
4. **메시지를 `deps.writeStdout`으로 썼다.** 지시가 `io.write` 또는 `deps.writeStdout` 중 택일을
   허용했다. 프로덕션에서는 `nodeReviewIO.write`도 결국 stdout이라 같지만, "stdout에 쓴다"는 요구를
   테스트로 모호함 없이 고정하려면 stdout 의존성 쪽이 낫다.
5. **changeset은 `ohmymcp` patch.**

## 남은 위험 / 보고 사항

- **`pnpm test` 전체 실행 1회에서 재현되지 않은 실패 1건이 있었다.** 21:31:02 실행에서
  `Tests 1 failed | 252 passed (253)`가 나왔다. 실패한 테스트 이름을 그 자리에서 캡처하지 못했고,
  이후 전체 `pnpm test` 7회와 `pnpm vitest run packages/cli` 5회를 더 돌렸으나 한 번도 재현되지
  않았다(모두 253/67 통과). 정직하게 남긴다.
- 원인 후보를 하나 찾았다. **내 변경이 아니고 내 허용 파일 밖이라 고치지 않았다.**
  `packages/cli/tests/generate-integration.test.ts`와 `packages/cli/tests/cli-integration.test.ts`는
  기본 유닛 실행에 섞인 채로 `examples/weather-server/server.mjs` **실제 프로세스를 띄우고**,
  종료 확인을 벽시계 1초 데드라인으로 폴링한다.

  ```
  const deadline = Date.now() + 1_000;
  ```

  부하가 걸린 순간(빌드·타입체크·린트 직후, 또는 다른 터미널이 동시에 테스트 중)에는 1초 안에
  프로세스가 사라지지 않을 수 있다. `CLAUDE.local.md`의 "재생 테스트가 가끔 실패 / 타임스탬프·실행
  순서 의존"과 "실제 서버 프로세스를 띄우는 E2E는 직렬 전용 웨이브로 분리한다"에 정확히 걸린다.
  판단이 필요하면 별도 태스크로 잡아야 한다.
- 실제 터미널에서 Ctrl-D를 눌러 보는 확인은 하지 않았다. TTY가 필요하고 MCP 서버 기동을 동반하므로
  직렬 E2E 웨이브 소관이다. 인메모리 readline으로 같은 EOF 경로를 덮었지만, TTY 고유 동작이 다를
  가능성은 남는다.

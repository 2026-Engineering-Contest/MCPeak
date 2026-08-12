# Task R6 보고서 — stdin 쓰기 오류를 예외 없이 실패로 판정

## 작업 공간

- worktree: `.claude/worktrees/ohmymcp-review4-generate`
- 브랜치: `fix/review4-generate` (`2344ce1`에서 분기)
- `git rev-parse HEAD`: `2344ce11136ff72f56c13125f6ef720b66e94654`
- 진입 시 `git status --short` 비어 있었고 `pnpm install` 뒤 baseline 120 passed 확인. 커밋 안 함.

## 변경 파일

```
M packages/generate/src/provider-process.ts
M packages/generate/tests/provider-process.test.ts
?? .changeset/generate-stdin-write-failure.md
```

허용 목록 밖 변경은 없다.

## 무엇이 바뀌었나

R3에서 넣은 `stdinWriteFailed` 플래그와 close 시점 조건부 판정을 **전부 걷어냈다.**

```ts
// 전 (R3)
child.stdin.on?.("error", () => { stdinWriteFailed = true; });
// close에서: exit 0 + 유효 JSON이면 무시, 그 외에는 internal

// 후 (R6)
child.stdin.on?.("error", () => { terminate("internal"); });
// close에서: reason이 세워져 있으므로 기존 분기가 internal로 확정한다
```

`settle()`을 직접 부르지 않는다. `terminate("internal")`이 `reason`을 세우고 자식을 정리한 뒤,
`close` 이벤트의 기존 분기(`if (reason !== undefined) settle({ ok: false, code: reason, ... })`)가
실패를 확정한다.

`terminate`의 기존 성질이 그대로 적용된다.

- SIGTERM 발송
- 1초 뒤 SIGKILL escalation (`killTimer`)
- 2초 뒤 deadline settle (`deadlineTimer`). 자식이 끝내 닫히지 않아도 호출자가 매달리지 않는다
- 자식이 먼저 닫히면 `close` 핸들러가 `killTimer`를 취소하므로 불필요한 SIGKILL은 가지 않는다

`invalidUtf8`과 `invalidJson` 판정에서 `stdinWriteFailed ? "internal" : ...` 삼항을 지우고 원래
형태로 되돌렸다. 쓰기 오류가 있었다면 그 코드 경로에 도달하지 않기 때문이다.

## 왜 R3의 판단을 철회했나

R3의 근거는 "provider가 프롬프트를 다 읽고 stdin을 먼저 닫으면 정상 EPIPE가 난다"였다. 그 근거가
틀렸다.

EPIPE는 **이미 닫힌 파이프에 쓰려 할 때** 난다. provider가 프롬프트를 전부 읽은 뒤 닫았다면 우리
쓰기는 그 시점에 이미 끝나 있었을 것이고 오류가 날 이유가 없다. 오류가 났다는 것은 일부 바이트가
전달되지 않았다는 뜻이다. 즉 프롬프트가 잘렸고, provider의 응답은 잘린 입력에 대한 응답이다.

exit code가 0이고 stdout이 유효한 JSON이라는 사실은 그것을 뒤집지 못한다. 스키마를 만족하는
그럴듯한 결과가 오히려 더 위험하다. 이 프로젝트에서 조용히 틀린 결과가 통과하는 것은 실패보다
나쁘다.

이 이력을 코드 주석에 남겼다. "이전 판단은 철회했다. 근거가 틀렸다"로 시작해 무엇이 왜 바뀌었는지
읽을 수 있게 썼다.

## 테스트

R3에서 넣은 stdin 관련 3개를 새 계약에 맞게 다시 썼고 회귀 확인용으로 하나를 더 넣었다.

| 테스트 | 단언 |
|---|---|
| `stdin 쓰기 오류가 나면 정상 종료와 유효한 JSON도 성공으로 보지 않는다` | exit 0 + `{"ok":true}` 인데도 `ok:false, code:"internal"`. `unhandledRejection` 없음 |
| `stdin 쓰기 오류 뒤 비정상 종료도 internal로 보고한다` | exit 1 → `internal` |
| `stdin 쓰기 오류 뒤 살아 있는 자식에게 종료 신호를 보낸다` | 즉시 `["SIGTERM"]`, 1초 뒤 `["SIGTERM","SIGKILL"]`, 2초 뒤 `internal`로 settle |
| `stdin 쓰기 오류가 없으면 invalidUtf8·invalidJson 판정이 그대로다` | 쓰기 오류 없는 깨진 JSON은 `invalidJson`, 깨진 UTF-8은 `invalidUtf8` |

첫 번째 테스트는 R3의 `stdin 스트림 error는 실행 결과를 바꾸지 않는다`를 정확히 뒤집은 것이다.
같은 입력에 기대값만 반대다. `unhandledRejection` 단언은 그대로 유지했다. 리스너를 다는 원래
목적(처리되지 않은 stream error가 host를 죽이는 것을 막는다)은 변하지 않았기 때문이다.

구현 전 실행에서 2개가 실제로 실패하는 것을 확인했다.

## 검증

```
$ pnpm vitest run packages/generate      # 진입 직후 baseline
 Test Files  7 passed (7) / Tests  120 passed (120)

$ pnpm vitest run packages/generate      # 테스트 수정 직후
 Test Files  1 failed | 6 passed (7) / Tests  2 failed | 119 passed (121)

$ pnpm vitest run packages/generate      # 구현 후
 Test Files  7 passed (7) / Tests  121 passed (121)

$ pnpm vitest run packages/cli
 Test Files  5 passed (5) / Tests  99 passed (99)

$ pnpm build
 Tasks:    6 successful, 6 total

$ pnpm typecheck
 Tasks:    6 successful, 6 total

$ pnpm lint
Checked 102 files in 30ms. No fixes applied.

$ pnpm test
 Test Files  28 passed (28) / Tests  331 passed (331)

$ rm -rf packages/*/dist && pnpm test
 Test Files  1 failed | 27 passed (28) / Tests  1 failed | 330 passed (331)
 FAIL packages/core/tests/stdio-integration.test.ts > handshake timeout 뒤 프로세스를 정리한다

$ pnpm test                              # 재실행
 Test Files  28 passed (28) / Tests  331 passed (331)
```

`dist`를 지운 실행에서 나온 실패 1개는 `packages/core`의 stdio-integration 간헐 실패다.
`docs/core-stdio-integration-flaky.md`에 인계된 알려진 항목이고 이번 변경과 무관한 패키지다.
재실행에서 통과했다. **이번 변경이 건드린 `packages/generate`와 `packages/cli`에서는 실패가 없다.**

거짓 신호 점검:

- **타입체크 대상 0개**: `packages/generate`에서 `npx tsc --noEmit --listFiles`로 이 worktree의
  `src` 파일 **14개**가 실제 검사됨을 확인했다.
- **린트 대상 0개**: biome이 `Checked 102 files`를 출력한다.
- **빌드 산출물이 낡음**: `dist`를 지운 상태로도 generate·cli는 전부 통과한다.

## 내가 임의로 판단한 부분

1. **`invalidUtf8`/`invalidJson` 분기를 R3 이전 형태로 되돌렸다.** 쓰기 오류가 있으면 그 경로에
   도달하지 않으므로 삼항이 죽은 코드가 된다. 지시에 명시되지 않았지만 남겨 두면 "여기서도
   쓰기 오류를 따진다"는 잘못된 인상을 준다.
2. **회귀 테스트를 하나 더 넣었다.** 지시가 요구한 세 가지에 더해, 쓰기 오류가 **없는** 경우의
   `invalidUtf8`/`invalidJson`이 그대로인지 확인한다. 1번 정리가 기존 판정을 건드리지 않았음을
   고정한다.
3. **changeset bump를 `patch`로 잡았다.** 공개 API 변화가 없는 판정 수정이다.

## 남은 위험

1. **쓰기 오류 뒤 결과가 `internal`이다.** CLI 안내는 `GENERATE_PROVIDER_FAILED` 기존 문구로 간다
   (B6의 분기 표에서 `internal`은 기존 문구 유지 대상이다). 사용자는 "요청을 완료하지 못했습니다"
   수준의 안내를 받고 프롬프트가 잘렸다는 것은 알 수 없다. 별도 failure code나 reason을 주려면
   `AuthoringProviderFailureCode`를 늘려야 하고 그것은 이번 범위 밖이다.
2. **정상 EPIPE가 실제로 존재한다면 이제 실패가 된다.** 위 논증대로면 존재하지 않아야 하지만,
   provider CLI가 프롬프트를 다 읽고도 우리 쓰기가 끝나기 전에 파이프를 닫는 구현이 있다면
   멀쩡한 실행이 `internal`이 된다. 그 경우 실패가 눈에 보이므로 조용히 틀리는 것보다는 낫다.
   실제 호출 E2E에서 이 코드가 나오는지 관찰할 필요가 있다.

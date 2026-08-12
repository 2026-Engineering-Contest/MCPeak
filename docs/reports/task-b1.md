# Task B1 보고서 — `packages/cli` 실패 원인별 안내 분기

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-cli-provider-failure`
- 브랜치: `fix/cli-provider-failure-message`
- `git rev-parse HEAD`: `ecede41ff0b8953b61fca26d565cfe866060a343`
- 기점 커밋: `ecede41 chore(cli): generate 출력 경로 gitignore 추가` (지시받은 값과 일치)
- 진입 시 `git status --short` 비어 있음, 계획서 존재 확인

## 변경 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/src/generate-command.ts` | `providerFailure()` 추가, 두 호출부(dispatch catch, `providerFailed` 분기) 교체 |
| `packages/cli/tests/generate-command.test.ts` | 실패 원인별 테스트 7개 + 노출 검사 1개 추가 |
| `.changeset/cli-provider-failure-message.md` | 신규 (patch, `ohmymcp`) |
| `docs/reports/task-b1.md` | 이 보고서 |

허용 목록 밖 파일은 건드리지 않았다. `packages/generate`의 `PublicProviderFailure`는 타입 import만
하고 정의는 그대로 두었다. 현재 필드(`providerId`, `code`, `timeoutMs`, `exitCode`, `stderr`)만으로
구현이 끝났으므로 BLOCKED 사유는 없었다.

## 구현

`safeFailure`는 그대로 두고 그 아래에 `providerFailure(deps, failure)`를 추가했다. `failure.code`로
분기하며 문구는 계획서 5장 Task B1의 문장을 글자 그대로 쓴다.

- `providerUnavailable` → `GENERATE_PROVIDER_UNAVAILABLE`
- `nonZeroExit` → `GENERATE_PROVIDER_EXIT` (`exitCode`가 `undefined`면 `코드 N로 ` 조각을 뺀다)
- `timedOut` → `GENERATE_PROVIDER_TIMEOUT` (`timeoutMs` 삽입)
- `schemaMismatch` → `GENERATE_PROVIDER_SCHEMA`
- `cancelled` → `GENERATE_PROVIDER_CANCELLED`
- 그 외(`outputLimitExceeded` / `invalidUtf8` / `invalidJson` / `internal`) → 기존
  `safeFailure(deps, "PROVIDER_FAILED")`

`{codex|claude}` 자리에는 `failure.providerId`를 넣는다.

## 검증

모두 이 worktree에서 실행했다.

### 1. 테스트 선작성 후 실패 확인

```
pnpm vitest run packages/cli
 Test Files  1 failed | 4 passed (5)
      Tests  6 failed | 57 passed (63)
```

실패 예시 원문:

```
AssertionError: expected '오류 [GENERATE_PROVIDER_FAILED]: AI 검토 …' to contain 'GENERATE_PROVIDER_CANCELLED'
```

신규 8개 중 2개(`exitCode를 모르면 …`, `internal 등 그 외 코드는 …`)는 기존 동작에서도 통과하는
성질의 단언이라 처음부터 녹색이었다. 나머지 6개가 빨간불이었고 구현 후 전부 녹색이 됐다.

### 2. 표적 검증 (구현 후)

```
pnpm vitest run packages/cli
 Test Files  5 passed (5)
      Tests  63 passed (63)
```

### 3. 전체 회귀

```
pnpm build
 Tasks:    6 successful, 6 total

pnpm typecheck
 Tasks:    6 successful, 6 total

pnpm lint
Checked 97 files in 20ms. No fixes applied.

pnpm test
 Test Files  27 passed (27)
      Tests  234 passed (234)
```

검사 대상 0개 거짓 신호 점검:

- 린트: `Checked 97 files` (0 아님)
- 타입체크: `tsc --noEmit` 성공 시 아무것도 출력하지 않으므로 별도로
  `cd packages/cli && npx tsc --noEmit --listFiles | grep -c "worktrees/ohmymcp-cli-provider-failure/packages/cli/"`
  를 돌려 이 worktree의 cli 소스 **9개** 파일이 실제 검사 대상임을 확인했다.
- 첫 `pnpm typecheck` 출력에 `OhMyMCP-worktrees/generate-ai-authoring/...` 같은 다른 체크아웃
  경로가 찍혔는데, turbo 캐시 replay가 과거 로그 문자열을 그대로 재생한 것이다. 실제로 실행된
  `ohmymcp:typecheck`의 경로는 이 worktree였다.

## 임의로 판단한 부분

1. **dispatch가 throw하는 경로(구 357행)는 기존 문구를 유지했다.** 계획서는 "357행과 364행 두
   호출부 모두 분기 대상"이라고 적었지만, 이 경로에는 `result`가 없어 `failure.code`를 알 수 없다.
   원인을 모르는 채 원인별 문구를 고르면 잘못된 조치를 안내하게 되므로, 두 호출부를 같은
   `providerFailure()`로 통일하되 이 경로는 `failure`를 `undefined`로 넘겨 기존
   `GENERATE_PROVIDER_FAILED`로 떨어지게 했다. 문구를 다르게 하려면 `dispatchAuthoringRequest`가
   던지는 오류의 형태를 계약으로 고정해야 하는데 그것은 `packages/generate` 소관이다.
2. **`cancelled` 케이스 테스트를 1개 추가했다.** 계획서 테스트 목록에는 없지만 문구 표에는 있어
   분기 6종 전부를 덮도록 했다.
3. **노출 검사 테스트에서 instruction 문자열을 `INSTRUCTION_PAYLOAD_TEXT`로 잡았다.** 계획서의
   "provider에 보낸 instruction 원문 미포함"을 기계적으로 검사하려면 안내 문구와 겹치지 않는
   토큰이 필요했다.
4. **changeset은 `ohmymcp` patch로 잡았다.** `packages/cli`의 패키지명이 `ohmymcp`이고, 공개 API가
   아니라 출력 문구 변경이라 patch가 맞다고 봤다.
5. **`switch` 안에서 문구를 만들고 default를 `undefined`로 두는 형태**를 썼다. 새 실패 코드가
   생겼을 때 조용히 잘못된 문구로 새지 않고 기존 문구로 떨어지게 하기 위함이다.

## 남은 위험

- Task A1이 아직 통합되지 않았다. A1이 `PublicProviderFailure`를 건드리지 않는다는 전제 위에서
  구현했으므로, A1 통합 후 루트에서 `pnpm build && pnpm test`를 다시 돌려야 한다. 특히 cli는
  generate의 빌드 산출물을 보므로 `pnpm build`를 건너뛰면 낡은 산출물로 판정하게 된다.
- 유닛테스트는 `dispatchAuthoringRequest`를 스텁으로 대체해 원인별 분기를 검증한다. 실제
  Codex/Claude가 어떤 `code`를 만들어내는지는 Task C1의 실제 호출 E2E에서만 확인된다.

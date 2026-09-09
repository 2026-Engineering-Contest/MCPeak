# Task T1 보고서: `--no-dry-run` 분기와 화면 문안 (이슈 #397)

## 작업 환경

```
pwd                 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/mcpeak-397
git rev-parse HEAD  35a02d753ef8c7e9fa64aff5f8443e4eb72b8e00
기점 커밋           35a02d7 (docs(cli): 리뷰 지적 4건을 반영해 사전보완 계획의 부정확한 서술을 고친다)
브랜치              fix/pre-fill-no-dry-run
```

git 명령은 상태 확인용 조회만 실행했다. 커밋·푸시는 사람이 한다.

## 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/src/generate-command.ts` | `runPreFill` 의 `input.dryRun` 분기와 doc 주석 한 문단, `showPreFillRequest` 의 채택 판정 두 줄과 doc 주석 한 문장 |
| `packages/cli/src/help.ts` | `--no-dry-run` 설명 둘째 줄 |
| `packages/cli/tests/pre-fill-command.test.ts` | `describe("--no-dry-run 과 사전보완")` 4개 추가, 기존 두 테스트에 `events` 단언 추가 |
| `packages/cli/tests/help.test.ts` | 도움말 단언 1개 추가 |
| `docs/reports/task-t1-pre-fill-no-dry-run.md` | 이 보고서 |

기존 테스트의 케이스 이름과 단언은 지우지 않았다. `git diff main -- packages/cli/tests/pre-fill-command.test.ts | grep -c '^-.*it('` 은 `0` 이다.

## Step 2: 실패 관측 (이슈 #397 재현 증거)

```
pnpm vitest run --root . packages/cli/tests/pre-fill-command.test.ts packages/cli/tests/help.test.ts
```

```
 FAIL  |unit| packages/cli/tests/pre-fill-command.test.ts > --no-dry-run 과 사전보완 > --no-dry-run 이면 사전보완을 건너뛰고 도구를 한 번도 호출하지 않는다
AssertionError: expected [ …(2) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "callTool:{\"timezone\":\"example\"}",
+   "callTool:{\"timezone\":\"Asia/Seoul\"}",
+ ]

 ❯ packages/cli/tests/pre-fill-command.test.ts:394:20
```

`--no-dry-run` 을 주고 검토 메뉴에서 취소했는데도 baseline 값 `"example"` 과 제안 값 `"Asia/Seoul"` 로 `callTool` 이 두 번 호출됐다. 이슈 본문의 재현과 같다.

같은 실행의 나머지 실패 두 건이다.

```
 FAIL  |unit| packages/cli/tests/help.test.ts > mcpeak help generate > 시험 실행 옵션의 설명이 도움말에 있다
 ❯ packages/cli/tests/help.test.ts:35:18
     35|     expect(help).toContain("않은 채 저장되고, 실행이 필요한 AI 사전보완도 건너뜁니다");

 FAIL  |unit| packages/cli/tests/pre-fill-command.test.ts > --no-dry-run 과 사전보완 > 전송 확인 화면이 실제 서버 실행을 확인 전에 고지한다
AssertionError: expected 'AI 사전보완 요청\nProvider: codex\nModel: m…' to match /채택 판정: 제안이 돌아온 케이스마다 baseline 값과 제안 값…/

+ Received:
"AI 사전보완 요청
...
받는 것: 값 제안뿐입니다. 케이스를 더하거나 구조를 바꾸지 않습니다.
"

 Test Files  2 failed (2)
      Tests  3 failed | 23 passed (26)
```

계획서는 새 테스트 4개가 실패하리라 적었으나 실제로는 3건이 실패했다. 새 테스트 중 `--no-dry-run 에서 채울 빈틈이 없으면 건너뜀 고지를 찍지 않는다` 와 `--no-dry-run --baseline-only 는 저장까지 도구를 호출하지 않는다` 는 구현 전에도 통과한다. 앞의 것은 대상 판정에서 이미 걸러지고, 뒤의 것은 `--baseline-only` 가 사전보완 자체를 건너뛰기 때문이다. 두 테스트는 회귀 방지용으로 그대로 두었다. 기존 두 테스트에 더한 `events` 단언도 계획서가 적은 대로 구현 전에 통과했다.

## Step 6·7: 통과 확인

```
pnpm vitest run --root . packages/cli/tests/pre-fill-command.test.ts packages/cli/tests/help.test.ts packages/cli/tests/pre-fill-screen.test.ts

 Test Files  3 passed (3)
      Tests  37 passed (37)
```

```
pnpm --filter @mcpeak/cli test

 Test Files  31 passed (31)
      Tests  910 passed | 1 skipped (911)
   Duration  7.68s
```

```
pnpm typecheck --force

 Tasks:    7 successful, 7 total
Cached:    0 cached, 7 total
  Time:    6.408s
```

`Cached: 0 cached` 를 확인했으므로 유효한 판정이다.

```
pnpm biome ci packages/cli

Checked 74 files in 46ms. No fixes applied.
```

## 임의로 판단한 부분

계획서 Step 1 의 테스트 코드를 그대로 붙였더니 `--no-dry-run --baseline-only` 테스트의 `argv(...)` 한 줄이 biome 의 줄 너비를 넘어 `pnpm biome ci packages/cli` 가 `format` 오류 1건으로 떨어졌다. `pnpm biome check --write packages/cli/tests/pre-fill-command.test.ts` 로 그 배열을 여러 줄로 폈다. 인자 값과 단언은 바뀌지 않았고 줄바꿈만 달라졌다.

## 남은 위험

- `showPreFillRequest` 의 케이스 수는 상한이다. `applyPreFill` 이 실제로 부르는 것은 제안이 돌아온 케이스뿐이므로 화면의 숫자보다 실제 호출이 적을 수 있다. 설계 §3.3 의 의도대로이며 문안이 "상한" 이라고 밝힌다.
- 소스 주석이 `ADR-0089` 를 가리킨다. T2 의 Step 1 에서 번호가 달라지면 그 주석 한 줄을 맞춰야 한다.
- 실환경 검증(W3)은 이 태스크 범위 밖이다. `codex` CLI 로 실제 서버에 돌리는 확인은 아직 하지 않았다.

## 커밋 메시지 (사람이 실행)

```
fix(cli): --no-dry-run 이면 AI 사전보완도 건너뛰어 툴 호출을 0회로 만든다
```

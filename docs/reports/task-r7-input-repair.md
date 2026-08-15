# Task R7: 도움말과 E2E (`cli`)

계획서 `docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md` §4 R7 을
구현했다.

## 바꾼 파일

| 파일 | 상태 |
|---|---|
| `packages/cli/src/help.ts` | 수정 |
| `packages/cli/tests/help.test.ts` | 수정 |
| `packages/cli/tests/dist-cli-e2e.mjs` | 수정 |

## 도움말

`GENERATE_USAGE` 의 옵션 목록 끝에 `[--no-repair]` 를 더했고, `GENERATE_DRY_RUN_OPTIONS` 에
계획서가 고정한 두 줄을 그대로 더했다.

```
  --no-repair           시험 실행이 실패해도 입력값을 고쳐 다시 시도하지 않습니다.
                        실패가 곧바로 분류 화면으로 갑니다
```

## E2E

`dist-cli-e2e.mjs` 는 `pnpm test` 의 수집 대상이 아니라 `pnpm build && pnpm --filter ohmymcp
test:e2e` 로만 돈다. 출력이 바뀐 두 자리를 함께 고쳤다.

- `generate --help` 옵션 목록 검사에 `--no-repair` 를 넣고, 설명 줄(`실패가 곧바로 분류 화면으로
  갑니다`)이 번들에 실렸는지 본다. 옵션을 소스에만 넣고 번들에서 빠뜨리면 사용자는 존재를 알
  방법이 없다.
- `--baseline-only` 출력에 교정 고지 줄(`최대 2회까지 다시 호출합니다`)이 없는지 못 박았다.
  시험 실행이 없으면 교정도 없다. 기존 기대값(`시험 실행` 문자열 부재)은 그대로 뒀다.

## 검증 명령과 실제 출력

### `pnpm build && pnpm --filter ohmymcp test:e2e`

```
> ohmymcp@0.6.1 build
 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    750ms

> ohmymcp@0.6.1 test:e2e /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-repair-wiring/packages/cli
> node ./tests/dist-cli-e2e.mjs
```

성공 시 출력이 없고 종료 코드가 0 이다. 실패하면 `assert` 가 던져 종료 코드 1 이 된다.

### `pnpm test`

```
 Test Files  57 passed (57)
      Tests  1222 passed | 1 skipped (1223)
   Start at  19:07:39
   Duration  2.02s (transform 2.82s, setup 0ms, import 5.46s, tests 7.80s, environment 2ms)
```

### `pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
  Time:    1.813s
```

### `pnpm lint`

```
> biome check .

Checked 164 files in 41ms. No fixes applied.
```

## 임의로 판단한 지점

1. **사용법 한 줄에서 `[--no-repair]` 를 맨 끝에 뒀다.** 계획서가 "옵션 목록 끝" 이라고 적었다.
2. **`help.test.ts` 의 기존 `it.each` 목록에 `--no-repair` 를 넣고 설명 검사는 별도 `it` 으로
   뺐다.** 기존 `네 옵션의 설명이 도움말에 있다` 케이스 이름을 바꾸지 않으려는 선택이다. 이름을
   바꾸면 계획서에 적힌 기존 테스트와 대조가 어긋난다.
3. **E2E 에 설명 줄 검사를 하나 더 넣었다.** 계획서의 E2E 항목은 `--no-repair 가 나온다` 하나
   뿐이지만, 옵션 이름만 보면 번들에 설명 블록이 빠져도 통과한다. `.gitignore 를 확인하세요` 를
   같은 이유로 검사하던 기존 줄과 대칭이다.

## 남은 위험

- `dist-cli-e2e.mjs` 는 `pnpm test` 에 안 잡힌다. 이 파일을 고칠 때마다 `pnpm build` 를 먼저
  돌리지 않으면 낡은 번들을 검사하게 된다. 이번에는 `pnpm build` 를 먼저 돌렸다.

## 커밋 메시지

```
docs(cli): 입력값 교정 옵션 도움말과 E2E 기대값을 갱신한다
```

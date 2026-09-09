# Task T2 보고서: 문서 · ADR · changeset (이슈 #397)

## 작업 환경

```
pwd                 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/mcpeak-397
git rev-parse HEAD  56d9a5e (T1 커밋)
브랜치              fix/pre-fill-no-dry-run
```

git 은 상태 확인용 조회만 했다. 커밋·푸시는 사람이 한다.

## Step 1: ADR 번호 확인

```
ls docs/adr | grep -E '^[0-9]{4}' | sort | tail -3
0086-조합-참조-pattern-스키마는-갈래를-골라-합성한다.md
0087-임의-키-맵은-빈-객체로-합성하고-키-이름만-검사한다.md
0088-예제-서버는-정상값을-스키마-examples-로-선언하고-통제-변이로-검출력을-고정한다.md
```

색인(`docs/adr/README.md`)의 최대값도 0088 이다. 따라서 **0089 가 맞다.** 번호가 바뀌지 않았으므로
`packages/cli/src/generate-command.ts` 의 `ADR-0089` 주석은 손대지 않았다.

## 바꾼 파일

| 파일 | 내용 |
|---|---|
| `docs/adr/0089-시험-실행이-꺼지면-사전보완도-건너뛴다.md` | 생성. 계획서 Step 2 본문 그대로. 머리말 형식은 ADR-0088 을 따랐다 |
| `docs/adr/README.md` | 색인 표의 0088 줄 뒤에 0089 한 줄 추가 |
| `README.md` (루트) | `generate` 절 `--baseline-only` 문장 뒤에 `--no-dry-run` 한 문장 추가 |
| `.changeset/cli-pre-fill-no-dry-run.md` | 생성. `@mcpeak/cli` patch |
| `docs/reports/task-t2-pre-fill-no-dry-run-docs.md` | 이 보고서 |

코드는 건드리지 않았다. T1 의 커밋된 변경도 그대로다.

## 검증

```
pnpm biome ci .

Checked 385 files in 79ms. No fixes applied.
```

```
pnpm changeset status --since=main

🦋  error Some packages have been changed but no changesets were found. Run `changeset add` to resolve this error.
🦋  error If this change doesn't need a release, run `changeset add --empty`.
 ELIFECYCLE  Command failed with exit code 1.
```

이 실패는 changeset 파일이 아직 커밋되지 않았기 때문이다. `--since=main` 은 git 이 추적하는 변경만
비교하는데 `.changeset/cli-pre-fill-no-dry-run.md` 는 `git status` 에서 `??`(untracked) 상태다.
서브에이전트는 git 명령을 실행하지 않으므로 스테이징도 커밋도 하지 않았다.

파일 자체는 유효하다. `--since` 없이 돌리면 changesets 가 정상 파싱한다.

```
pnpm changeset status

🦋  info Packages to be bumped at minor:
🦋  - @mcpeak/cli
🦋  - @mcpeak/dashboard
...
```

`@mcpeak/cli` 가 목록에 있다. 이 화면에서 cli 가 minor 로 보이는 것은 main 에 이미 쌓인 다른
changeset 들이 cli 를 minor 로 올리기 때문이고, 이번 브랜치가 더한 것은 patch 다.

**따라서 완료 조건 "`pnpm changeset status --since=main` 에 `@mcpeak/cli` 가 잡힌다" 는 커밋 뒤에
사람이 다시 확인해야 한다.** 계획서 §5 통합 게이트 5번 항목이다.

## 임의로 판단한 부분

없다. 본문·색인 줄·README 문장·changeset 은 계획서 확정본을 그대로 옮겼다.

## 남은 위험

- 위의 `changeset status --since=main` 은 커밋 전이라 아직 통과를 증명하지 못한다. CI 의
  `changeset-check` 잡이 같은 명령을 쓰므로 커밋에 `.changeset/cli-pre-fill-no-dry-run.md` 가
  반드시 포함돼야 한다.
- ADR 번호 0089 는 이 브랜치 기준이다. 같은 번호를 쓰는 다른 브랜치가 먼저 머지되면 충돌한다.
  `docs/adr/README.md` 가 이 위험을 이미 적어 두었다.
- W3 실환경 검증(`pnpm build --force` 뒤 `test:e2e`, `codex` 로 실제 서버 실행)은 오케스트레이터
  몫이라 여기서 하지 않았다.

## 커밋 메시지 (사람이 실행)

```
docs(cli): --no-dry-run 이 사전보완도 끈다는 사실을 README·ADR-0089·changeset 에 적는다
```

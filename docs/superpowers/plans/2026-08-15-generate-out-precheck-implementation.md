# `generate --out` 선검사와 덮어쓰기 구현 계획 (2026-08-15)

- 설계 문서: `docs/superpowers/specs/2026-08-15-generate-out-precheck-design.md`
- 선행 작업: R4(저장 경로 no-clobber), 입력값 교정 R0~R7, R8
- 새 ADR: 없다. 설계서 §4·§5 가 R4 의 원칙을 유지하는 근거를 담는다.
- 대상 패키지: `cli` 전부

## 0. 실행 모델

메인 세션은 오케스트레이터다. 구현·테스트는 위임 세션이 한다. 메인 세션은 worktree 부트스트랩,
프롬프트 전달, 보고서와 diff 확인, 검증 재실행, 머지 게이트, 통합 대장 기록만 한다.

모델 배분은 `CLAUDE.local.md` 의 표를 따른다. R9 는 **표준 모델**이다. 화면 문안과 검사 자리
셋이 설계서에 값 단위로 적혀 있어 판단 여지가 없다. 되돌릴 수 없는 동작(`unlink`)이 들어가지만
그 순서도 설계서 §5 가 고정한다.

## 1. 사람 몫 사전 조건

```sh
git log --oneline -1     # main 이 기점인지
git status --short       # 깨끗한지
```

설계서와 이 계획서가 `main` 에 커밋돼 있어야 한다.

## 2. 태스크 목록

| Task | 내용 | 선행 | 모델 |
|---|---|---|---|
| R9 | `--force` 옵션, 선검사, 도움말, E2E | 없음 | 표준 |

태스크가 하나라 의존성 그래프와 웨이브 표가 없다. 터미널 1개다. 번호는 입력값 교정 계열을 이어
R9 로 둔다.

## 3. PR 분할

PR 하나다. 옵션·검사·도움말·E2E 가 한 덩어리라 나누면 중간 커밋의 도움말과 동작이 어긋난다.

## 4. 태스크 상세

### R9: 출력 경로 선검사와 `--force` (`cli`)

**Files**

- Modify: `packages/cli/src/generate-command.ts`
- Modify: `packages/cli/src/help.ts`
- Test: `packages/cli/tests/generate-command.test.ts`
- Test: `packages/cli/tests/help.test.ts`
- Test: `packages/cli/tests/dist-cli-e2e.mjs`

`packages/runner`, `packages/generate`, `core/src/types.ts`, 루트 빌드 설정은 공유 계약이다.
입력값 교정 모듈(`repair-target.ts`, `input-repair.ts`, `repair-proposal.ts`,
`dry-run-review.ts`, `dry-run.ts`, `cassette-wiring.ts`, `reset-hook.ts`)도 고치지 않는다.

`generate-command.test.ts` 는 PR #102 가 같은 시각에 고치고 있다(설계서 §8). 충돌 지점이므로
이 태스크가 그 파일에서 손댄 범위를 보고서에 적는다.

**옵션**

| 옵션 | 값 | 규칙 |
|---|---|---|
| `--force` | 없음 | 한 번만. `optionNames` 와 `flagNames` 둘 다에 더한다 |

`GenerateCommandInput` 에 `readonly force: boolean` 을 더한다. `--baseline-only` 와 함께 쓸 수
있고 다른 옵션과의 배타 규칙은 없다.

**선검사 자리 (설계서 §4)**

`runGenerateCommand` 가 `parseGenerateCommand` 로 입력을 만든 직후, **`deps.connect` 를 부르기
전에** 검사한다. `input.force` 가 참이면 건너뛴다.

```
parse → (force 아니고 exists(outPath) 면 여기서 끊는다) → connect → ...
```

끊을 때는 설계서 §6 의 첫 문안을 `writeStderr` 로 내고 기존 저장 실패와 같은 종료 코드를
돌려준다. 새 종료 코드를 만들지 않는다.

**저장 경로 (설계서 §5)**

`saveSuite` 의 `exists` 선검사는 `input.force` 가 참이면 건너뛴다. `link` 직전에 `--force` 면
`deps.unlink(input.outPath)` 를 부르고 `ENOENT` 만 삼킨다. 다른 오류는 올린다.

**`link` 의 `EEXIST` 검사를 지우지 마라.** `rename` 으로 바꾸지 마라. R4 가 실측으로 없앤 데이터
손실 결함이 그대로 돌아온다.

**화면**: 설계서 §6 이 전량을 고정한다. 두 문안의 차이는 `시작하지 않았습니다` 와
`저장하지 않았습니다` 뿐이다. 문안을 새로 만들지 마라.

**테스트 (전량)**

```
generate 옵션 파싱
  · --force 를 두 번 주면 사용 오류다
  · --force 에 값을 붙이면 사용 오류다
  · --force 를 주면 force 가 켜진다
  · --force 가 없으면 force 가 꺼진다

generate 출력 경로 선검사
  · --out 이 이미 있고 --force 가 없으면 connect 를 부르지 않는다
  · 그때 화면에 시작하지 않았습니다 문안이 나온다
  · --out 이 없으면 선검사가 통과하고 connect 를 부른다
  · --force 면 --out 이 있어도 connect 를 부른다
  · --baseline-only 에서도 선검사가 돈다

generate 덮어쓰기 저장
  · --force 면 기존 파일이 새 명세로 바뀐다
  · --force 면 저장 직전 exists 검사를 건너뛴다
  · --force 인데 unlink 가 ENOENT 면 저장이 성공한다
  · --force 인데 unlink 가 다른 오류면 저장이 실패한다
  · --force 라도 link 가 EEXIST 면 저장하지 않고 저장 실패 문안이 나온다
  · --force 가 없으면 저장 단계 동작이 이전과 같다

generate 도움말
  · GENERATE_USAGE 에 [--force] 가 있다
  · 설명 블록에 --force 줄이 있다
```

`connect` 를 부르는지 여부는 주입한 `deps.connect` 의 호출 수로 본다. 실제 서버를 띄우지 않는다.

**E2E (`dist-cli-e2e.mjs`)**

```
· generate --help 에 --force 가 나온다
· 이미 있는 --out 으로 generate 를 부르면 서버를 띄우지 않고 끊는다
```

둘째 항목은 `--baseline-only` 로 확인한다. 프로세스가 뜨지 않았는지는 기존 `expectExited` 와 같은
방식으로 본다. 새 검사 방식을 만들지 마라.

**명령**: `pnpm test`, `pnpm build && pnpm --filter ohmymcp test:e2e`, `pnpm typecheck --force`,
`pnpm lint`

**보고서**: `docs/reports/task-r9-out-precheck.md`

**커밋**: `feat(cli): generate 출력 경로를 착수 전에 검사하고 --force 를 추가한다`

## 5. 실행 프롬프트

터미널 1개다. 프로젝트 루트에서 새 터미널을 열고 아래 블록을 그대로 붙여넣는다.

권장 실행 설정: 표준 모델, 추론 수준 보통, 에이전트 종류 `general-purpose`.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  cd "$(git rev-parse --show-toplevel)"
  git worktree add .claude/worktrees/ohmymcp-out-precheck -b feat/generate-out-precheck main

를 실행한 뒤 그 경로로 세션을 옮겨라. 옮긴 다음 아래를 확인하고, 하나라도 어긋나면 중단하고
BLOCKED 로 보고해라.

  - pwd 가 저장소 루트의 .claude/worktrees/ohmymcp-out-precheck 인지
    (git rev-parse --show-toplevel 이 그 경로를 가리키는지로 확인한다)
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-15-generate-out-precheck-design.md 가 있는지
  - docs/superpowers/plans/2026-08-15-generate-out-precheck-implementation.md 가 있는지
  - packages/cli/src/generate-command.ts 에 OutputExistsError 가 있는지
  - git status --short 가 비어 있는지
  - pnpm install 과 pnpm build 를 실행하고 pnpm test 가 실제로 기동하는지

[2단계: 실행]

너는 구현자다. Task R9 를 끝낸다. 계획서
docs/superpowers/plans/2026-08-15-generate-out-precheck-implementation.md 의 §4 를 읽고 그대로
구현해라. 배경과 검사 자리와 화면 문안은 설계 문서
docs/superpowers/specs/2026-08-15-generate-out-precheck-design.md 의 §1·§4·§5·§6 이 전량 고정한다.

지금 generate 는 출력 파일이 이미 있으면 저장을 거부하는데, 그 사실을 저장 확인에 y 를 누른
뒤에야 알려준다. 그 사이 실서버 시험 실행과 provider 호출이 이미 나갔다. 게다가 덮어쓸 방법이
CLI 안에 아예 없다. 이 둘을 고치는 태스크다.

R9 허용 Files:
  packages/cli/src/generate-command.ts
  packages/cli/src/help.ts
  packages/cli/tests/generate-command.test.ts
  packages/cli/tests/help.test.ts
  packages/cli/tests/dist-cli-e2e.mjs

주의할 것 셋을 미리 적는다.

  1. link 의 EEXIST 검사를 지우지 마라. rename 으로 바꾸지 마라. rename 은 대상이 있으면 말없이
     덮어쓴다. 실측으로 확인해 없앤 데이터 손실 결함이 그대로 돌아온다
     (generate-command.ts 의 주석과 docs/reports/task-r4.md).
  2. --force 의 덮어쓰기는 link 직전 unlink 로 한다. ENOENT 만 삼키고 다른 오류는 올린다.
     unlink 는 이미 GenerateCommandDependencies 에 있다. 새 primitive 를 만들지 마라.
  3. 선검사는 deps.connect 앞이다. 서버에 붙은 뒤에 검사하면 이 태스크의 목적이 사라진다.
     테스트로 connect 호출 수를 세서 못 박아라.

목록 밖 파일을 고치지 마라. packages/runner, packages/generate, core/src/types.ts 의
McpClient·ToolResult, 루트 빌드 설정은 공유 계약이다. 입력값 교정 모듈(repair-target.ts,
input-repair.ts, repair-proposal.ts, dry-run-review.ts, dry-run.ts, cassette-wiring.ts,
reset-hook.ts)도 고치지 마라. 계약이 안 맞으면 고치지 말고 보고해라. 의존 방향은 단방향이고
역참조·순환을 만들지 마라. @modelcontextprotocol/sdk 는 1.x 고정이고 목록 밖 의존성을 추가하지
마라. 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰을 하지 마라. 다른 작업자의 변경을
되돌리지 마라.

packages/cli/tests/generate-command.test.ts 는 다른 터미널이 PR 102 에서 같이 고치고 있다.
네가 그 파일에서 손댄 범위를 보고서에 적어라.

테스트는 인메모리와 fixtures/ 만 쓴다. connect 는 주입한 가짜다. dist-cli-e2e.mjs 만 실제
프로세스를 띄우고 그것은 pnpm --filter ohmymcp test:e2e 로 돈다.

검증: pnpm test, pnpm build && pnpm --filter ohmymcp test:e2e, pnpm typecheck --force, pnpm lint
를 모두 돌리고 출력을 보고서에 붙여라. typecheck 는 Cached: 0 cached 인지 확인해라.
packages/core/tests/stdio-integration.test.ts 는 첫 실행에 종종 실패하는 기존 플레이크다.
그것만 실패하면 재실행하고 그 사실을 적어라.

보고서: docs/reports/task-r9-out-precheck.md 를 쓴다. 바꾼 파일, 검증 명령과 결과, 임의로 판단한
지점, 남은 위험을 적어라. 커밋 메시지
`feat(cli): generate 출력 경로를 착수 전에 검사하고 --force 를 추가한다` 를 보고서에 적어라.
커밋은 하지 마라.

최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

## 6. 통합 게이트

1. worktree 에서 `git status --short` 와 `git diff --check`. 변경 경로가 허용 Files 안인가.
2. diff 를 직접 읽는다. **`link` 의 `EEXIST` 검사가 그대로 있는가. `rename` 이 안 들어왔는가.**
   설계서 §6 의 두 문안이 그대로인가. 선검사가 `connect` 앞인가.
3. 계획서에 적힌 검증 명령을 **다시 실행한다.** `pnpm typecheck --force` 출력에서
   `Cached: 0 cached` 를 확인한다.
4. 통과하면 **오케스트레이터 세션이** 태스크 단위로 커밋한다. 구현 세션은 커밋하지 않는다.
   실행 프롬프트의 `커밋은 하지 마라` 와 이 줄은 같은 규칙의 양면이다.
5. 통합 브랜치를 `--no-ff` 로 합친 뒤 **PR 을 열어 머지한다. `main` 에 직접 푸시하지 않는다.**
   저장소 규칙상 모든 변경은 PR 을 거친다. 통합 대장 기록도 그 PR 에 함께 싣는다. 로컬 `main`
   병합은 검증용이고 원격 반영이 아니다.
6. 통합 SHA 를 `docs/task-integration-ledger.tsv` 에 `R9-out-precheck` 로 기록한다.
7. worktree 가 깨끗한지 확인한 뒤 그 worktree 만 제거하고 그 브랜치만 삭제한다.

## 7. 완료 판정

설계서 §2 의 완료 조건 다섯에 더해 아래를 확인한다.

- `docs/task-integration-ledger.tsv` 에 `R9-out-precheck` 한 줄이 있고 `main` 의 조상이다.
- 실제로 `--out` 이 있는 경로에 `generate` 를 돌려 서버가 안 뜨는 것을 손으로 확인한다.
- `--force` 로 같은 경로를 두 번 생성해 두 번째 파일이 새 명세인 것을 손으로 확인한다.

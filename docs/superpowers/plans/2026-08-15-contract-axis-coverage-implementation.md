# 계약 축 커버리지와 위반 케이스 생성 (단계 5+6) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 로 태스크
> 단위 실행. 스텝은 체크박스(`- [ ]`) 로 추적한다.

**목표:** 서버가 선언한 `inputSchema` 에서 검증해야 할 축을 도출해, 규칙 기반 생성이 선언을
일부러 어긴 케이스를 기본으로 만들고, 명세가 덮지 않은 축을 `generate` 화면에 **미검증**으로
보여준다.

**설계:** 축 도출과 케이스-축 매칭은 `runner` 가 소유한다(`normalizeInputSchema` 를 한 벌로
유지해야 하고, `generate` 의 `validateSchema` 는 미지원 키워드에서 던져 커버리지 화면을 죽인다).
`generate` 는 그 축을 케이스로 합성하고 커버리지를 계산한다. `cli` 는 화면만 찍는다. 위반 케이스가
단계 2 의 입력 계약 대조에서 스스로 고발되지 않게 `runner` 에 제외 규칙을 하나 추가한다.

**기술 스택:** TypeScript, pnpm workspace, vitest, biome. `@modelcontextprotocol/sdk` 1.x 고정.

**설계 문서:** `docs/superpowers/specs/2026-08-15-contract-axis-coverage-design.md`
**선행 설계:** `docs/superpowers/specs/2026-08-14-input-contract-check-design.md`, ADR-0009,
ADR-0015, ADR-0018

## 전역 제약

- 손대지 않는다: `packages/core/**`, 루트 `package.json`·`pnpm-workspace.yaml`·`turbo.json`·
  `tsconfig.base.json`·`vitest.config.ts`, `packages/record/**`, `packages/mock/**`,
  `examples/**`, `fixtures/**`.
- 의존 방향: `cli` → `runner`/`generate` → `core`. 역참조·순환 금지.
- 의존성 추가 0건. `@modelcontextprotocol/sdk` 버전 변경 금지.
- 서브에이전트는 git 명령을 실행하지 않는다. 커밋·머지·푸시는 사람이 한다.
- 유닛테스트는 인메모리 리터럴과 `fixtures/tools-list.sample.json` 읽기만 쓴다.
  `examples/weather-server` 프로세스를 띄우는 검증은 T9(직렬 전용)에만 있다.
- 문자열 비교와 정렬은 `packages/runner/src/ordering.ts` 의 `byCodeUnit` 만 쓴다.
  `localeCompare` 금지. 새 비교자를 만들지 않는다.
- 중첩 스키마를 내려가는 재귀를 새로 만들지 않는다. 축 도출은 `properties` 한 겹만 본다.
- 시간·난수·환경 변수·실행 순서에 의존하는 코드 금지.
- 새 매직넘버는 상수로 두고 근거를 주석에 적는다. 이 계획의 매직넘버는
  `CASE_COUNT_WARNING_THRESHOLD = 1500` 하나다(T10, 근거는 설계서 §9.2).
- 커밋 메시지는 Conventional Commits, scope 필수(`runner`/`generate`/`cli`). 한국어.

## 완료 조건

1. `pnpm test`, `pnpm typecheck --force`, `pnpm lint` 전부 통과. `Cached: 0 cached` 확인.
2. `fixtures/tools-list.sample.json` 두 툴로 만든 baseline 이 케이스 **8개**이고 id·입력·단언이
   설계서 §5.5 표와 정확히 일치한다.
3. 그 8개를 `checkInputContract` 에 넣으면 `REQUIRED_MISSING`·`UNDECLARED_FIELD`·
   `TYPE_MISMATCH`·`ENUM_MISMATCH` 가 **0건**이다.
4. 같은 8개로 `computeCoverage` 를 돌리면 `verified === total === 8` 이다. 3번과 4번이 **동시에**
   참이어야 §11.1 의 침묵과 §6.2 의 판정이 서로를 무효화하지 않는다는 것이 증명된다.
5. 같은 `tools` 로 두 번 생성한 suite 가 `JSON.stringify` 기준 동일하다.
6. `examples/weather-server` E2E 가 총 8케이스, 7 passed, 1 failed 로 통과한다(실패 1건은
   `get-weather-success` 의 도메인 값 문제이고 기존과 같은 이유다).
7. `docs/adr/0009-...` 의 승인 심볼 표와 `dependency-boundary.test.ts` 의
   `APPROVED_RUNNER_SYMBOLS` 가 실제 import 와 정확히 일치한다.
8. `packages/core` 변경 0건.

## 비범위

- `UNDECLARED_INJECTED` 축. `generate` 의 `validateSchema` 허용 키워드 확대가 선행이다.
- 값의 도메인 검사. 단계 3.
- `cli test` 화면과 `--json`. 커버리지는 `generate` 시점만.
- 케이스 이름의 조사 문제(설계서 §5.6).
- dry run 승인 게이트(단계 3), repair(단계 4).

---

## 1. 실행 모델

메인 세션은 오케스트레이터다. 태스크마다 서브에이전트를 스폰하고 사이사이 리뷰한다(테스트 통과 +
Files 목록 준수). 구현은 서브에이전트가 한다.

| 태스크 | 모델 | 사유 |
|---|---|---|
| T1 정규화 추출 | 표준 | 행위 변화 0의 기계적 이동. 기존 테스트가 판정한다 |
| T2 `deriveContractAxes` | 표준 | 사양이 계획서에 코드로 못 박혀 있다 |
| T3 `matchCoveredAxes` | 상위 | 판정 규칙이 §11.1 침묵과 상호작용한다. 틀리면 커버리지가 조용히 1/N 로 굳는다 |
| T4 §11.1 제외 규칙 + ADR-0021 | 상위 | 검사 대상의 경계 판단. 잘못 넓히면 진짜 오타를 영구 미탐으로 만든다 |
| T5 `fieldSlug` | 표준 | 슬러그 규칙이 코드로 적혀 있다 |
| T6 `buildViolationCases` | 상위 | 위반값 선택 규칙이 결정론성 계약이다. 값이 흔들리면 지문이 흔들린다 |
| T7 `computeCoverage` | 표준 | 집계다. 판정은 T3 이 소유한다 |
| T8 `render`·`baseline` 배선 | 표준 | 사양이 코드로 적혀 있다. POLICY_VERSION 승격 포함 |
| T9 `cli` 화면 + 실서버 E2E | 상위 | 표시 문안 설계. 이 프로젝트에서 문안은 제품이다. 직렬 전용 |
| T10 ADR-0009 개정 + 경계 테스트 + ADR-0022 | 상위 | 패키지 경계 판단. 목록이 실제 import 와 어긋나면 경계 장치가 죽는다 |

## 2. 터미널 분할

**터미널 2개, 순차다.** 병렬로 열지 않는다.

PR 을 두 개로 나누는 이유는 설계서 §13 에 있다. `cli` 는 공동 소유라 `runner` 와 한 PR 에 담을 수
없고(CONTRIBUTING §2.2), 반대로 `generate` 만 담은 PR 은 `packages/cli/tests/generate-integration.test.ts:112`
의 `toHaveLength(2)` 가 깨져 CI 가 빨간불이라 머지되지 않는다. 그래서 `generate` 와 `cli` 는 한
PR 이다(로드맵 PR 2-B 선례).

**스택 PR 로 만들지 않는다.** 베이스가 피처 브랜치면 CodeRabbit 이 리뷰를 건너뛴다(단계 8 에서
확인한 도구 제약). 터미널 B 는 PR 1 이 `main` 에 머지된 뒤에 연다.

| 터미널 | PR | 브랜치 | worktree | 패키지 | 태스크 |
|---|---|---|---|---|---|
| A | 1 | `feat/contract-axes-runner` | `.claude/worktrees/ohmymcp-contract-axes-runner` | `runner` | T1 → T2 → T3 → T4 |
| B | 2 | `feat/contract-axes-generate-cli` | `.claude/worktrees/ohmymcp-contract-axes-generate-cli` | `generate` · `cli` | T5 → T6 → T7 → T8 → T9 → T10 |

터미널 안의 웨이브.

| 터미널 | 웨이브 | 태스크 | 병렬 |
|---|---|---|---|
| A | 1 | T1 | 단독. 후속 전부가 이 파일을 읽는다 |
| A | 2 | T2 → T3 | 순차. 같은 파일(`contract-axes.ts`) |
| A | 3 | T4 | 단독. `input-contract.ts` |
| B | 1 | T5 | 단독 |
| B | 2 | T6 → T7 | 순차. T7 이 T6 의 케이스를 기대값으로 쓴다 |
| B | 3 | T8 | 단독. 여기서 baseline 출력이 실제로 바뀐다 |
| B | 4 | T9 | **직렬 전용.** 실제 서버 프로세스를 띄운다 |
| B | 5 | T10 | 단독. 실제 import 를 보고 목록을 확정한다 |

## 3. 사람 몫 사전 조건

터미널 A 를 열기 전에 프로젝트 루트에서 두 가지만 확인한다.

1. 이 계획서와 설계 문서(`docs/superpowers/specs/2026-08-15-contract-axis-coverage-design.md`)를
   커밋했는지. **untracked 면 새 worktree 에 따라가지 않는다.**
2. `git status --short` 가 깨끗한지 확인하고 `git log --oneline -1` 의 SHA 를 적어 둔다. 그 SHA 가
   터미널 A 프롬프트의 기점 검증 값이다.

터미널 B 를 열기 전에 하나 더 확인한다.

3. PR 1 이 `main` 에 머지됐는지. `git log --oneline -1 main` 의 SHA 를 적어 두고, 그것이 터미널 B
   프롬프트의 기점 검증 값이다. **브랜치나 worktree 가 존재한다는 사실을 머지 근거로 쓰지 않는다.**

## 4. 실행 프롬프트

### 4.1 터미널 A (PR 1, `runner`)

권장 실행 설정: 상위 모델, 추론 수준 높음, 에이전트 종류 `general-purpose`(이 세션이
오케스트레이터로 남고 태스크마다 서브에이전트를 스폰한다).

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add .claude/worktrees/ohmymcp-contract-axes-runner -b feat/contract-axes-runner HEAD

를 실행한 뒤 그 경로(.claude/worktrees/ohmymcp-contract-axes-runner)로 세션을 옮겨라.
EnterWorktree 도구에 path 로 그 절대 경로를 넘긴다. name 으로 새로 만들게 하지 마라.

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 `BLOCKED: <사유>` 로 보고해라.
  - pwd 가 .claude/worktrees/ohmymcp-contract-axes-runner 인지
  - git log --oneline -1 이 루트에서 적어 둔 기점 SHA 와 같은지
  - docs/superpowers/plans/2026-08-15-contract-axis-coverage-implementation.md 가 존재하는지
  - docs/superpowers/specs/2026-08-15-contract-axis-coverage-design.md 가 존재하는지
  - docs/superpowers/specs/2026-08-14-input-contract-check-design.md 가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm install 로 의존성을 설치하고
    `pnpm vitest run packages/runner/tests/input-contract.test.ts` 가 실제로 실행되는지
    (새 worktree 는 node_modules 를 상속하지 않는다. 실행 불가는 타임아웃처럼 보인다)

[2단계: 실행]

역할: 오케스트레이터. 너는 직접 구현하지 않는다. 계획서의 T1 → T2 → T3 → T4 를 순서대로,
태스크마다 서브에이전트를 스폰해 실행시키고, 보고를 받아 검증하고, 다음 태스크로 넘긴다.

계획서: docs/superpowers/plans/2026-08-15-contract-axis-coverage-implementation.md
이 터미널의 범위는 계획서 §2 표의 터미널 A 다. T5 이후는 이 터미널에서 하지 않는다.
각 태스크의 모델은 계획서 §1 의 표를 따른다.

각 서브에이전트 프롬프트에 다음을 그대로 넣어라.
  - 그 태스크의 Files 목록. 목록 밖 파일 수정 금지. 특히 packages/core/**, 루트 빌드 설정,
    packages/generate/**, packages/cli/** 은 이 터미널에서 건드리지 않는다. 필요해 보이면
    수정하지 말고 보고한다.
  - 의존 방향은 단방향(cli → runner/generate → core). 역참조·순환 금지.
  - @modelcontextprotocol/sdk 는 1.x 고정. 의존성 추가 금지.
  - git 명령을 실행하지 않는다. 커밋은 사람이 한다.
  - 백그라운드 실행 금지. 하위 에이전트 스폰 금지. 다른 작업자의 변경을 되돌리지 않는다.
  - 테스트는 인메모리 리터럴만 쓴다. 서버 프로세스를 띄우지 않는다.
  - 정렬과 문자열 비교는 packages/runner/src/ordering.ts 의 byCodeUnit 만 쓴다.
  - 보고서를 docs/reports/task-<태스크ID>-contract-axes.md 에 쓴다.
  - 완료 형식: 첫 줄이 `status: READY_FOR_REVIEW` 또는 `status: BLOCKED`. 이어서 바꾼 파일 목록,
    실행한 검증 명령과 그 출력의 판정 줄, 임의로 판단한 지점, 남은 위험.

태스크마다 아래를 통과해야 다음으로 넘어간다.
  - pnpm vitest run <해당 테스트 파일>  가 통과
  - pnpm vitest run packages/runner  전체가 통과
  - pnpm typecheck --force  가 통과하고 검사 파일 수가 0이 아님
  - pnpm lint  가 통과
Files 목록 밖 변경이 있으면 되돌리게 하고 사유를 보고서에 남긴다.
보고서와 실제 diff 와 테스트 출력을 직접 확인하기 전에는 다음 태스크를 시작하지 않는다.

T4 가 끝나면 pnpm test · pnpm typecheck --force · pnpm lint 를 한 번 더 돌리고, 커밋 제안
목록(태스크 단위, Conventional Commits, scope 필수, 한국어)을 사람에게 제시한다. 직접 커밋하지
마라. PR 1 은 사람이 만든다.
```

### 4.2 터미널 B (PR 2, `generate` + `cli`)

권장 실행 설정: 상위 모델, 추론 수준 높음, 에이전트 종류 `general-purpose`(이 세션이
오케스트레이터로 남고 태스크마다 서브에이전트를 스폰한다).

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

먼저 PR 1 이 머지됐는지 확인해라. 아래 둘이 모두 참이어야 계속한다.
  - git fetch 후 git log --oneline -5 origin/main 에 feat/contract-axes-runner 의 머지 커밋이 있다
  - git merge-base --is-ancestor <PR1 통합 SHA> origin/main 이 성공한다
하나라도 실패하면 아무것도 만들지 말고 `BLOCKED: PR 1 미머지` 로 보고해라.

  git worktree add .claude/worktrees/ohmymcp-contract-axes-generate-cli -b feat/contract-axes-generate-cli origin/main

를 실행한 뒤 그 경로(.claude/worktrees/ohmymcp-contract-axes-generate-cli)로 세션을 옮겨라.
EnterWorktree 도구에 path 로 그 절대 경로를 넘긴다. name 으로 새로 만들게 하지 마라.

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 `BLOCKED: <사유>` 로 보고해라.
  - pwd 가 .claude/worktrees/ohmymcp-contract-axes-generate-cli 인지
  - git log --oneline -1 이 루트에서 적어 둔 origin/main 기점 SHA 와 같은지
  - docs/superpowers/plans/2026-08-15-contract-axis-coverage-implementation.md 가 존재하는지
  - docs/superpowers/specs/2026-08-15-contract-axis-coverage-design.md 가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm install 로 의존성을 설치하고 pnpm build 로 runner 산출물을 만든 뒤
    `pnpm vitest run packages/generate/tests/baseline.test.ts` 가 실제로 실행되는지
    (generate 와 cli 는 runner 산출물을 본다. 낡은 산출물은 낡은 계약으로 판정한다)
  - node -e "import('@ohmymcp/runner').then(m => console.log(typeof m.deriveContractAxes, typeof m.matchCoveredAxes))"
    가 `function function` 을 출력하는지. 아니면 PR 1 이 실제로 안 들어온 것이므로 BLOCKED 다

[2단계: 실행]

역할: 오케스트레이터. 너는 직접 구현하지 않는다. 계획서의 T5 → T6 → T7 → T8 → T9 → T10 을
순서대로, 태스크마다 서브에이전트를 스폰해 실행시키고, 보고를 받아 검증하고, 다음으로 넘긴다.

계획서: docs/superpowers/plans/2026-08-15-contract-axis-coverage-implementation.md
이 터미널의 범위는 계획서 §2 표의 터미널 B 다. T1~T4 는 이미 main 에 있으므로 다시 하지 않는다.
각 태스크의 모델은 계획서 §1 의 표를 따른다.

T9 는 실제 서버 프로세스를 띄우는 직렬 전용 태스크다. 다른 태스크와 동시에 돌리지 마라.

각 서브에이전트 프롬프트에 다음을 그대로 넣어라.
  - 그 태스크의 Files 목록. 목록 밖 파일 수정 금지. 특히 packages/core/**, packages/runner/**,
    packages/record/**, packages/mock/**, examples/**, fixtures/**, 루트 빌드 설정은 이 PR 에서
    건드리지 않는다. 필요해 보이면 수정하지 말고 보고한다.
  - 의존 방향은 단방향(cli → runner/generate → core). 역참조·순환 금지.
    generate 가 runner 에서 가져오는 심볼은 ADR-0009 의 승인 목록으로 제한된다. 목록에 없는
    심볼이 필요하면 임의로 넣지 말고 T10 에서 다룰 것으로 보고한다.
  - @modelcontextprotocol/sdk 는 1.x 고정. 의존성 추가 금지.
  - git 명령을 실행하지 않는다. 커밋은 사람이 한다.
  - 백그라운드 실행 금지. 하위 에이전트 스폰 금지. 다른 작업자의 변경을 되돌리지 않는다.
  - 유닛테스트는 인메모리 리터럴과 fixtures/tools-list.sample.json 읽기만 쓴다. 서버 프로세스를
    띄우는 것은 T9 뿐이다.
  - 보고서를 docs/reports/task-<태스크ID>-contract-axes.md 에 쓴다.
  - 완료 형식: 첫 줄이 `status: READY_FOR_REVIEW` 또는 `status: BLOCKED`. 이어서 바꾼 파일 목록,
    실행한 검증 명령과 그 출력의 판정 줄, 임의로 판단한 지점, 남은 위험.

태스크마다 아래를 통과해야 다음으로 넘어간다.
  - pnpm vitest run <해당 테스트 파일>  가 통과
  - pnpm vitest run packages/generate  전체가 통과 (T9 이후는 packages/cli 도)
  - pnpm typecheck --force  가 통과하고 검사 파일 수가 0이 아님
  - pnpm lint  가 통과
Files 목록 밖 변경이 있으면 되돌리게 하고 사유를 보고서에 남긴다.
보고서와 실제 diff 와 테스트 출력을 직접 확인하기 전에는 다음 태스크를 시작하지 않는다.

T10 이 끝나면 pnpm test · pnpm typecheck --force · pnpm lint 를 한 번 더 돌리고
`Cached: 0 cached` 를 확인한 뒤, 커밋 제안 목록(태스크 단위, Conventional Commits, scope 필수,
한국어)을 사람에게 제시한다. 직접 커밋하지 마라. PR 2 는 사람이 만든다.
```

---

## 5. 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/runner/src/input-schema.ts` | 서버 `inputSchema` 정규화와 필드 판정. 패키지 내부 전용 | T1 |
| `packages/runner/src/case-expectation.ts` | 케이스의 `isError` 기대값 판독. 패키지 내부 전용 | T1 |
| `packages/runner/src/contract-axes.ts` | 축 도출과 케이스-축 매칭 | T2, T3 |
| `packages/runner/src/input-contract.ts` | 입력 계약 대조. 거절 기대 케이스 제외 | T1, T4 |
| `packages/generate/src/filename.ts` | 슬러그 규칙 | T5 |
| `packages/generate/src/violation-cases.ts` | 축을 위반 케이스로 합성 | T6 |
| `packages/generate/src/coverage.ts` | 명세와 축 대조, 커버리지 집계 | T7 |
| `packages/generate/src/render.ts` | 케이스 합성 진입점, 케이스 타입 | T6, T8 |
| `packages/generate/src/baseline.ts` | suite 합성, 정책 버전, 커버리지 동봉 | T8 |
| `packages/cli/src/generate-command.ts` | 커버리지 화면과 케이스 수 고지 | T9 |

`input-schema.ts` 와 `case-expectation.ts` 를 `index.ts` 로 내보내지 않는다. `ordering.ts` 의
선례와 같다(파일 머리 주석에 "패키지 내부 전용" 을 적는다). 내보내면 단계 2 의 내부 판단
(부분 성공 없음, `type` 배열이면 필드 포기)이 공개 API 가 되어 나중에 못 바꾼다.

---

## Task 1: 정규화와 기대값 판독을 내부 모듈로 추출

**Files**
- Create: `packages/runner/src/input-schema.ts`
- Create: `packages/runner/src/case-expectation.ts`
- Modify: `packages/runner/src/input-contract.ts`
- Test: `packages/runner/tests/input-contract.test.ts` (기존 파일. 단언 변경 없이 통과해야 한다)

**Interfaces**
- Consumes: `packages/runner/src/schema-match.ts` 의 `matchResponseSchema`·`plainObject`·
  `typeName`, `packages/runner/src/ordering.ts` 의 `byCodeUnit`
- Produces: 아래 시그니처. T2·T3·T4 가 전부 이것을 쓴다

```ts
// packages/runner/src/input-schema.ts
export type DeclaredType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
export interface NormalizedField {
  readonly type: DeclaredType | null;
  readonly enumValues: readonly JsonValue[] | null;
}
export interface NormalizedInputSchema {
  readonly fields: ReadonlyMap<string, NormalizedField>;
  readonly required: readonly string[];
  readonly rejectsUndeclared: boolean;
}
export interface InputSchemaAnalysis {
  readonly schema: NormalizedInputSchema | null;
  readonly unanalyzableReason: string | null;
  readonly unanalyzedFields: readonly string[];
}
export function analyzeInputSchema(schema: unknown): InputSchemaAnalysis;
export function judgeField(field: NormalizedField, value: JsonValue): "TYPE_MISMATCH" | "ENUM_MISMATCH" | null;

// packages/runner/src/case-expectation.ts
export function expectedIsError(testCase: TestCaseSpec): boolean | null;
```

**행위 변화 0이 이 태스크의 판정 기준이다.** `input-contract.ts` 의 기존 테스트가 단언 하나도
안 바뀌고 통과해야 한다.

- [ ] **Step 1: `input-schema.ts` 를 만든다**

`input-contract.ts` 에서 `DeclaredType`, `NormalizedField`, `NormalizedInputSchema`,
`BLOCKING_KEYWORDS`, `DECLARED_TYPES`, `hasBlockingKeyword`, `declaredType`,
`normalizeInputSchema`, `judgeField` 를 그대로 옮긴다. `normalizeInputSchema` 는 이름을
`analyzeInputSchema` 로 바꾸고 반환을 `InputSchemaAnalysis` 로 넓힌다. **판정 로직은 한 글자도
바꾸지 않는다.** 늘어나는 것은 사유와 미해석 필드 수집뿐이다.

```ts
/**
 * 서버가 선언한 임의의 JSON Schema 를 우리가 이해하는 구조로 줄인다.
 *
 * 이 파일은 패키지 내부 전용이다. `index.ts` 로 내보내지 않는다. 여기 담긴 판단(부분 성공은
 * 없다, type 이 배열이면 그 필드를 통째로 포기한다)은 ADR-0015 의 결정이고 공개 API 가 되면
 * 고칠 수 없다.
 */
export function analyzeInputSchema(schema: unknown): InputSchemaAnalysis {
  const fail = (reason: string): InputSchemaAnalysis => ({
    schema: null,
    unanalyzableReason: reason,
    unanalyzedFields: [],
  });
  if (!plainObject(schema)) return fail("schema");
  // BLOCKING_KEYWORDS 배열 순서로 첫 것을 고른다. Object.keys 순서를 쓰면 사유가 흔들린다.
  const blocking = BLOCKING_KEYWORDS.find((keyword) => Object.hasOwn(schema, keyword));
  if (blocking !== undefined) return fail(blocking);
  if (schema.type !== "object") return fail("type");
  const properties = schema.properties;
  if (!plainObject(properties)) return fail("properties");

  const fields = new Map<string, NormalizedField>();
  const unanalyzedFields: string[] = [];
  for (const name of Object.keys(properties).sort(byCodeUnit)) {
    const field = properties[name];
    if (!plainObject(field) || hasBlockingKeyword(field) || Array.isArray(field.type)) {
      fields.set(name, { type: null, enumValues: null });
      unanalyzedFields.push(name);
      continue;
    }
    const type = declaredType(field.type);
    const rawEnum = field.enum;
    const enumValues =
      Array.isArray(rawEnum) && rawEnum.length > 0 ? (rawEnum as readonly JsonValue[]) : null;
    fields.set(name, { type, enumValues });
    // type 도 enum 도 못 읽었으면 이 필드에는 요구할 근거가 없다. 축을 못 만드는 필드다.
    if (type === null && enumValues === null) unanalyzedFields.push(name);
  }

  const rawRequired = schema.required;
  const required = Array.isArray(rawRequired)
    ? rawRequired.filter((name): name is string => typeof name === "string")
    : [];

  return {
    schema: { fields, required, rejectsUndeclared: schema.additionalProperties === false },
    unanalyzableReason: null,
    unanalyzedFields,
  };
}
```

원본은 `!plainObject(field) || hasBlockingKeyword(field)` 와 `Array.isArray(field.type)` 를 두
분기로 나눠 뒀다. 합쳐도 결과가 같다(둘 다 `{ type: null, enumValues: null }` 을 넣고 continue).
합치는 이유는 미해석 필드 수집을 한 곳에서 하기 위해서다. `Object.keys(properties).sort(byCodeUnit)`
순회이므로 `unanalyzedFields` 는 자동으로 코드 단위 오름차순이다.

- [ ] **Step 2: `case-expectation.ts` 를 만든다**

```ts
/**
 * 케이스가 오류 응답을 기대하는지 판독한다.
 *
 * 이 파일은 패키지 내부 전용이다. `index.ts` 로 내보내지 않는다.
 *
 * isError 단언이 여러 개이고 expected 가 서로 다르면 null 이다. 그런 명세는 모순이고, 어느
 * 쪽으로 읽어도 틀린다. 모순을 임의로 한쪽으로 해석하면 그 사실이 숨는다.
 */
export function expectedIsError(testCase: TestCaseSpec): boolean | null {
  let seen: boolean | null = null;
  for (const assertion of testCase.assertions) {
    if (assertion.type !== "isError") continue;
    if (seen === null) seen = assertion.expected;
    else if (seen !== assertion.expected) return null;
  }
  return seen;
}
```

- [ ] **Step 3: `input-contract.ts` 를 import 로 바꾼다**

옮긴 정의를 삭제하고 `analyzeInputSchema`·`judgeField`·타입을 import 한다. `normalizeOnce` 의
본문만 바뀐다.

```ts
const normalizeOnce = (tool: ToolDef): NormalizedInputSchema | null => {
  if (!normalized.has(tool.name))
    normalized.set(
      tool.name,
      duplicated.has(tool.name) ? null : analyzeInputSchema(tool.inputSchema).schema,
    );
  return normalized.get(tool.name) ?? null;
};
```

- [ ] **Step 4: 기존 테스트가 그대로 통과하는지 확인한다**

Run: `pnpm vitest run packages/runner/tests/input-contract.test.ts`
Expected: PASS. 단언을 하나도 고치지 않았어야 한다. 하나라도 고쳐야 통과하면 추출이 무손실이
아니라는 뜻이므로 되돌리고 원인을 보고한다.

- [ ] **Step 5: 회귀와 정적 검사**

Run: `pnpm vitest run packages/runner`
Expected: PASS (`deep-and-cyclic-input.test.ts` 포함)
Run: `pnpm typecheck --force`, `pnpm lint`
Expected: PASS, 검사 파일 수가 0이 아님

- [ ] **Step 6: 보고서를 쓰고 완료 보고**

`docs/reports/task-t1-contract-axes.md` 에 바꾼 파일, 검증 명령과 판정 줄, 임의 판단 지점(두
분기를 합친 것)을 적는다. 커밋 제안: `refactor(runner): 입력 스키마 정규화를 내부 모듈로 분리한다`

---

## Task 2: `deriveContractAxes`

**Files**
- Create: `packages/runner/src/contract-axes.ts`
- Modify: `packages/runner/src/index.ts` (export 추가만)
- Test: `packages/runner/tests/contract-axes.test.ts` (신규)

**Interfaces**
- Consumes: T1 의 `analyzeInputSchema`, `ordering.ts` 의 `byCodeUnit`
- Produces: `deriveContractAxes(tool, options?)`, `ContractAxis`, `ContractAxisKind`,
  `ContractDeclaredType`, `ContractAxesResult`. T3·T6·T7 이 쓴다. 전량 시그니처는 설계서 §3.2

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import type { ToolDef } from "@ohmymcp/core";
import { describe, expect, it } from "vitest";
import { deriveContractAxes } from "../src/index.js";

const tool = (name: string, inputSchema: unknown): ToolDef => ({ name, inputSchema });
const weather = tool("get_weather", {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
});

describe("deriveContractAxes", () => {
  it("required 하나와 type 하나인 툴은 축 3개를 낸다", () => {
    const result = deriveContractAxes(weather);
    expect(result.analyzable).toBe(true);
    expect(result.unanalyzableReason).toBeNull();
    expect(result.unanalyzedFields).toEqual([]);
    expect(result.axes).toEqual([
      { kind: "HAPPY_PATH", tool: "get_weather", field: null, declaredType: null, declaredEnum: null },
      { kind: "REQUIRED_OMITTED", tool: "get_weather", field: "city", declaredType: null, declaredEnum: null },
      { kind: "TYPE_VIOLATION", tool: "get_weather", field: "city", declaredType: "string", declaredEnum: null },
    ]);
  });

  it("type 과 enum 을 함께 선언한 필드는 축이 둘 생긴다", () => {
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { units: { type: "string", enum: ["c", "f"] } } }),
    );
    expect(result.axes.map((axis) => axis.kind)).toEqual([
      "HAPPY_PATH",
      "TYPE_VIOLATION",
      "ENUM_VIOLATION",
    ]);
    expect(result.axes[2]?.declaredEnum).toEqual(["c", "f"]);
  });

  it("루트에 anyOf 가 있으면 축을 세지 않고 사유가 anyOf 다", () => {
    const result = deriveContractAxes(tool("t", { anyOf: [{ type: "object" }] }));
    expect(result).toEqual({
      axes: [],
      analyzable: false,
      unanalyzableReason: "anyOf",
      unanalyzedFields: [],
    });
  });

  it("필드에 anyOf 가 있으면 그 필드만 축에서 빠지고 unanalyzedFields 에 들어간다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: { a: { type: "string" }, b: { anyOf: [{ type: "string" }] } },
        required: ["a", "b"],
      }),
    );
    expect(result.unanalyzedFields).toEqual(["b"]);
    expect(result.axes.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toEqual([
      "HAPPY_PATH:",
      "REQUIRED_OMITTED:a",
      "REQUIRED_OMITTED:b",
      "TYPE_VIOLATION:a",
    ]);
  });

  it("required 배열 순서를 뒤집어도 결과가 같다", () => {
    const forward = deriveContractAxes(
      tool("t", { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"] }),
    );
    const backward = deriveContractAxes(
      tool("t", { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["b", "a"] }),
    );
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  it("duplicated 를 넘기면 사유가 duplicateTool 이다", () => {
    expect(deriveContractAxes(weather, { duplicated: true })).toEqual({
      axes: [],
      analyzable: false,
      unanalyzableReason: "duplicateTool",
      unanalyzedFields: [],
    });
  });

  it("같은 툴로 두 번 호출한 결과가 동일하다", () => {
    expect(JSON.stringify(deriveContractAxes(weather))).toBe(
      JSON.stringify(deriveContractAxes(weather)),
    );
  });
});
```

나머지 케이스는 설계서 §10.1 의 `deriveContractAxes` 블록에 전량으로 있다. 그 목록을 전부
테스트로 옮긴다. 위 코드는 그중 형태가 특이한 것만 미리 적은 것이다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm vitest run packages/runner/tests/contract-axes.test.ts`
Expected: FAIL. `deriveContractAxes is not a function`

- [ ] **Step 3: 최소 구현**

```ts
import type { ToolDef } from "@ohmymcp/core";
import { analyzeInputSchema } from "./input-schema.js";
import { byCodeUnit } from "./ordering.js";
import type { JsonValue } from "./spec/types.js";

export function deriveContractAxes(
  tool: ToolDef,
  options?: { readonly duplicated?: boolean },
): ContractAxesResult {
  const unanalyzable = (reason: string): ContractAxesResult => ({
    axes: [],
    analyzable: false,
    unanalyzableReason: reason,
    unanalyzedFields: [],
  });
  // 중복 선언은 툴 하나만 봐서는 알 수 없다. 호출자가 tools 배열 전체를 보고 넘긴다.
  if (options?.duplicated === true) return unanalyzable("duplicateTool");
  const analysis = analyzeInputSchema(tool.inputSchema);
  if (analysis.schema === null) return unanalyzable(analysis.unanalyzableReason ?? "schema");

  const axis = (
    kind: ContractAxisKind,
    field: string | null,
    declaredType: ContractDeclaredType | null,
    declaredEnum: readonly JsonValue[] | null,
  ): ContractAxis => ({ kind, tool: tool.name, field, declaredType, declaredEnum });

  const axes: ContractAxis[] = [axis("HAPPY_PATH", null, null, null)];
  // required 는 서버가 준 순서다. 정렬해서 쓴다. cases 배열 순서는 지문에 들어가는 의미이므로
  // 서버가 required 순서를 바꾸는 것만으로 지문이 흔들리면 안 된다.
  for (const name of [...analysis.schema.required].sort(byCodeUnit))
    axes.push(axis("REQUIRED_OMITTED", name, null, null));
  // fields 는 analyzeInputSchema 가 이미 코드 단위로 정렬해 넣은 Map 이다. 다시 정렬하지 않는다.
  for (const [name, field] of analysis.schema.fields)
    if (field.type !== null) axes.push(axis("TYPE_VIOLATION", name, field.type, null));
  for (const [name, field] of analysis.schema.fields)
    if (field.enumValues !== null)
      axes.push(axis("ENUM_VIOLATION", name, null, [...field.enumValues]));

  return {
    axes,
    analyzable: true,
    unanalyzableReason: null,
    unanalyzedFields: analysis.unanalyzedFields,
  };
}
```

타입 선언(`ContractAxisKind`·`ContractAxis`·`ContractDeclaredType`·`ContractAxesResult`)은 설계서
§3.2 의 것을 주석까지 그대로 옮긴다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run packages/runner/tests/contract-axes.test.ts`
Expected: PASS

- [ ] **Step 5: `index.ts` 에 export 추가**

```ts
export {
  type ContractAxesResult,
  type ContractAxis,
  type ContractAxisKind,
  type ContractDeclaredType,
  deriveContractAxes,
} from "./contract-axes.js";
```

- [ ] **Step 6: 회귀와 정적 검사, 보고서**

Run: `pnpm vitest run packages/runner`, `pnpm typecheck --force`, `pnpm lint`
Expected: 전부 PASS
보고서: `docs/reports/task-t2-contract-axes.md`
커밋 제안: `feat(runner): 서버 선언에서 계약 축을 도출한다`

---

## Task 3: `matchCoveredAxes`

**Files**
- Modify: `packages/runner/src/contract-axes.ts`
- Modify: `packages/runner/src/index.ts` (export 추가만)
- Test: `packages/runner/tests/contract-axes.test.ts`

**Interfaces**
- Consumes: T1 의 `analyzeInputSchema`·`judgeField`·`expectedIsError`, T2 의 `ContractAxis`
- Produces: `matchCoveredAxes({ testCase, tool }): readonly ContractAxis[]`. T7 이 쓴다

**이 태스크가 상위 모델인 이유.** T4 가 `checkInputContract` 를 침묵시키는데 이 함수는 그
침묵과 무관하게 판정해야 한다. 둘을 한 재료로 만들면 커버리지가 조용히 1/N 로 굳고, 테스트가
전부 초록인 채로 기능이 죽는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { checkInputContract, deriveContractAxes, matchCoveredAxes } from "../src/index.js";
import type { TestCaseSpec } from "../src/index.js";

const callCase = (
  id: string,
  input: Record<string, unknown>,
  expected: boolean,
): TestCaseSpec => ({
  id,
  name: id,
  operation: { type: "callTool", tool: "get_weather", input },
  assertions: [{ type: "isError", expected }],
});

describe("matchCoveredAxes", () => {
  it("선언을 지킨 입력 + isError false 는 HAPPY_PATH 를 덮는다", () => {
    const covered = matchCoveredAxes({ testCase: callCase("ok", { city: "서울" }, false), tool: weather });
    expect(covered.map((axis) => axis.kind)).toEqual(["HAPPY_PATH"]);
  });

  it("선언을 어긴 입력 + isError false 는 아무 축도 덮지 않는다", () => {
    expect(matchCoveredAxes({ testCase: callCase("bad", {}, false), tool: weather })).toEqual([]);
  });

  it("required 를 뺀 입력 + isError true 는 REQUIRED_OMITTED 를 덮는다", () => {
    const covered = matchCoveredAxes({ testCase: callCase("miss", {}, true), tool: weather });
    expect(covered).toEqual([
      { kind: "REQUIRED_OMITTED", tool: "get_weather", field: "city", declaredType: null, declaredEnum: null },
    ]);
  });

  it("타입을 어긴 입력 + isError true 는 TYPE_VIOLATION 을 덮는다", () => {
    const covered = matchCoveredAxes({ testCase: callCase("type", { city: 0 }, true), tool: weather });
    expect(covered.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toEqual(["TYPE_VIOLATION:city"]);
  });

  it("isError 단언이 없으면 빈 배열이다", () => {
    const testCase: TestCaseSpec = {
      id: "no-iserror",
      name: "no-iserror",
      operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "object" } }],
    };
    expect(matchCoveredAxes({ testCase, tool: weather })).toEqual([]);
  });

  it("isError expected 가 서로 다른 단언이 둘 있으면 빈 배열이다", () => {
    const testCase: TestCaseSpec = {
      id: "contradiction",
      name: "contradiction",
      operation: { type: "callTool", tool: "get_weather", input: {} },
      assertions: [
        { type: "isError", expected: true },
        { type: "isError", expected: false },
      ],
    };
    expect(matchCoveredAxes({ testCase, tool: weather })).toEqual([]);
  });

  it("checkInputContract 가 침묵하는 케이스에서도 축을 낸다", () => {
    const testCase = callCase("miss", {}, true);
    const suite = { schemaVersion: 1 as const, id: "s", name: "s", defaultTimeoutMs: 1000, cases: [testCase] };
    expect(checkInputContract({ suite, tools: [weather] }).findings).toEqual([]);
    expect(matchCoveredAxes({ testCase, tool: weather })).toHaveLength(1);
  });
});
```

마지막 테스트가 이 태스크의 핵심이다. T4 를 먼저 하면 이 테스트가 T4 없이도 의미를 갖지만, T4 가
아직 없는 상태에서는 `findings` 가 1건이라 실패한다. **그러므로 이 테스트만 T4 에서 활성화한다.**
T3 에서는 `it.todo` 로 남기고 T4 의 Step 에서 켠다. 나머지 테스트는 T3 에서 전부 통과해야 한다.

나머지 케이스는 설계서 §10.1 의 `matchCoveredAxes` 블록 전량이다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm vitest run packages/runner/tests/contract-axes.test.ts -t matchCoveredAxes`
Expected: FAIL. `matchCoveredAxes is not a function`

- [ ] **Step 3: 최소 구현**

```ts
/** 입력이 선언을 어긴 지점을 축으로 바꾼다. §4.4 순서로 낸다. */
function violatedAxes(
  tool: ToolDef,
  schema: NormalizedInputSchema,
  input: Record<string, unknown>,
): ContractAxis[] {
  const axes: ContractAxis[] = [];
  for (const name of [...schema.required].sort(byCodeUnit))
    if (!Object.hasOwn(input, name))
      axes.push({ kind: "REQUIRED_OMITTED", tool: tool.name, field: name, declaredType: null, declaredEnum: null });
  const typeAxes: ContractAxis[] = [];
  const enumAxes: ContractAxis[] = [];
  for (const [name, field] of schema.fields) {
    if (!Object.hasOwn(input, name)) continue;
    const code = judgeField(field, input[name] as JsonValue);
    // judgeField 는 타입 위반이면 enum 을 보지 않는다. 그래서 한 케이스가 같은 필드의 타입 축과
    // enum 축을 동시에 덮지 않는다. 우리 생성기도 케이스를 따로 만든다.
    if (code === "TYPE_MISMATCH")
      typeAxes.push({ kind: "TYPE_VIOLATION", tool: tool.name, field: name, declaredType: field.type, declaredEnum: null });
    else if (code === "ENUM_MISMATCH")
      enumAxes.push({ kind: "ENUM_VIOLATION", tool: tool.name, field: name, declaredType: null, declaredEnum: [...(field.enumValues ?? [])] });
  }
  return [...axes, ...typeAxes, ...enumAxes];
}

export function matchCoveredAxes(options: {
  readonly testCase: TestCaseSpec;
  readonly tool: ToolDef;
}): readonly ContractAxis[] {
  const { testCase, tool } = options;
  if (testCase.operation.type !== "callTool") return [];
  if (testCase.operation.tool !== tool.name) return [];
  const expected = expectedIsError(testCase);
  if (expected === null) return [];
  const analysis = analyzeInputSchema(tool.inputSchema);
  if (analysis.schema === null) return [];
  const input = testCase.operation.input;
  if (!plainObject(input)) return [];
  const violated = violatedAxes(tool, analysis.schema, input);
  if (expected === false)
    return violated.length === 0
      ? [{ kind: "HAPPY_PATH", tool: tool.name, field: null, declaredType: null, declaredEnum: null }]
      : [];
  return violated;
}
```

`deriveContractAxes` 와 축 객체를 만드는 코드가 두 곳에 생긴다. 지역 헬퍼로 합치되 **`tool` 을
인자로 받는 형태**로 둔다. 모듈 수준 클로저로 만들면 두 함수가 서로의 상태를 보게 된다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run packages/runner/tests/contract-axes.test.ts`
Expected: PASS. `it.todo` 하나가 남아 있는 것은 정상이다(T4 에서 켠다)

- [ ] **Step 5: `index.ts` 에 export 추가**

`export { ..., matchCoveredAxes } from "./contract-axes.js";`

- [ ] **Step 6: 회귀와 정적 검사, 보고서**

Run: `pnpm vitest run packages/runner`, `pnpm typecheck --force`, `pnpm lint`
보고서: `docs/reports/task-t3-contract-axes.md`
커밋 제안: `feat(runner): 케이스가 덮는 계약 축을 판정한다`

---

## Task 4: 거절 기대 케이스를 입력 계약 대조에서 제외

**Files**
- Modify: `packages/runner/src/input-contract.ts`
- Modify: `packages/runner/tests/input-contract.test.ts`
- Modify: `packages/runner/tests/contract-axes.test.ts` (`it.todo` 활성화)
- Create: `docs/adr/0021-거절-기대-케이스의-입력-계약-대조-제외.md`

**Interfaces**
- Consumes: T1 의 `expectedIsError`
- Produces: 행위 변화. `checkInputContract` 가 `isError expected true` 케이스에서 네 코드를 내지
  않는다. T7 의 커버리지가 이 침묵과 공존해야 한다

**이 태스크가 상위 모델인 이유.** 검사 대상의 경계를 좁히는 결정이다. 잘못 넓히면 진짜 오타를
영구 미탐으로 만들고, 좁히지 않으면 모든 사용자가 매 실행마다 거짓 경고를 본다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe("거절 기대 케이스 제외", () => {
  const rejecting = (input: Record<string, unknown>): TestSuiteSpec => ({
    schemaVersion: 1,
    id: "s",
    name: "s",
    defaultTimeoutMs: 1000,
    cases: [
      {
        id: "reject",
        name: "reject",
        operation: { type: "callTool", tool: "get_weather", input },
        assertions: [{ type: "isError", expected: true }],
      },
    ],
  });

  it("isError true 케이스는 REQUIRED_MISSING 을 내지 않는다", () => {
    const result = checkInputContract({ suite: rejecting({}), tools: [weather] });
    expect(result.findings).toEqual([]);
    expect(result.totalFindings).toBe(0);
  });

  it("isError true 케이스는 TYPE_MISMATCH 를 내지 않는다", () => {
    expect(checkInputContract({ suite: rejecting({ city: 0 }), tools: [weather] }).findings).toEqual([]);
  });

  it("isError true 케이스도 TOOL_NOT_DECLARED 는 낸다", () => {
    const suite = rejecting({ city: "서울" });
    const result = checkInputContract({ suite, tools: [tool("other", { type: "object", properties: {} })] });
    expect(result.findings.map((finding) => finding.code)).toEqual(["TOOL_NOT_DECLARED"]);
  });

  it("isError true 케이스도 SCHEMA_NOT_ANALYZABLE 은 낸다", () => {
    const result = checkInputContract({
      suite: rejecting({ city: "서울" }),
      tools: [tool("get_weather", { anyOf: [{ type: "object" }] })],
    });
    expect(result.findings.map((finding) => finding.code)).toEqual(["SCHEMA_NOT_ANALYZABLE"]);
  });

  it("isError false 케이스는 기존과 같이 전부 낸다", () => {
    const suite: TestSuiteSpec = {
      ...rejecting({}),
      cases: [{ ...rejecting({}).cases[0], assertions: [{ type: "isError", expected: false }] } as never],
    };
    expect(checkInputContract({ suite, tools: [weather] }).findings.map((f) => f.code)).toEqual([
      "REQUIRED_MISSING",
    ]);
  });

  it("expected 가 서로 다른 isError 단언이 둘이면 전부 낸다", () => {
    const suite: TestSuiteSpec = {
      ...rejecting({}),
      cases: [
        {
          ...rejecting({}).cases[0],
          assertions: [
            { type: "isError", expected: true },
            { type: "isError", expected: false },
          ],
        } as never,
      ],
    };
    expect(checkInputContract({ suite, tools: [weather] }).findings.map((f) => f.code)).toEqual([
      "REQUIRED_MISSING",
    ]);
  });
});
```

설계서 §10.3 의 목록 전량을 옮긴다. 마지막 항목("`buildViolationCases` 가 만든 케이스 전량을
넣으면 finding 이 0건")은 §5.5 표의 케이스 8개를 **리터럴로** 적어서 검증한다. `generate` 를
import 하지 않는다. 의존 방향이 뒤집힌다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm vitest run packages/runner/tests/input-contract.test.ts -t "거절 기대"`
Expected: FAIL. `REQUIRED_MISSING` 이 1건 나온다

- [ ] **Step 3: 최소 구현**

`checkInputContract` 의 케이스 루프에서 `caseFindings` 를 만든 뒤, 정렬·절단·합산 **전에** 걸러낸다.

```ts
/**
 * 거절을 기대하는 케이스에서 침묵시키는 코드. ADR-0021.
 *
 * 그 케이스는 선언을 어긴 입력을 보내는 것이 목적이다. 어긴 사실을 위반으로 신고하면 도구가
 * 스스로 만든 케이스를 스스로 고발한다.
 *
 * TOOL_NOT_DECLARED 는 빼지 않는다. 서버가 모르는 툴 이름은 거절 기대와 무관하게 오타다.
 * SCHEMA_NOT_ANALYZABLE 도 빼지 않는다. 위반이 아니라 "검사를 못 했다" 는 보고이고, 삼키면
 * "검사했는데 깨끗함" 과 구분되지 않는다.
 */
const SUPPRESSED_WHEN_REJECTION_EXPECTED: ReadonlySet<SpecFindingCode> = new Set([
  "REQUIRED_MISSING",
  "UNDECLARED_FIELD",
  "TYPE_MISMATCH",
  "ENUM_MISMATCH",
]);
```

루프 안에서:

```ts
// expectedIsError 가 null 이면(모순된 명세) 침묵시키지 않는다. 모순을 숨기지 않는다.
const kept =
  expectedIsError(testCase) === true
    ? caseFindings.filter((finding) => !SUPPRESSED_WHEN_REJECTION_EXPECTED.has(finding.code))
    : caseFindings;

kept.sort(...);              // 기존 정렬을 kept 에 적용
totalFindings += kept.length; // 자르기 전 개수는 침묵 후 개수다
findings.push(...kept.slice(0, MAX_FINDINGS_PER_CASE));
```

`totalFindings` 를 침묵 **후** 개수로 세는 것이 요점이다. 침묵시킨 것을 총합에 남기면 소비자가
"위반 6건이 있는데 목록은 비어 있다" 를 보고 버그로 읽는다.

- [ ] **Step 4: 테스트 통과 확인과 `it.todo` 활성화**

Run: `pnpm vitest run packages/runner/tests/input-contract.test.ts`
Expected: PASS
T3 에서 `it.todo` 로 남긴 "checkInputContract 가 침묵하는 케이스에서도 축을 낸다" 를 `it` 으로
바꾼다.
Run: `pnpm vitest run packages/runner/tests/contract-axes.test.ts`
Expected: PASS, todo 0개

- [ ] **Step 5: ADR-0021 을 쓴다**

`docs/adr/` 의 형식(상태·날짜·담당·작성자·참조 / 배경 / 선택지 / 결정 / 이유 / 결과)을 따른다.
착수 시점에 `docs/adr/` 을 다시 읽어 0021 이 비어 있는지 확인한다(0016 번호 충돌 전례가 있다).
내용은 설계서 §11.1 의 선택지 A~D 와 결정·이유를 옮긴다. 상태는 `제안`.

- [ ] **Step 6: 회귀와 정적 검사, 보고서**

Run: `pnpm vitest run packages/runner`, `pnpm typecheck --force`, `pnpm lint`
보고서: `docs/reports/task-t4-contract-axes.md`
커밋 제안: `fix(runner): 거절 기대 케이스를 입력 계약 대조에서 제외한다`

---

## Task 5: `fieldSlug`

**Files**
- Modify: `packages/generate/src/filename.ts`
- Test: `packages/generate/tests/filename.test.ts` (신규. 기존에 이 파일의 단독 테스트가 없다)

**Interfaces**
- Produces: `fieldSlug(name: string): string`. T6 이 케이스 id 를 만들 때 쓴다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { describe, expect, it } from "vitest";
import { fieldSlug, safeBaseName } from "../src/filename.js";

describe("fieldSlug", () => {
  it("영숫자 이름은 그대로 소문자 슬러그다", () => {
    expect(fieldSlug("city")).toBe("city");
    expect(fieldSlug("maxResults")).toBe("maxresults");
  });
  it("비영숫자는 하이픈이 된다", () => {
    expect(fieldSlug("a_b")).toBe("a-b");
    expect(fieldSlug("a.b")).toBe("a-b");
  });
  it("슬러그가 비면 field- 접두사와 해시를 쓴다", () => {
    expect(fieldSlug("한국어")).toMatch(/^field-[0-9a-f]{8}$/);
  });
  it("같은 이름은 항상 같은 슬러그다", () => {
    expect(fieldSlug("한국어")).toBe(fieldSlug("한국어"));
  });
  it("Windows 예약어를 피하지 않는다. 케이스 id 는 파일 이름이 아니다", () => {
    expect(fieldSlug("con")).toBe("con");
    expect(safeBaseName("con", 0)).toMatch(/^tool-[0-9a-f]{8}$/);
  });
});
```

마지막 테스트가 `safeBaseName` 과의 차이를 고정한다. 두 함수가 같은 슬러그 규칙을 공유하면서
fallback 만 다르다는 사실이 코드로 남는다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/generate/tests/filename.test.ts`
Expected: FAIL. `fieldSlug is not a function`

- [ ] **Step 3: 최소 구현**

```ts
/** 슬러그 규칙 본체. safeBaseName 과 fieldSlug 가 공유한다. 규칙이 갈리면 id 가 갈린다. */
function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/**
 * 필드 이름을 케이스 id 조각으로 바꾼다.
 *
 * safeBaseName 과 fallback 이 다르다. 그쪽은 파일 기본 이름이라 `tool-<hash>` 로 떨어지고
 * Windows 예약어를 피해야 한다. 케이스 id 는 파일 이름이 아니므로 예약어를 피할 이유가 없고,
 * fallback 이 `tool-` 이면 이름이 거짓이 된다.
 */
export function fieldSlug(name: string): string {
  const slug = slugify(name);
  return slug.length === 0
    ? `field-${createHash("sha256").update(name.normalize("NFC")).digest("hex").slice(0, 8)}`
    : slug;
}
```

`safeBaseName` 은 본문을 `slugify(name)` 호출로 바꾼다. 정규식을 두 벌 두지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run packages/generate/tests/filename.test.ts`
Expected: PASS
Run: `pnpm vitest run packages/generate`
Expected: PASS. `safeBaseName` 을 쓰는 기존 테스트가 그대로 통과해야 한다

- [ ] **Step 5: 보고서**

보고서: `docs/reports/task-t5-contract-axes.md`
커밋 제안: `refactor(generate): 슬러그 규칙을 공유하고 fieldSlug 를 추가한다`

---

## Task 6: `buildViolationCases`

**Files**
- Create: `packages/generate/src/violation-cases.ts`
- Modify: `packages/generate/src/render.ts` (케이스 타입을 `GeneratedCase` 로 승격, export)
- Modify: `packages/generate/src/index.ts` (export 추가)
- Test: `packages/generate/tests/violation-cases.test.ts` (신규)

**Interfaces**
- Consumes: `runner` 의 `deriveContractAxes`·`ContractAxis`·`ContractAxisKind`, T5 의 `fieldSlug`
- Produces: `buildViolationCases({ tool, happyInput, baseName }): readonly GeneratedCase[]`,
  `GeneratedCase`. T7·T8 이 쓴다

**이 태스크가 상위 모델인 이유.** 위반값 선택이 결정론성 계약이다. 값이 흔들리면 같은 서버에서
매번 다른 지문이 나오고, 승인 지문(단계 8)이 무의미해진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`fixtures/tools-list.sample.json` 을 읽어 설계서 §5.5 표를 그대로 단언한다. 픽스처 경로는
`baseline.test.ts` 가 이미 쓰는 방식(`readFileSync`)을 따른다.

```ts
it("get_weather 로 위반 케이스 2개가 나온다", () => {
  expect(
    buildViolationCases({ tool: weather, happyInput: { city: "example" }, baseName: "get-weather" }),
  ).toEqual([
    {
      id: "get-weather-missing-city",
      name: "get_weather가 필수 필드 'city' 누락을 거절한다",
      operation: { type: "callTool", tool: "get_weather", input: {} },
      assertions: [{ type: "isError", expected: true }],
    },
    {
      id: "get-weather-type-city",
      name: "get_weather가 'city' 타입 위반을 거절한다",
      operation: { type: "callTool", tool: "get_weather", input: { city: 0 } },
      assertions: [{ type: "isError", expected: true }],
    },
  ]);
});

it("add 로 위반 케이스 4개가 나온다", () => {
  const cases = buildViolationCases({ tool: add, happyInput: { a: 0, b: 0 }, baseName: "add" });
  expect(cases.map((item) => item.id)).toEqual([
    "add-missing-a",
    "add-missing-b",
    "add-type-a",
    "add-type-b",
  ]);
  expect(cases.map((item) => item.operation.input)).toEqual([
    { b: 0 },
    { a: 0 },
    { a: "example", b: 0 },
    { a: 0, b: "example" },
  ]);
});

it("integer 필드의 타입 위반값은 1.5 다", () => {
  const cases = buildViolationCases({
    tool: tool("t", { type: "object", properties: { n: { type: "integer" } } }),
    happyInput: {},
    baseName: "t",
  });
  expect(cases).toEqual([
    {
      id: "t-type-n",
      name: "t가 'n' 타입 위반을 거절한다",
      operation: { type: "callTool", tool: "t", input: { n: 1.5 } },
      assertions: [{ type: "isError", expected: true }],
    },
  ]);
});

it("문자열 enum 의 위반값은 __ohmymcp_invalid_enum__ 이다", () => {
  const cases = buildViolationCases({
    tool: tool("t", { type: "object", properties: { u: { type: "string", enum: ["c", "f"] } } }),
    happyInput: { u: "c" },
    baseName: "t",
  });
  expect(cases.map((item) => [item.id, item.operation.input])).toEqual([
    ["t-type-u", { u: 0 }],
    ["t-enum-u", { u: "__ohmymcp_invalid_enum__" }],
  ]);
});

it("enum 에 예약 문자열이 있으면 접미사를 붙인다", () => {
  const cases = buildViolationCases({
    tool: tool("t", {
      type: "object",
      properties: { u: { type: "string", enum: ["__ohmymcp_invalid_enum__"] } },
    }),
    happyInput: { u: "__ohmymcp_invalid_enum__" },
    baseName: "t",
  });
  expect(cases[1]?.operation.input).toEqual({ u: "__ohmymcp_invalid_enum___2" });
});

it("숫자 enum 의 위반값은 최댓값 + 1 이다", () => {
  const cases = buildViolationCases({
    tool: tool("t", { type: "object", properties: { n: { type: "number", enum: [1, 2] } } }),
    happyInput: { n: 1 },
    baseName: "t",
  });
  expect(cases[1]?.operation.input).toEqual({ n: 3 });
});

it("숫자 enum 의 최댓값이 안전 정수 경계면 문자열 규칙으로 넘어간다", () => {
  const cases = buildViolationCases({
    tool: tool("t", {
      type: "object",
      properties: { n: { type: "number", enum: [Number.MAX_SAFE_INTEGER] } },
    }),
    happyInput: { n: Number.MAX_SAFE_INTEGER },
    baseName: "t",
  });
  expect(cases[1]?.operation.input).toEqual({ n: "__ohmymcp_invalid_enum__" });
});

it("슬러그가 충돌하면 -2 가 붙는다", () => {
  const cases = buildViolationCases({
    tool: tool("t", { type: "object", properties: { "a-b": { type: "string" }, a_b: { type: "string" } } }),
    happyInput: {},
    baseName: "t",
  });
  expect(cases.map((item) => item.id)).toEqual(["t-type-a-b", "t-type-a-b-2"]);
});

it("해석 불가 툴은 위반 케이스가 0개다", () => {
  expect(
    buildViolationCases({ tool: tool("t", { anyOf: [{ type: "object" }] }), happyInput: {}, baseName: "t" }),
  ).toEqual([]);
});

it("두 번 호출한 결과가 동일하다", () => {
  const once = buildViolationCases({ tool: add, happyInput: { a: 0, b: 0 }, baseName: "add" });
  const twice = buildViolationCases({ tool: add, happyInput: { a: 0, b: 0 }, baseName: "add" });
  expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
});
```

`a-b` 와 `a_b` 의 순회 순서는 `deriveContractAxes` 가 `byCodeUnit` 으로 정렬해 넘긴 순서다.
`"a-b" < "a_b"` (하이픈 0x2D < 밑줄 0x5F)이므로 `a-b` 가 먼저이고 `-2` 는 `a_b` 에 붙는다.

나머지 케이스는 설계서 §10.2 전량이다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/generate/tests/violation-cases.test.ts`
Expected: FAIL. `buildViolationCases is not a function`

- [ ] **Step 3: 위반값 규칙을 구현한다**

```ts
/**
 * enum 위반값에 쓰는 예약 문자열. 어떤 서버도 이것을 유효한 값으로 선언하지 않을 것을 노린
 * 이름이고, 그래도 겹치면 접미사를 붙여 피한다.
 */
const INVALID_ENUM_VALUE = "__ohmymcp_invalid_enum__";

/**
 * 선언 type 을 어기는 값. 표로 고정한다. 값이 흔들리면 지문이 흔들린다.
 *
 * integer 만 1.5 다. "example" 을 넣으면 `typeof value === "number"` 검사만 있는 서버도
 * 잡히지만, 1.5 는 그 검사를 통과하고 정수 검사가 없는 것까지 잡는다. 더 예리한 위반이다.
 */
const TYPE_VIOLATION_VALUE: Readonly<Record<ContractDeclaredType, JsonValue>> = {
  string: 0,
  number: "example",
  integer: 1.5,
  boolean: "example",
  object: "example",
  array: "example",
  null: "example",
};

/**
 * 선언 enum 밖 값. 선언 type 이 수 계열이면 타입까지 지킨 값을 고르려 최댓값 + 1 을 쓴다.
 * 안전 정수 경계를 넘으면 그 값이 정확히 표현되지 않아 "enum 밖" 이 보장되지 않으므로
 * 문자열 규칙으로 떨어진다.
 */
function enumViolationValue(axis: ContractAxis): JsonValue {
  const allowed = axis.declaredEnum ?? [];
  if (axis.declaredType === "number" || axis.declaredType === "integer") {
    const numbers = allowed.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (numbers.length > 0) {
      const next = Math.max(...numbers) + 1;
      if (Number.isSafeInteger(next)) return next;
    }
  }
  let candidate = INVALID_ENUM_VALUE;
  for (let suffix = 2; allowed.includes(candidate); suffix++)
    candidate = `${INVALID_ENUM_VALUE}_${suffix}`;
  return candidate;
}
```

`enumViolationValue` 가 `axis.declaredType` 을 보는데 `ENUM_VIOLATION` 축의 `declaredType` 은
`null` 이다(설계서 §3.2). 그래서 **`buildViolationCases` 는 축 목록을 필드 이름으로 다시 묶어
같은 필드의 `TYPE_VIOLATION` 축에서 `declaredType` 을 가져온다.** 축 객체를 바꾸지 않는다.
`ContractAxis` 는 `runner` 공개 타입이고 여기서 의미를 늘리면 두 패키지가 다른 뜻으로 읽는다.

- [ ] **Step 4: 케이스 합성을 구현한다**

```ts
export function buildViolationCases(options: {
  readonly tool: ToolDef;
  readonly happyInput: JsonObject;
  readonly baseName: string;
}): readonly GeneratedCase[] {
  const { tool, happyInput, baseName } = options;
  const { axes } = deriveContractAxes(tool);
  const declaredTypeByField = new Map<string, ContractDeclaredType>();
  for (const axis of axes)
    if (axis.kind === "TYPE_VIOLATION" && axis.field !== null && axis.declaredType !== null)
      declaredTypeByField.set(axis.field, axis.declaredType);

  const usedIds = new Set<string>();
  const uniqueId = (prefix: string, field: string): string => {
    const initial = `${baseName}-${prefix}-${fieldSlug(field)}`;
    let id = initial;
    for (let occurrence = 2; usedIds.has(id); occurrence++) id = `${initial}-${occurrence}`;
    usedIds.add(id);
    return id;
  };
  const violation = (id: string, name: string, input: JsonObject): GeneratedCase => ({
    id,
    name,
    operation: { type: "callTool", tool: tool.name, input },
    assertions: [{ type: "isError", expected: true }],
  });

  const cases: GeneratedCase[] = [];
  for (const axis of axes) {
    const field = axis.field;
    if (field === null) continue; // HAPPY_PATH 는 render.ts 가 만든다
    if (axis.kind === "REQUIRED_OMITTED") {
      // 정상 입력에 그 키가 없으면 뺄 것이 없다. 그대로 만들면 정상 케이스와 입력이 같은데
      // 단언만 isError: true 인 케이스가 되어 항상 실패한다. 서버가 옳은데 우리가 틀린 것이다.
      // 이 축은 케이스 없이 남고 커버리지가 미검증으로 보고한다. 그것이 정직한 상태다.
      //
      // 이 상황은 required 에 있지만 properties 에 없는 필드에서 나온다. generate 의
      // validateSchema 는 그런 스키마를 거부하지만(schema.ts 의 required 검사) runner 의 축
      // 도출은 허용하므로 손으로 쓴 명세나 AI 경로에서 도달할 수 있다.
      if (!Object.hasOwn(happyInput, field)) continue;
      const input = { ...happyInput };
      delete input[field];
      cases.push(
        violation(
          uniqueId("missing", field),
          `${tool.name}가 필수 필드 '${field}' 누락을 거절한다`,
          input,
        ),
      );
    } else if (axis.kind === "TYPE_VIOLATION") {
      const value = TYPE_VIOLATION_VALUE[axis.declaredType as ContractDeclaredType];
      cases.push(
        violation(uniqueId("type", field), `${tool.name}가 '${field}' 타입 위반을 거절한다`, {
          ...happyInput,
          [field]: value,
        }),
      );
    } else if (axis.kind === "ENUM_VIOLATION") {
      const value = enumViolationValue({
        ...axis,
        declaredType: declaredTypeByField.get(field) ?? null,
      });
      cases.push(
        violation(
          uniqueId("enum", field),
          `${tool.name}가 '${field}' 의 선언되지 않은 값을 거절한다`,
          { ...happyInput, [field]: value },
        ),
      );
    }
  }
  return cases;
}
```

`axes` 순서가 그대로 케이스 순서다. `deriveContractAxes` 가 §4.4 로 정렬해 주므로 여기서 다시
정렬하지 않는다. 케이스 이름의 조사 형식은 설계서 §5.6 의 결정을 따른다(기존
`${tool.name}가 오류 없이 응답한다` 와 통일).

- [ ] **Step 5: `GeneratedCase` 를 `render.ts` 에서 승격시킨다**

`render.ts` 의 지역 타입 `GeneratedSuiteSpec` 의 `cases` 원소를 `violation-cases.ts` 의
`GeneratedCase` 로 바꾼다. 설계서 §3.2 의 정의(`expected: true | false` 를 리터럴 유니온으로 두고
`boolean` 으로 넓히지 않는다)를 그대로 쓴다. `buildGeneratedCase` 의 반환 타입도 `GeneratedCase`
가 된다.

- [ ] **Step 6: 통과 확인**

Run: `pnpm vitest run packages/generate/tests/violation-cases.test.ts`
Expected: PASS
Run: `pnpm vitest run packages/generate`
Expected: PASS. baseline 출력은 아직 안 바뀌었으므로 기존 테스트가 전부 통과해야 한다

- [ ] **Step 7: `index.ts` export 와 보고서**

```ts
export { buildViolationCases, type GeneratedCase } from "./violation-cases.js";
```

보고서: `docs/reports/task-t6-contract-axes.md`
커밋 제안: `feat(generate): 선언을 어긴 입력 케이스를 합성한다`

---

## Task 7: `computeCoverage`

**Files**
- Create: `packages/generate/src/coverage.ts`
- Modify: `packages/generate/src/index.ts` (export 추가)
- Test: `packages/generate/tests/coverage.test.ts` (신규)

**Interfaces**
- Consumes: `runner` 의 `deriveContractAxes`·`matchCoveredAxes`·`ContractAxis`·`ContractAxisKind`,
  T6 의 `buildViolationCases`(테스트에서만)
- Produces: `computeCoverage({ suite, tools }): CoverageResult`, `CoverageResult`·`ToolCoverage`·
  `AxisCoverage`. T8·T9 가 쓴다. 전량 시그니처는 설계서 §3.2

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it("§5.5 의 8케이스 스위트는 verified 와 total 이 8 로 같다", () => {
  const suite = suiteOf([weather, add]); // T6 의 buildViolationCases + 정상 케이스로 조립
  const coverage = computeCoverage({ suite, tools: [weather, add] });
  expect(coverage.verified).toBe(8);
  expect(coverage.total).toBe(8);
});

it("REQUIRED_OMITTED 케이스를 지우면 그 축의 caseId 가 null 이고 verified 가 1 줄어든다", () => {
  const full = suiteOf([weather, add]);
  const suite = { ...full, cases: full.cases.filter((item) => item.id !== "add-missing-b") };
  const coverage = computeCoverage({ suite, tools: [weather, add] });
  expect(coverage.verified).toBe(7);
  expect(coverage.total).toBe(8);
  const addCoverage = coverage.tools.find((item) => item.tool === "add");
  expect(addCoverage?.axes.find((axis) => axis.field === "b" && axis.kind === "REQUIRED_OMITTED")?.caseId).toBeNull();
});

it("손으로 쓴 이름의 케이스도 입력 내용으로 축이 잡힌다", () => {
  const suite: TestSuiteSpec = {
    schemaVersion: 1,
    id: "s",
    name: "s",
    defaultTimeoutMs: 1000,
    cases: [
      {
        id: "내가-쓴-케이스",
        name: "내가 쓴 케이스",
        operation: { type: "callTool", tool: "get_weather", input: {} },
        assertions: [{ type: "isError", expected: true }],
      },
    ],
  };
  const coverage = computeCoverage({ suite, tools: [weather] });
  expect(
    coverage.tools[0]?.axes.find((axis) => axis.kind === "REQUIRED_OMITTED")?.caseId,
  ).toBe("내가-쓴-케이스");
});

it("같은 축을 두 케이스가 덮으면 suite.cases 순서상 첫 케이스가 실린다", () => { /* 설계서 §6.2 */ });
it("해석 불가 툴은 total 0, verified 0, axes 빈 배열이고 사유가 실린다", () => { /* §6.4 */ });
it("중복 선언된 툴은 analyzable false 이고 사유가 duplicateTool 이다", () => { /* §4.2 */ });
it("tools 배열 순서를 뒤집어도 결과가 동일하다", () => { /* §8.1 */ });
it("tools 가 툴 이름 코드 단위 오름차순이다", () => { /* §3.2 */ });
it("명세에 있지만 서버가 선언하지 않은 툴은 결과에 없다", () => { /* §10.4 */ });
```

`it` 본문이 주석만 남은 항목은 설계서 §10.4 의 해당 줄을 읽고 채운다. 목록 전량이 그곳에 있다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/generate/tests/coverage.test.ts`
Expected: FAIL. `computeCoverage is not a function`

- [ ] **Step 3: 최소 구현**

```ts
export function computeCoverage(options: {
  readonly suite: TestSuiteSpec;
  readonly tools: readonly ToolDef[];
}): CoverageResult {
  const { suite, tools } = options;
  // 이름으로만 조회한다. 배열 순서가 결과를 바꾸지 않아야 한다.
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) duplicated.add(tool.name);
    seen.add(tool.name);
  }
  const declared = new Map<string, ToolDef>();
  for (const tool of tools) if (!declared.has(tool.name)) declared.set(tool.name, tool);

  const toolCoverages: ToolCoverage[] = [];
  for (const name of [...declared.keys()].sort(byCodeUnit)) {
    const tool = declared.get(name) as ToolDef;
    const derived = deriveContractAxes(tool, { duplicated: duplicated.has(name) });
    // 축 키는 kind 와 field 쌍이다. 같은 툴 안에서 유일하다(설계서 §3.2).
    const coveredBy = new Map<string, string>();
    for (const testCase of suite.cases)
      for (const axis of matchCoveredAxes({ testCase, tool })) {
        const key = `${axis.kind} ${axis.field ?? ""}`;
        // 첫 케이스만 남긴다. suite.cases 순서를 쓰므로 결정론적이다.
        if (!coveredBy.has(key)) coveredBy.set(key, testCase.id);
      }
    const axes: AxisCoverage[] = derived.axes.map((axis) => ({
      kind: axis.kind,
      field: axis.field,
      caseId: coveredBy.get(`${axis.kind} ${axis.field ?? ""}`) ?? null,
    }));
    toolCoverages.push({
      tool: name,
      analyzable: derived.analyzable,
      unanalyzableReason: derived.unanalyzableReason,
      axes,
      verified: axes.filter((axis) => axis.caseId !== null).length,
      total: axes.length,
      unanalyzedFields: derived.unanalyzedFields,
    });
  }
  return {
    tools: toolCoverages,
    verified: toolCoverages.reduce((sum, item) => sum + item.verified, 0),
    total: toolCoverages.reduce((sum, item) => sum + item.total, 0),
  };
}
```

`byCodeUnit` 은 `runner` 내부 전용이라 `generate` 가 import 할 수 없다. `coverage.ts` 안에 같은
비교자를 지역 상수로 둔다. **이것은 의도된 중복이다.** 대안은 `runner` 가 `byCodeUnit` 을 공개
API 로 내보내는 것인데, 세 글자 함수를 위해 승인 심볼 목록을 넓히고 공개 표면을 늘리는 것이 더
비싸다. 사본에 그 사유를 주석으로 적는다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run packages/generate/tests/coverage.test.ts`
Expected: PASS

- [ ] **Step 5: `index.ts` export 와 보고서**

```ts
export {
  type AxisCoverage,
  computeCoverage,
  type CoverageResult,
  type ToolCoverage,
} from "./coverage.js";
```

보고서: `docs/reports/task-t7-contract-axes.md`
커밋 제안: `feat(generate): 계약 축 커버리지를 계산한다`

---

## Task 8: `render`·`baseline` 배선

**Files**
- Modify: `packages/generate/src/render.ts`
- Modify: `packages/generate/src/baseline.ts`
- Test: `packages/generate/tests/baseline.test.ts`
- Test: `packages/generate/tests/index.test.ts` (생성 파일 스냅샷이 있으면 갱신)

**Interfaces**
- Consumes: T6 의 `buildViolationCases`, T7 의 `computeCoverage`
- Produces: `createBaselineSuite` 결과에 `coverage` 필드. 툴당 케이스가 1개에서 `1 + 위반 수` 로
  늘어난다. `BASELINE_POLICY_VERSION` 이 `"schema-baseline-v2"` 가 된다

**여기서 처음으로 사용자에게 보이는 출력이 바뀐다.** T5~T7 은 아무것도 바꾸지 않았다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it("fixtures 두 툴로 만든 baseline 은 케이스 8개다", () => {
  const tools = JSON.parse(readFileSync(fixturePath, "utf8")).tools as ToolDef[];
  const result = createBaselineSuite(tools, { suiteId: "weather", suiteName: "Weather" });
  expect(result.suite.cases.map((item) => item.id)).toEqual([
    "get-weather-success",
    "get-weather-missing-city",
    "get-weather-type-city",
    "add-success",
    "add-missing-a",
    "add-missing-b",
    "add-type-a",
    "add-type-b",
  ]);
});

it("정책 버전이 v2 다", () => {
  expect(BASELINE_POLICY_VERSION).toBe("schema-baseline-v2");
});

it("baseline 결과에 커버리지가 실리고 전부 검증된다", () => {
  const tools = JSON.parse(readFileSync(fixturePath, "utf8")).tools as ToolDef[];
  const result = createBaselineSuite(tools, { suiteId: "weather", suiteName: "Weather" });
  expect(result.coverage.verified).toBe(result.coverage.total);
  expect(result.coverage.total).toBe(8);
});

it("생성한 suite 가 validateMcpSuite 를 통과한다", () => {
  const tools = JSON.parse(readFileSync(fixturePath, "utf8")).tools as ToolDef[];
  const result = createBaselineSuite(tools, { suiteId: "weather", suiteName: "Weather" });
  expect(validateMcpSuite(result.suite).valid).toBe(true);
});

it("두 번 만든 suite 가 바이트로 같다", () => {
  const tools = JSON.parse(readFileSync(fixturePath, "utf8")).tools as ToolDef[];
  const options = { suiteId: "weather", suiteName: "Weather" };
  expect(JSON.stringify(createBaselineSuite(tools, options).suite)).toBe(
    JSON.stringify(createBaselineSuite(tools, options).suite),
  );
});
```

`validateMcpSuite` 통과 확인이 중요하다. 케이스 id 가 늘어나므로 `DUPLICATE_CASE_ID` 가 여기서
드러난다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/generate/tests/baseline.test.ts`
Expected: FAIL. 케이스가 2개다

- [ ] **Step 3: `render.ts` 가 위반 케이스를 함께 만든다**

`buildSuite` 의 `cases` 를 `[정상 케이스, ...buildViolationCases({ tool, happyInput: input, baseName })]`
로 바꾼다. `buildGeneratedCase` 는 이름을 `buildGeneratedCases`(복수)로 바꾸고 배열을 반환한다.
`baseline.ts` 의 `tools.map(...)` 은 `flatMap` 이 된다.

`renderTool` 이 만드는 파일에도 같은 케이스가 들어간다. `buildSuite` 하나만 쓰므로 자동이다.
설계 원칙("파일로 쓰는 suite 와 baseline suite 가 같은 case 를 만든다", `render.ts:90` 주석)이
유지된다.

- [ ] **Step 4: `baseline.ts` 에 정책 버전과 커버리지를 싣는다**

```ts
/**
 * 위반 케이스를 기본 생성하기 시작해 v2 로 올린다(ADR-0022). 이 값이 baselineFingerprint
 * 계산에 들어가므로 정책이 바뀐 사실이 지문에 남는다.
 */
export const BASELINE_POLICY_VERSION = "schema-baseline-v2" as const;
```

`createBaselineSuite` 의 반환에 `coverage: computeCoverage({ suite, tools })` 를 넣는다.
`deepFreeze` 대상 안에 포함된다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run packages/generate/tests/baseline.test.ts`
Expected: PASS
Run: `pnpm vitest run packages/generate`
Expected: PASS. 기존 스냅샷이 있으면 갱신하고, 갱신한 이유를 보고서에 적는다
Run: `pnpm typecheck --force`, `pnpm lint`
Expected: PASS

- [ ] **Step 6: 보고서**

보고서: `docs/reports/task-t8-contract-axes.md`. 갱신한 기존 기대값을 전부 나열한다
커밋 제안: `feat(generate): baseline 에 위반 케이스와 커버리지를 포함한다`

---

## Task 9: `cli` 화면과 실서버 E2E (직렬 전용)

**Files**
- Modify: `packages/cli/src/generate-command.ts`
- Modify: `packages/cli/src/index.ts` (의존성 주입 한 줄)
- Test: `packages/cli/tests/generate-command.test.ts`
- Test: `packages/cli/tests/generate-integration.test.ts`

**Interfaces**
- Consumes: T7 의 `computeCoverage`·`CoverageResult`·`ToolCoverage`·`AxisCoverage`
- Produces: 화면 출력. 반환값 계약 변화 없음. exit code 변화 없음

**이 태스크가 상위 모델이고 직렬 전용인 이유.** 화면 문안이 이 프로젝트의 제품이고, E2E 가
`examples/weather-server` 프로세스를 띄운다.

- [ ] **Step 1: 화면 렌더 함수의 테스트를 쓴다**

설계서 §7.1~§7.4 의 문안을 그대로 기대값으로 쓴다. `generate-command.test.ts` 에 이미 있는
`ReviewIO` 스텁 패턴을 따른다.

```
renderCoverage
  · 전부 검증되면 한 줄이다: "커버리지  2 tools, 8 axes 전부 검증"
  · 미검증이 있으면 툴별 줄이 나오고 미검증 축만 ? 로 들여쓴다
  · 전부 검증된 툴도 미검증 툴과 함께 한 줄로 나온다
  · 해석 불가 툴은 "해석 불가" 와 사유 괄호가 붙고 커버리지 숫자에서 빠진다
  · 해석 못 한 필드가 있으면 이름을 나열한 줄이 붙는다
  · 툴이 0개면 아무것도 찍지 않는다
  · 축이 0개인 툴만 있으면 "전부 검증" 이라고 쓰지 않는다 (0/0 은 검증이 아니다)

케이스 수 고지
  · 케이스가 1500개 미만이면 고지가 없다
  · 1500개 이상이면 두 줄 고지가 stdout 에 있다
  · 고지가 있어도 exit code 는 0 이다
```

마지막 항목("0/0 은 검증이 아니다")이 놓치기 쉬운 경계다. 모든 툴이 해석 불가면 `total` 이 0
이고 `verified === total` 이 참이 되어 "전부 검증" 이 찍힌다. 그 화면은 거짓이다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/cli/tests/generate-command.test.ts -t 커버리지`
Expected: FAIL

- [ ] **Step 3: 화면을 구현한다**

```ts
/**
 * runner 보고서 상한(1MB)에 닿기 전에 알리는 임계.
 *
 * 케이스당 보고서가 관측 범위에서 300~600 바이트다. 600 으로 계산해도 1500 케이스면 900KB 로
 * DEFAULT_MAX_REPORT_BYTES(1MB) 안에 들어간다. 그보다 크면 사용자가 조치할 시간이 필요하다.
 * 이 상한은 올릴 수 없다(resolvePayloadLimits 가 기본값을 최대치로 쓴다).
 */
const CASE_COUNT_WARNING_THRESHOLD = 1500;
```

`renderCoverage(coverage: CoverageResult): string` 은 순수 함수로 둔다. `io.write` 를 안에서
부르지 않는다. 테스트가 문자열을 직접 비교할 수 있어야 한다. 축 이름을 사람 문장으로 바꾸는
표(`REQUIRED_OMITTED` → `필수 필드 누락 거절`)도 이 파일 안에 `Record<ContractAxisKind, string>`
으로 둔다. **`Record` 로 두는 이유는 `runner` 가 축 종류를 늘리면 여기서 타입 오류가 나게 하는
것이다.** 문자열 배열로 두면 새 축이 화면에서 조용히 사라지고, 그 누락은 "검증했다" 로 읽힌다.
`FINDING_GROUP`(`generate-command.ts:375`)이 같은 이유로 같은 형태다.

- [ ] **Step 4: 두 경로에 배선한다**

`--baseline-only` 경로는 `baseline.coverage` 를 그대로 쓴다. 대화형 경로는 최종 suite 가
baseline 과 다르므로 저장 직전에 `computeCoverage({ suite: 최종 suite, tools })` 를 다시 부른다.
의존성은 `GenerateCommandDependencies` 에 선택 필드로 추가한다(기존 선택 의존성 패턴과 같다).

```ts
computeCoverage?: typeof import("@ohmymcp/generate").computeCoverage;
```

`packages/cli/src/index.ts` 의 실제 주입에 `computeCoverage: generate.computeCoverage` 한 줄을
넣는다. 런타임 의존성을 못 불러온 경로(`unavailableDependencies`)는 건드리지 않는다. 그 경로는
어차피 `connect` 에서 먼저 실패한다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run packages/cli/tests/generate-command.test.ts`
Expected: PASS

- [ ] **Step 6: 실서버 E2E 기대값을 갱신한다**

`examples/weather-server` 는 이미 입력을 검증한다(`server.mjs` 의
`typeof city !== "string"`, `typeof a !== "number" || typeof b !== "number"`). 그래서 위반
케이스 6개가 모두 통과한다. `get-weather-success` 는 `city: "example"` 이 `WEATHER` 에 없어
기존과 같은 이유로 실패한다.

```ts
expect(suite.cases).toHaveLength(8);
expect(report.summary).toEqual({
  total: 8,
  passed: 7,
  failed: 1,
  timedOut: 0,
  cancelled: 0,
  notRun: 0,
});
expect(report.cases.map((item: { status: string }) => item.status)).toEqual([
  "failed",   // get-weather-success  도메인 값 문제. 설계서 §2 비범위
  "passed",   // get-weather-missing-city
  "passed",   // get-weather-type-city
  "passed",   // add-success
  "passed",   // add-missing-a
  "passed",   // add-missing-b
  "passed",   // add-type-a
  "passed",   // add-type-b
]);
```

케이스 수 `8` 은 상수로 박지 않고 `deriveContractAxes` 로 계산한 수와도 비교한다. `examples`
서버 선언이 바뀔 때 "선언이 바뀌었다" 와 "생성이 깨졌다" 가 구분돼야 한다.

**`examples/**` 를 수정하지 않는다.** 이 태스크의 Files 목록에 없다. 위반 케이스가 실패하면
그 사실을 보고하고 멈춘다. 오케스트레이터가 판단한다.

- [ ] **Step 7: 통과 확인과 보고서**

Run: `pnpm vitest run packages/cli/tests/generate-integration.test.ts`
Expected: PASS. 서버 프로세스가 종료되는지(`exited(pidFile)`)까지 확인한다
Run: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
보고서: `docs/reports/task-t9-contract-axes.md`. 화면 문안 전량을 붙인다
커밋 제안: `feat(cli): generate 화면에 계약 축 커버리지를 표시한다`

---

## Task 10: ADR-0009 개정, 의존 경계, ADR-0022

**Files**
- Modify: `docs/adr/0009-generate가-runner에-의존하는-예외.md`
- Modify: `packages/generate/tests/dependency-boundary.test.ts`
- Create: `docs/adr/0022-위반-케이스-생성-정책.md`

**Interfaces**
- Consumes: T6·T7 이 실제로 쓴 `runner` 심볼 목록
- Produces: 승인 목록과 실제 import 의 일치

- [ ] **Step 1: 실제 import 를 센다**

```bash
grep -rn 'from "@ohmymcp/runner"' packages/generate/src
```

목록에 추가될 것은 `deriveContractAxes`, `matchCoveredAxes`, `ContractAxis`,
`ContractAxisKind`, `ContractDeclaredType` 중 **실제로 import 문에 나타난 것만**이다.
`dependency-boundary.test.ts` 는 정확한 일치를 요구하므로(`toEqual`) 안 쓰는 것을 넣으면 깨진다.
예상과 다르면 예상을 고치고 그 사실을 보고서에 적는다.

- [ ] **Step 2: 테스트를 먼저 고쳐 실패를 본다**

`APPROVED_RUNNER_SYMBOLS` 에 Step 1 의 목록을 알파벳 순서로 넣는다.
Run: `pnpm vitest run packages/generate/tests/dependency-boundary.test.ts`
Expected: PASS. 실패하면 목록과 실제 import 가 어긋난 것이므로 목록을 고친다

- [ ] **Step 3: ADR-0009 를 고친다**

배경 절의 심볼 표에 새 심볼을 넣고, 왜 늘어났는지 한 단락을 추가한다. 근거는 설계서 §3.1 의
두 이유(정규화 한 벌 유지, `generate` 파서는 미지원 키워드에서 던져 화면을 죽인다)다.
"목록을 넓히려면 이 ADR 을 고쳐야 한다" 는 결과 절의 규칙을 지킨 것이 이 스텝이다.

- [ ] **Step 4: ADR-0022 를 쓴다**

설계서 §11.2 의 세 판단(기본 생성 대 옵트인, 필드마다 대 축마다, 상한 대 무제한)을 한 ADR 에
담는다. `docs/adr/` 형식을 따르고 상태는 `제안`. 착수 시점에 번호가 비어 있는지 확인한다.

- [ ] **Step 5: 전체 회귀**

Run: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
Expected: 전부 PASS, `Cached: 0 cached`

- [ ] **Step 6: 보고서**

보고서: `docs/reports/task-t10-contract-axes.md`
커밋 제안: `docs(generate): ADR-0009 승인 심볼 목록을 넓히고 ADR-0022 를 추가한다`

---

## 6. 통합 게이트

각 터미널이 끝난 뒤 오케스트레이터가 직접 확인한다. 자식의 완료 선언은 단서일 뿐이다.

**터미널 A (PR 1) 게이트**

1. `pnpm test`, `pnpm typecheck --force`, `pnpm lint` 통과. `Cached: 0 cached`
2. `packages/runner/tests/input-contract.test.ts` 의 **기존** 단언이 T1 에서 하나도 바뀌지 않았다
   (`git diff` 로 확인). 바뀌었으면 추출이 무손실이 아니다
3. `packages/generate`·`packages/cli`·`packages/core` 변경 0건
4. `input-schema.ts` 와 `case-expectation.ts` 가 `index.ts` 에 없다
5. 통합 SHA 를 `docs/task-integration-ledger.tsv` 에 `T1~T4-contract-axes` 로 기록하고 별도 문서
   커밋으로 보존한다

**터미널 B (PR 2) 게이트**

1. `pnpm test`, `pnpm typecheck --force`, `pnpm lint` 통과. `Cached: 0 cached`
2. 완료 조건 3번과 4번이 **동시에** 참인 테스트가 실제로 있다(`input-contract.test.ts` 의
   리터럴 8케이스 + `coverage.test.ts` 의 `verified === total`)
3. `packages/runner`·`packages/core`·`examples`·`fixtures` 변경 0건
4. `dependency-boundary.test.ts` 의 목록과 ADR-0009 표가 일치
5. E2E 가 8케이스 7 passed 1 failed 이고 서버 프로세스가 종료된다
6. 통합 SHA 를 대장에 `T5~T10-contract-axes` 로 기록한다

**PR 1 머지 전 재확인.** `docs/adr/` 에 그 사이 0021 이 들어왔는지 다시 본다. 병렬 터미널끼리
번호를 고정해도 그 사이 `main` 에 같은 번호가 들어가면 충돌한다. 0016 에서 실제로 밟았다.

**리뷰 스레드.** `main` 에 `required_conversation_resolution` 이 켜져 있다. 지적을 안 받는
경우에도 **그 스레드 안에 답글을 달고 해제**해야 머지된다. `mergeStateStatus` 가 `BLOCKED` 로만
나오고 이유를 말해 주지 않는다. 절차는 `CLAUDE.md` 의 해당 절에 있다.

## 7. ADR

| 번호 | 제목 | 태스크 |
|---|---|---|
| 0021 | 거절 기대 케이스의 입력 계약 대조 제외 | T4 |
| 0009 개정 | `generate → runner` 승인 심볼 목록 확대 | T10 |
| 0022 | 위반 케이스 생성 정책(기본 생성·필드마다·무제한) | T10 |

## 8. 자체 검토 결과

설계 문서의 절을 훑어 대응 태스크를 확인했다.

| 설계서 | 태스크 |
|---|---|
| §3.2 `contract-axes.ts` 공개 계약 | T2, T3 |
| §4.2 도출 규칙, §4.4 정렬 | T2 |
| §4.2 중복 툴 이름 | T2(파라미터), T7(판정) |
| §5.2 위반값 규칙, §5.4 id, §5.5 이름 | T6 |
| §5.1 정상 입력 재사용 | T8 |
| §6.2 판정 규칙 | T3 |
| §6.3 §11.1 제외 규칙 | T4 |
| §6.4 미검증의 정의 | T7(계산), T9(표시) |
| §7.1~§7.4 화면 전량 | T9 |
| §8.1 결정론성 | T2·T6·T7·T8 각 테스트 |
| §8.3 지문과 정책 버전 | T8 |
| §9.2 1MB 벽 고지 | T9 |
| §10.1~§10.6 테스트 | T2·T3·T4·T6·T7·T8·T9 |
| §11 ADR | T4, T10 |
| §13 소유권과 PR | §2 터미널 분할 |

**검토에서 고친 것 셋.**

1. T1 을 새로 넣었다. 설계서 §3.1 은 `contract-axes.ts` 가 `normalizeInputSchema` 를 "재사용" 한다고만
   적었는데 그 함수는 `input-contract.ts` 안의 비공개다. 추출을 태스크로 세우지 않으면 T2 가
   남의 파일을 고치면서 시작한다.
2. T3 의 마지막 테스트를 T4 까지 `it.todo` 로 미뤘다. T3 시점에는 `checkInputContract` 가 아직
   말하므로 그 테스트가 실패한다. 순서를 뒤집으면(T4 먼저) T4 의 테스트가 T3 의 함수를 필요로
   해서 같은 문제가 생긴다.
3. `byCodeUnit` 을 `generate` 에서 사본으로 두기로 정하고 사유를 T7 에 적었다. `runner` 내부
   전용 파일이라 import 할 수 없고, 이것 하나로 승인 심볼 목록을 넓히는 것이 더 비싸다.

**남은 위험 둘.**

- 케이스당 보고서 바이트(300~600)는 추정이다. T9 에서 실제 보고서 크기를 재 볼 수 있으면
  임계 근거를 실측으로 바꾼다. 못 재면 추정임을 주석에 남긴다.
- 케이스당 보고서 바이트 추정이 틀리면 임계 1500 이 헐거워진다. 벽 자체는 예외로 드러나므로
  사용자가 원인 모를 실패를 보는 일은 없다. 고지가 늦게 뜨는 것이 최악이다.

검토 중 발견해 규칙으로 못 박은 것 하나. `required` 에 있지만 `properties` 에 없는 필드는
`REQUIRED_OMITTED` 축이 생기는데 정상 입력에 그 키가 없어서 "뺀 입력" 이 정상 입력과 같아진다.
그대로 만들면 입력이 같고 단언만 반대인 케이스가 되어 항상 실패한다. T6 Step 4 에 건너뛰는
규칙과 사유를 넣었고, T2 테스트에 축이 생기는 것 자체를 고정한다. 축은 남고 커버리지가 미검증으로
보고한다.

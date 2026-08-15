# `isError` 진단의 서버 응답 본문 구현 계획 (2026-08-15)

- 설계 문서: `docs/superpowers/specs/2026-08-15-iserror-response-body-design.md`
- 선행 ADR: ADR-0008, ADR-0011, ADR-0022, ADR-0025
- 이 작업의 ADR: ADR-0027 (착수 전 커밋 완료, `9b50c68`)
- 대상 패키지: `runner`. `cli` 는 테스트 기대값만 바뀐다.

## 0. 실행 모델

메인 세션은 오케스트레이터다. 구현·테스트는 위임 세션이 한다. 메인 세션은 worktree 부트스트랩,
프롬프트 전달, 보고서와 diff 확인, 검증 재실행, 머지 게이트, 통합 대장 기록만 한다.

모델 배분은 `CLAUDE.local.md` 의 표를 따른다. R8 은 **상위 모델**이다. 실패 메시지 문안이 이
프로젝트의 제품이고, 패키지 경계 판단(다른 오너의 `runner` 를 어디까지 건드리는가)이 들어간다.

## 1. 사람 몫 사전 조건

```sh
git log --oneline -1     # main 이 기점인지
git status --short       # 깨끗한지
```

설계서와 이 계획서, ADR-0027 이 `main` 에 커밋돼 있어야 한다.

## 2. 태스크 목록

| Task | 내용 | 선행 | 모델 |
|---|---|---|---|
| R8 | `isError` 진단에 응답 본문을 싣고 리포터가 찍는다 | 없음 | 상위 |

태스크가 하나라 의존성 그래프와 웨이브 표가 없다. 터미널 1개다. R1~R7 번호는 입력값 교정
계획이 쓴다. 그 계획의 후속이므로 번호를 이어 R8 로 둔다. R4 를 비워 둔 것과 같은 기준이다.

## 3. PR 분할

PR 하나다. `runner` 계약 변경과 그 기대값 수정이 한 덩어리라 나누면 중간 커밋이 빨간불이 된다.

## 4. 태스크 상세

### R8: `isError` 진단의 응답 본문 (`runner`)

**Files**

- Modify: `packages/runner/src/diagnostics.ts`
- Modify: `packages/runner/src/assertions.ts`
- Modify: `packages/runner/src/executor.ts`
- Modify: `packages/runner/src/reporter.ts`
- Test: `packages/runner/tests/assertions.test.ts`
- Test: `packages/runner/tests/reporter.test.ts`
- Test: `packages/runner/tests/executor.test.ts`
- Test: `packages/cli/tests/input-repair.test.ts`
- Test: `packages/cli/tests/repair-target.test.ts`
- Test: `packages/cli/tests/dry-run.test.ts`
- Test: `packages/cli/tests/generate-command.test.ts`

`repair-target.test.ts` 는 착수 뒤에 더했다. `서버 오류 본문이 없으면 serverMessage 가 빈
문자열이다` 가 "`isError` 단언만 달린 케이스에는 `→ ` 줄이 없다" 를 전제로 쓰여 있었는데 이
작업이 그 전제를 없앤다. 테스트가 틀린 것이 아니라 전제가 사라진 것이므로 같은 이름으로 남기고
상황만 바꾼다.

`packages/cli/src` 는 한 줄도 안 고친다. 고쳐야 할 것 같으면 고치지 말고 보고한다. 그러면 설계가
틀린 것이다. `core/src/types.ts`, `packages/generate` 전부, 루트 빌드 설정은 공유 계약이다.

**마지막 두 파일은 실제로 깨졌을 때만 손댄다.** PR #102 가 같은 파일을 고치고 있다(설계서 §8).
손댔으면 무엇을 왜 고쳤는지 보고서에 적는다.

**공개 계약 (전량, 설계서 §3 과 같다)**

```ts
export interface RunnerDiagnostic {
  code: RunnerDiagnosticCode;
  message: string;
  expected?: JsonValue;
  actual?: JsonValue;
  hint: string;
  violations?: SchemaViolationDiagnostic[];
  totalViolations?: number;
  /** 진단에 덧붙이는 자유 문장. 리포터가 violations 와 같은 `→ ` 형식으로 찍는다. */
  notes?: string[];
}

export function assertIsError(
  result: ToolResult,
  spec: IsErrorAssertionSpec,
  extraction: BodyExtraction | undefined,
  options?: { redaction?: RunnerRedactionOptions },
): AssertionResult;
```

**본문을 싣는 규칙**: 설계서 §4 의 표가 전량이다. 접두어를 붙이지 않는 규칙을 특히 지킨다.

**화면**: 설계서 §5 가 전량이다. `violations` 를 먼저, 그다음 `notes`, 그다음 `hint` 다.

**테스트 (이름은 저장소의 기존 문장 투를 따르되 아래를 전부 덮는다)**

```
· isError 로 실패하면 응답 본문이 진단 notes 에 실린다
· 본문이 JSON 이면 한 줄로 실린다
· 본문 추출이 실패하면 notes 가 없다
· redaction 대상 값이 본문에 있으면 치환돼 실린다
· 본문이 MAX_VALUE_STRING_CHARS 보다 길면 잘린다
· isError 가 통과하면 notes 가 없다
· 리포터가 notes 를 `→ ` 줄로 찍는다
· violations 와 notes 가 둘 다 있으면 violations 가 먼저 나온다
```

`packages/cli/tests/repair-target.test.ts` 에 두 가지를 한다.

- `서버 오류 본문이 없으면 serverMessage 가 빈 문자열이다` 는 본문 추출이 실패하는 응답을 쓰게
  바꾼다(`content: null` 이면 `CONTENT_NOT_ARRAY` 로 `ok: false` 다). 케이스는 여전히 `isError`
  로 실패하므로 교정 대상 판별은 그대로 통과하고 `serverMessage` 만 빈 문자열이 된다. 이름과
  의도를 바꾸지 않는다.
- **`isError` 단언만 달린 케이스의 `serverMessage` 에 서버 응답 본문이 들어간다**를 덮는
  테스트를 하나 더한다. 이것이 이 작업의 성과이고, `runner` 와 `cli` 를 잇는 계약이라 한쪽만
  고쳐도 조용히 깨진다. 이름은 저장소의 기존 문장 투를 따른다.

기존 테스트를 지우지 않는다. 기대값만 새 출력에 맞게 고친다.

**추가 확인**: `packages/cli/tests/generate-integration.test.ts` 의
`입력값 교정으로 고친 값이 실제 서버 명세에 남는다` 가 여전히 통과하는지 본다. 실제
`weather-server` 를 띄우는 테스트라 이 터미널만 돌 때 확인한다.

**명령**: `pnpm test`, `pnpm build && pnpm --filter ohmymcp test:e2e`, `pnpm typecheck --force`,
`pnpm lint`

**보고서**: `docs/reports/task-r8-iserror-body.md`. `weather-server` 에 `{"city":"example"}` 를
보냈을 때 실제로 찍히는 실패 블록 전문을 붙인다. 그것이 이 태스크의 산출물이다.

**커밋**: `feat(runner): isError 진단에 서버 응답 본문을 싣는다`

## 5. 실행 프롬프트

터미널 1개다. 프로젝트 루트에서 새 터미널을 열고 아래 블록을 그대로 붙여넣는다.

권장 실행 설정: 상위 모델, 추론 수준 높음, 에이전트 종류 `general-purpose`.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-iserror-body -b feat/iserror-response-body main

를 실행한 뒤 그 경로로 세션을 옮겨라. 옮긴 다음 아래를 확인하고, 하나라도 어긋나면 중단하고
BLOCKED 로 보고해라.

  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-iserror-body 인지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/adr/0027-isError-진단의-서버-응답-본문.md 가 있는지
  - docs/superpowers/specs/2026-08-15-iserror-response-body-design.md 가 있는지
  - docs/superpowers/plans/2026-08-15-iserror-response-body-implementation.md 가 있는지
  - packages/runner/src/diagnostics.ts 에 isErrorMismatchDiagnostic 이 있는지
  - packages/runner/src/body.ts 에 extractResponseBody 가 있는지
  - git status --short 가 비어 있는지
  - pnpm install 과 pnpm build 를 실행하고 pnpm test 가 실제로 기동하는지

[2단계: 실행]

너는 구현자다. Task R8 을 끝낸다. 계획서
docs/superpowers/plans/2026-08-15-iserror-response-body-implementation.md 의 §4 를 읽고 그대로
구현해라. 결정과 배경은 docs/adr/0027-isError-진단의-서버-응답-본문.md 에, 계약과 규칙과 화면은
docs/superpowers/specs/2026-08-15-iserror-response-body-design.md 의 §3·§4·§5 에 전량 있다.

지금 isError 단언이 실패해도 서버가 무엇이라고 거절했는지가 화면에 한 글자도 안 나온다. 진단이
고정 문장과 불리언 둘만 담기 때문이다. 그래서 실패 화면이 이유를 안 보여주고, 입력값 교정의 AI
제안도 근거를 못 얻어 항상 사람 입력으로 간다. 이것을 고치는 태스크다.

R8 허용 Files:
  packages/runner/src/diagnostics.ts
  packages/runner/src/assertions.ts
  packages/runner/src/executor.ts
  packages/runner/src/reporter.ts
  packages/runner/tests/assertions.test.ts
  packages/runner/tests/reporter.test.ts
  packages/runner/tests/executor.test.ts
  packages/cli/tests/input-repair.test.ts
  packages/cli/tests/dry-run.test.ts
  packages/cli/tests/generate-command.test.ts

runner 는 원래 다른 오너의 패키지다. 이번 태스크는 사용자가 명시적으로 승인했다. 그래도 위 목록
밖은 고치지 마라. 특히 core/src/types.ts 의 McpClient·ToolResult, packages/generate 전부,
packages/cli/src 전부, 루트 빌드 설정은 고치지 마라. cli 소스는 한 줄도 안 고쳐야 한다. 이미
`→ ` 줄을 읽고 있어서 진단만 채우면 그대로 붙는다. 고쳐야 할 것 같으면 고치지 말고 보고해라.

packages/cli/tests/dry-run.test.ts 와 packages/cli/tests/generate-command.test.ts 는 실제로
깨졌을 때만 손대라. 다른 터미널이 PR 102 에서 그 두 파일을 고치고 있어 나중에 충돌 지점이 된다.
손댔으면 무엇을 왜 고쳤는지 반드시 보고해라.

의존 방향은 단방향(cli → runner/generate/record/mock → core)이고 역참조·순환을 만들지 마라.
@modelcontextprotocol/sdk 는 1.x 고정이고 목록 밖 의존성을 추가하지 마라. 백그라운드 실행,
커밋, 머지, 푸시, 하위 에이전트 스폰을 하지 마라. 다른 작업자의 변경을 되돌리지 마라.

테스트는 인메모리와 fixtures/ 만 쓴다. 다만 마지막에 packages/cli/tests/generate-integration.
test.ts 의 `입력값 교정으로 고친 값이 실제 서버 명세에 남는다` 가 통과하는지 확인해라. 그것은
실제 weather-server 를 띄운다. 이 터미널만 돌고 있으니 괜찮다.

검증: pnpm test, pnpm build && pnpm --filter ohmymcp test:e2e, pnpm typecheck --force, pnpm lint
를 모두 돌리고 출력을 보고서에 붙여라. typecheck 는 Cached: 0 cached 인지 확인해라.
packages/core/tests/stdio-integration.test.ts 는 첫 실행에 종종 실패하는 기존 플레이크다. 그것만
실패하면 재실행하고 그 사실을 적어라.

보고서: docs/reports/task-r8-iserror-body.md 를 쓴다. 바꾼 파일, 검증 명령과 결과, 임의로 판단한
지점, 남은 위험을 적어라. weather-server 에 {"city":"example"} 를 보냈을 때 실제로 화면에 찍히는
실패 블록 전문을 반드시 붙여라. 커밋 메시지
`feat(runner): isError 진단에 서버 응답 본문을 싣는다` 를 보고서에 적어라. 커밋은 하지 마라.

최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

## 6. 통합 게이트

1. worktree 에서 `git status --short` 와 `git diff --check`. 변경 경로가 허용 Files 안인가.
   `packages/cli/src` 가 하나도 안 바뀌었는가.
2. diff 를 직접 읽는다. 설계서 §4 의 표 다섯 줄이 코드에 하나씩 있는가. 접두어를 안 붙였는가.
   `violations` → `notes` → `hint` 순서가 맞는가.
3. 계획서에 적힌 검증 명령을 **다시 실행한다.** `pnpm typecheck --force` 출력에서
   `Cached: 0 cached` 를 확인한다.
4. 통과하면 커밋하고 `--no-ff` 로 머지한다. 머지된 `main` 에서 전체 테스트를 **새로** 돌린다.
5. 통합 SHA 를 `docs/task-integration-ledger.tsv` 에 `R8-iserror-body` 로 기록하고 별도 문서
   커밋으로 보존한다.
6. worktree 가 깨끗한지 확인한 뒤 그 worktree 만 제거하고 그 브랜치만 삭제한다.

## 7. 완료 판정

설계서 §2 의 완료 조건 넷에 더해 아래를 확인한다.

- `docs/task-integration-ledger.tsv` 에 `R8-iserror-body` 한 줄이 있고 `main` 의 조상이다.
- `docs/adr/README.md` 에 ADR-0027 이 색인돼 있다.
- `packages/cli/src` 의 diff 가 비어 있다.

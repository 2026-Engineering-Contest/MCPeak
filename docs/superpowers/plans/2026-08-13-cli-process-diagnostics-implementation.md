# CLI 프로세스 진단 출력 구현 계획 (2026-08-13)

설계 문서: `docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md`
로드맵: `ROADMAP.local.md` 단계 1 (로컬 전용, gitignore 대상)

## 1. 실행 모델

구현·테스트는 서브에이전트가 한다. 메인 세션은 오케스트레이터로 남아 스폰·리뷰·통합만 한다.
태스크 셋이 하나이므로 터미널 1개, worktree 1개, 브랜치 1개다. 태스크는 T1 → T2 → T3 순서로
직렬 실행하며 각 태스크 사이에 메인 세션의 리뷰 게이트가 있다.

## 2. 목표와 완료 조건

설계 문서 §2 를 그대로 따른다. 판정 명령은 다음 넷이다.

| 목적 | 명령 |
|---|---|
| 전체 판정 | `pnpm test` |
| 타입체크 | `pnpm typecheck` |
| 린트 | `pnpm lint` |
| 빌드 | `pnpm build` |
| 배포 산출물 E2E | `pnpm --filter ohmymcp test:e2e` |

완료 조건.

- 위 다섯 명령 전부 통과.
- 판정, 종료 코드, stdout 바이트가 바뀌지 않는다. 이 셋을 검증하는 기존 단언은 수정 없이
  통과한다.
- 기존 테스트 수정은 공개 계약이 실제로 늘어난 세 곳에만 허용한다. `TestCommandInput` 에
  `stderrLines` 가 생겨 파싱 결과를 전량 비교하는 단언 2곳(`test 명세, command와 반복 arg를
  입력 순서대로 파싱한다`, `equals 형식과 하이픈·빈 문자열 arg를 보존한다`)과 `usage` 문자열
  1곳(`각 사용법 오류를 고정 message와 usage hint로 출력하고 읽기 전에 종료한다`)이다. 그 밖의
  기존 단언을 고쳐야 통과한다면 회귀이므로 `BLOCKED` 로 보고한다.
- `--stderr-lines 0` 실행의 stdout·stderr 바이트가 변경 전과 같다.
- `--json` 실행의 stdout 바이트가 변경 전과 같다.

## 3. 공유 계약 (전량, 수정 금지)

T1 이 만들고 T2 가 소비한다. 이 시그니처는 두 태스크의 접점이므로 한 글자도 바꾸지 않는다.
바꿔야 한다고 판단되면 수정하지 말고 보고한다.

```ts
// packages/cli/src/process-diagnostics.ts

/** core 의 McpProcessDiagnostics 와 구조가 같다. core 를 import 하지 않는다. */
export interface ProcessDiagnosticsInput {
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface RenderProcessDiagnosticsOptions {
  /** 표시할 stderr 마지막 줄 수. 0 이면 빈 문자열을 반환한다. */
  readonly maxLines: number;
}

export function isAbnormalExit(diagnostics: ProcessDiagnosticsInput): boolean;

export function renderProcessDiagnostics(
  diagnostics: ProcessDiagnosticsInput,
  options: RenderProcessDiagnosticsOptions,
): string;
```

`TestCommandInput` 에 필드 하나가 늘어난다. 이것도 접점이다.

```ts
export interface TestCommandInput {
  readonly suitePath: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly json: boolean;
  readonly stderrLines: number; // 신규. 기본값 20
}
```

**수정 금지 대상**: `packages/core/**`, `packages/runner/**`, `packages/generate/**`,
`packages/record/**`, `packages/mock/**`, 루트 빌드 설정(`package.json`, `turbo.json`,
`tsconfig.base.json`, `pnpm-workspace.yaml`, `vitest.config.ts`), `fixtures/**`,
`examples/**`. 특히 `packages/core/src/types.ts` 의 `McpClient`·`ToolResult` 는 동결이다.

## 4. 태스크

### Task T1 — 진단 렌더러 (순수 함수)

**Files**

- 생성: `packages/cli/src/process-diagnostics.ts`
- 생성: `packages/cli/tests/process-diagnostics.test.ts`

이 목록 밖의 파일을 수정하지 않는다.

**입력 계약**: §3 의 `ProcessDiagnosticsInput`, `RenderProcessDiagnosticsOptions`.

**산출 계약**

`isAbnormalExit` 은 `signal !== null || (exitCode !== null && exitCode !== 0)` 이다.

`renderProcessDiagnostics` 는 설계 문서 §5 의 레이아웃을 그대로 만든다. 문자열은 전량 아래와
같다. 변형하지 않는다.

- 1행: `서버 프로세스 진단`
- 2행: `  종료 코드: ${exitCode ?? "없음"}  시그널: ${signal ?? "없음"}` (구분은 공백 두 칸)
- stderr 가 빈 문자열이면 3행은 `  stderr: (비어 있음)` 이고 여기서 끝난다.
- 내용이 있으면 3행은 `  stderr (${안쪽}):` 이다. `안쪽` 은 다음 조각을 이 순서로 `, ` 로 잇는다.
  - 잘리지 않았으면 `전체`, 잘렸으면 `마지막 ${maxLines}줄`
  - 줄 수 제한으로 버린 줄이 있으면 `위로 ${버린수}줄 더 있음`
  - `stderrTruncated === true` 이면 `앞부분이 수집 상한으로 잘렸습니다`
- 4행 이후: 각 줄 앞에 공백 4칸.
- `maxLines === 0` 이면 빈 문자열을 반환한다. 이 판정이 다른 모든 판정보다 먼저다.
- 빈 문자열이 아니면 항상 `\n` 으로 끝난다.

줄 분할은 설계 문서 §5.4 다. `/\r?\n/` 로 나누고, 마지막 원소가 빈 문자열이면 하나만 버리고,
마지막 `maxLines` 개를 취한다. 중간의 빈 줄은 유지한다.

이스케이프는 설계 문서 §5.5 다. **줄로 나눈 뒤 각 줄에 적용하고 개행으로 합친다.** 규칙은
`packages/runner/src/reporter.ts:38` 및 `packages/cli/src/test-command.ts:143` 과 같은 값이다.
코드포인트가 `<= 0x1f`, `0x7f..0x9f`, `U+2028`, `U+2029` 이면 `\uXXXX`(4자리 소문자 16진)로
바꾼다. 두 파일의 함수를 import 하지 않고 이 모듈에 다시 쓴다(ADR-0013 과 같은 근거).

색상을 쓰지 않는다. `process` 를 읽지 않는다.

**테스트**: 설계 문서 §8.1 의 20건을 그대로 만든다. 그중 다음 두 건은 **전체 문자열 비교**로
단언한다. 포함 단언만 쓰면 레이아웃이 깨져도 통과한다.

- `종료 코드와 시그널을 한 줄에 적는다`
- `stderr 가 비면 한 줄로 끝낸다`

이스케이프 테스트의 입력은 소스에서 `"\u001b[31mred\u001b[0m"`, `"\u009b1m"` 처럼 이스케이프
표기로 적는다. 원문 제어문자를 소스에 넣지 않는다.

**표적 검증**: `pnpm vitest run packages/cli/tests/process-diagnostics.test.ts`
**전체 회귀**: `pnpm test`, `pnpm typecheck`, `pnpm lint`

**보고서**: `docs/reports/task-t1-cli-process-diagnostics.md`

### Task T2 — 옵션 파싱과 배선

**Files**

- 수정: `packages/cli/src/test-command.ts`
- 수정: `packages/cli/tests/test-command.test.ts`
- 수정: `packages/cli/tests/cli-integration.test.ts`

이 목록 밖의 파일을 수정하지 않는다. T1 이 만든 `process-diagnostics.ts` 는 읽고 import 만 한다.

**선행**: T1 통합 완료. 통합 SHA 가 대장에 있고 현재 HEAD 의 조상이어야 한다.

**산출 계약 1 — 옵션 파싱** (설계 문서 §6)

`usage` 상수 끝에 ` [--stderr-lines <N>]` 을 더한다.

`parseTestCommand` 가 `--stderr-lines` 와 `--stderr-lines=N` 을 받는다. 기본값 20. 기존
`--command` 분기와 같은 형태로 쓴다. 실패 메시지는 전량 다음과 같다.

- 값 없음: `` `--stderr-lines` 옵션 값이 필요합니다. ``
- 중복 지정: `` `--stderr-lines`는 한 번만 사용할 수 있습니다. ``
- 정수 아님 또는 음수: `` `--stderr-lines` 값은 0 이상의 정수여야 합니다. ``

전부 `CLI_USAGE` 이고 힌트는 `usage` 다. 값 검증은 `/^\d+$/` 로 하고 `Number.parseInt` 후
`Number.isSafeInteger` 를 확인한다. `-1` 처럼 `-` 로 시작하는 값은 `--arg` 와 같은 이유로
"값이 필요합니다" 가 아니라 "0 이상의 정수여야 합니다" 로 보고한다. 즉 `--stderr-lines` 다음
토큰은 `-` 로 시작해도 값으로 받아 검증 단계에서 거절한다.

**산출 계약 2 — 진단 출력 배선** (설계 문서 §4.3, §7)

`runCli` 안에서 `connection` 이 만들어진 뒤의 경로에만 붙인다. 판단이 갈리는 지점이므로 전량
적는다.

```ts
const writeDiagnostics = (leadingBlank: boolean): void => {
  if (input.stderrLines === 0) return;
  let diagnostics: ProcessDiagnosticsInput;
  try {
    diagnostics = connection.getDiagnostics();
  } catch {
    return;
  }
  // 정보가 없는 블록은 소음이다. 설계 문서 §4.3.
  if (diagnostics.stderr === "" && !isAbnormalExit(diagnostics)) return;
  const block = renderProcessDiagnostics(diagnostics, { maxLines: input.stderrLines });
  if (block === "") return;
  dependencies.writeStderr(leadingBlank ? `\n${block}` : block);
};
```

**빈 진단 생략은 모든 경로에 적용한다.** `stderr` 가 빈 문자열이고 `isAbnormalExit` 이 거짓이면
블록에 남는 것은 `종료 코드: 0  시그널: 없음` 과 `stderr: (비어 있음)` 뿐이다. 케이스는 실패했지만
서버는 정상 종료한 실행에서 매번 붙게 되고, 그 경우 실패 원인은 단언 진단이 이미 설명한다.
이 판정은 렌더러가 아니라 호출부에 둔다.

호출 지점 넷.

1. `startRunner` 가 던진 경우: `writeFailure(... RUNNER_EXECUTION_FAILED ...)` **전에**
   진단을 계산하고, 오류 메시지를 먼저 쓴 뒤 `writeDiagnostics(true)` 를 호출한다. 즉 stderr 에
   오류 메시지 → 빈 줄 → 진단 순서로 나간다.
2. `finalize` 가 거절한 경우: 같은 순서로 `RUNNER_FINALIZATION_FAILED` 뒤에
   `writeDiagnostics(true)`.
3. 보고서를 얻은 경우: stdout 에 보고서를 쓴 뒤,
   `report.status !== "passed" || isAbnormalExit(connection.getDiagnostics())` 이면
   `writeDiagnostics(false)`.
4. 보고서 출력 중 `CLI_INTERNAL_ERROR` 로 빠지는 경로: 진단을 쓰지 않는다. 원인이 서버가 아니라
   우리 렌더링이다.
5. `connect` 가 거절한 경로: `connection` 이 없으므로 오류 객체에서 진단을 꺼낸다. 설계 문서
   §4.3.1 이다. 아래에 계약을 전량 적는다.

명세 검증 실패 등 연결 시도 이전 경로는 손대지 않는다.

**산출 계약 3 — 연결 실패 경로의 진단** (설계 문서 §4.3.1)

`core` 의 `McpClientError` 가 `diagnostics: McpProcessDiagnostics` 를 들고 있다
(`packages/core/src/errors.ts:92`). 기존 `coreError()` 헬퍼가 이미 오류를 순회해 그 객체를
찾으므로, 반환 타입을 넓혀 `diagnostics` 를 함께 꺼낸다. `core` 를 import 하지 않고 구조로
검증한다.

```ts
type CoreError = Readonly<{
  name: "McpClientError";
  code: string;
  message: string;
  hint: string;
  diagnostics?: ProcessDiagnosticsInput;
}>;
```

`diagnostics` 판정은 기존 `coreError()` 의 방식과 같이 필드 존재와 타입을 직접 확인한다.
`stderr` 가 `string`, `stderrTruncated` 가 `boolean`, `exitCode` 가 `number | null`,
`signal` 이 `string | null` 이어야 한다. 하나라도 어긋나면 `undefined` 로 두고 진단 없이
기존 메시지만 낸다.

출력 조건은 이 경로에만 하나가 더 붙는다. **`stderr` 가 빈 문자열이고 `isAbnormalExit` 이
거짓이면 블록을 쓰지 않는다.** 실행 파일이 없어 spawn 이 실패한 경우가 여기 해당하고, 그때
블록은 `종료 코드: 없음  시그널: 없음` 과 `stderr: (비어 있음)` 만 담아 소음이 된다.

쓰는 경우의 순서는 다른 실패 경로와 같다. 오류 메시지 → 빈 줄 → 진단.

`getDiagnostics()` 호출 자체가 던지면 진단 없이 기존 동작을 유지한다. `try/catch` 로 감싸고
잡은 예외는 무시한다. 진단 출력 실패가 판정을 바꾸면 안 된다.

**종료 코드는 바꾸지 않는다.** `report.status === "passed" ? 0 : 1`, 실패 경로 1 그대로다.

**테스트**: 설계 문서 §8.2 의 파싱 8건과 `runCli` 12건, §8.3 의 통합 1건을 그대로 만든다.
연결 실패 경로 3건(오류에 담긴 진단 출력, 진단이 비면 미출력, `McpClientError` 아닌 거절)이
그중에 있다.
기존 테스트는 고치지 않는다. `deps()` 헬퍼의 `connection()` 픽스처가 이미 `getDiagnostics` 를
제공하므로 시그니처 변경이 필요 없다. 진단 시나리오는 `connect` 오버라이드로 다른
`getDiagnostics` 를 돌려주는 방식으로 만든다.

**표적 검증**: `pnpm vitest run packages/cli/tests/test-command.test.ts packages/cli/tests/cli-integration.test.ts`
**전체 회귀**: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`

**보고서**: `docs/reports/task-t2-cli-process-diagnostics.md`

### Task T3 — 실환경 E2E (직렬 전용)

**Files**

- 수정: `packages/cli/tests/dist-cli-e2e.mjs`

이 목록 밖의 파일을 수정하지 않는다. `examples/**` 를 만들거나 고치지 않는다.

**선행**: T2 통합 완료. 실행 전에 `pnpm build` 로 `packages/cli/dist/cli.mjs` 를 갱신한다.
낡은 산출물로 판정하면 옛 동작을 검증하게 된다.

**산출 계약**

기존 판정(정상 서버에 대한 `--json` stdout `JSON.parse`)을 유지한다. 아래 셋을 더한다.

1. **기동 즉시 죽는 서버**: 테스트가 `node:os` 의 임시 디렉터리에 최소 스크립트를 만든다. 이
   스크립트는 `@modelcontextprotocol/sdk` 를 쓰지 않고, stderr 에
   `"TypeError: Cannot read properties of undefined (reading 'temp')"` 를 쓴 뒤
   `process.exit(1)` 한다. `connectStdio` 가 `PROCESS_EXITED` 로 던지는 경로이며, 진단 출처는
   `McpClientError.diagnostics` 다(계약 3).
   판정: 종료 코드 1, stderr 에 `MCP_CONNECTION_FAILED` 와 `서버 프로세스 진단` 과 `TypeError`
   와 `종료 코드: 1` 이 있다.
2. **`--stderr-lines 0`**: 같은 스크립트로 `--stderr-lines 0` 을 주고 실행한다.
   판정: stderr 에 `MCP_CONNECTION_FAILED` 는 있고 `서버 프로세스 진단` 은 **없다.**
3. **실행 불가능한 command**: 존재하지 않는 실행 파일로 실행한다. spawn 자체가 실패해 진단이
   전부 비는 경로다.
   판정: stderr 에 `PROCESS_START_FAILED` 가 있고 `서버 프로세스 진단` 이 없다.

임시 파일은 테스트가 끝나며 정리한다. 저장소 안에 파일을 남기지 않는다.

**표적 검증**: `pnpm build && pnpm --filter ohmymcp test:e2e`
**전체 회귀**: `pnpm test`, `pnpm typecheck`, `pnpm lint`

**보고서**: `docs/reports/task-t3-cli-process-diagnostics.md`

### Task T4 — ADR

**Files**

- 생성: `docs/adr/0014-진단-출력-채널.md`

**선행**: T2 통합 완료(결정이 코드로 확정된 뒤에 쓴다).

**산출 계약**: 기존 ADR 형식(배경 / 선택지 / 결정 / 이유 / 결과)을 따른다.
`docs/adr/0012-cli-기본-출력-전환.md` 와 같은 머리말(상태·날짜·관련 설계)을 쓴다. 내용은 설계
문서 §11 이다. 선택지 셋은 (1) `RunnerReport` 에 진단 필드 추가, (2) stdout 에 보고서와 함께
출력, (3) stderr 채널로 분리이고 결정은 (3)이다. 이유에 §4.2 의 결정론성 계약과 `--json`
소비자 보호를 적는다. `docs/adr/README.md` 에 목록 줄이 있으면 함께 갱신한다.

**표적 검증**: 없음(문서). `pnpm lint` 만 확인한다.

**보고서**: `docs/reports/task-t4-cli-process-diagnostics.md`

## 5. 의존성과 웨이브

```
T1 (렌더러) → T2 (배선) → T3 (E2E, 직렬)
                       ↘ T4 (ADR)
```

| 웨이브 | 태스크 | 병렬 | 비고 |
|---|---|---|---|
| 1 | T1 | 단독 | 공유 계약을 만든다 |
| 2 | T2 | 단독 | T1 통합 후 |
| 3 | T3, T4 | T3 는 실서버 프로세스를 띄우므로 직렬 웨이브. T4 는 문서라 T3 와 파일이 겹치지 않아 같은 웨이브에서 순차로 처리한다 | |

터미널은 1개다. T1 과 T2 는 `test-command.ts` 와 `process-diagnostics.ts` 로 파일이 갈리지만
T2 가 T1 의 export 를 import 하므로 병렬로 돌릴 수 없다. 병렬 터미널을 만들지 않는다.

## 6. 모델 배분

프로젝트 로컬 지침의 모델 표를 따른다.

| 태스크 | 모델 | 사유 |
|---|---|---|
| T1 | 상위 모델 | 사용자에게 보이는 실패 문안과 잘림 표시 규칙을 설계한다. 계획서에 문자열을 못 박았지만 경계 조합(두 잘림 동시, 빈 줄 처리, 이스케이프와 줄 분할의 순서)이 판단을 요구한다 |
| T2 | 표준 모델 | 파싱과 배선. 계약과 호출 지점이 계획서에 전량 적혀 있다 |
| T3 | 표준 모델 | 사양이 명확한 E2E 추가 |
| T4 | 표준 모델 | 결정이 설계 문서에 이미 적혀 있다 |

## 7. 사람 몫 사전 조건

터미널을 열기 전에 프로젝트 루트에서 두 줄만 확인한다.

```
git log --oneline -1
git status --short
```

- HEAD 가 `origin/main` 과 같은 커밋이어야 한다.
- 워킹트리가 깨끗해야 한다.
- **설계 문서와 이 계획서가 커밋돼 있어야 한다.** untracked 면 새 worktree 에 딸려가지 않는다.
  `ROADMAP.local.md` 는 gitignore 대상이라 커밋으로 전달되지 않는다. 필요하면 실행 프롬프트가
  지시하는 대로 worktree 생성 직후 복사한다.

## 8. 실행 프롬프트

터미널 1개이므로 프롬프트도 1개다. 프로젝트 루트에서 새 터미널을 열고 아래를 그대로 붙여넣는다.

권장 실행 설정: 오케스트레이터 세션은 상위 모델. 태스크 서브에이전트는 §6 의 표대로 T1 은 상위
모델, T2·T3·T4 는 표준 모델. 에이전트 종류는 범용(general-purpose).

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add .claude/worktrees/ohmymcp-cli-process-diagnostics -b feat/cli-process-diagnostics

를 실행한 뒤 그 경로로 세션을 옮겨라. 이어서 루트의 로컬 문서를 worktree 로 복사해라
(gitignore 대상이라 worktree 에 따라오지 않는다).

  cp /Users/doo._.hyun/Study/Project/OhMyMCP/ROADMAP.local.md .claude/worktrees/ohmymcp-cli-process-diagnostics/ 2>/dev/null || true
  cp /Users/doo._.hyun/Study/Project/OhMyMCP/CLAUDE.local.md .claude/worktrees/ohmymcp-cli-process-diagnostics/ 2>/dev/null || true

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라.
  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-cli-process-diagnostics 인지
  - git log --oneline -1 이 루트에서 본 기점 커밋과 같은지
  - docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md 와
    docs/superpowers/plans/2026-08-13-cli-process-diagnostics-implementation.md 가 존재하는지
  - git status --short 가 비어 있는지(복사한 *.local.md 제외)
  - pnpm install 을 실행한 뒤 pnpm vitest --version 과 pnpm typecheck 가 실제로 실행되는지

[2단계: 실행]

너는 이 터미널의 오케스트레이터다. 직접 구현하지 마라. 태스크마다 서브에이전트를 스폰하고,
보고를 받으면 보고서와 diff 와 테스트 결과를 직접 확인한 뒤 다음으로 넘어가라.

계획서: docs/superpowers/plans/2026-08-13-cli-process-diagnostics-implementation.md
설계 문서: docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md

순서는 T1 → T2 → (T3, T4) 다. 앞 태스크의 pnpm test 가 통과하기 전에 다음 태스크를 시작하지
마라.

각 서브에이전트 프롬프트에 다음을 그대로 넣어라.

  - 자기 Task 의 Files 목록 밖 파일을 수정하지 마라. 특히 packages/core, packages/runner,
    packages/generate, packages/record, packages/mock, 루트 빌드 설정, fixtures, examples 는
    공유 계약이다. 수정이 필요해 보이면 고치지 말고 보고해라.
  - core/src/types.ts 의 McpClient / ToolResult 는 동결이다. 제안만 하고 진행하지 마라.
  - 의존 방향은 단방향이다(cli → runner/generate/record/mock → core). 역참조·순환 금지.
  - @modelcontextprotocol/sdk 는 1.x 고정. 목록 밖 의존성을 추가하지 마라.
  - 커밋·푸시·머지는 사람이 한다. git 명령을 실행하지 마라. 백그라운드 실행과 하위 에이전트
    스폰도 금지다.
  - 다른 작업자의 변경을 되돌리지 마라.
  - 유닛테스트는 인메모리와 fixtures 만 쓴다. 실제 서버 프로세스를 띄우는 것은 T3 뿐이다.
  - 최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고 변경 파일, 실행한
    검증 명령과 결과, 보고서 경로, 남은 위험을 포함해라.

모델은 T1 만 상위 모델로, T2·T3·T4 는 표준 모델로 스폰해라.

각 태스크가 끝나면 아래를 직접 확인한 뒤 나에게 보고해라.
  - git status --short 로 변경 파일이 그 Task 의 Files 목록 안에 있는지
  - git diff 로 기존 테스트의 단언이 수정되지 않았는지(수정됐다면 회귀다, BLOCKED)
  - pnpm test, pnpm typecheck, pnpm lint 결과와 각각의 검사 대상 개수
  - 보고서 파일이 실제로 존재하는지

T3 전에는 반드시 pnpm build 를 먼저 돌려라. 낡은 dist 로 판정하면 옛 동작을 검증한다.

전부 끝나면 다음을 실행해 결과를 보고해라. 커밋·푸시·PR 생성은 하지 마라.
  pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm --filter ohmymcp test:e2e
```

## 9. 통합 게이트

1. 각 태스크 완료 후 메인 세션이 보고서, 허용 Files 의 diff, 테스트 결과를 직접 확인한다.
   자식의 "완료" 선언만으로 통합하지 않는다.
2. 기존 테스트의 단언이 바뀌었으면 회귀다. 통합하지 않고 `BLOCKED` 로 보고한다.
3. 통합 직후 SHA 를 `docs/task-integration-ledger.tsv` 에 기록하고 별도 문서 커밋으로 남긴다.
   행 이름은 `T1-cli-process-diagnostics`, `T2-cli-process-diagnostics`,
   `T3-cli-process-diagnostics`, `T4-cli-process-diagnostics` 다.
4. PR 은 하나다. 제목 `feat(cli): 실패 시 서버 프로세스 진단을 출력한다`. 수정 파일이 전부
   `packages/cli/` 와 `docs/` 안이므로 오너 영역이 섞이지 않는다.

## 10. 거짓 신호 점검

판정 전에 아래를 의심한다. 설계 문서 §9 와 프로젝트 로컬 지침의 표를 함께 본다.

- **타입체크·린트 녹색**: 검사 대상이 0개일 수 있다. 출력에서 검사한 파일 수를 확인한다.
- **새 worktree 에서 테스트 타임아웃**: 의존성 미설치다. `pnpm install` 을 먼저 확인한다.
- **E2E 가 계속 옛 동작을 보임**: `dist/` 가 낡았다. `pnpm build` 후 다시 본다.
- **`writes.err` 가 비어서 통과**: 조건 판정이 잘못돼 안 붙었을 수 있다. 통과 케이스와 실패
  케이스를 같은 파일에서 둘 다 단언했는지 확인한다.
- **포함 단언만으로 통과**: 레이아웃이 깨져도 통과한다. §8.1 의 지정 두 건이 전체 문자열 비교인지
  확인한다.
- **E2E 의 stderr 가 비어 통과**: 프로세스 종료 전에 읽었을 수 있다. 종료를 기다린 뒤 판정하는지
  확인한다.

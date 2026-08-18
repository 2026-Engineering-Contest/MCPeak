# Core stdio transport 구현 계획

- 상태: 실행 승인 대기
- 작성일: 2026-08-12
- 설계 기준: [Core stdio transport 및 프로세스 수명주기 설계](../specs/2026-08-12-core-stdio-transport-design.md)
- 결정 기준: [ADR-0001](../../adr/0001-transport-strategy.md)
- 구현 대상: `@ohmymcp-hsu/core`

## 1. 목표

SDK 1.30.0을 사용해 실제 stdio MCP 서버를 실행하고 동결된 `McpClient`로 변환한다. Core가 child
process와 stream 수명주기를 소유하며, 정상 종료와 pending `listTools` 또는 `callTool`에 독립적인
강제 종료를 유한 시간 안에 완료한다.

최종 통과 조건은 다음과 같다.

```text
pnpm exec vitest run packages/core/tests
pnpm --filter @ohmymcp-hsu/core typecheck
pnpm --filter @ohmymcp-hsu/core build
pnpm exec biome check packages/core
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm exec changeset status
```

표적 테스트 출력에는 Core 테스트 파일과 테스트 수가 실제로 나타나야 한다. 실제 process 통합
테스트는 `examples/weather-server/server.mjs`와 `packages/core/tests/fixtures/`만 사용하며 외부
네트워크와 사용자 계정에 접근하지 않는다.

## 2. 비범위와 절대 제약

- `packages/core/src/types.ts`의 `McpClient`, `ToolDef`, `ToolResult`를 변경하지 않는다.
- `@modelcontextprotocol/sdk` 1.30.0을 변경하지 않는다.
- 새 dependency를 추가하지 않는다.
- Runner, CLI, Generate, Record, Mock 구현을 수정하지 않는다.
- root build 설정과 workspace 설정을 수정하지 않는다.
- Streamable HTTP, SSE, WebSocket, OAuth, Docker lifecycle, process tree 종료를 구현하지 않는다.
- Core에서 Runner 타입을 import하지 않는다.
- shell command 문자열을 만들거나 `shell: true`를 사용하지 않는다.
- command, args, env value, cwd, raw stderr를 기본 오류 message와 JSON에 넣지 않는다.
- timestamp, 실행 시간, random ID, PID를 `ToolDef`, `ToolResult`, 오류 JSON에 넣지 않는다.
- 테스트를 production code보다 먼저 작성하고 의도한 RED를 확인한 뒤 GREEN으로 이동한다.
- 구현, 리뷰, 검증 agent는 commit, merge, push를 하지 않는다.
- 다른 작업자의 변경을 되돌리지 않는다.

## 3. 파일 소유권

### 생성

- `packages/core/src/errors.ts`
- `packages/core/src/options.ts`
- `packages/core/src/diagnostics.ts`
- `packages/core/src/controlled-stdio.ts`
- `packages/core/src/lifecycle.ts`
- `packages/core/src/client.ts`
- `packages/core/tests/options.test.ts`
- `packages/core/tests/diagnostics.test.ts`
- `packages/core/tests/errors.test.ts`
- `packages/core/tests/lifecycle.test.ts`
- `packages/core/tests/client.test.ts`
- `packages/core/tests/stdio-integration.test.ts`
- `packages/core/tests/fixtures/handshake-never-completes.mjs`
- `packages/core/tests/fixtures/pending-list-tools.mjs`
- `packages/core/tests/fixtures/pending-call-tool.mjs`
- `.changeset/core-stdio-transport.md`

### 수정

- `packages/core/src/index.ts`
- `packages/core/tests/index.test.ts`
- `packages/core/README.md`
- `packages/core/package.json`, description만 실제 구현 상태에 맞게 수정할 수 있다.

### 수정 금지

- `packages/core/src/types.ts`
- `packages/core/tsconfig.json`
- `packages/core/tsdown.config.mjs`
- `packages/core/package.json`의 dependency와 script
- `examples/weather-server/**`
- `fixtures/**`
- `packages/runner/**`
- `packages/cli/**`
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `turbo.json`
- `tsconfig.base.json`
- `vitest.config.ts`
- `biome.json`

실행 중 보고서는 ignore된 `.agents/reports/`에만 쓴다. 태스크 통합 SHA는
`docs/superpowers/plans/2026-08-12-core-stdio-transport-ledger.tsv`에 메인 세션이 기록하고 사용자가
별도 문서 커밋으로 보존한다.

## 4. 공개 계약

Task 1이 다음 이름과 signature를 확정한다. 이후 태스크는 이름이나 의미를 바꾸지 않는다.

```ts
export interface ConnectOptions {
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  connectTimeoutMs?: number;
  maxMessageBytes?: number;
  maxStderrBytes?: number;
}

export interface McpProcessDiagnostics {
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface McpStdioConnection {
  readonly client: McpClient;
  getDiagnostics(): McpProcessDiagnostics;
  close(): Promise<void>;
  forceClose(): Promise<void>;
}

export type McpClientErrorCode =
  | "PROCESS_START_FAILED"
  | "HANDSHAKE_TIMEOUT"
  | "HANDSHAKE_FAILED"
  | "PROCESS_EXITED"
  | "TRANSPORT_FAILED"
  | "OPERATION_FAILED"
  | "INVALID_TOOL_ARGUMENTS"
  | "PAGINATION_CURSOR_REPEATED"
  | "CLOSE_FAILED"
  | "FORCE_CLOSE_FAILED"
  | "FORCE_CLOSE_TIMEOUT";

export type McpClientErrorPhase =
  | "spawn"
  | "handshake"
  | "process"
  | "transport"
  | "listTools"
  | "callTool"
  | "close"
  | "forceClose";

export class McpClientError extends Error {
  override readonly name = "McpClientError";
  readonly code: McpClientErrorCode;
  readonly phase: McpClientErrorPhase;
  readonly hint: string;
  readonly diagnostics: McpProcessDiagnostics;
  override readonly cause?: unknown;

  constructor(options: {
    code: McpClientErrorCode;
    phase: McpClientErrorPhase;
    diagnostics: McpProcessDiagnostics;
    cause?: unknown;
  });

  toJSON(): Readonly<Record<string, unknown>>;
}

export function connectStdio(options: ConnectOptions): Promise<McpStdioConnection>;
export function connect(options: ConnectOptions): Promise<McpClient>;
```

`McpClientError`의 message와 hint는 code별 고정 dictionary에서 만든다. `toJSON()`은 다음 key만
가진 frozen object다.

```ts
{
  name: "McpClientError";
  code: McpClientErrorCode;
  phase: McpClientErrorPhase;
  message: string;
  hint: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderrTruncated: boolean;
}
```

stderr, cause, command, args, env, cwd는 JSON에 없다.

## 5. 내부 경계

구현 방식이 달라도 다음 package-private 경계를 유지한다.

```ts
export interface ResolvedConnectOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly connectTimeoutMs: number;
  readonly maxMessageBytes: number;
  readonly maxStderrBytes: number;
}

export function resolveConnectOptions(input: ConnectOptions): ResolvedConnectOptions;

export interface BoundedStderr {
  append(chunk: Uint8Array): void;
  snapshot(exitCode: number | null, signal: NodeJS.Signals | null): McpProcessDiagnostics;
}

export interface ControlledStdioTransport extends Transport {
  readonly state:
    | "created"
    | "starting"
    | "handshaking"
    | "open"
    | "closing"
    | "forceClosing"
    | "closed"
    | "failed";
  getDiagnostics(): McpProcessDiagnostics;
  markOpen(): void;
  forceClose(): Promise<void>;
}
```

실제 구현은 test dependency injection을 허용하되 public package root에서 fake clock, spawn factory,
child process handle을 export하지 않는다. 테스트는 내부 module을 직접 import할 수 있다.

## 6. 상태 전이와 시간 계약

Task 2는 다음 상태 전이를 단일 lifecycle controller에 구현한다.

```text
created → starting → handshaking → open

created | starting | handshaking | open
  → closing → forceClosing → closed

created | starting | handshaking | open | closing | forceClosing
  → failed
```

상태 전이 규칙은 다음과 같다.

1. spawn 전 option 검증 실패는 child process를 만들지 않는다.
2. process `spawn` event를 관찰한 시점에도 state가 `starting`일 때만 handshake를 시작한다.
   `closing`, `forceClosing`, `closed`, `failed`에서는 event만 관찰하고 transport start, SDK handshake,
   settled Promise와 진단을 변경하지 않는다.
3. transport start가 resolve되면 `handshaking`이고, SDK initialize와 initialized notification이
   끝난 뒤 `markOpen()`을 정확히 한 번 호출해 `open` connection을 반환한다.
4. spawn과 handshake 실패는 connection을 반환하지 않고 force-close를 시작한다.
5. process close event는 transport `onclose`를 정확히 한 번 호출한다.
6. `close()` 반복 호출은 reference-equal Promise를 반환한다.
7. `forceClose()` 반복 호출은 reference-equal Promise를 반환한다.
8. close 진행 중 force-close가 호출되면 현재 timer를 취소하고 즉시 force-close로 승급한다.
9. force-close가 시작된 뒤 close는 force-close Promise를 반환한다.
10. stdin end, stdout/stderr reader 중단, stdin destroy, `SIGTERM`, `SIGKILL`은 각각 최대 한 번이다.
11. `closed`에서 종료 메서드는 이미 resolve된 terminal Promise를 반환하고 종료 side effect를 반복하지 않는다.
12. 늦은 process event는 listener가 관찰하지만 settled Promise와 최종 진단을 변경하지 않는다.

고정 시간은 다음과 같다.

```ts
const STDIN_CLOSE_GRACE_MS = 500;
const SIGTERM_GRACE_MS = 500;
const SIGKILL_OBSERVE_MS = 500;
```

정확한 500ms 경계에서는 deadline이 우선한다. 정상 close는 stdin end 뒤 500ms, `SIGTERM` 뒤
500ms, `SIGKILL` 뒤 close event 관찰 500ms의 최대 1,500ms다. 모든 timer는 `unref()`한다.

모든 단계는 같은 package-private monotonic clock과 `deadlineAt` 비교를 사용한다. timer callback과
process settlement callback이 모두 `now >= deadlineAt`을 검사하므로 callback 등록 순서가 결과를
바꾸지 않는다. production clock은 wall clock 변경의 영향을 받지 않는 Node monotonic source를
사용하고 테스트는 fake clock을 주입한다.

force-close는 기존 request와 SDK close를 기다리지 않고 reader 중단, stdin destroy, `SIGKILL`,
close event 관찰 순서로 실행한다. process-not-found는 성공이고 권한 또는 다른 kill 오류는
`FORCE_CLOSE_FAILED`다. 500ms 안에 close event가 없으면 `FORCE_CLOSE_TIMEOUT`이고 final state는
`failed`다. 정확히 500ms의 timeout 뒤 늦은 close event가 와도 final state와 진단은 바뀌지 않는다.

정상 close의 stdin end, SDK close, reader 중단 실패는 `CLOSE_FAILED`, phase `close`로 정규화하고
해당 시점의 진단과 cause를 보존한다. close Promise는 reject하고 final state는 `failed`로 고정한다.
동시에 force-close cleanup을 한 번 시작해 cache하며 이후 `forceClose()`는 그 Promise를 반환한다.
cleanup 결과는 이미 확정된 close 오류, state와 진단을 덮지 않는다. 이후 `close()`는 같은 rejected
close Promise를 반환한다.

## 7. 데이터 변환 계약

### 7.1 tools/list

SDK `listTools({ cursor })`를 `nextCursor === undefined`까지 순차 호출한다. page와 tool 순서를
유지하고 정렬하거나 중복 tool을 제거하지 않는다. 같은 cursor 문자열은 빈 문자열을 포함해 두
번째 관찰 즉시 `PAGINATION_CURSOR_REPEATED`로 reject하고 추가 request를 보내지 않는다.

```ts
{
  name: sdkTool.name,
  ...(sdkTool.description === undefined ? {} : { description: sdkTool.description }),
  inputSchema: sdkTool.inputSchema,
}
```

### 7.2 tools/call

name은 비어 있지 않은 문자열이고 args는 JSON object여야 한다. JSON 검증은 explicit stack과
`WeakSet`을 사용해 깊은 입력에서 call stack을 소진하지 않고 cycle을 구분한다. null, array,
undefined, 함수, symbol, BigInt, `NaN`, `Infinity`, `-Infinity`, 순환 참조를 request 전에 거절한다.

표준 결과는 다음과 같다.

```ts
{
  content: sdkResult.content,
  isError: sdkResult.isError ?? false,
  raw: sdkResult,
}
```

SDK compatibility 결과는 다음과 같다.

```ts
{
  content: sdkResult.toolResult,
  isError: false,
  raw: sdkResult,
}
```

서버의 `isError: true`는 resolved `ToolResult`이며 rejection으로 바꾸지 않는다. text content는 JSON
parse하지 않는다.

## 8. Wave와 태스크 의존성

```text
Task 1: 공개 계약, option, error, diagnostics
  ↓ 사용자 리뷰와 구현 commit SHA
  ↓ 통합 대장 기록 commit SHA
Task 2: controlled stdio transport와 lifecycle
  ↓ 사용자 리뷰와 구현 commit SHA
  ↓ 통합 대장 기록 commit SHA
Task 3: SDK McpClient adapter와 실제 process 통합
  ↓ 사용자 리뷰와 구현 commit SHA
  ↓ 통합 대장 기록 commit SHA
Task 4: README, changeset, 전체 회귀 검증
  ↓ 사용자 리뷰와 구현 commit SHA
  ↓ 통합 대장 기록 commit SHA
최종 읽기 전용 리뷰
```

모든 태스크가 `packages/core/src/index.ts`와 선행 public contract에 의존하므로 Wave 하나, terminal
하나, worktree 하나에서 순차 실행한다. 구현 agent와 최종 reviewer만 역할별로 교체한다. 활성
agent는 한 번에 하나만 둔다.

## 9. 모델 배분

| 역할 | 모델 | 추론 | 이유 |
|---|---|---|---|
| Task 1 구현 | `gpt-5.6-terra` | `medium` | 공개 API와 안전한 오류 계약 구현 |
| Task 2 구현 | `gpt-5.6-terra` | `medium` | process lifecycle, timer race, 강제 종료 구현 |
| Task 3 구현 | `gpt-5.6-terra` | `medium` | SDK adapter와 실제 process 통합 테스트 |
| Task 4 문서와 검증 | `gpt-5.6-luna` | `medium` | 범위가 좁고 반복 가능한 문서 및 명령 작업 |
| 최종 리뷰 | `gpt-5.6-terra` | `medium` | 계약, 수명주기, 테스트 누락 통합 검토 |

`gpt-5.6-sol`은 timeout, process 잔존, SDK close 계약 충돌을 terra로 서로 다른 접근을 포함해 두 번
시도한 뒤에도 같은 불확실성이 남거나 구현자와 reviewer 판정이 충돌할 때만 사용한다.

## 10. Task 1: 공개 계약, option, error, diagnostics

### Files

- 생성: `packages/core/src/errors.ts`
- 생성: `packages/core/src/options.ts`
- 생성: `packages/core/src/diagnostics.ts`
- 생성: `packages/core/tests/options.test.ts`
- 생성: `packages/core/tests/diagnostics.test.ts`
- 생성: `packages/core/tests/errors.test.ts`
- 수정: `packages/core/src/index.ts`
- 수정: `packages/core/tests/index.test.ts`

### RED 테스트

다음 이름과 단언을 먼저 작성한다.

| 테스트 이름 | 필수 단언 |
|---|---|
| `연결 옵션 기본값을 결정론적으로 채운다` | 10,000, 10MiB, 64KiB와 빈 args/env |
| `잘못된 구조를 process 시작 전에 거절한다` | 빈 command, args/env/cwd 타입, unknown field에서 path가 있는 `TypeError` |
| `지원하지 않는 Windows command를 시작 전에 거절한다` | win32에서 대소문자가 다른 `.cmd`와 `.bat`도 `TypeError`, spawn 0회 |
| `수치 옵션 경계를 검증한다` | 각 옵션의 0, NaN, ±Infinity, 음수, 소수, 상한+1 reject, 양 경계 accept |
| `연결 옵션을 immutable snapshot으로 복사한다` | 원본 args/env 변경 뒤 resolved value 불변, 중첩 freeze |
| `stderr 최근 byte만 보존한다` | 상한 이하 원문, 초과 시 tail과 truncation true |
| `UTF-8 byte 경계도 안전한 문자열을 반환한다` | partial multibyte가 replacement character이며 throw 없음 |
| `진단 snapshot은 호출마다 새 frozen 값이다` | reference 다름, mutation 불가, 내부 상태 불변 |
| `오류 message와 JSON은 비밀값을 제외한다` | command/args/env/cwd/stderr/cause sentinel이 모든 직렬화 필드에 없음 |
| `오류 code별 message, hint와 phase가 고정된다` | 모든 code를 순회하고 process, transport를 포함한 설계 mapping과 non-empty 고정 문자열 검증 |
| `기존 connect export와 동결 타입을 유지한다` | named export 존재, `McpClient` signature typecheck, `types.ts` diff 없음 |

RED 명령:

```bash
pnpm exec vitest run packages/core/tests/options.test.ts packages/core/tests/diagnostics.test.ts packages/core/tests/errors.test.ts packages/core/tests/index.test.ts
```

### 구현 규칙

- `Object.prototype` 또는 `null` prototype의 plain object만 option/env object로 허용한다.
- unknown field 이름은 안전한 고정 option key 비교 결과이므로 path에 넣을 수 있지만 값은 넣지 않는다.
- `getDefaultEnvironment()` 호출은 Task 2에서 한다. Task 1의 resolved env는 명시적 env snapshot이다.
- stderr buffer는 byte 기준 tail을 보존하고 매 append마다 전체 문자열을 만들지 않는다.
- `McpClientError.diagnostics`와 `toJSON()` 결과는 생성 즉시 freeze한다.
- 기존 `connect()` 스텁은 Task 3 전까지 유지하되 public type export를 새 module에서 가져온다.

### GREEN 검증

```bash
pnpm exec vitest run packages/core/tests/options.test.ts packages/core/tests/diagnostics.test.ts packages/core/tests/errors.test.ts packages/core/tests/index.test.ts
pnpm --filter @ohmymcp-hsu/core typecheck
pnpm --filter @ohmymcp-hsu/core build
pnpm exec biome check packages/core
```

메인 세션은 report, 허용 Files diff, 실제 수집 테스트 수, `types.ts` 무변경을 직접 확인한다. 통과
후 사용자에게 다음 commit을 요청하고 SHA를 확인한다.

```text
feat(core): stdio 연결 공개 계약 추가
```

## 11. Task 2: controlled stdio transport와 lifecycle

### Files

- 생성: `packages/core/src/controlled-stdio.ts`
- 생성: `packages/core/src/lifecycle.ts`
- 생성: `packages/core/tests/lifecycle.test.ts`
- 수정: `packages/core/src/diagnostics.ts`, process event snapshot 연결에 필요한 범위만

### RED 테스트

package-private fake spawn, fake child process, fake monotonic clock을 사용한다.

| 테스트 이름 | 필수 단언 |
|---|---|
| `start는 spawn event 뒤에만 완료된다` | spawn 전 pending, error면 `PROCESS_START_FAILED`, listener 정리 |
| `정상 close는 stdin 종료로 끝낸다` | 499ms signal 0회, exit 관찰 뒤 SIGTERM/SIGKILL 0회 |
| `500ms 경계에서는 SIGTERM이 이긴다` | 정확히 500ms에 stdin exit와 timer가 경쟁해도 SIGTERM 1회 |
| `SIGTERM 뒤 500ms 경계에서는 SIGKILL이 이긴다` | SIGTERM 1회, SIGKILL 1회 |
| `forceClose는 grace timer를 기다리지 않는다` | 호출 turn에 reader 중단, stdin destroy, SIGKILL 1회 |
| `close 도중 forceClose가 오면 승급한다` | 기존 timer 취소, SIGTERM 여부와 무관하게 SIGKILL 최대 1회 |
| `종료 메서드는 reference-equal Promise를 공유한다` | close 반복, force 반복, force 이후 close의 identity와 side effect 횟수 |
| `closed 뒤 종료 메서드는 side effect가 없다` | 자발적 exit와 정상 close 각각 resolved terminal Promise, 추가 종료 동작 0회, state와 진단 불변 |
| `정상 close 단계 실패를 보존한다` | stdin end, SDK close, reader 중단 각각 `CLOSE_FAILED`, phase `close`, frozen 진단, final `failed`, force cleanup 재사용 |
| `process-not-found kill은 성공이다` | reject 없음, final closed |
| `kill 권한 오류를 안전한 실패로 보존한다` | `FORCE_CLOSE_FAILED`, cause는 JSON에 없음 |
| `SIGKILL close event 상한을 지킨다` | 499ms pending, 500ms `FORCE_CLOSE_TIMEOUT`과 final `failed`, 늦은 close 뒤 state와 진단 불변 |
| `forceClose 뒤 늦은 spawn을 무시한다` | starting에서 force-close 뒤 spawn에도 transport start, SDK handshake와 listener 재등록 0회, settled Promise와 진단 불변 |
| `process close는 onclose를 한 번만 호출한다` | close/error 중복 event에도 SDK callback 1회 |
| `stdout protocol 오류는 fatal이다` | 비-JSON, invalid JSON-RPC, message 상한 초과 각각 force-close 1회 |
| `stderr는 fatal이 아니다` | stderr append 뒤 연결 state 유지와 bounded snapshot |
| `모든 lifecycle timer를 unref한다` | timer handle마다 unref 1회 |
| `최종 상태에서 listener를 정리한다` | late error 관찰 handler는 유지하되 공개 state와 Promise 불변 |

RED 명령:

```bash
pnpm exec vitest run packages/core/tests/lifecycle.test.ts
```

### 구현 규칙

- Node `child_process.spawn`을 `shell: false`, `windowsHide: true`, stdio pipe로 호출한다.
- Task 1이 Windows의 `.cmd`와 `.bat` command를 대소문자와 무관하게 `TypeError`로 거절한다.
  Task 2는 검증된 command만 받고 `cmd.exe` wrapping과 command-line quoting을 추가하지 않는다.
  Windows 테스트에서는 spawn 0회와 안전한 고정 오류를 검증한다.
- SDK 1.30.0의 `getDefaultEnvironment()`가 반환하는 플랫폼별 허용 key만 상속하고 resolved explicit
  env를 그 위에 덮어쓴다. Windows 허용 key는 `APPDATA`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`,
  `PATH`, `PROCESSOR_ARCHITECTURE`, `SYSTEMDRIVE`, `SYSTEMROOT`, `TEMP`, `USERNAME`, `USERPROFILE`,
  `PROGRAMFILES`이고, 그 밖의 플랫폼은 `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`다.
  전체 `process.env`를 사용하지 않으며 parent secret sentinel 제외와 explicit 값 우선순위를 테스트한다.
- SDK 공개 `Transport`, `ReadBuffer`, `serializeMessage`만 사용한다.
- transport가 invalid stdout을 관찰하면 `onerror` 뒤 force-close하고 새 message를 처리하지 않는다.
- process `error`와 `close` event 경쟁은 첫 terminal observation만 state를 결정한다.
- close/force Promise를 state 변경 전에 cache해 동시 재진입에도 같은 객체를 반환한다.
- fake dependency는 package root에서 export하지 않는다.

### GREEN 검증

```bash
pnpm exec vitest run packages/core/tests/lifecycle.test.ts packages/core/tests/diagnostics.test.ts packages/core/tests/errors.test.ts
pnpm exec vitest run packages/core/tests
pnpm --filter @ohmymcp-hsu/core typecheck
pnpm --filter @ohmymcp-hsu/core build
pnpm exec biome check packages/core
```

메인 세션은 exact timer 경계, signal 횟수, pending과 독립적인 force path, listener 정리를 직접
검토한다. 통과 후 사용자에게 다음 commit을 요청한다.

```text
feat(core): stdio 프로세스 수명주기 구현
```

## 12. Task 3: SDK adapter와 실제 process 통합

### Files

- 생성: `packages/core/src/client.ts`
- 생성: `packages/core/tests/client.test.ts`
- 생성: `packages/core/tests/stdio-integration.test.ts`
- 생성: `packages/core/tests/fixtures/handshake-never-completes.mjs`
- 생성: `packages/core/tests/fixtures/pending-list-tools.mjs`
- 생성: `packages/core/tests/fixtures/pending-call-tool.mjs`
- 수정: `packages/core/src/index.ts`
- 수정: `packages/core/tests/index.test.ts`
- 수정: `packages/core/src/errors.ts`, SDK error normalization에 필요한 고정 mapping만

### RED 테스트

| 테스트 이름 | 필수 단언 |
|---|---|
| `connect 기존 API는 실제 McpClient를 반환한다` | listTools/callTool/close 존재, lifecycle field 없음 |
| `connectStdio는 동일 client와 lifecycle handle을 반환한다` | identity, diagnostics, close, forceClose |
| `모든 tools/list page를 서버 순서대로 합친다` | cursor request 배열과 final ToolDef deep equality |
| `빈 문자열을 포함한 반복 cursor를 거절한다` | 고정 code, 반복 관찰 뒤 request 0회 |
| `정상 tool 결과를 ToolResult로 변환한다` | content, false, raw exact object |
| `isError true를 resolved ToolResult로 유지한다` | rejection 없음, content와 raw 보존 |
| `compatibility toolResult를 손실 없이 변환한다` | content는 toolResult, false, raw envelope |
| `잘못된 callTool 입력을 request 전에 거절한다` | 모든 invalid JSON fixture에서 SDK call 0회 |
| `과도하게 깊은 JSON object도 raw RangeError를 노출하지 않는다` | explicit stack 검증 뒤 serialization 실패를 `INVALID_TOOL_ARGUMENTS`로 변환, SDK call 0회 |
| `비순환 공유 JSON object를 허용한다` | 같은 child object를 두 key가 참조해도 SDK call 1회 |
| `서버의 작업 protocol 오류를 transport 오류와 구분한다` | listTools와 callTool reject가 `OPERATION_FAILED`, phase와 cause 보존 |
| `spawn 실패를 안전한 오류로 정규화한다` | code, phase, hint, bounded diagnostics, secret JSON 제외 |
| `handshake timeout 뒤 process를 강제 종료한다` | timeout code, SIGKILL 최대 1회, fixture PID 잔존 없음 |
| `handshake와 cleanup 실패를 순서대로 보존한다` | `AggregateError.errors`가 handshake primary, force cleanup 순서 |
| `SDK close 실패를 정상 종료 오류로 보존한다` | `CLOSE_FAILED`, phase `close`, frozen 진단, final `failed`, force cleanup Promise 재사용 |
| `process 조기 종료를 진단과 함께 반환한다` | `PROCESS_EXITED`, phase `process`, exitCode 또는 signal, bounded stderr, safe JSON |
| `비동기 transport 실패의 phase를 고정한다` | 공개 작업 밖 stdout framing 실패가 `TRANSPORT_FAILED`, phase `transport` |
| `weather-server의 실제 도구와 호출 결과를 반환한다` | `get_weather`, `add`, 서울 성공, 미지원 도시 true |
| `weather-server 정상 종료 뒤 process를 남기지 않는다` | injected spawn observer가 기록한 PID에 process-not-found |
| `pending listTools를 forceClose로 끝낸다` | force 전 pending, force 뒤 SDK rejection, child 잔존 없음 |
| `pending callTool을 forceClose로 끝낸다` | listTools와 동일, unhandled rejection 0회 |

client 단위 RED:

```bash
pnpm exec vitest run packages/core/tests/client.test.ts packages/core/tests/index.test.ts
```

실제 process RED:

```bash
pnpm exec vitest run packages/core/tests/stdio-integration.test.ts
```

### 구현 규칙

- SDK `Client` identity는 고정 `{ name: "ohmymcp", version: "0.0.0" }`을 사용하고 runtime 시간이나
  machine 정보를 넣지 않는다.
- SDK `Client.connect(transport, { timeout: connectTimeoutMs })`가 resolve된 뒤 connection을 반환한다.
- connect 실패 catch는 SDK의 내부 close 완료를 기다리기 전에 controlled transport force-close를
  시작하고 cleanup outcome을 보존한다.
- wrapper `client.close()`와 `connection.close()`는 같은 lifecycle Promise를 사용한다.
- operation catch는 process exit 진단이 있으면 `PROCESS_EXITED`, framing/stream이면
  `TRANSPORT_FAILED`, 그 외 SDK protocol 오류는 원래 cause를 보존한 `OPERATION_FAILED`로 변환한다.
- fixture는 외부 network를 사용하지 않고 PID를 test 전용 임시 파일에 기록한다. 임시 경로는
  `mkdtemp`로 만들고 각 테스트 afterEach에서 종료와 정리를 확인한다.
- 실제 process suite는 `describe.sequential`이며 timeout을 명시한다. 실패해도 afterEach에서
  force-close를 시도하고 PID 잔존 여부를 보고한다.

### GREEN 검증

```bash
pnpm exec vitest run packages/core/tests/client.test.ts packages/core/tests/index.test.ts
pnpm exec vitest run packages/core/tests/stdio-integration.test.ts
pnpm exec vitest run packages/core/tests
pnpm --filter @ohmymcp-hsu/core typecheck
pnpm --filter @ohmymcp-hsu/core build
pnpm exec biome check packages/core
```

실제 process 테스트에서 파일명과 수집 수, weather-server 대상 경로, PID 잔존 검사를 메인 세션이
직접 확인한다. 통과 후 사용자에게 다음 commit을 요청한다.

```text
feat(core): 실제 MCP stdio 연결 구현
```

## 13. Task 4: 문서, changeset, 전체 검증

### Files

- 수정: `packages/core/README.md`
- 수정: `packages/core/package.json`, description만 필요한 경우
- 생성: `.changeset/core-stdio-transport.md`

### 문서 계약

README에 다음을 실제 공개 타입과 일치하게 기록한다.

- `connect`로 단순 McpClient를 얻는 예시
- `connectStdio`로 client, diagnostics, close, force-close를 사용하는 예시
- command, args, explicit env, cwd, handshake timeout과 크기 상한
- 전체 process.env를 상속하지 않는 이유
- stderr가 bounded untrusted 진단이고 기본 오류 JSON에 포함되지 않는다는 경고
- stdio만 지원하며 HTTP와 OAuth는 후속이라는 범위
- Windows `.cmd`와 `.bat`는 첫 구현에서 거절하며 executable과 script args 조합을 써야 한다는 제한
- Core는 Runner를 import하지 않고 CLI가 조립한다는 경계

changeset은 `@ohmymcp-hsu/core` minor이며 설명은 한국어로 작성한다.

### 검증

```bash
pnpm exec vitest run packages/core/tests
pnpm --filter @ohmymcp-hsu/core typecheck
pnpm --filter @ohmymcp-hsu/core build
pnpm exec biome check packages/core
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm exec changeset status
git diff --check
git status --short
```

검증 보고서에는 다음을 포함한다.

- Core 표적 테스트 파일 수와 테스트 수
- 실제 process integration test 수와 대상 fixture
- 전체 저장소 테스트 파일 수와 테스트 수
- typecheck와 build가 실제 실행한 package 수
- Biome 검사 파일 수
- changeset status의 Core release 항목
- 허용 Files 밖 변경 없음
- `packages/core/src/types.ts`, SDK version, lockfile 무변경
- child process 잔존 없음

메인 리뷰 통과 후 사용자에게 다음 commit을 요청한다.

```text
docs(core): stdio transport 사용법과 changeset 추가
```

## 14. 태스크별 리뷰와 통합 게이트

각 Task가 `READY_FOR_REVIEW`를 반환해도 다음 Task를 바로 시작하지 않는다. 메인 세션이 다음을
직접 확인한다.

Task 시작 직전 다음 명령으로 HEAD를 `TASK_BASE_SHA`에 기록하고 같은 shell에서 유지한다.

```bash
TASK_BASE_SHA="$(git rev-parse HEAD)"
```

리뷰 시 Task의 Files 절에 적힌 정확한 경로를 정렬한 allowlist 파일을 만든 뒤 tracked와 untracked
변경을 합친 목록과 비교한다.

```bash
: "${TASK_BASE_SHA:?Task 시작 시 기록한 SHA가 필요합니다}"
TASK_AUDIT_DIR="$(mktemp -d)"
git diff --name-only "$TASK_BASE_SHA" > "$TASK_AUDIT_DIR/tracked"
git ls-files --others --exclude-standard > "$TASK_AUDIT_DIR/untracked"
LC_ALL=C sort -u "$TASK_AUDIT_DIR/tracked" "$TASK_AUDIT_DIR/untracked" > "$TASK_AUDIT_DIR/actual"
LC_ALL=C sort -u "$TASK_AUDIT_DIR/allowlist" > "$TASK_AUDIT_DIR/allowed"
comm -23 "$TASK_AUDIT_DIR/actual" "$TASK_AUDIT_DIR/allowed" > "$TASK_AUDIT_DIR/disallowed"
test ! -s "$TASK_AUDIT_DIR/disallowed"
git diff --check "$TASK_BASE_SHA"
git status --short
```

`allowlist`는 glob이 아니라 Task별 Files의 한 줄당 한 경로다. 수정 가능성이 조건부인
`packages/core/package.json`도 Task 4에서 허용하지 않으면 넣지 않는다. `packages/core/src/types.ts`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, root `package.json`, root TypeScript, Turbo, Biome, Vitest 설정과
그 밖의 모든 root 설정은 어느 allowlist에도 넣지 않는다. `disallowed`가 한 줄이라도 있거나 목록
생성에 실패하면 후속 Task를 시작하지 않는다. 검토가 끝나면 `TASK_AUDIT_DIR`만 제거한다.

1. agent report를 읽는다.
2. tracked와 untracked 합집합이 Task의 정확한 allowlist와 일치하는지 확인한다.
3. RED가 의도한 이유로 실패했는지 확인한다.
4. GREEN 명령과 테스트 수를 재실행한다.
5. 설계와 이 계획의 필수 단언을 직접 대조한다.
6. 지적이 있으면 같은 구현 agent에게 `followup_task`로 수정 범위와 재검증 명령을 보낸다.
7. 통과하면 변경 파일, 검증 결과, 남은 위험, 권장 commit message를 사용자에게 보고하고 멈춘다.
8. 사용자가 commit SHA를 제공하면 commit 존재, 현재 HEAD 일치, 현재 기점의 조상 여부를 확인한다.
9. 메인 세션이 통합 대장에 Task와 SHA를 기록하고 사용자의 별도 문서 commit SHA를 확인한다.
10. 두 SHA가 모두 검증된 뒤에만 다음 Task를 시작한다.

agent와 메인 세션은 commit, merge, push를 하지 않는다.

## 15. 단일 terminal 실행 프롬프트

사용자가 실행 전에 확인할 사전 조건은 다음 두 줄이다.

```bash
git log --oneline -1
git status --short
```

첫 명령의 HEAD에는 승인된 ADR, 설계, 구현 계획이 포함돼 있어야 한다. 두 번째 명령 출력은 비어
있어야 한다. 현재 문서가 commit되지 않았거나 Runner 예시 테스트가 untracked인 상태에서는 이
프롬프트를 실행하지 않는다.

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```text
OhMyMCP Core stdio transport 구현 계획을 오케스트레이션해라.

[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

현재 checkout에서 다음 값을 기록해라.

  repo_root="$(git rev-parse --show-toplevel)"
  base_commit="$(git rev-parse HEAD)"
  git_dir="$(git rev-parse --path-format=absolute --git-dir)"
  git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
  current_branch="$(git branch --show-current)"

`git status --short`가 비어 있지 않거나 다음 문서가 base_commit에 없으면 BLOCKED로 끝내라.

  docs/adr/0001-transport-strategy.md
  docs/superpowers/specs/2026-08-12-core-stdio-transport-design.md
  docs/superpowers/plans/2026-08-12-core-stdio-transport-implementation.md
  docs/superpowers/plans/2026-08-12-core-stdio-transport-ledger.tsv

git_dir와 git_common_dir가 다르면 현재 checkout이 이미 연결 worktree다. 중첩 worktree를 만들지
말고 repo_root를 core_worktree로 사용해라. 같으면 다음 값을 계산해라.

  worktree_parent="$(dirname "$repo_root")/OhMyMCP-worktrees"
  core_worktree="$worktree_parent/core-stdio-transport"
  core_branch="feat/core-stdio-transport"

worktree_parent만 `mkdir -p`로 만들 수 있다. core_worktree 경로나 core_branch가 이미 존재하면
삭제하거나 재사용하지 말고 BLOCKED로 끝내라. 다음 명령으로 base_commit에서 worktree를 만들어라.

  git worktree add -b "$core_branch" "$core_worktree" "$base_commit"

새 worktree를 만든 경우 gitignore 대상인 로컬 실행 규약을 원본 작업공간에서 복사해라.

  cp -R "$repo_root/.agents" "$core_worktree/.agents"
  mkdir -p "$core_worktree/docs"
  cp -R "$repo_root/docs/conventions" "$core_worktree/docs/conventions"

현재 checkout이 이미 연결 worktree라면 복사하지 말고 그 위치의 `.agents/`와
`docs/conventions/`가 존재하는지만 확인해라.

core_worktree로 이동한 뒤 다음을 확인해라.

  pwd
  git rev-parse HEAD
  git rev-parse --git-dir
  git rev-parse --git-common-dir
  git branch --show-current
  git status --short

pwd가 기록한 core_worktree와 다르거나 HEAD가 base_commit과 다르거나 승인 문서,
`.agents/skills/execution-conventions/SKILL.md`, `docs/conventions/plan.md`,
`docs/conventions/execution.md`가 없거나 status가 깨끗하지 않으면 구현을 시작하지 말고 BLOCKED로
끝내라.

다음으로 bootstrap하고 도구가 실제 실행되는지 확인해라.

  pnpm install --frozen-lockfile
  pnpm exec vitest run packages/core/tests/index.test.ts
  pnpm --filter @ohmymcp-hsu/core typecheck
  pnpm --filter @ohmymcp-hsu/core build

의존성 설치, 테스트 수집, typecheck, build 중 하나라도 실패하면 agent를 spawn하지 말고 BLOCKED로
끝내라. 출력에 실제 테스트 파일과 Core package가 나타나는지 확인해라.

[2단계: 실행]

프로젝트 지침, plan-conventions, execution-conventions, docs/conventions/plan.md,
docs/conventions/execution.md, ADR, 설계, 구현 계획을 끝까지 읽어라.

Task 1부터 Task 4까지 계획 순서대로 실행한다. 동시에 둘 이상의 agent를 실행하지 않는다. 각 Task
구현 agent에게 실제 core_worktree 절대 경로, 절대 report 경로, 허용 Files, 금지 Files, RED/GREEN
명령, 완료 형식을 message 안에 반복해 넣어라. 표나 이전 message를 참조하게 하지 마라.

agent는 background 실행, commit, merge, push, 하위 agent spawn을 하지 않으며 다른 작업자의
변경을 되돌리지 않는다. 최종 응답은 다음 형식이다.

  status: READY_FOR_REVIEW 또는 status: BLOCKED
  변경 파일
  RED 명령과 실패 이유
  GREEN 명령과 결과 및 수집 수
  report 경로
  남은 위험

READY_FOR_REVIEW 뒤에는 메인 세션이 report, diff, 테스트를 직접 확인한다. 지적은 같은 agent에게
followup_task로 보내고 수정 루프를 반복한다. 통과하면 사용자에게 권장 commit message를 제시하고
멈춘다.

사용자가 구현 commit SHA를 알려주면 다음을 확인한다.

  git cat-file -e SHA^{commit}
  git merge-base --is-ancestor SHA HEAD
  git rev-parse HEAD

HEAD가 SHA와 정확히 같아야 한다. 메인 세션은
docs/superpowers/plans/2026-08-12-core-stdio-transport-ledger.tsv에 Task 번호와 SHA를 append하고
사용자에게 별도 문서 commit을 요청한다. 그 문서 commit SHA도 같은 방식으로 검증한다. 두 commit이
현재 HEAD 조상임을 확인한 뒤 다음 Task를 시작한다.

Task 4와 통합 대장 기록까지 끝나면 최종 읽기 전용 reviewer를 한 번 실행한다. reviewer report와
메인 검증이 모두 통과하기 전에는 완료로 보고하지 않는다.
```

## 16. 네이티브 agent 호출

오케스트레이터는 `coreWorktree`를 §15에서 기록한 실제 절대 경로로 치환한다. 아래 호출의 문자열에
`${coreWorktree}` literal을 남기지 않는다.

### Task 1 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "core_contract",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Core 공개 계약, option, error, diagnostics 구현자.",
    "Worktree: ${coreWorktree}",
    "Report: ${coreWorktree}/.agents/reports/task-1-core-contract.md",
    "첫 명령으로 git rev-parse --show-toplevel을 실행해 Worktree 절대 경로와 같은지 확인한다. AGENTS.md, .agents/skills/execution-conventions/SKILL.md, docs/conventions/execution.md, ADR-0001, Core 설계와 이 구현 계획을 끝까지 읽는다. 하나라도 없거나 경로가 다르면 BLOCKED다.",
    "허용 Files: packages/core/src/errors.ts, packages/core/src/options.ts, packages/core/src/diagnostics.ts, packages/core/src/index.ts, packages/core/tests/options.test.ts, packages/core/tests/diagnostics.test.ts, packages/core/tests/errors.test.ts, packages/core/tests/index.test.ts, .agents/reports/task-1-core-contract.md.",
    "금지: packages/core/src/types.ts, dependency와 lockfile, 다른 package, root 설정 수정, background, commit, merge, push, 하위 agent spawn, 다른 변경 되돌리기.",
    "테스트를 먼저 작성한다. option 기본값은 connect 10000ms, message 10MiB, stderr 64KiB다. 빈 command, args/env/cwd 타입, unknown field, 각 수치의 0/NaN/±Infinity/음수/소수/상한+1과 win32의 .cmd/.bat command를 process 시작 전에 거절하고 양 수치 경계는 허용한다. 원본 변경에도 immutable snapshot이 유지돼야 한다. stderr는 byte-tail과 truncation, partial UTF-8 replacement, 새 frozen snapshot을 검증한다. 모든 McpClientError code의 고정 message/hint/phase와 process, transport phase, stderr/cause/config sentinel이 없는 safe toJSON을 검증한다. 기존 connect stub과 동결 타입은 유지한다.",
    "RED/GREEN: pnpm exec vitest run packages/core/tests/options.test.ts packages/core/tests/diagnostics.test.ts packages/core/tests/errors.test.ts packages/core/tests/index.test.ts. 이후 pnpm --filter @ohmymcp-hsu/core typecheck, build와 pnpm exec biome check packages/core를 실행하고 수집 수를 기록한다.",
    "보고서와 최종 응답은 READY_FOR_REVIEW 또는 BLOCKED, 변경 파일, RED, GREEN, 남은 위험 순서다.",
  ].join("\n").replaceAll("${coreWorktree}", coreWorktree),
});
```

### Task 2 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "core_lifecycle",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP controlled stdio transport와 process lifecycle 구현자.",
    "Worktree: ${coreWorktree}",
    "Report: ${coreWorktree}/.agents/reports/task-2-core-lifecycle.md",
    "첫 명령으로 저장소 루트와 Worktree가 같은지 확인하고, 현재 HEAD가 사용자 승인 Task 1과 통합 대장 commit을 포함하는지 확인한다. AGENTS.md, .agents/skills/execution-conventions/SKILL.md, docs/conventions/execution.md, ADR, 설계, 계획을 끝까지 읽는다.",
    "허용 Files: packages/core/src/controlled-stdio.ts, packages/core/src/lifecycle.ts, packages/core/src/diagnostics.ts, packages/core/tests/lifecycle.test.ts, .agents/reports/task-2-core-lifecycle.md.",
    "금지: public frozen types, index public 이름 변경, SDK version, dependency, 다른 package, root 설정 수정, background, commit, merge, push, 하위 agent spawn, 다른 변경 되돌리기.",
    "테스트를 먼저 작성한다. stdin grace 500ms, SIGTERM grace 500ms, SIGKILL 관찰 500ms이고 exact boundary는 deadline 우선이다. close 반복과 force 반복은 reference-equal Promise, force 뒤 close는 force Promise다. closed 뒤에는 resolved terminal Promise와 side effect 0회다. close 중 force는 timer를 기다리지 않고 승급하며 stdin end/destroy, reader 중단, SIGTERM/SIGKILL, onclose는 각각 최대 1회다. stdin 또는 reader 종료 실패는 CLOSE_FAILED와 final failed이며 force cleanup을 재사용한다. ESRCH는 성공, 권한 오류는 FORCE_CLOSE_FAILED, SIGKILL 뒤 500ms 무응답은 FORCE_CLOSE_TIMEOUT과 final failed이고 늦은 close가 state와 진단을 바꾸지 않는다. forceClose 뒤 늦은 spawn은 transport start, handshake와 listener 재등록을 하지 않는다. invalid stdout/JSON-RPC/message 상한은 TRANSPORT_FAILED와 transport phase, stderr는 nonfatal이고 모든 timer는 unref한다. Node spawn은 shell false이고 SDK 공개 Transport, ReadBuffer, serializeMessage, getDefaultEnvironment만 사용한다. SDK 안전 환경 key만 상속하고 explicit env가 우선하며 parent secret sentinel은 제외한다.",
    "RED: pnpm exec vitest run packages/core/tests/lifecycle.test.ts. GREEN 뒤 Core 전체 테스트, typecheck, build, Biome를 실행하고 수집 수를 기록한다.",
    "보고서와 최종 응답은 READY_FOR_REVIEW 또는 BLOCKED 형식이다.",
  ].join("\n").replaceAll("${coreWorktree}", coreWorktree),
});
```

### Task 3 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "core_sdk_integration",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP SDK McpClient adapter와 실제 process 통합 구현자.",
    "Worktree: ${coreWorktree}",
    "Report: ${coreWorktree}/.agents/reports/task-3-core-sdk-integration.md",
    "첫 명령으로 저장소 루트와 Worktree를 확인하고 HEAD가 승인된 Task 2와 통합 대장 commit을 포함하는지 확인한다. AGENTS.md, .agents/skills/execution-conventions/SKILL.md, docs/conventions/execution.md, ADR, 설계, 계획을 끝까지 읽는다.",
    "허용 Files: packages/core/src/client.ts, packages/core/src/index.ts, packages/core/src/errors.ts, packages/core/tests/client.test.ts, packages/core/tests/index.test.ts, packages/core/tests/stdio-integration.test.ts, packages/core/tests/fixtures/handshake-never-completes.mjs, packages/core/tests/fixtures/pending-list-tools.mjs, packages/core/tests/fixtures/pending-call-tool.mjs, .agents/reports/task-3-core-sdk-integration.md.",
    "금지: core frozen types, weather-server 수정, dependency와 lockfile, 다른 package, root 설정, 외부 network, background, commit, merge, push, 하위 agent spawn, 다른 변경 되돌리기.",
    "테스트를 먼저 작성한다. listTools는 모든 page를 서버 순서대로 합치고 같은 cursor는 빈 문자열도 두 번째 관찰에서 PAGINATION_CURSOR_REPEATED다. callTool은 non-empty name과 JSON object만 허용하고 null/array/undefined/function/symbol/BigInt/비유한 수/cycle/과도한 depth를 SDK 호출 전에 INVALID_TOOL_ARGUMENTS로 거절하되 비순환 공유 참조는 허용한다. 표준과 compatibility ToolResult, isError true resolve, OPERATION_FAILED와 process/transport error 및 phase 구분, SDK close 실패의 CLOSE_FAILED와 force cleanup 재사용, handshake와 cleanup 오류 순서 보존을 검증한다. 실제 process suite는 직렬이며 weather-server 성공과 오류, handshake timeout, pending listTools/callTool force close, PID 잔존 없음을 검사한다.",
    "RED/GREEN은 client/index focused 테스트와 stdio-integration 테스트를 분리 실행한다. 이후 Core 전체 테스트, typecheck, build, Biome를 실행하고 실제 process 테스트 수와 잔존 process 검사를 보고한다.",
    "보고서와 최종 응답은 READY_FOR_REVIEW 또는 BLOCKED 형식이다.",
  ].join("\n").replaceAll("${coreWorktree}", coreWorktree),
});
```

### Task 4 문서와 검증

권장 스폰 설정: `default / gpt-5.6-luna / medium`.

```js
await spawn_agent({
  task_name: "core_docs_verification",
  fork_turns: "none",
  model: "gpt-5.6-luna",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Core 문서, changeset, 전체 검증 담당자.",
    "Worktree: ${coreWorktree}",
    "Report: ${coreWorktree}/.agents/reports/task-4-core-docs.md",
    "첫 명령으로 저장소 루트와 Worktree를 확인하고 HEAD가 승인된 Task 3과 통합 대장 commit을 포함하는지 확인한다. AGENTS.md, .agents/skills/execution-conventions/SKILL.md, docs/conventions/execution.md, ADR, 설계, 계획과 실제 public types를 끝까지 읽는다.",
    "허용 Files: packages/core/README.md, packages/core/package.json의 description, .changeset/core-stdio-transport.md, .agents/reports/task-4-core-docs.md.",
    "금지: package dependency와 script, lockfile, source와 tests, 다른 package와 root README, repository-wide write format, background, commit, merge, push, 하위 agent spawn, 다른 변경 되돌리기.",
    "README에 connect와 connectStdio 예제, explicit env와 안전한 기본 상속, timeout과 크기 상한, bounded untrusted stderr, stdio-only 범위, Windows executable 제한, CLI composition 경계를 실제 export와 일치하게 쓴다. @ohmymcp-hsu/core minor changeset을 한국어로 작성한다. Core 표적 테스트/typecheck/build/Biome 뒤 전체 test/typecheck/lint/build와 changeset status를 실행하고 각 검사 대상 수, frozen types/SDK/lockfile 무변경, 잔존 process 없음을 기록한다.",
    "최종 응답은 READY_FOR_REVIEW 또는 BLOCKED 형식이다.",
  ].join("\n").replaceAll("${coreWorktree}", coreWorktree),
});
```

### 최종 읽기 전용 리뷰

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "core_final_review",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Core stdio transport 최종 읽기 전용 reviewer.",
    "Worktree: ${coreWorktree}",
    "Report: ${coreWorktree}/.agents/reports/final-core-stdio-review.md",
    "첫 명령으로 저장소 루트와 Worktree를 확인하고 승인된 Task 4와 모든 통합 대장 commit이 HEAD 조상인지 확인한다. AGENTS.md, .agents/skills/execution-conventions/SKILL.md, docs/conventions/execution.md, ADR, 설계, 구현 계획을 끝까지 읽는다.",
    "파일 수정, background, commit, merge, push, 하위 agent spawn은 금지한다.",
    "base 이후 diff와 테스트를 읽기 전용 검토한다. frozen types와 package 경계, option validation, safe stderr, SDK 1.30.0, state transition, exact timer race, force-close 독립성, Promise identity, pagination, ToolResult 변환, process 잔존, README와 changeset 일치를 심각도순으로 보고한다.",
    "필요한 read-only 테스트를 실행하고 최종 응답은 READY_FOR_REVIEW 또는 BLOCKED로 시작한다.",
  ].join("\n").replaceAll("${coreWorktree}", coreWorktree),
});
```

## 17. 자체 검토 체크리스트

- [x] 설계 포함 범위가 Task 1부터 Task 4 중 정확히 한 곳에 대응한다.
- [x] 동결된 `McpClient`, `ToolDef`, `ToolResult`는 수정 금지다.
- [x] 공개 계약이 lifecycle과 client adapter보다 먼저 구현된다.
- [x] 판단이 필요한 상태 전이, timer 값, exact boundary와 force 승급 규칙이 전량 명시됐다.
- [x] 테스트 이름과 필수 단언이 실제 fixture 경로와 함께 명시됐다.
- [x] 실제 process 검증은 외부 network 없이 직렬 실행된다.
- [x] 태스크가 같은 public index를 공유하므로 병렬이 아니라 한 worktree에서 순차 실행된다.
- [x] 각 Task에 모델, 추론, 허용 Files, RED/GREEN, report와 완료 형식이 있다.
- [x] 구현, 리뷰, 검증 agent는 commit, merge, push를 하지 않는다.
- [x] 사용자 commit SHA와 통합 대장 commit SHA가 다음 Task의 선행 게이트다.
- [x] 최종 reviewer와 메인 전체 회귀 검증이 별도 게이트다.
- [x] 계획 실행 전 ADR, 설계, 계획이 commit되고 worktree가 깨끗해야 한다.

# Core stdio transport 및 프로세스 수명주기 설계

- 상태: 사용자 승인 완료, 구현 계획 작성 완료
- 작성일: 2026-08-12
- 승인일: 2026-08-12
- 구현 대상: `@ohmymcp/core`
- 선행 결정: [ADR-0001](../../adr/0001-transport-strategy.md)
- 후속 연동: `ohmymcp test`, weather-server E2E

## 1. 목적

Core는 로컬 명령으로 실행할 수 있는 실제 MCP 서버를 자식 프로세스로 시작하고 handshake를
완료한 뒤 동결된 `McpClient`를 제공한다. 정상 종료와 강제 종료는 pending `listTools` 또는
`callTool` 요청에 의존하지 않고 유한 시간 안에 끝나야 한다.

첫 수직 기능의 완료 조건은 다음과 같다.

> `examples/weather-server/server.mjs`에 stdio로 연결한 `McpClient`가 전체 툴 목록을 반환하고,
> `get_weather`와 `add`를 실제로 호출하며, 정상 종료와 permanently pending 요청의 강제 종료 뒤
> 자식 프로세스를 남기지 않는다.

완료 여부는 다음 명령과 관찰 결과로 판정한다.

```text
pnpm exec vitest run packages/core/tests
→ Core 단위 테스트와 직렬 stdio 통합 테스트 전체 통과

pnpm --filter @ohmymcp/core typecheck
→ 공개 타입과 테스트 타입체크 통과

pnpm --filter @ohmymcp/core build
→ ESM, CJS, 선언 파일 생성 성공

pnpm exec biome check packages/core
→ Core 변경 파일 lint와 format 검사 통과
```

전체 저장소 회귀는 `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`로 판정한다. 명령
성공뿐 아니라 Core 테스트 파일과 실제 프로세스 통합 테스트가 수집됐는지 확인한다.

## 2. 범위

### 2.1 포함

- Node.js에서 stdio MCP 서버 프로세스 기동
- SDK 1.30.0 `Client`를 사용한 MCP handshake
- 동결된 `McpClient.listTools`, `callTool`, `close` 구현
- 전체 tools pagination 수집
- MCP SDK 결과를 `ToolDef`와 `ToolResult`로 변환
- 안전한 기본 환경변수 상속과 명시적 환경변수 덮어쓰기
- bounded stderr 수집과 진단 snapshot
- handshake timeout
- 정상 종료, `SIGTERM`, `SIGKILL` 단계
- pending MCP 요청과 독립적인 강제 종료
- 동일 연결의 중복 종료에 대한 멱등성
- 실제 weather-server와 종료 전용 fixture 통합 테스트
- Core 공개 기능을 설명하는 changeset과 README 갱신

### 2.2 제외

- Streamable HTTP, SSE, WebSocket transport
- OAuth와 원격 MCP 인증
- 공개 인프로세스 transport
- Docker container 자체의 생성과 종료
- 자식 프로세스가 다시 만든 전체 process tree 종료
- MCP resources, prompts, sampling, elicitation API
- Runner, CLI, Generate 코드 변경
- `packages/core/src/types.ts`의 `McpClient`, `ToolDef`, `ToolResult` 변경
- `@modelcontextprotocol/sdk` 버전 변경

## 3. 확인된 현재 계약

### 3.1 동결 타입

다음 타입은 구현의 입력이며 변경 대상이 아니다.

```ts
export interface McpClient {
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: unknown): Promise<ToolResult>;
  close(): Promise<void>;
}

export type ToolDef = {
  name: string;
  description?: string;
  inputSchema: unknown;
};

export type ToolResult = {
  content: unknown;
  isError: boolean;
  raw: unknown;
};
```

### 3.2 설치된 SDK

`pnpm-workspace.yaml`은 `@modelcontextprotocol/sdk`를 1.30.0으로 고정한다. 설치된 코드에서 다음을
확인했다.

- SDK `Client.connect(transport, { timeout })`가 transport 시작과 initialize handshake를 수행한다.
- `Client.listTools`와 `Client.callTool`은 request별 timeout과 `AbortSignal`을 받을 수 있다.
- SDK `StdioClientTransport`는 child process PID만 공개하고 child process 객체는 공개하지 않는다.
- SDK 기본 `close()`는 stdin 종료 후 최대 2초, `SIGTERM` 후 최대 2초를 기다린 뒤 `SIGKILL`한다.
- transport가 닫히면 SDK Protocol이 pending request를 `ConnectionClosed`로 reject한다.
- SDK의 안전한 기본 환경변수 목록과 stdio `ReadBuffer`, message serializer를 공개 subpath로
  사용할 수 있다.

Runner의 동결된 `McpClient` 호출에는 `AbortSignal`을 전달할 자리가 없다. 따라서 Runner timeout
뒤 실제 pending SDK request를 끝내는 최종 경계는 transport 종료다.

## 4. 공개 API

기존 `connect(options): Promise<McpClient>`는 호환 API로 유지한다. Runner와 CLI가 강제 종료를
구현할 수 있도록 lifecycle handle을 반환하는 `connectStdio`를 추가한다.

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

export function connectStdio(options: ConnectOptions): Promise<McpStdioConnection>;
export function connect(options: ConnectOptions): Promise<McpClient>;
```

`connect`는 `connectStdio`를 호출하고 `connection.client`를 반환한다. 반환된 client의 `close()`는
같은 connection lifecycle을 닫는다. 단순 사용자는 기존 API를 유지하고, CLI와 transport-aware
adapter는 `connectStdio`를 사용한다.

`McpStdioConnection`은 Runner 타입을 import하지 않는다. 후속 CLI 연동은 다음처럼 조립한다.

```ts
const connection = await connectStdio(options);

const shutdown: McpClientShutdownController = {
  client: connection.client,
  close: () => connection.close(),
  forceClose: () => connection.forceClose(),
};
```

Runner의 force-close reason은 CLI 진단에 사용할 수 있지만 Core 종료 동작을 바꾸지 않는다. 어떤
reason이든 Core는 동일한 즉시 강제 종료 계약을 수행한다.

### 4.1 옵션 기본값과 검증

| 옵션 | 기본값 | 허용값 | 이유 |
|---|---:|---:|---|
| `connectTimeoutMs` | 10,000 | 1..60,000 유한 정수 | 로컬 서버 handshake가 무기한 대기하지 않게 함 |
| `maxMessageBytes` | 10 MiB | 1..64 MiB 유한 정수 | SDK 기본값을 유지하면서 비정상 stdout 메모리 사용을 제한 |
| `maxStderrBytes` | 64 KiB | 1..1 MiB 유한 정수 | 실패 진단을 보존하되 자식 프로세스가 메모리를 고갈시키지 못하게 함 |

다음 입력은 process spawn 전에 reject한다.

- 빈 `command`
- 문자열이 아닌 `args` 원소
- 문자열 값이 아닌 `env` 항목
- 빈 `cwd`
- 알 수 없는 option field
- `0`, `NaN`, `Infinity`, 음수, 소수, 상한을 넘은 수치 옵션

구조 또는 문자열 타입 오류는 `TypeError`, 수치 범위 오류는 `RangeError`다. 오류 메시지에는
option path와 허용 범위를 넣되 command, args, env value, cwd의 실제 값은 넣지 않는다.

`connectStdio`는 검증 직후 option을 깊은 불변 snapshot으로 복사한다. 호출자가 연결 도중 원본
배열이나 객체를 변경해 실행 명령과 환경이 달라지지 않는다.

## 5. 프로세스와 transport 구성

Core는 Node의 child process handle을 직접 소유하는 package-private stdio transport를 구현한다.
이 transport는 SDK의 공개 `Transport` 계약을 만족하고 SDK 1.30.0의 `ReadBuffer`와
`serializeMessage`를 사용한다.

```text
ConnectOptions
→ Core controlled stdio transport
→ child process stdin/stdout/stderr
→ SDK Client handshake와 protocol
→ McpClient adapter
→ McpStdioConnection lifecycle
```

SDK의 `StdioClientTransport`를 그대로 사용하지 않는 이유는 child process 객체가 공개되지 않아
pending request와 독립적인 즉시 `forceClose()`를 확실하게 구현하기 어렵기 때문이다. private
field 접근, type cast를 통한 내부 객체 접근, SDK source monkey patch는 사용하지 않는다.

프로세스는 `shell: false`, `windowsHide: true`로 실행한다. shell command 문자열을 조합하지 않으므로
args의 공백이나 shell 문자가 다시 해석되지 않는다. Windows에서 `.cmd` 또는 `.bat` 실행이 필요한
경우 호출자가 실제 executable 이름을 전달한다. 첫 구현은 shell fallback을 사용하지 않는다.

환경변수는 SDK `getDefaultEnvironment()`의 안전한 기본 목록에 `options.env`를 덮어쓴다. 부모
프로세스의 전체 `process.env`를 자동 상속하지 않는다. Notion token 같은 인증정보는 사용자가
`env`에 명시한 경우에만 자식 프로세스로 전달한다.

## 6. 연결 상태 전이

연결 하나는 다음 상태를 가진다.

```text
created
  → starting
  → handshaking
  → open
  → closing
  → forceClosing
  → closed

created | starting | handshaking | open | closing | forceClosing
  → failed
```

규칙은 다음과 같다.

1. option 검증을 통과한 뒤에만 `starting`으로 이동한다.
2. child process의 `spawn` event 뒤 `handshaking`으로 이동한다.
3. SDK initialize와 initialized notification이 끝난 뒤에만 `open` connection을 반환한다.
4. spawn 또는 handshake 실패 시 connection을 반환하지 않고 즉시 force-close를 시작한다.
5. child process가 스스로 종료하면 transport `onclose`를 정확히 한 번 호출하고 pending SDK
   request를 reject한 뒤 `closed`가 된다.
6. `close()`가 진행 중일 때 `forceClose()`가 호출되면 기존 close 대기를 기다리지 않고 즉시
   `forceClosing`으로 승급한다.
7. `forceClose()`가 시작된 뒤 `close()`를 호출하면 새 종료 동작을 만들지 않고 기존 force-close
   Promise를 반환한다.
8. 같은 종료 메서드의 반복 호출은 같은 Promise를 반환한다.
9. 실제 stdin end, `SIGTERM`, `SIGKILL`, stream destroy는 각각 최대 한 번만 수행한다.
10. 최종 상태와 진단 snapshot은 늦게 도착한 process event가 뒤집지 않는다.

## 7. 정상 종료와 강제 종료

Core의 내부 종료 상한은 Runner 기본 `closeTimeoutMs: 2,000`보다 짧게 유지한다.

| 단계 | 상한 | 동작 |
|---|---:|---|
| stdin 정상 종료 대기 | 500ms | stdin을 end하고 서버의 자발적 종료를 기다림 |
| `SIGTERM` 대기 | 500ms | 살아 있으면 `SIGTERM`을 정확히 한 번 전송 |
| `SIGKILL` 관찰 | 500ms | 그래도 살아 있으면 즉시 force-close하고 close event를 기다림 |

정상 `close()`의 최악 상한은 1,500ms다. 이 값은 Runner의 2,000ms 기본 제한 안에서 Core가 자체
cleanup을 마칠 500ms 여유를 남긴다. exact boundary에서는 deadline이 우선한다. 예를 들어 stdin
종료가 500ms에 관찰되면 `SIGTERM` 단계로 이동한다.

`forceClose()`는 현재 단계와 관계없이 다음 순서로 실행한다.

```text
stdout와 stderr reader 중단
→ stdin destroy
→ 살아 있는 child process에 SIGKILL
→ transport onclose와 SDK pending request reject
→ 최대 500ms 동안 close event 관찰
```

`SIGKILL` 직후 close event가 500ms 안에 관찰되지 않으면 `McpClientError`의
`FORCE_CLOSE_TIMEOUT`으로 reject한다. timeout 뒤에도 모든 process listener는 늦은 close를
관찰해 자원을 정리하지만 이미 반환한 오류를 변경하지 않는다.

`kill()`이 process-not-found를 의미하면 이미 종료된 것으로 보고 성공 처리한다. 권한 오류나 다른
시스템 오류는 `FORCE_CLOSE_FAILED`로 보존한다. `forceClose()`는 pending `listTools`, `callTool`,
SDK `Client.close()` Promise를 기다린 뒤 시작하지 않는다.

Core의 종료 timer는 모두 `unref()`해 종료 대상 process가 이미 사라진 경우 timer만으로 Node
process가 살아 있지 않게 한다.

stdout은 MCP JSON-RPC message 전용이다. JSON이 아닌 줄, 유효하지 않은 JSON-RPC message,
`maxMessageBytes` 초과, stdin 또는 stdout stream 오류는 `TRANSPORT_FAILED` fatal 오류다. 해당
오류를 관찰하면 새 요청을 받지 않고 force-close를 시작한다. 일반 로그는 stderr로만 출력해야 한다.

## 8. McpClient 변환

### 8.1 `listTools()`

SDK `listTools({ cursor })`를 `nextCursor`가 없을 때까지 순차 호출한다. 결과는 page와 tool의 서버
응답 순서를 유지해 하나의 `ToolDef[]`로 반환한다.

```ts
{
  name: sdkTool.name,
  description: sdkTool.description,
  inputSchema: sdkTool.inputSchema,
}
```

같은 cursor 문자열이 두 번 나오면 빈 문자열을 포함해 `PAGINATION_CURSOR_REPEATED` 오류를 내고
추가 요청을 보내지 않는다. 임의 page 상한, 중복 tool 제거, 정렬은 적용하지 않는다. Runner
timeout 뒤 transport가 닫히면 현재 SDK request가 reject되어 pagination도 끝난다.

### 8.2 `callTool(name, args)`

`name`은 비어 있지 않은 문자열이어야 한다. `args`는 JSON object여야 하며 배열, `null`, 함수,
`undefined`, `BigInt`, `NaN`, `Infinity`, 순환 참조를 거절한다. 검증 실패 시 MCP 요청은 0회다.

표준 SDK 결과는 다음처럼 변환한다.

```ts
{
  content: sdkResult.content,
  isError: sdkResult.isError ?? false,
  raw: sdkResult,
}
```

SDK 1.x compatibility 결과가 `{ toolResult }` 형태면 다음처럼 반환한다.

```ts
{
  content: sdkResult.toolResult,
  isError: false,
  raw: sdkResult,
}
```

Core는 text content를 임의로 JSON parse하지 않는다.

서버가 반환한 `isError: true`는 Promise rejection이 아니라 정상 `ToolResult`다. transport 또는
protocol 실패만 rejection으로 전달한다.

## 9. stderr와 진단

stderr는 process 시작 전에 pipe listener를 연결해 초기 오류를 놓치지 않는다. UTF-8 byte 기준
최근 `maxStderrBytes`만 보존하는 ring buffer를 사용한다. 앞부분을 버렸으면
`stderrTruncated: true`다. byte 경계에서 잘린 UTF-8은 Node의 replacement character로 안전한
문자열이 된다.

`getDiagnostics()`는 매번 재귀 동결된 새 snapshot을 반환한다. 호출자가 반환값을 변경해 내부
상태나 다음 진단을 바꿀 수 없다.

stderr는 MCP 서버가 만든 신뢰할 수 없는 값이며 token을 포함할 수도 있다. 따라서 다음 정책을
적용한다.

- 오류의 `message`와 `hint`에 stderr, command, args, env value, cwd를 자동 보간하지 않는다.
- `McpClientError.diagnostics`와 `getDiagnostics()`에서만 bounded stderr를 명시적으로 제공한다.
- 후속 CLI는 출력 전에 별도 redaction 정책을 적용한다.
- Core 오류의 `toJSON()`은 code, phase, message, hint, exitCode, signal, stderrTruncated만 반환하고
  stderr와 cause를 제외한다.

## 10. 오류 모델

```ts
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
  toJSON(): Readonly<Record<string, unknown>>;
}
```

오류 code별 `message`와 `hint`는 고정 dictionary에서 만든다. 실제 서버 문자열과 SDK 오류 message는
자동 보간하지 않는다. 원래 오류는 `cause`에 보존하지만 신뢰할 수 없는 값으로 취급하고
`toJSON()`에서 제외한다. `diagnostics`는 오류 생성 시점의 frozen snapshot이다.

| code | message가 설명할 내용 | hint가 제안할 조치 |
|---|---|---|
| `PROCESS_START_FAILED` | MCP 서버 프로세스를 시작하지 못함 | command 실행 가능 여부와 cwd 확인 |
| `HANDSHAKE_TIMEOUT` | 제한 시간 안에 MCP 초기화를 마치지 못함 | 서버가 stdio MCP인지와 timeout 확인 |
| `HANDSHAKE_FAILED` | MCP 초기화 응답 또는 protocol 협상 실패 | 서버 stderr와 SDK 호환성 확인 |
| `PROCESS_EXITED` | 요청 완료 전 서버가 종료됨 | exit code, signal, bounded stderr 확인 |
| `TRANSPORT_FAILED` | stdio framing 또는 stream 오류 | stdout에 MCP 외 텍스트를 쓰는지 확인 |
| `OPERATION_FAILED` | 서버가 MCP 작업을 protocol 오류로 거절함 | 요청한 tool과 서버 기능 및 진단 확인 |
| `INVALID_TOOL_ARGUMENTS` | callTool 인자가 JSON object가 아님 | object 입력과 JSON 값만 사용 |
| `PAGINATION_CURSOR_REPEATED` | tools/list cursor가 반복됨 | 서버 pagination 구현 확인 |
| `CLOSE_FAILED` | 정상 종료 과정 실패 | 진단 확인 후 force close 결과 확인 |
| `FORCE_CLOSE_FAILED` | 강제 종료 시스템 호출 실패 | 권한과 process 상태 확인 |
| `FORCE_CLOSE_TIMEOUT` | SIGKILL 뒤 close event가 상한 안에 없음 | process 잔존 여부와 운영체제 상태 확인 |

동일 실패에서 protocol 오류와 process exit가 함께 관찰되면 먼저 시작된 공개 작업의 오류를
primary로 유지하고 process 진단은 그 오류의 diagnostics에 넣는다. cleanup 오류가 primary 작업
오류를 덮지 않는다. 둘 이상의 독립 cleanup 오류가 있으면 관찰 순서대로 `AggregateError`에 넣는다.

## 11. 동시성과 결정론성

- `listTools`와 `callTool`의 동시 호출을 Core가 임의 직렬화하지 않는다. Runner가 명세 순서에 따라
  순차 실행한다.
- 각 `listTools` 호출의 page와 tool 순서는 서버 응답 순서를 유지한다.
- timestamp, 실제 실행 시간, PID는 `ToolDef`, `ToolResult`, 공개 오류 JSON에 넣지 않는다.
- stderr는 도착 순서를 유지하고 크기 제한 이외의 정렬이나 내용 변경을 하지 않는다.
- 동일 connection에서 close와 force-close 경쟁 결과는 호출 순서가 아니라 상태 전이 규칙으로
  고정한다. force-close 요청이 관찰되면 항상 force-close가 우선한다.
- process event listener와 timer는 최종 상태에서 모두 제거한다. 늦은 error event는 handler가
  관찰해 unhandled error를 만들지 않지만 공개 결과를 변경하지 않는다.

## 12. 테스트 계약

구현 전에 아래 이름과 단언을 실제 Vitest 실패 테스트로 제시한다.

### 12.1 옵션과 공개 API

| 테스트 이름 | 필수 단언 |
|---|---|
| `connect 기존 API는 McpClient를 반환한다` | `listTools`, `callTool`, `close` 함수 존재, lifecycle field 노출 없음 |
| `connectStdio는 client와 종료 handle을 반환한다` | 동일 client identity, `close`, `forceClose`, `getDiagnostics` 존재 |
| `잘못된 연결 옵션을 process 시작 전에 거절한다` | 빈 command, 잘못된 args/env/cwd, unknown field, 모든 수치 경계에서 spawn 0회 |
| `연결 옵션을 시작 전에 snapshot한다` | 호출 뒤 args/env 변경에도 실제 child 입력 불변 |
| `안전한 기본 환경만 상속한다` | 임의 parent secret은 child에 없음, 명시한 env만 전달, 명시값이 기본값 덮어씀 |

### 12.2 McpClient 변환

| 테스트 이름 | 필수 단언 |
|---|---|
| `모든 tools/list page를 응답 순서대로 합친다` | cursor 요청 순서와 최종 `ToolDef[]` deep equality |
| `반복된 tools/list cursor를 거절한다` | 반복 cursor 관찰 직후 고정 code, 추가 요청 0회 |
| `정상 tool 결과를 ToolResult로 변환한다` | content, `isError: false`, raw 보존 |
| `도구 오류 결과를 rejection으로 바꾸지 않는다` | `isError: true`인 resolved ToolResult |
| `호환 toolResult 결과를 손실 없이 변환한다` | compatibility content와 raw deep equality |
| `JSON object가 아닌 callTool 인자를 호출 전에 거절한다` | null, array, undefined, 함수, BigInt, 비유한 수, 순환 입력에서 SDK 호출 0회 |
| `서버의 작업 protocol 오류를 transport 오류와 구분한다` | listTools와 callTool reject가 `OPERATION_FAILED`, phase와 cause 보존 |

### 12.3 프로세스 수명주기

| 테스트 이름 | 필수 단언 |
|---|---|
| `spawn 실패를 안전한 오류로 보고한다` | 고정 code와 hint, message와 JSON에 command/args/env/cwd 없음 |
| `handshake timeout 뒤 자식 프로세스를 강제 종료한다` | 10,000ms 경계에서 timeout, SIGKILL 최대 1회, process 잔존 없음 |
| `정상 close는 stdin 종료로 끝낸다` | 499ms까지 signal 0회, 자발적 exit면 SIGTERM과 SIGKILL 0회 |
| `정상 종료가 늦으면 SIGTERM 뒤 종료한다` | 500ms에 SIGTERM 1회, SIGKILL 0회 |
| `SIGTERM을 무시하면 SIGKILL한다` | 다음 500ms 경계에 SIGKILL 1회, 총 종료 1회 |
| `forceClose는 pending listTools와 독립적으로 끝난다` | request 미완료 상태에서 즉시 SIGKILL, SDK request reject, child 잔존 없음 |
| `forceClose는 pending callTool과 독립적으로 끝난다` | listTools와 같은 계약, late reject unhandled 없음 |
| `close 도중 forceClose가 오면 즉시 승급한다` | 기존 grace timer를 기다리지 않고 SIGKILL 1회 |
| `종료 API 반복 호출은 같은 Promise와 한 번의 실제 종료를 공유한다` | close/force 각각 identity, stdin end와 signal 횟수 상한 |
| `SIGKILL 뒤 close event가 없으면 유한 시간에 실패한다` | 500ms 경계에서 `FORCE_CLOSE_TIMEOUT`, 늦은 event가 결과를 바꾸지 않음 |
| `stdout protocol 오류는 fatal transport 실패다` | 비-JSON 줄, invalid JSON-RPC, message 상한 초과 각각 고정 code, force-close 1회 |

### 12.4 stderr와 실제 서버 통합

| 테스트 이름 | 필수 단언 |
|---|---|
| `stderr 최근 byte만 bounded 진단으로 보존한다` | byte 상한, truncation flag, 새 frozen snapshot |
| `오류 message와 JSON에 stderr와 비밀값을 넣지 않는다` | sentinel이 message, hint, `JSON.stringify(error)`에 없음 |
| `weather-server의 실제 도구 목록과 성공·오류 호출을 반환한다` | `get_weather`, `add`, 서울 성공, 알 수 없는 도시 `isError: true` |
| `weather-server 정상 종료 뒤 프로세스를 남기지 않는다` | close 완료 뒤 저장한 PID에 process-not-found |

단위 테스트는 package-private fake process와 fake clock을 사용한다. 실제 process 통합 테스트는
`describe.sequential`로 실행하고 외부 MCP, 네트워크, 사용자 계정에 접근하지 않는다. pending과
signal 동작을 만드는 fixture는 `packages/core/tests/fixtures/` 안에서만 만든다.

## 13. 예상 파일 구조

```text
packages/core/src/
├── types.ts                 # 동결, 수정 금지
├── errors.ts                # 고정 code, 안전한 오류와 JSON
├── options.ts               # 런타임 검증과 immutable snapshot
├── diagnostics.ts           # bounded stderr와 frozen snapshot
├── controlled-stdio.ts      # child process handle과 SDK Transport 구현
├── lifecycle.ts             # close, forceClose 상태 전이
├── client.ts                # SDK Client와 McpClient 변환
└── index.ts                 # 공개 API 재수출

packages/core/tests/
├── options.test.ts
├── client.test.ts
├── lifecycle.test.ts
├── diagnostics.test.ts
├── stdio-integration.test.ts
└── fixtures/
    ├── handshake-never-completes.mjs
    ├── pending-list-tools.mjs
    └── pending-call-tool.mjs

.changeset/
└── core-stdio-transport.md
```

`controlled-stdio.ts`는 SDK `Client`를 import하지 않는다. `client.ts`가 controlled transport를 SDK
Client에 주입한다. `lifecycle.ts`는 Runner를 import하지 않는다.

## 14. 패키지 경계와 후속 연동

Core 구현 PR의 허용 범위는 `packages/core/**`, Core changeset 한 파일, 이 ADR과 설계 문서다.
다음 파일은 수정하지 않는다.

```text
packages/core/src/types.ts
packages/runner/**
packages/cli/**
examples/weather-server/**
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json
tsconfig.base.json
vitest.config.ts
biome.json
```

`examples/weather-server/server.mjs`는 읽기 전용 E2E 대상으로 사용한다. 새 의존성은 추가하지 않는다.
구현은 Node 내장 child process와 이미 고정된 SDK 1.30.0 공개 API만 사용한다.

Core PR이 병합된 뒤 별도 CLI와 weather-server E2E PR이 `connectStdio`를 호출한다. CLI가 Core를
직접 의존할지 Runner가 Core 연결을 재수출할지에 대한 기존 미합의 항목은 이 설계에서 다음처럼
해결한다.

```text
cli → core
cli → runner
runner → core의 타입
core → runner import 없음
```

CLI가 composition root이므로 Core와 Runner를 직접 조립한다. Runner가 `connectStdio`를 재수출하지
않는다. 이 dependency 변경은 공유 CLI 영역이므로 Core PR이 아니라 후속 CLI PR에서 팀 승인을
받아 적용한다.

## 15. 명시적 한계와 후속 결정

- Windows `.cmd`와 `.bat` command 탐색 편의성은 첫 도그푸딩 뒤 검토한다. 첫 구현은
  `shell: false`와 사용자가 전달한 executable을 그대로 사용한다.
- process tree 종료는 보장하지 않는다. MCP 서버가 분리된 손자 프로세스를 만들면 별도 process
  group 정책이 필요하다.
- 원격 Streamable HTTP는 request abort, socket 종료, OAuth redaction을 별도 설계한다.
- stderr는 bounded 보관만 하며 Core가 알 수 없는 비밀값을 자동으로 안전하게 판별한다고 주장하지
  않는다. 사용자 출력 전 redaction은 CLI 설계에서 확정한다.
- `ToolResult.content`의 JSON 추출은 Runner 응답 assertion 설계에서 결정하며 Core가 수행하지 않는다.
- SDK 공개 subpath나 close 동작이 바뀌면 1.x 안에서도 설치된 코드와 통합 테스트를 다시 확인한다.

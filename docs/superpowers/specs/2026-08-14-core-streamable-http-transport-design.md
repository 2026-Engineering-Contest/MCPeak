# Core Streamable HTTP transport 설계

- 상태: 초안 (사용자 검토 대기)
- 작성일: 2026-08-14
- 구현 대상: `@mcpeak/core`
- 해결 이슈: [#16 core.connect() 가 Streamable HTTP 를 지원해야 한다](https://github.com/2026-Engineering-Contest/OhMyMCP/issues/16)
- 선행 결정: [ADR-0001](../../adr/0001-transport-strategy.md), [ADR-0020](../../adr/0020-streamable-http-transport.md)
- 선행 설계: [Core stdio transport 및 프로세스 수명주기 설계](./2026-08-12-core-stdio-transport-design.md)

## 1. 목적

Core 는 URL 로 접근하는 원격 또는 로컬 Streamable HTTP MCP 서버에 연결하고, handshake 를
완료한 뒤 동결된 `McpClient` 를 제공한다. stdio 연결과 같은 `McpClient` 를 내놓으므로
`runner`, `generate`, `record` 는 어느 transport 로 붙었는지 알 필요가 없다.

완료 조건은 다음과 같다.

> `connect({ url })` 로 붙은 `McpClient` 가 서버의 전체 툴 목록을 반환하고, 성공 응답과
> `isError` 응답을 모두 매핑하며, 연결 실패 · 상태 코드 오류 · handshake timeout · 세션 상실을
> 서로 다른 오류 코드와 진단으로 구분해 보고하고, 같은 실패를 두 번 일으켰을 때
> `JSON.stringify(error.toJSON())` 이 바이트 단위로 같다.

판정 명령은 다음과 같다.

```text
pnpm exec vitest run packages/core/tests
→ Core 단위 테스트와 HTTP 통합 테스트 전체 통과 (수집된 테스트 파일 수를 눈으로 확인한다)

pnpm --filter @mcpeak/core typecheck
→ 공개 타입과 테스트 타입체크 통과

pnpm --filter @mcpeak/core build
→ ESM, CJS, 선언 파일 생성 성공

pnpm exec biome check packages/core
→ lint 와 format 검사 통과
```

전체 회귀는 `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` 로 판정한다.

## 2. 범위

### 2.1 포함

- `ConnectOptions` 를 stdio 옵션과 HTTP 옵션의 유니온으로 확장
- URL 과 헤더의 검증 · 정규화 (자격증명 제거 포함)
- SDK 1.30.0 `StreamableHTTPClientTransport` 를 사용한 연결과 handshake
- HTTP 연결 진단 타입 신설과 `McpClientError` 진단의 유니온화
- HTTP 전용 오류 코드 6종 추가
- 재연결 정책 고정 (결정론성)
- 세션 종료를 포함한 `close()` 와 멱등성
- 인프로세스 HTTP 테스트 서버 fixture 와 통합 테스트
- README 와 `docs/architecture.md` 2절 표 갱신, changeset

### 2.2 제외

- OAuth (`authProvider`) 와 토큰 갱신. 정적 헤더 주입까지만 한다.
- SSE(`client/sse.js`) 와 WebSocket transport
- 재연결 · 재개(`resumptionToken`, `resumeStream`)
- HTTP 프록시 설정, 커스텀 TLS 신뢰 저장소
- `packages/core/src/types.ts` 의 `McpClient`, `ToolDef`, `ToolResult` 변경
- `@modelcontextprotocol/sdk` 버전 변경
- `runner`, `generate`, `record`, `mock`, `cli` 의 소스 변경
- `examples/` 를 쓰는 E2E. 이 설계의 테스트는 전부 인프로세스다.

## 3. 확인된 현재 계약

### 3.1 동결 타입 (`packages/core/src/types.ts`)

입력이며 변경 대상이 아니다.

```ts
export interface McpClient {
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: unknown): Promise<ToolResult>;
  close(): Promise<void>;
}
```

### 3.2 이슈 #16 본문 중 현재 저장소와 어긋나는 전제

이슈는 `core` 가 스텁이던 시점에 작성됐다. 다음 세 가지는 이미 해소됐고, 이 설계는 남은 하나만
다룬다.

| 이슈의 전제 | 현재 상태 | 근거 |
|---|---|---|
| `core` 가 아직 스텁이다 | 아니다. stdio 연결 · 수명주기 · 진단 · 오류 모델 구현 완료 | `packages/core/src` 8개 파일 1146줄, 테스트 7개 파일 |
| `cli` 에 `core` 를 부를 경로가 없다 | 있다 | `packages/cli/package.json` 의 `"@mcpeak/core": "workspace:*"`, `docs/architecture.md` 7절 |
| 목 경로에서 자기 검증이 막힌다 | 안 막힌다 | `packages/mock/src/stdio.ts` 의 `mcpeak-mock` 진입점 ([ADR-0007](../../adr/0007-mock-stdio-transport.md)) |
| HTTP 로 뜨는 MCP 서버를 테스트할 수 없다 | **여전히 그렇다. 이 설계의 대상이다.** | `packages/core/src/options.ts` 에 URL 을 넣을 자리가 없다 |

이슈 5번("ADR-0001 에 세 번째 선택지 추가")도 따르지 않는다. ADR-0001 은 이미 선택지 C 로
Streamable HTTP 를 검토해 기각했고, 결과 절에서 "stdio E2E 와 도그푸딩 결과가 쌓이면 Streamable
HTTP 지원 여부와 transport 공통 인터페이스를 별도 ADR 에서 결정한다"고 예고했다. 승인된 ADR 을
고치지 않고 예고된 후속 ADR-0020 를 새로 쓴다.

### 3.3 설치된 SDK 1.30.0 실측

버전 인상 없이 아래를 쓴다.

```text
@modelcontextprotocol/sdk/client/streamableHttp.js
  class StreamableHTTPClientTransport implements Transport
    constructor(url: URL, opts?: StreamableHTTPClientTransportOptions)
    get sessionId(): string | undefined
    terminateSession(): Promise<void>
  class StreamableHTTPError extends Error { readonly code: number | undefined }

@modelcontextprotocol/sdk/client/auth.js
  class UnauthorizedError extends Error
```

`StreamableHTTPError.code` 에 들어오는 값은 두 종류다.

- HTTP 상태 코드 (`response.status`). POST 실패, SSE 개방 실패, 세션 종료 실패에서 온다.
- `-1`. 응답 `Content-Type` 이 `application/json` 도 `text/event-stream` 도 아닐 때만 쓴다.
  (`streamableHttp.js:406`)

`reconnectionOptions` 의 SDK 기본값은 `maxRetries: 2`, `initialReconnectionDelay: 1000`,
`reconnectionDelayGrowFactor: 1.5`, `maxReconnectionDelay: 30000` 이다. 6절에서 이 값을 덮는다.

## 4. 공개 API

`packages/core/src/index.ts` 의 기존 표면은 유지하고 아래를 더한다. `connectStdio` 와
`McpStdioConnection` 의 시그니처는 바뀌지 않는다.

```ts
export interface McpHttpConnection {
  readonly client: McpClient;
  getDiagnostics(): McpHttpDiagnostics;
  close(): Promise<void>;
}

/** Streamable HTTP MCP 서버에 연결하고 handshake 를 완료한 뒤 연결을 반환한다. */
export async function connectHttp(options: HttpConnectOptions): Promise<McpHttpConnection>;

/** command 면 stdio, url 이면 Streamable HTTP 로 분기한다. */
export async function connect(options: ConnectOptions): Promise<McpClient>;
```

`connect()` 의 반환 타입은 `Promise<McpClient>` 그대로다. 이것이 `runner` · `generate` ·
`record` 가 영향을 받지 않는 이유다.

`McpHttpConnection` 에 `forceClose()` 를 두지 않는다. 근거는 9절에 있다.

## 5. 옵션 (`packages/core/src/options.ts`)

### 5.1 타입

```ts
export interface StdioConnectOptions {
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  connectTimeoutMs?: number;
  maxMessageBytes?: number;
  maxStderrBytes?: number;
}

export interface HttpConnectOptions {
  url: string;
  headers?: Readonly<Record<string, string>>;
  connectTimeoutMs?: number;
}

export type ConnectOptions = StdioConnectOptions | HttpConnectOptions;

export interface ResolvedHttpConnectOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly connectTimeoutMs: number;
}

export function isHttpConnectOptions(input: ConnectOptions): input is HttpConnectOptions;
export function resolveHttpConnectOptions(input: HttpConnectOptions): ResolvedHttpConnectOptions;
```

`ConnectOptions` 라는 이름과 `index.ts` 의 `export type { ConnectOptions }` 는 그대로다.

**기존 `resolveConnectOptions` 의 이름도 바꾸지 않는다.** 매개변수 타입만 `ConnectOptions` 에서
`StdioConnectOptions` 로 좁힌다. `resolveStdioConnectOptions` 로 개명하면 호출부가
`src/index.ts` 와 `tests/lifecycle.test.ts` 두 곳으로 흩어져 있어 이 설계의 태스크 경계를 가로
지른다. 이름 하나를 위해 파일 소유권을 겹치게 만들 이유가 없다.

`maxMessageBytes` 와 `maxStderrBytes` 는 HTTP 옵션에 두지 않는다. 프레이밍은 SDK 와 `fetch` 가
하고, stderr 에 해당하는 채널이 없다.

### 5.2 분기 판정

`isHttpConnectOptions` 는 `"url" in input` 으로 판정한다. `command` 와 `url` 이 함께 오면
분기 전에 `TypeError("options must set exactly one of command or url")` 로 거절한다. 둘 다
없으면 같은 메시지로 거절한다. 조용히 한쪽을 고르지 않는다.

키 화이트리스트는 두 벌로 나눈다. 기존 `OPTION_KEYS` 는 stdio 전용이 되고
`HTTP_OPTION_KEYS = { url, headers, connectTimeoutMs }` 를 새로 둔다. 교차 키
(`{ url, cwd }`, `{ command, headers }`)는 각 화이트리스트에서 걸려
`options.<키> is not supported` 로 거절된다. 기존 검사 방식(`Reflect.ownKeys` 순회)을 그대로
쓴다.

### 5.3 URL 정규화 규칙

`new URL(input.url)` 로 파싱하고 아래를 강제한다. 전부 프로세스도 소켓도 열기 전에 판정한다.

| 규칙 | 위반 시 |
|---|---|
| 파싱 가능한 절대 URL | `TypeError("url must be an absolute http or https URL")` |
| `protocol` 이 `http:` 또는 `https:` | 같은 메시지 |
| `username` 과 `password` 가 비어 있음 | `TypeError("url must not embed credentials; use the headers option")` |
| `hash` 가 비어 있음 | `TypeError("url must not contain a fragment")` |

정규화 결과는 `parsed.href` 에서 `hash` 를 뺀 문자열이다. 경로를 임의로 붙이거나 지우지
않는다. `/mcp` 는 관례일 뿐 스펙이 아니므로 Core 가 추측하지 않는다.

### 5.4 헤더 검증 규칙

| 규칙 | 위반 시 |
|---|---|
| plain object | `TypeError("headers must be a plain object")` |
| 키가 `/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/` (RFC 9110 token) | `TypeError("headers key <키> is not a valid HTTP token")` |
| 값이 문자열이고 CR · LF · NUL 을 포함하지 않음 | `TypeError("headers.<키> must not contain control characters")` |

값의 내용은 오류 메시지에 넣지 않는다. `Authorization` 이 그대로 흘러나오면 안 되기 때문이다
(11절).

키는 소문자로 정규화해 저장한다. 같은 헤더를 대소문자만 달리해 두 번 준 경우
(`Authorization` 과 `authorization`) `TypeError("headers has a duplicate key: authorization")`
로 거절한다. 마지막 값이 이기는 규칙은 결정론적으로 보이지만 객체 키 순서에 의존하므로 쓰지
않는다.

### 5.5 기본값

`connectTimeoutMs` 는 stdio 와 같은 `NUMERIC_OPTIONS` 규칙을 쓴다. 기본 10000, 최대 60000,
1 미만이나 비정수는 `RangeError`.

## 6. 결정론성 정책

이 프로젝트의 핵심 가치가 결정론성이므로 SDK 기본값 중 시간과 재시도에 의존하는 것을 덮는다.

```ts
new StreamableHTTPClientTransport(new URL(resolved.url), {
  requestInit: { headers: resolved.headers },
  reconnectionOptions: {
    maxRetries: 0,
    initialReconnectionDelay: 1_000,
    maxReconnectionDelay: 1_000,
    reconnectionDelayGrowFactor: 1,
  },
});
```

`maxRetries: 0` 이 이 절의 결정이다. SDK 기본값(2회, 1000ms 에서 1.5배씩 증가)을 그대로 두면
같은 서버 중단이 실행마다 다른 시각에 다른 오류로 관측된다. 우리는 테스트 도구다. 끊긴 연결을
조용히 되살리는 것보다 끊겼다고 즉시 말하는 쪽이 옳다. 재연결이 필요하다는 실사용 근거가
생기면 옵션으로 여는 것을 별도로 결정한다.

`maxRetries` 만 0 으로 두고 나머지 세 값도 함께 고정하는 이유는 `StreamableHTTPReconnectionOptions`
가 네 필드 모두 필수이기 때문이다. 사용되지 않아도 값이 남으므로 결정론적인 값을 넣는다.

세션 ID 는 서버가 만든다. Core 는 `sessionId` 옵션을 주지 않고, 진단에는 관측된 값만 싣는다.
`packages/mock` 은 stateless 모드라 세션 ID 를 발급하지 않으므로 목을 상대로 한 진단의
`sessionId` 는 항상 `null` 이다.

## 7. 진단 모델

### 7.1 결정

`McpProcessDiagnostics` 는 `stderr` · `stderrTruncated` · `exitCode` · `signal` 넷으로
이뤄지며 넷 다 HTTP 에 존재하지 않는다. 세 가지 길이 있었다.

- **A. HTTP 에 빈 프로세스 스냅샷을 준다.** `exitCode: null`, `stderr: ""`. 타입은 안 바뀌지만
  진단이 거짓말을 한다. 사용자는 프로세스가 정상 종료했다고 읽는다. 실패 메시지가 제품인
  프로젝트에서 이건 제품 결함이다.
- **B. 진단을 없애고 오류 메시지만 남긴다.** 이미 stdio 진단에 의존하는 오류 모델을 되돌려야
  한다.
- **C. 태그된 유니온으로 넓힌다.** 채택.

### 7.2 타입 (`packages/core/src/diagnostics.ts`)

```ts
export interface McpProcessDiagnostics {
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface McpHttpDiagnostics {
  /** 자격증명이 제거된 정규화 URL. 헤더는 절대 싣지 않는다. */
  readonly url: string;
  /** 관측된 HTTP 상태 코드. 네트워크 단계에서 실패하면 null. */
  readonly status: number | null;
  readonly statusText: string | null;
  /** 서버가 발급한 Mcp-Session-Id. stateless 서버면 null. */
  readonly sessionId: string | null;
}

export type McpDiagnostics =
  | ({ readonly transport: "stdio" } & McpProcessDiagnostics)
  | ({ readonly transport: "http" } & McpHttpDiagnostics);
```

`createDiagnosticsSnapshot` 은 `transport: "stdio"` 를 붙여 반환한다.
`createHttpDiagnosticsSnapshot(url, status, statusText, sessionId)` 를 새로 두고
`transport: "http"` 를 붙인다. 둘 다 `Object.freeze` 한다.

`McpClientError.diagnostics` 의 타입이 `McpProcessDiagnostics` 에서 `McpDiagnostics` 로
넓어진다. `createMcpClientAdapter` 의 `diagnostics` 콜백 타입도 같이 넓어진다.

### 7.3 외부 영향

없다. `runner` · `generate` · `record` · `cli` 소스를 전수 검색한 결과 core 의 진단 타입을
읽는 곳이 0개다. `packages/generate/src/providers.ts` 의 `diagnostics` 는 이름만 같은 자체
타입이다. `runner/src/diagnostics.ts` 도 자체 모듈이다.

## 8. 오류 모델

### 8.1 추가되는 phase

`McpClientErrorPhase` 에 `"connect"` 를 더한다. HTTP 는 프로세스를 띄우지 않으므로 `"spawn"` 이
맞지 않고, 연결 수립과 MCP handshake 를 구분해야 원인이 드러난다.

### 8.2 추가되는 코드 6종

`MCP_CLIENT_ERROR_DETAILS` 에 아래를 더한다. 기존 11종은 그대로 둔다.

| 코드 | phase | message | hint |
|---|---|---|---|
| `HTTP_CONNECT_FAILED` | `connect` | MCP 서버 URL 에 연결하지 못했습니다. | 서버가 떠 있는지, url 의 host 와 port 가 맞는지 확인하세요. |
| `HTTP_STATUS_ERROR` | `connect` | MCP 엔드포인트가 오류 상태 코드를 반환했습니다. | status 와 경로를 확인하세요. Streamable HTTP 엔드포인트는 보통 `/mcp` 입니다. |
| `HTTP_UNAUTHORIZED` | `connect` | MCP 엔드포인트가 인증을 요구합니다. | headers 옵션으로 토큰을 전달하세요. OAuth 자동 흐름은 아직 지원하지 않습니다. |
| `HTTP_RESPONSE_INVALID` | `connect` | MCP 엔드포인트가 JSON 도 SSE 도 아닌 응답을 반환했습니다. | url 이 MCP 엔드포인트인지 확인하세요. 프록시나 로그인 페이지가 HTML 을 돌려주는 경우가 흔합니다. |
| `HTTP_HANDSHAKE_TIMEOUT` | `handshake` | 제한 시간 안에 MCP 초기화를 마치지 못했습니다. | 서버가 Streamable HTTP MCP 인지와 connectTimeoutMs 를 확인하세요. |
| `HTTP_SESSION_LOST` | `transport` | 서버가 이 연결의 세션을 더 이상 알지 못합니다. | 서버 재시작이나 세션 만료 여부를 확인하세요. 재연결은 지원하지 않으므로 다시 connect 하세요. |

기존 `HANDSHAKE_TIMEOUT` 의 hint 는 "서버가 stdio MCP 인지와 timeout 을 확인하세요" 라서
HTTP 에서 그대로 쓰면 잘못된 곳을 보게 만든다. 그래서 코드를 나눈다.
`PROCESS_START_FAILED` · `PROCESS_EXITED` · `TRANSPORT_FAILED` 는 HTTP 경로에서 절대 발생시키지
않는다. `TRANSPORT_FAILED` 의 hint 가 "stdout 에 MCP 외 텍스트를 쓰는지 확인하세요" 이기
때문이다.

### 8.3 SDK 오류에서 우리 코드로 가는 매핑

`connectHttp` 내부에서 아래 순서로 판정한다. 위에서 걸리면 아래는 보지 않는다.

```text
1. cause instanceof UnauthorizedError                        → HTTP_UNAUTHORIZED (status 401)
2. cause instanceof StreamableHTTPError && code === -1        → HTTP_RESPONSE_INVALID (status null)
3. cause instanceof StreamableHTTPError && code === 401|403   → HTTP_UNAUTHORIZED (status = code)
4. cause instanceof StreamableHTTPError                       → HTTP_STATUS_ERROR (status = code)
5. cause.code === -32001 || cause.code === "RequestTimeout"   → HTTP_HANDSHAKE_TIMEOUT
6. 그 밖                                                       → HTTP_CONNECT_FAILED (status null)
```

6번이 `fetch` 의 `TypeError`(ECONNREFUSED, DNS 실패, TLS 실패)를 받는 자리다. Node 의
`fetch` 는 원인을 `cause` 에 중첩하므로 우리 `McpClientError.cause` 에 원본을 그대로 넘겨
디버깅 정보를 잃지 않게 한다. 다만 `message` 와 `toJSON()` 에는 싣지 않는다.

연결이 수립된 뒤(`listTools` · `callTool` 중) 발생하는 오류는 `createMcpClientAdapter` 의
`operationFailureKind` 를 통한다. HTTP 연결은 아래를 반환한다.

```text
StreamableHTTPError && code === 404 && sessionId !== null   → HTTP_SESSION_LOST
그 밖                                                        → 기존 OPERATION_FAILED
```

`404` 여도 세션 ID 를 받은 적이 없으면 세션 상실이 아니라 잘못된 경로다. 그래서 조건에
`sessionId !== null` 을 넣는다.

### 8.4 `toJSON()` 분기

현재 `toJSON()` 은 `exitCode` · `signal` · `stderrTruncated` 를 싣는다. transport 별로 나눈다.

```ts
// transport === "stdio" (기존과 동일)
{ name, code, phase, message, hint, exitCode, signal, stderrTruncated }

// transport === "http"
{ name, code, phase, message, hint, url, status, statusText, sessionId }
```

`transport` 필드도 함께 싣는다. 소비자가 어느 모양인지 분기할 수 있어야 한다.

## 9. 종료 정책

```ts
async function close(): Promise<void>;
```

1. 이미 닫혔으면 즉시 반환한다 (멱등).
2. `transport.sessionId` 가 있으면 `transport.terminateSession()` 을 호출한다. 실패는 삼킨다.
   서버가 405 를 돌려주는 것이 스펙상 허용된 동작이고, 종료를 실패로 만들 이유가 없다.
3. `sdk.close()` 를 호출한다. SDK 가 transport 를 닫고 내부 `AbortController` 로 진행 중인
   요청을 끊는다.
4. 3번이 던지면 `CLOSE_FAILED` 로 감싸 던진다.

`forceClose()` 를 두지 않는다. stdio 의 `forceClose` 는 pending 요청과 무관하게 자식 프로세스를
`SIGKILL` 하려고 존재한다. HTTP 에는 죽일 프로세스가 없고 `close()` 자체가 abort 로 pending
요청을 끊으므로, 같은 이름의 두 번째 종료 경로는 의미 없는 API 표면만 늘린다.

`close()` 뒤에 남은 pending 요청은 reject 된다. 이 계약을 12절에서 검증한다.

## 10. McpClient 변환

바뀌지 않는다. `createMcpClientAdapter` 는 SDK `Client` 만 알고 transport 를 모른다.
pagination 수집, `toolResult` 형태와 표준 `content` 형태 처리, `assertToolArguments` 가 모두
그대로 적용된다. 이 절이 짧은 것이 이 설계가 싼 이유다.

바뀌는 것은 어댑터가 받는 두 콜백의 타입뿐이다.

```ts
createMcpClientAdapter(
  sdk: SdkClient,
  diagnostics: () => McpDiagnostics,   // McpProcessDiagnostics 에서 넓어짐
  close: () => Promise<void>,
  operationFailureKind: () => OperationFailureKind,
)
```

`OperationFailureKind` 는 `"process" | "transport" | undefined` 에 `"httpSession"` 을 더한다.
HTTP 연결은 `"process"` 를 절대 반환하지 않는다.

## 11. 비밀값 노출 금지

`record` 가 카세트에서 비밀값을 가리는 것과 같은 이유로 진단에도 규칙을 둔다.

- `headers` 의 값은 진단 · 오류 메시지 · `toJSON()` 어디에도 싣지 않는다. 키 이름도 싣지
  않는다.
- `url` 은 5.3 에서 자격증명을 이미 거절했으므로 진단에 그대로 싣는다. 쿼리 문자열은 남긴다.
  토큰을 쿼리로 받는 서버가 있지만, 경로 일부를 지우면 어느 엔드포인트에 붙었는지 알 수 없어
  진단이 쓸모없어진다. 이 한계는 15절에 적는다.
- SDK 가 만든 오류 메시지(`Error POSTing to endpoint: <서버 응답 본문>`)를 우리 `message` 에
  이어붙이지 않는다. 우리 메시지는 고정 문자열이고 서버 본문은 `cause` 에만 남는다. 결정론성도
  이 규칙에서 함께 나온다.

## 12. 테스트 계약

전부 인프로세스다. `examples/` 프로세스를 띄우지 않으므로 병렬 터미널에서 안전하다.
`core` 는 `mock` 을 의존할 수 없으므로(의존 방향 역전) 테스트 전용 서버 fixture 를 따로 둔다.

### 12.0 fixture

`packages/core/tests/fixtures/http-server.ts` 를 새로 만든다.

```ts
export interface TestHttpServer {
  readonly url: string;          // http://127.0.0.1:<포트>/mcp
  close(): Promise<void>;
}

/** SDK McpServer + StreamableHTTPServerTransport(stateless) 를 127.0.0.1:0 에 띄운다. */
export function startMcpHttpServer(options: {
  tools: readonly { name: string; description?: string; inputSchema: unknown }[];
  onCall?: (name: string, args: unknown) => unknown;
  pageSize?: number;             // 지정 시 tools/list 를 cursor 로 나눠 돌려준다
}): Promise<TestHttpServer>;

/** MCP 를 흉내내지 않고 지정한 상태 코드 · 본문 · 지연만 돌려주는 원시 서버. */
export function startRawServer(options: {
  status?: number;
  contentType?: string;
  body?: string;
  delayMs?: number;              // 응답을 지연시켜 handshake timeout 을 만든다
}): Promise<TestHttpServer>;
```

포트는 `0` 으로 받아 OS 가 정한다. 진단 단언에 포트 번호를 쓰지 않는다.

### 12.1 `tests/options.test.ts` (기존 파일에 추가)

- `resolveHttpConnectOptions({ url: "http://127.0.0.1:8080/mcp" })` 가
  `{ url: "http://127.0.0.1:8080/mcp", headers: {}, connectTimeoutMs: 10_000 }` 와 `toEqual`
- 반환값이 `Object.isFrozen` 이고 `headers` 도 동결됐다
- 다음 입력이 `TypeError` 이며 메시지에 괄호 안 문자열을 포함한다
  - `{ url: "" }` (`url`)
  - `{ url: "not a url" }` (`url`)
  - `{ url: "ftp://host/mcp" }` (`http or https`)
  - `{ url: "http://user:pw@host/mcp" }` (`credentials`)
  - `{ url: "http://host/mcp#frag" }` (`fragment`)
  - `{ url: "http://host/mcp", headers: { "bad key": "v" } }` (`HTTP token`)
  - `{ url: "http://host/mcp", headers: { "x-a": "v\r\nInjected: 1" } }` (`control characters`)
  - `{ url: "http://host/mcp", headers: { Authorization: "a", authorization: "b" } }`
    (`duplicate key`)
  - `{ url: "http://host/mcp", headers: { "x-a": 1 } }` (`x-a`)
  - `{ url: "http://host/mcp", cwd: "/tmp" }` (`cwd is not supported`)
  - `{ command: "node", url: "http://host/mcp" }` (`exactly one of command or url`)
  - `{}` (`exactly one of command or url`)
- `{ url, connectTimeoutMs: 0 }` 과 `{ url, connectTimeoutMs: 60_001 }` 이 `RangeError`
- 헤더 키가 소문자로 정규화된다: `{ Authorization: "Bearer x" }` 의 결과 키가 `authorization`
- **헤더 값이 오류 메시지에 안 나온다**: `{ "x-a": "\r\n" }` 을 거절한 오류의 `message` 에
  `"\r\n"` 이 아닌 키 이름만 있다
- `isHttpConnectOptions({ command: "node" })` 가 `false`, `isHttpConnectOptions({ url })` 이
  `true`
- 기존 stdio 케이스 전부 그대로 통과한다 (회귀)

### 12.2 `tests/diagnostics.test.ts` (기존 파일에 추가)

- `createDiagnosticsSnapshot(...)` 결과의 `transport` 가 `"stdio"` 이고 나머지 네 필드는 기존과
  동일하다
- `createHttpDiagnosticsSnapshot("http://h/mcp", 404, "Not Found", "s1")` 이
  `{ transport: "http", url: "http://h/mcp", status: 404, statusText: "Not Found", sessionId: "s1" }`
  와 `toEqual` 이고 `Object.isFrozen`

### 12.3 `tests/errors.test.ts` (기존 파일에 추가)

- 신규 6종 각각의 `phase` 와 `hint` 가 8.2 표와 일치한다
- 신규 6종의 `message` 에 `stdio`, `stdout`, `process`, `exit` 문자열이 없다
- HTTP 진단으로 만든 오류의 `toJSON()` 키 집합이
  `["name","code","phase","message","hint","transport","url","status","statusText","sessionId"]`
  와 정확히 같다. `exitCode` 와 `signal` 이 없다
- stdio 진단으로 만든 오류의 `toJSON()` 키 집합이 기존과 같고 `transport: "stdio"` 만 늘었다
- `toJSON()` 결과에 `headers` 값 문자열이 없다

### 12.4 `tests/http-integration.test.ts` (신규)

각 케이스는 자기 서버를 띄우고 `afterEach` 에서 닫는다.

1. `connect({ url })` 이 반환한 클라이언트의 `listTools()` 가 서버가 등록한 툴 이름과 설명을
   순서대로 반환한다
2. `callTool("echo", { text: "hi" })` 가 `{ isError: false }` 이고 `content` 가 서버 응답과
   같다
3. 서버가 `isError: true` 를 돌려주면 `ToolResult.isError` 가 `true` 이고 던지지 않는다
4. `callTool("echo", "문자열")` 이 `INVALID_TOOL_ARGUMENTS` 로 거절되고 네트워크 요청이 나가지
   않는다 (fixture 의 호출 카운터가 0)
5. `pageSize: 1` 로 툴 3개를 띄우면 `listTools()` 가 3개를 모두 모아 반환한다
6. 같은 cursor 를 반복하는 서버에 대해 `PAGINATION_CURSOR_REPEATED` 를 던지고 무한 루프에 빠지지
   않는다
7. 아무도 듣지 않는 포트로 `connect` 하면 `HTTP_CONNECT_FAILED`, `phase === "connect"`,
   `diagnostics.transport === "http"`, `diagnostics.status === null`
8. `startRawServer({ status: 500 })` 에 붙으면 `HTTP_STATUS_ERROR` 이고
   `diagnostics.status === 500`
9. `startRawServer({ status: 401 })` 에 붙으면 `HTTP_UNAUTHORIZED`
10. `startRawServer({ status: 200, contentType: "text/html", body: "<html>" })` 에 붙으면
    `HTTP_RESPONSE_INVALID`
11. `startRawServer({ delayMs: 5_000 })` 에 `connectTimeoutMs: 200` 으로 붙으면
    `HTTP_HANDSHAKE_TIMEOUT` 이고, 실패까지 걸린 시간이 2초 미만이다
12. 연결 성공 뒤 서버를 닫고 `callTool` 하면 던지는 오류의 `code` 가
    `PROCESS_EXITED` · `PROCESS_START_FAILED` · `TRANSPORT_FAILED` 중 어느 것도 아니다
13. 세션을 발급하는 서버가 세션을 잊은 뒤(404) `callTool` 하면 `HTTP_SESSION_LOST`
14. `close()` 를 두 번 호출해도 던지지 않는다
15. `terminateSession` 에 405 를 돌려주는 서버에서도 `close()` 가 정상 반환한다
16. `close()` 뒤 pending 이던 `callTool` 이 유한 시간 안에 reject 된다
17. `connect({ url })` 의 반환 타입이 `McpClient` 이며 `getDiagnostics` 를 노출하지 않는다
    (`connectHttp` 만 노출한다)
18. `headers: { authorization: "Bearer test-token" }` 을 준 연결에서 서버가 받은 요청 헤더에
    그 값이 들어 있다

### 12.5 결정론성

19. 7번 실패(연결 거부)를 두 번 일으켜 `JSON.stringify(err.toJSON())` 두 값이 문자열로 같다.
    포트가 다르면 다르므로 **같은 포트 번호**로 두 번 시도한다
20. 8번 실패를 두 번 일으켜 같은 비교를 한다
21. 1번 성공 경로를 두 번 실행해 `JSON.stringify(await listTools())` 두 값이 같다

### 12.6 기존 테스트 수정

22. stdio 진단을 `toEqual` 로 비교하는 기존 단언에 `transport: "stdio"` 를 더한다.
    대상은 `tests/diagnostics.test.ts`, `tests/errors.test.ts`, `tests/index.test.ts`,
    `tests/stdio-integration.test.ts` 중 실제로 깨지는 곳만 고친다. 단언을 느슨하게
    (`toMatchObject` 로) 바꾸지 않는다

## 13. 예상 파일 구조

```text
packages/core/src/
  options.ts              수정  HttpConnectOptions, 분기, URL·헤더 검증
  diagnostics.ts          수정  McpHttpDiagnostics, McpDiagnostics, http 스냅샷
  errors.ts               수정  phase "connect", 코드 6종, toJSON 분기
  client.ts               수정  진단 타입 확장, OperationFailureKind 에 httpSession
  http-transport.ts       신규  SDK 오류를 McpClientError 로 옮기는 매핑, 재연결 고정
  index.ts                수정  connectHttp, connect 분기
  controlled-stdio.ts     변경 없음
  lifecycle.ts            변경 없음

packages/core/tests/
  fixtures/http-server.ts    신규
  http-integration.test.ts   신규
  options.test.ts            수정
  diagnostics.test.ts        수정
  errors.test.ts             수정

docs/
  adr/0020-streamable-http-transport.md   신규
  adr/README.md                            수정 (색인 한 줄)
  architecture.md                          수정 (2절 core 입력 칸)
packages/core/README.md                    수정
.changeset/*.md                            신규
```

`lifecycle.ts` 와 `controlled-stdio.ts` 를 건드리지 않는 것이 이 설계의 경계다. HTTP 경로는
프로세스 수명주기 코드를 한 줄도 재사용하지 않는다.

## 14. 패키지 경계

- 의존 방향 변화 없음. `core` 는 여전히 아무 내부 패키지도 import 하지 않는다.
- 새 런타임 의존성 없음. `@modelcontextprotocol/sdk` 1.30.0 안에서 끝난다.
- `runner` · `generate` · `record` · `mock` · `cli` 소스 변경 없음. `connect()` 의 반환 타입이
  `Promise<McpClient>` 그대로이기 때문이다.
- `docs/architecture.md` 2절 표의 `core` 입력 칸을
  `ConnectOptions (command·args·env·cwd 또는 url·headers)` 로 갱신한다.
- CLI 가 `--url` 플래그를 받는 것은 이 설계 밖이다. `cli` 오너의 결정이며 별도 이슈로 넘긴다.

## 15. 명시적 한계와 후속 결정

- **OAuth 미지원.** `authProvider` 를 붙이지 않는다. 401 을 만나면 `HTTP_UNAUTHORIZED` 로
  끝난다. 실제 원격 MCP 도그푸딩에서 필요해지면 별도 ADR 로 연다.
- **재연결 미지원.** 6절의 결정에 따라 끊기면 실패한다.
- **쿼리 문자열 토큰은 진단에 남는다.** 11절 참조. 쿼리를 통째로 지우면 진단 가치가 사라져서
  택하지 않았다. 필요하면 마스킹 규칙을 `record` 와 맞춰 별도로 정한다.
- **`http://` 평문을 막지 않는다.** 로컬 목 서버가 평문이기 때문이다. 원격 host 에 대한 경고를
  낼지는 CLI 계층의 결정으로 남긴다.
- **stdio 와 HTTP 의 공통 transport 추상화를 만들지 않는다.** ADR-0001 이 "검증되지 않은 공통
  계층이 먼저 생기는 것"을 경계했다. 두 경로의 종료 정책이 실제로 다르므로 이번에도 만들지
  않는다. 세 번째 transport 가 생길 때 다시 판단한다.

# @ohmymcp/core

`@ohmymcp/core`는 MCP 서버에 붙어 handshake를 완료한 뒤 동결된 `McpClient`를 제공한다.
transport는 두 가지다. 로컬 서버는 프로세스를 stdio로 시작해서 붙고, 원격 서버는 URL에
Streamable HTTP로 붙는다. stdio 경로에서 서버 프로세스, stdin/stdout, bounded stderr와 종료
수명주기는 Core가 소유한다.

## 공개 API

간단히 사용할 때는 `connect`로 동결된 클라이언트만 받을 수 있다.

```ts
import { connect } from "@ohmymcp/core";

const client = await connect({
  command: process.execPath,
  args: ["./server.mjs"],
  env: { MCP_MODE: "test" },
  cwd: process.cwd(),
  connectTimeoutMs: 10_000,
  maxMessageBytes: 10 * 1024 * 1024,
  maxStderrBytes: 64 * 1024,
});

try {
  const tools = await client.listTools();
  const result = await client.callTool("get_weather", { city: "Seoul" });
  console.log(tools, result);
} finally {
  await client.close();
}
```

CLI나 다른 composition root에서 정상 종료와 즉시 강제 종료를 구분해야 하면 `connectStdio`를
사용한다.

```ts
import { connectStdio } from "@ohmymcp/core";

const connection = await connectStdio({
  command: "node",
  args: ["./server.mjs"],
  env: { MCP_MODE: "test" },
  cwd: process.cwd(),
});

try {
  await connection.client.listTools();
} finally {
  await connection.close();
  // pending MCP 요청과 무관하게 종료해야 할 때:
  // await connection.forceClose();
}

console.log(connection.getDiagnostics());
```

`connect`는 `connectStdio(options)`의 `connection.client`를 반환한다. `ConnectOptions`는
`command`, `args`, 명시적인 `env`, `cwd`, handshake 제한 시간, stdout 메시지 최대 크기와 stderr
최대 크기를 받는다. 기본값은 각각 10초, 10 MiB, 64 KiB다. 값은 유한한 정수여야 하며 허용
범위를 벗어나면 자식 프로세스를 시작하기 전에 실패한다.

환경변수는 전체 `process.env`를 상속하지 않는다. 부모 환경에는 인증 토큰 같은 비밀값이 섞일 수
있고, 실행마다 달라지는 값이 테스트 결정론성을 깨뜨릴 수 있기 때문이다. SDK가 허용한 안전한
기본 환경변수만 전달하며, 추가 값은 `env`에 명시한 경우에만 자식 프로세스로 전달한다.

stderr는 신뢰할 수 없는 자식 프로세스 입력으로 취급한다. 최근 byte만 bounded buffer에 보존하며
기본 상한은 64 KiB다. stderr 내용은 진단 snapshot에는 포함될 수 있지만 기본 오류 message와
`McpClientError.toJSON()`에는 포함되지 않는다. 오류 JSON에는 code, phase, 고정된 message와 hint,
exit code, signal, stderr 잘림 여부만 들어간다.

실행은 shell을 거치지 않으므로 `args`가 공백이나 shell 문자를 포함해도 다시 해석되지 않는다.
Windows에서는 `.cmd`와 `.bat` command를 거절한다. 운영체제가 직접 실행할 수 있는 executable을
`command`로 주고, script 경로와 script 인자는 `args`로 전달한다. Windows command wrapping과
command-line quoting은 이 transport의 범위가 아니다.

SSE, WebSocket, OAuth 기반 원격 인증은 후속 설계와 ADR에서 별도로 결정한다.

## Streamable HTTP로 연결하기

URL로만 접근할 수 있는 MCP 서버에는 `command` 대신 `url`을 준다. 같은 `connect`가 옵션 모양을
보고 transport를 고른다.

```ts
import { connect } from "@ohmymcp/core";

const token = process.env.MCP_TOKEN;
if (!token) throw new Error("MCP_TOKEN is required");

const client = await connect({
  url: "https://mcp.example.com/mcp",
  headers: { Authorization: `Bearer ${token}` },
  connectTimeoutMs: 10_000,
});

try {
  const tools = await client.listTools();
  console.log(tools);
} finally {
  await client.close();
}
```

`HttpConnectOptions`는 `url`, 선택적 `headers`, 선택적 `connectTimeoutMs`만 받는다. 프로세스가
없으므로 `forceClose`도 없고, `close()`가 내부 abort로 pending 요청을 끊는다. 실패 진단은
`transport: "http"`로 태그되며 `url`, `status`, `statusText`, `sessionId`를 싣는다. 헤더 값은
진단이나 오류 JSON 어디에도 실리지 않는다.

**OAuth와 재연결은 지원하지 않는다.** 인증은 직접 만든 `headers`로만 붙이고 401은
`HTTP_UNAUTHORIZED`로 끝나며, 연결이 끊기면 재시도 없이 즉시 실패한다(자세한 이유는
[ADR-0020](https://github.com/2026-Engineering-Contest/OhMyMCP/blob/main/docs/adr/0020-streamable-http-transport.md)
참조).

Core는 Runner를 import하지 않는다. Runner는 `McpClient`를 주입받고, CLI가 `connectStdio`의
`client`, `close`, `forceClose`를 Runner의 shutdown 경계에 조립하는 composition root다.

## 범위와 안정성

`src/types.ts`의 `McpClient`, `ToolDef`, `ToolResult`는 패키지 간 동결 계약이다. Core는
`@modelcontextprotocol/sdk` 1.x를 사용하며 SDK 버전을 올리지 않는다.

오너: `@seodduu` `@endl24` `@sunghoon0303` (MCP 서버 테스트 파트)

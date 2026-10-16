**English** · [한국어](./README.ko.md)

# @mcpeak/core

`@mcpeak/core` attaches to an MCP server, completes the handshake, and then provides a frozen `McpClient`.
There are two transports. A local server is attached by starting its process over stdio, and a remote server is attached at a URL
over Streamable HTTP. On the stdio path, Core owns the server process, stdin/stdout, bounded stderr, and the shutdown
lifecycle.

## Public API

For simple use, `connect` gives you just the frozen client.

```ts
import { connect } from "@mcpeak/core";

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

When the CLI or another composition root needs to distinguish a graceful shutdown from an immediate forced shutdown, use
`connectStdio`.

```ts
import { connectStdio } from "@mcpeak/core";

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

`connect` returns the `connection.client` of `connectStdio(options)`. `ConnectOptions` takes
`command`, `args`, an explicit `env`, `cwd`, the handshake time limit, the maximum stdout message size, and the maximum stderr
size. The defaults are 10 seconds, 10 MiB, and 64 KiB respectively. Values must be finite integers, and anything outside the allowed
range fails before the child process is started.

Environment variables do not inherit the whole of `process.env`. The parent environment can contain secrets such as auth tokens,
and values that change from run to run can break test determinism. Only the safe default environment variables allowed by the SDK
are passed, and additional values are passed to the child process only when specified in `env`.

stderr is treated as untrusted child process input. Only the most recent bytes are kept in a bounded buffer, with
a default cap of 64 KiB. stderr content may be included in diagnostic snapshots but is not included in the default error message or
`McpClientError.toJSON()`. The error JSON contains only the code, phase, fixed message and hint,
exit code, signal, and whether stderr was truncated.

Execution does not go through a shell, so even if `args` contains spaces or shell characters, they are not reinterpreted.
On Windows, `.cmd` and `.bat` commands are rejected. Give an executable the operating system can run directly as
`command`, and pass the script path and script arguments in `args`. Windows command wrapping and
command-line quoting are outside the scope of this transport.

SSE, WebSocket, and OAuth-based remote authentication will be decided separately in a follow-up design and ADR.

## Connecting over Streamable HTTP

For an MCP server reachable only by URL, give `url` instead of `command`. The same `connect` picks the transport by
the shape of the options.

```ts
import { connect } from "@mcpeak/core";

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

`HttpConnectOptions` takes only `url`, optional `headers`, and optional `connectTimeoutMs`. With no
process there is no `forceClose`, and `close()` cuts pending requests with an internal abort. Failure diagnostics are
tagged `transport: "http"` and carry `url`, `status`, `statusText`, and `sessionId`. Header values
never appear in diagnostics or error JSON.

**OAuth and reconnection are not supported.** Authentication is attached only through headers you build yourself, a 401
ends as `HTTP_UNAUTHORIZED`, and a dropped connection fails immediately without retrying (for the detailed reasoning, see
[ADR-0020](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0020-streamable-http-transport.md)).

Core does not import Runner. Runner receives an injected `McpClient`, and the CLI is the composition root that assembles `connectStdio`'s
`client`, `close`, and `forceClose` into Runner's shutdown boundary.

## Scope and stability

`McpClient`, `ToolDef`, and `ToolResult` in `src/types.ts` are a frozen contract between packages. Only the optional
`ToolDef.outputSchema` agreed in #406 carries the output contract of `tools/list` without loss, and the existing shape of `McpClient` and
`ToolResult` is not changed. Core uses `@modelcontextprotocol/sdk` 1.x and does not upgrade the SDK
version.

Owners: `@seodduu` `@endl24` `@sunghoon0303` (MCP server testing part)

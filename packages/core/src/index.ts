import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createMcpClientAdapter } from "./client.js";
import { NodeControlledStdioTransport } from "./controlled-stdio.js";
import type { McpHttpDiagnostics, McpProcessDiagnostics } from "./diagnostics.js";
import { McpClientError } from "./errors.js";
import { HttpConnectionState, trackOperationFailures } from "./http-transport.js";
import type { ConnectOptions, HttpConnectOptions, StdioConnectOptions } from "./options.js";
import {
  isHttpConnectOptions,
  resolveConnectOptions,
  resolveHttpConnectOptions,
} from "./options.js";
import type { McpClient } from "./types.js";

export {
  CommandParseError,
  type CommandParseErrorCode,
  tokenizeCommand,
} from "./command.js";
export type {
  McpDiagnostics,
  McpHttpDiagnostics,
  McpProcessDiagnostics,
} from "./diagnostics.js";
export type { McpClientErrorCode, McpClientErrorPhase } from "./errors.js";
export { McpClientError } from "./errors.js";
export type { ConnectOptions, HttpConnectOptions, StdioConnectOptions } from "./options.js";
export type { McpClient, ToolDef, ToolResult } from "./types.js";

export interface McpStdioConnection {
  readonly client: McpClient;
  // 반환 타입은 설계 §4 에 따라 좁히지 않는다. 런타임 값에는 transport: "stdio" 가 붙어
  // 있지만, 선언까지 좁히면 이 인터페이스를 구현하는 다른 패키지의 test double 이 깨진다.
  getDiagnostics(): McpProcessDiagnostics;
  close(): Promise<void>;
  forceClose(): Promise<void>;
}

export interface McpHttpConnection {
  readonly client: McpClient;
  getDiagnostics(): McpHttpDiagnostics;
  close(): Promise<void>;
}

export async function connectStdio(options: StdioConnectOptions): Promise<McpStdioConnection> {
  const transport = new NodeControlledStdioTransport(resolveConnectOptions(options));
  const sdk = new Client({ name: "mcpeak", version: "0.0.0" });
  // SDK close는 facade에서 끝내고, 실제 child 종료는 lifecycle controller가 한 번만 수행한다.
  // 이 순서가 아니면 lifecycle의 normalClose hook이 다시 자기 close Promise를 await하게 된다.
  const sdkTransport: Transport = {
    start: () => transport.start(),
    send: (message) => transport.send(message),
    close: () => Promise.resolve(),
    get onclose() {
      return transport.onclose;
    },
    set onclose(callback) {
      transport.onclose = callback;
    },
    get onerror() {
      return transport.onerror;
    },
    set onerror(callback) {
      transport.onerror = callback;
    },
    get onmessage() {
      return transport.onmessage;
    },
    set onmessage(callback) {
      transport.onmessage = callback;
    },
  };
  transport.setNormalCloseHook(() => sdk.close());
  try {
    await sdk.connect(sdkTransport, { timeout: transport.options.connectTimeoutMs });
    transport.markOpen();
  } catch (cause) {
    const diagnostics = transport.getDiagnostics();
    const timeout =
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      (cause.code === -32001 || cause.code === "RequestTimeout");
    const primary =
      cause instanceof McpClientError
        ? cause
        : diagnostics.exitCode !== null || diagnostics.signal !== null
          ? new McpClientError({
              code: "PROCESS_EXITED",
              phase: "process",
              diagnostics,
              cause,
            })
          : new McpClientError({
              code: timeout ? "HANDSHAKE_TIMEOUT" : "HANDSHAKE_FAILED",
              phase: "handshake",
              diagnostics,
              cause,
            });
    try {
      await transport.forceClose();
    } catch (cleanup) {
      throw new AggregateError([primary, cleanup], primary.message);
    }
    throw primary;
  }
  const close = () => transport.close();
  const operationFailureKind = () => {
    const diagnostics = transport.getDiagnostics();
    if (diagnostics.exitCode !== null || diagnostics.signal !== null) return "process" as const;
    return transport.state === "failed" ? ("transport" as const) : undefined;
  };
  return {
    client: createMcpClientAdapter(
      sdk,
      () => transport.getDiagnostics(),
      close,
      operationFailureKind,
    ),
    // 런타임 값에는 createDiagnosticsSnapshot 이 이미 transport: "stdio" 를 붙여 놓았다.
    getDiagnostics: () => transport.getDiagnostics(),
    close,
    forceClose: () => transport.forceClose(),
  };
}

/**
 * Streamable HTTP MCP 서버에 연결하고 handshake 를 완료한 뒤 연결을 반환한다.
 * 프로세스를 띄우지 않으므로 죽일 대상이 없다. `forceClose` 를 두지 않는 이유다(설계 §9).
 */
export async function connectHttp(options: HttpConnectOptions): Promise<McpHttpConnection> {
  const resolved = resolveHttpConnectOptions(options);
  const state = new HttpConnectionState(resolved);
  const sdk = new Client({ name: "mcpeak", version: "0.0.0" });
  try {
    await sdk.connect(state.transport, { timeout: resolved.connectTimeoutMs });
  } catch (cause) {
    await state.abort();
    throw state.toConnectError(cause);
  }
  const close = () => state.close(() => sdk.close());
  return {
    client: createMcpClientAdapter(
      trackOperationFailures(sdk, state),
      () => state.getDiagnostics(),
      close,
      () => state.operationFailureKind(),
    ),
    getDiagnostics: () => state.getDiagnostics(),
    close,
  };
}

/**
 * command 면 stdio, url 이면 Streamable HTTP 로 분기한다.
 * 반환 타입이 `McpClient` 그대로이므로 상위 패키지는 어느 transport 인지 알 필요가 없다.
 */
export async function connect(options: ConnectOptions): Promise<McpClient> {
  if (isHttpConnectOptions(options)) return (await connectHttp(options)).client;
  return (await connectStdio(options)).client;
}

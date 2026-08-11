import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createMcpClientAdapter } from "./client.js";
import { NodeControlledStdioTransport } from "./controlled-stdio.js";
import type { McpProcessDiagnostics } from "./diagnostics.js";
import { McpClientError } from "./errors.js";
import type { ConnectOptions } from "./options.js";
import { resolveConnectOptions } from "./options.js";
import type { McpClient } from "./types.js";

export type { McpProcessDiagnostics } from "./diagnostics.js";
export type { McpClientErrorCode, McpClientErrorPhase } from "./errors.js";
export { McpClientError } from "./errors.js";
export type { ConnectOptions } from "./options.js";
export type { McpClient, ToolDef, ToolResult } from "./types.js";

export interface McpStdioConnection {
  readonly client: McpClient;
  getDiagnostics(): McpProcessDiagnostics;
  close(): Promise<void>;
  forceClose(): Promise<void>;
}

export async function connectStdio(options: ConnectOptions): Promise<McpStdioConnection> {
  const transport = new NodeControlledStdioTransport(resolveConnectOptions(options));
  const sdk = new Client({ name: "ohmymcp", version: "0.0.0" });
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
    getDiagnostics: () => transport.getDiagnostics(),
    close,
    forceClose: () => transport.forceClose(),
  };
}

/**
 * MCP 서버 프로세스를 기동하고 핸드셰이크를 완료한 뒤 클라이언트를 반환한다.
 *
 * 아직 구현되지 않음 — `core` 오너가 채운다.
 */
export async function connect(options: ConnectOptions): Promise<McpClient> {
  return (await connectStdio(options)).client;
}

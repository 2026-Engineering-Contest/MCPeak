import type { McpProcessDiagnostics } from "./diagnostics.js";
import type { ConnectOptions } from "./options.js";
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

/** Task 3가 controlled stdio transport로 채울 연결 진입점이다. */
export function connectStdio(_options: ConnectOptions): Promise<McpStdioConnection> {
  throw new Error("not implemented");
}

/**
 * MCP 서버 프로세스를 기동하고 핸드셰이크를 완료한 뒤 클라이언트를 반환한다.
 *
 * 아직 구현되지 않음 — `core` 오너가 채운다.
 */
export function connect(options: ConnectOptions): Promise<McpClient> {
  throw new Error("not implemented");
}

import type { McpClient } from "./types.js";

export type { McpClient, ToolDef, ToolResult } from "./types.js";

/** stdio 로 MCP 서버 프로세스를 기동할 때의 옵션. */
export interface ConnectOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * MCP 서버 프로세스를 기동하고 핸드셰이크를 완료한 뒤 클라이언트를 반환한다.
 *
 * 아직 구현되지 않음 — `core` 오너가 채운다.
 */
export function connect(options: ConnectOptions): Promise<McpClient> {
  throw new Error("not implemented");
}

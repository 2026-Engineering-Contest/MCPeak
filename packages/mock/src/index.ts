import type { ToolResult } from "@ohmymcp/core";

export interface MockServer {
  url: string;
  close(): Promise<void>;
}

export interface MockOptions {
  tools?: unknown[];
}

/**
 * 목 MCP 서버를 띄운다.
 * 아직 구현되지 않음 — `mock` 오너가 채운다.
 */
export function createMockServer(options: MockOptions): Promise<MockServer> {
  throw new Error("not implemented");
}

/**
 * 특정 툴 호출에 대한 응답을 주입한다.
 * 아직 구현되지 않음 — `mock` 오너가 채운다.
 */
export function injectResponse(name: string, response: ToolResult): void {
  throw new Error("not implemented");
}

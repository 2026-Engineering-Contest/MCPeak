import type { McpClient, ToolResult } from "@mcptest/core";

/** `createMcpTest` 에 넘기는 설정. */
export interface McpTestConfig {
  client: McpClient;
}

/** 각 테스트 본문에 전달되는 컨텍스트. */
export interface McpTestContext {
  client: McpClient;
}

export type TestBody = (ctx: McpTestContext) => void | Promise<void>;

/** matcher 가 반환하는 결과. `message` 는 실패 시 출력할 사람이 읽는 문장이다. */
export interface MatchResult {
  pass: boolean;
  message: () => string;
}

/**
 * MCP 서버에 대한 테스트 스위트를 정의한다.
 *
 * 아직 구현되지 않음 — `runner` 오너가 채운다.
 */
export function createMcpTest(config: McpTestConfig, body: TestBody): void {
  throw new Error("not implemented");
}

/**
 * matcher: 툴 목록에 주어진 이름의 툴이 있는지 단언한다.
 * 실패 메시지가 곧 제품이다 — 무엇이 왜 다른지 보여줘야 한다 (CLAUDE.md).
 *
 * 아직 구현되지 않음 — `runner` 오너가 채운다.
 */
export function toContainTool(result: ToolResult, name: string): MatchResult {
  throw new Error("not implemented");
}

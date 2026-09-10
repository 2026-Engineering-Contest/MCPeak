export interface McpClient {
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: unknown): Promise<ToolResult>;
  close(): Promise<void>;
}

export type ToolDef = {
  name: string;
  description?: string;
  inputSchema: unknown;
  /** MCP tools/list가 선언한 구조화 출력 계약. 선언하지 않은 서버와의 호환을 위해 선택적이다. */
  outputSchema?: unknown;
};

export type ToolResult = {
  content: unknown;
  isError: boolean;
  raw: unknown;
};

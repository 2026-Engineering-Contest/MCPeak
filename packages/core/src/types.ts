export interface McpClient {
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: unknown): Promise<ToolResult>;
  close(): Promise<void>;
}

export type ToolDef = {
  name: string;
  description?: string;
  inputSchema: unknown;
};

export type ToolResult = {
  content: unknown;
  isError: boolean;
  raw: unknown;
};

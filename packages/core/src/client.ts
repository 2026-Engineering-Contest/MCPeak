import type { McpProcessDiagnostics } from "./diagnostics.js";
import { McpClientError } from "./errors.js";
import type { McpClient, ToolDef, ToolResult } from "./types.js";

const MAX_JSON_DEPTH = 100;

type SdkClient = {
  listTools(params?: { cursor?: string }): Promise<{
    tools: readonly { name: string; description?: string; inputSchema: unknown }[];
    nextCursor?: string;
  }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
};

export type OperationFailureKind = "process" | "transport" | undefined;

function isCoreError(value: unknown): value is McpClientError {
  return (
    value instanceof McpClientError ||
    (typeof value === "object" &&
      value !== null &&
      "code" in value &&
      "phase" in value &&
      typeof value.code === "string" &&
      typeof value.phase === "string")
  );
}

function invalidArguments(diagnostics: () => McpProcessDiagnostics): McpClientError {
  return new McpClientError({
    code: "INVALID_TOOL_ARGUMENTS",
    phase: "callTool",
    diagnostics: diagnostics(),
  });
}

/** JSON 객체만 전달되도록 iterative traversal로 검증한다. 공유 참조는 허용하고 cycle만 거절한다. */
export function assertToolArguments(
  name: string,
  args: unknown,
  diagnostics: () => McpProcessDiagnostics,
): asserts args is Record<string, unknown> {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    args === null ||
    Array.isArray(args) ||
    typeof args !== "object"
  ) {
    throw invalidArguments(diagnostics);
  }
  try {
    const ancestors = new Set<object>();
    const stack: { value: unknown; depth: number; leave?: object }[] = [{ value: args, depth: 0 }];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;
      if (current.leave) {
        ancestors.delete(current.leave);
        continue;
      }
      const value = current.value;
      if (value === null || typeof value === "string" || typeof value === "boolean") continue;
      if (typeof value === "number") {
        if (Number.isFinite(value)) continue;
        throw invalidArguments(diagnostics);
      }
      if (
        typeof value === "undefined" ||
        typeof value === "function" ||
        typeof value === "symbol" ||
        typeof value === "bigint" ||
        Array.isArray(value) ||
        typeof value !== "object" ||
        current.depth > MAX_JSON_DEPTH
      )
        throw invalidArguments(diagnostics);
      if (ancestors.has(value)) throw invalidArguments(diagnostics);
      ancestors.add(value);
      stack.push({ value: undefined, depth: current.depth, leave: value });
      for (const child of Object.values(value))
        stack.push({ value: child, depth: current.depth + 1 });
    }
  } catch (cause) {
    if (isCoreError(cause)) throw cause;
    throw invalidArguments(diagnostics);
  }
}

export function createMcpClientAdapter(
  sdk: SdkClient,
  diagnostics: () => McpProcessDiagnostics,
  close: () => Promise<void> = () => Promise.resolve(),
  operationFailureKind: () => OperationFailureKind = () => undefined,
): McpClient {
  const operationFailure = (phase: "listTools" | "callTool", cause: unknown): McpClientError => {
    const kind = operationFailureKind();
    if (kind === "process")
      return new McpClientError({
        code: "PROCESS_EXITED",
        phase: "process",
        diagnostics: diagnostics(),
        cause,
      });
    if (kind === "transport")
      return new McpClientError({
        code: "TRANSPORT_FAILED",
        phase: "transport",
        diagnostics: diagnostics(),
        cause,
      });
    return new McpClientError({
      code: "OPERATION_FAILED",
      phase,
      diagnostics: diagnostics(),
      cause,
    });
  };
  return {
    async listTools(): Promise<ToolDef[]> {
      const tools: ToolDef[] = [];
      const observed = new Set<string | undefined>();
      let cursor: string | undefined;
      while (true) {
        if (observed.has(cursor))
          throw new McpClientError({
            code: "PAGINATION_CURSOR_REPEATED",
            phase: "listTools",
            diagnostics: diagnostics(),
          });
        observed.add(cursor);
        let page: Awaited<ReturnType<SdkClient["listTools"]>>;
        try {
          page = await sdk.listTools(cursor === undefined ? {} : { cursor });
        } catch (cause) {
          if (isCoreError(cause)) throw cause;
          throw operationFailure("listTools", cause);
        }
        for (const tool of page.tools) {
          tools.push({
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            inputSchema: tool.inputSchema,
          });
        }
        cursor = page.nextCursor;
        if (cursor === undefined) return tools;
      }
    },
    async callTool(name: string, args: unknown): Promise<ToolResult> {
      assertToolArguments(name, args, diagnostics);
      let result: unknown;
      try {
        result = await sdk.callTool({ name, arguments: args });
      } catch (cause) {
        if (isCoreError(cause)) throw cause;
        throw operationFailure("callTool", cause);
      }
      if (typeof result === "object" && result !== null && "toolResult" in result) {
        return { content: result.toolResult, isError: false, raw: result };
      }
      if (typeof result !== "object" || result === null || !("content" in result))
        throw new McpClientError({
          code: "OPERATION_FAILED",
          phase: "callTool",
          diagnostics: diagnostics(),
          cause: result,
        });
      const standard = result as { content: unknown; isError?: boolean };
      return { content: standard.content, isError: standard.isError ?? false, raw: result };
    },
    close,
  };
}

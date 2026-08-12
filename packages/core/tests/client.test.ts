import { describe, expect, it, vi } from "vitest";
import { createMcpClientAdapter } from "../src/client.js";

const diagnostics = { stderr: "", stderrTruncated: false, exitCode: null, signal: null } as const;

function adapter(
  overrides: Partial<{ listTools: () => Promise<unknown>; callTool: () => Promise<unknown> }> = {},
  operationFailureKind: () => "process" | "transport" | undefined = () => undefined,
) {
  const sdk = {
    listTools: vi.fn(overrides.listTools ?? (async () => ({ tools: [], nextCursor: undefined }))),
    callTool: vi.fn(overrides.callTool ?? (async () => ({ content: [], isError: false }))),
  };
  return {
    sdk,
    client: createMcpClientAdapter(
      sdk as never,
      () => diagnostics,
      () => Promise.resolve(),
      operationFailureKind,
    ),
  };
}

describe("McpClient SDK adapter", () => {
  it("모든 tools/list page를 서버 순서대로 합친다", async () => {
    const { sdk, client } = adapter({
      listTools: vi
        .fn()
        .mockResolvedValueOnce({ tools: [{ name: "first", inputSchema: {} }], nextCursor: "next" })
        .mockResolvedValueOnce({ tools: [{ name: "second", description: "d", inputSchema: {} }] }),
    });
    await expect(client.listTools()).resolves.toEqual([
      { name: "first", inputSchema: {} },
      { name: "second", description: "d", inputSchema: {} },
    ]);
    expect(sdk.listTools).toHaveBeenNthCalledWith(1, {});
    expect(sdk.listTools).toHaveBeenNthCalledWith(2, { cursor: "next" });
  });

  it("빈 문자열을 포함한 반복 cursor는 추가 요청 없이 거절한다", async () => {
    const { sdk, client } = adapter({
      listTools: vi.fn().mockResolvedValue({ tools: [], nextCursor: "" }),
    });
    await expect(client.listTools()).rejects.toMatchObject({
      code: "PAGINATION_CURSOR_REPEATED",
      phase: "listTools",
    });
    expect(sdk.listTools).toHaveBeenCalledTimes(2);
  });

  it("표준, compatibility와 tool error 결과를 손실 없이 변환한다", async () => {
    const standard = adapter({
      callTool: async () => ({ content: [{ type: "text", text: "ok" }], isError: true }),
    });
    const standardRaw = { content: [{ type: "text", text: "ok" }], isError: true };
    standard.sdk.callTool.mockResolvedValueOnce(standardRaw);
    const standardResult = await standard.client.callTool("x", {});
    expect(standardResult).toMatchObject({
      content: [{ type: "text", text: "ok" }],
      isError: true,
    });
    expect(standardResult.raw).toBe(standardRaw);
    const compatibility = adapter({ callTool: async () => ({ toolResult: { legacy: true } }) });
    const compatibilityRaw = { toolResult: { legacy: true } };
    compatibility.sdk.callTool.mockResolvedValueOnce(compatibilityRaw);
    const compatibilityResult = await compatibility.client.callTool("x", {});
    expect(compatibilityResult).toMatchObject({
      content: { legacy: true },
      isError: false,
    });
    expect(compatibilityResult.raw).toBe(compatibilityRaw);
  });

  it("형식이 아닌 callTool 응답은 callTool OPERATION_FAILED로 정규화한다", async () => {
    for (const result of [null, undefined, 0, "text", true, [], {}, { isError: false }]) {
      const { client } = adapter({ callTool: async () => result });
      await expect(client.callTool("tool", {})).rejects.toMatchObject({
        code: "OPERATION_FAILED",
        phase: "callTool",
      });
    }
  });

  it("JSON object가 아닌, 순환 또는 과도하게 깊은 인자를 SDK 호출 전에 거절한다", async () => {
    const { sdk, client } = adapter();
    await expect(client.callTool("", {})).rejects.toMatchObject({ code: "INVALID_TOOL_ARGUMENTS" });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 101; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    for (const value of [
      null,
      [],
      undefined,
      () => {},
      Symbol("x"),
      1n,
      { value: NaN },
      { value: Infinity },
      cycle,
      deep,
      Object.defineProperty({}, "bad", {
        enumerable: true,
        get: () => {
          throw new RangeError("deep");
        },
      }),
    ]) {
      await expect(client.callTool("tool", value)).rejects.toMatchObject({
        code: "INVALID_TOOL_ARGUMENTS",
      });
    }
    const shared = { child: { value: 1 } };
    await expect(
      client.callTool("tool", { a: shared.child, b: shared.child }),
    ).resolves.toBeDefined();
    expect(sdk.callTool).toHaveBeenCalledTimes(1);
  });

  it("SDK 작업 오류는 process와 transport를 우선하고 나머지만 operation으로 정규화한다", async () => {
    const regular = adapter({
      listTools: async () => {
        throw new Error("protocol");
      },
    });
    await expect(regular.client.listTools()).rejects.toMatchObject({
      code: "OPERATION_FAILED",
      phase: "listTools",
    });
    const core = adapter({
      callTool: async () => {
        throw Object.assign(new Error("closed"), { code: "TRANSPORT_FAILED", phase: "transport" });
      },
    });
    await expect(core.client.callTool("tool", {})).rejects.toMatchObject({
      code: "TRANSPORT_FAILED",
      phase: "transport",
    });
    const process = adapter(
      {
        callTool: async () => {
          throw new Error("exit");
        },
      },
      () => "process",
    );
    await expect(process.client.callTool("tool", {})).rejects.toMatchObject({
      code: "PROCESS_EXITED",
      phase: "process",
    });
    const transport = adapter(
      {
        callTool: async () => {
          throw new Error("framing");
        },
      },
      () => "transport",
    );
    await expect(transport.client.callTool("tool", {})).rejects.toMatchObject({
      code: "TRANSPORT_FAILED",
      phase: "transport",
    });
  });
});

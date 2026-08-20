import type { McpClient } from "@mcpeak/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finalizeRunnerExecution,
  type McpClientShutdownController,
  runSuite,
  type TestSuiteSpec,
} from "../src/index.js";

const suite: TestSuiteSpec = {
  schemaVersion: 1,
  id: "one",
  name: "one",
  cases: [
    {
      id: "a",
      name: "a",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "x" }],
    },
  ],
};

describe("finalizeRunnerExecution", () => {
  afterEach(() => vi.useRealTimers());
  it("같은 controller의 종료를 한 번만 시작한다", async () => {
    const client: McpClient = {
      listTools: async () => [{ name: "x", inputSchema: {} }],
      callTool: async () => ({ content: null, isError: false, raw: null }),
      close: async () => undefined,
    };
    const close = vi.fn(async () => undefined);
    const forceClose = vi.fn(async () => undefined);
    const shutdown: McpClientShutdownController = { client, close, forceClose };
    const execution = runSuite({ client, suite });
    const first = finalizeRunnerExecution({ execution, shutdown });
    const second = finalizeRunnerExecution({ execution, shutdown });
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ status: "passed" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(forceClose).not.toHaveBeenCalled();
  });
  it("pending listTools와 callTool은 drain deadline 뒤 force close한다", async () => {
    vi.useFakeTimers();
    for (const operation of ["listTools", "callTool"] as const) {
      const client: McpClient = {
        listTools: () => new Promise(() => undefined),
        callTool: () => new Promise(() => undefined),
        close: async () => undefined,
      };
      const forceClose = vi.fn(async () => undefined);
      const execution = runSuite({
        client,
        suite: {
          ...suite,
          defaultTimeoutMs: 1,
          cases: [
            {
              id: "a",
              name: "a",
              operation:
                operation === "listTools"
                  ? { type: "listTools" }
                  : { type: "callTool", tool: "x", input: {} },
              assertions: [
                {
                  type: operation === "listTools" ? "toolExists" : "isError",
                  ...(operation === "listTools" ? { tool: "x" } : { expected: false }),
                } as never,
              ],
            },
          ],
        } as TestSuiteSpec,
        drainTimeoutMs: 2,
      });
      const finalized = finalizeRunnerExecution({
        execution,
        shutdown: { client, close: vi.fn(async () => undefined), forceClose },
      });
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(2);
      await finalized;
      expect(forceClose).toHaveBeenCalledWith("drainDeadlineExceeded");
    }
  });
  it("graceful close deadline과 force deadline은 exact boundary에서 timeout이 이긴다", async () => {
    vi.useFakeTimers();
    const client: McpClient = {
      listTools: async () => [{ name: "x", inputSchema: {} }],
      callTool: async () => ({ content: null, isError: false, raw: null }),
      close: async () => undefined,
    };
    let resolveClose!: () => void;
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );
    const forceClose = vi.fn(() => new Promise<void>(() => undefined));
    const result = finalizeRunnerExecution({
      execution: runSuite({ client, suite }),
      shutdown: { client, close, forceClose },
      closeTimeoutMs: 2,
      forceCloseTimeoutMs: 2,
    });
    const expected = expect(result).rejects.toMatchObject({
      name: "RunnerShutdownTimeoutError",
      limitMs: 2,
    });
    await vi.advanceTimersByTimeAsync(2);
    resolveClose();
    await vi.advanceTimersByTimeAsync(2);
    await expected;
    expect(forceClose).toHaveBeenCalledWith("gracefulCloseDeadlineExceeded");
  });
  it("invalid option, wrong client, forged execution은 getter나 transport 전에 동기 거절한다", () => {
    const client = { ...({} as McpClient) };
    const close = vi.fn();
    const forceClose = vi.fn();
    const forged = {
      get report() {
        throw new Error("read");
      },
      get drain() {
        throw new Error("read");
      },
    } as unknown as ReturnType<typeof runSuite>;
    expect(() =>
      finalizeRunnerExecution({
        execution: forged,
        shutdown: { client, close, forceClose },
        closeTimeoutMs: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      finalizeRunnerExecution({ execution: forged, shutdown: { client, close, forceClose } }),
    ).toThrow(TypeError);
    expect(close).not.toHaveBeenCalled();
    expect(forceClose).not.toHaveBeenCalled();
  });
});

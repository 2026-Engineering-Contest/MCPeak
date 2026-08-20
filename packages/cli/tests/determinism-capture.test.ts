import type { McpClient, ToolDef, ToolResult } from "@mcpeak/core";
import type { RunnerEvent, TestCaseResult, TestCaseSpec } from "@mcpeak/runner";
import { describe, expect, it } from "vitest";
import { createDeterminismCapture } from "../src/determinism-capture.js";

const toolResult = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: false,
  raw: {},
});

const callToolCase = (id: string, name: string, tool: string): TestCaseSpec => ({
  id,
  name,
  operation: { type: "callTool", tool, input: {} },
  assertions: [{ type: "isError", expected: false }],
});

const caseStarted = (caseIndex: number, spec: TestCaseSpec): RunnerEvent => ({
  type: "caseStarted",
  sequence: caseIndex * 2 + 1,
  caseId: spec.id,
  caseIndex,
  case: spec,
});

const caseCompleted = (
  caseIndex: number,
  spec: TestCaseSpec,
  result: Pick<TestCaseResult, "status"> & { assertions: TestCaseResult["assertions"] },
): RunnerEvent => ({
  type: "caseCompleted",
  sequence: caseIndex * 2 + 2,
  caseId: spec.id,
  caseIndex,
  result: {
    spec,
    status: result.status,
    operation: { status: result.status === "passed" ? "completed" : "failed" },
    assertions: result.assertions,
    rejectionBasis: "notApplicable",
  },
});

const stubClient = (overrides: Partial<McpClient> = {}): McpClient => ({
  listTools: async () => [],
  callTool: async () => toolResult("기본"),
  close: async () => {},
  ...overrides,
});

describe("createDeterminismCapture", () => {
  it("캡처가 호출을 현재 케이스에 귀속시킨다", async () => {
    const inner = stubClient({
      callTool: async (_name, args) => toolResult(String((args as { v: string }).v)),
    });
    const capture = createDeterminismCapture(inner);
    const first = callToolCase("c1", "첫째", "echo");
    const second = callToolCase("c2", "둘째", "echo");

    capture.onEvent(caseStarted(0, first));
    const returnedFirst = await capture.client.callTool("echo", { v: "a" });
    capture.onEvent(caseStarted(1, second));
    await capture.client.callTool("echo", { v: "b" });

    const observations = capture.observations();
    expect(observations).toHaveLength(2);
    expect(observations[0]?.caseId).toBe("c1");
    expect(observations[0]?.caseName).toBe("첫째");
    expect(observations[0]?.toolName).toBe("echo");
    expect((observations[0]?.response as ToolResult | undefined)?.content).toEqual([
      { type: "text", text: "a" },
    ]);
    expect(observations[1]?.caseId).toBe("c2");
    expect((observations[1]?.response as ToolResult | undefined)?.content).toEqual([
      { type: "text", text: "b" },
    ]);
    // 래퍼는 호출자에게 원본을 그대로 돌려준다. 사본은 관찰용이다.
    expect(returnedFirst.content).toEqual([{ type: "text", text: "a" }]);
  });

  it("늦게 도착한 응답도 호출 시점 케이스에 귀속된다", async () => {
    let release: ((value: ToolResult) => void) | undefined;
    const inner = stubClient({
      callTool: () =>
        new Promise<ToolResult>((resolve) => {
          release = resolve;
        }),
    });
    const capture = createDeterminismCapture(inner);
    const slow = callToolCase("c1", "느린 케이스", "echo");
    const next = callToolCase("c2", "다음 케이스", "echo");

    capture.onEvent(caseStarted(0, slow));
    const pending = capture.client.callTool("echo", { v: "late" });
    // 케이스 1 이 타임아웃 처리되고 케이스 2 가 시작된 뒤에 응답이 도착한다.
    capture.onEvent(caseStarted(1, next));
    release?.(toolResult("late"));
    await pending;

    const observations = capture.observations();
    expect((observations[0]?.response as ToolResult | undefined)?.content).toEqual([
      { type: "text", text: "late" },
    ]);
    expect(observations[1]?.response).toBeUndefined();
    expect(Object.hasOwn(observations[1] ?? {}, "response")).toBe(false);
  });

  it("listTools 응답도 현재 케이스에 귀속시킨다", async () => {
    const tools: ToolDef[] = [{ name: "echo", inputSchema: { type: "object" } }];
    const capture = createDeterminismCapture(stubClient({ listTools: async () => tools }));
    const listCase: TestCaseSpec = {
      id: "c1",
      name: "툴 목록",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "echo" }],
    };

    capture.onEvent(caseStarted(0, listCase));
    await capture.client.listTools();

    const observations = capture.observations();
    expect(observations[0]?.toolName).toBeNull();
    expect(observations[0]?.response).toEqual(tools);
  });

  it("caseCompleted 에서 status 와 단언 status 를 옮긴다", async () => {
    const capture = createDeterminismCapture(stubClient());
    const spec = callToolCase("c1", "첫째", "echo");

    capture.onEvent(caseStarted(0, spec));
    await capture.client.callTool("echo", {});
    capture.onEvent(
      caseCompleted(0, spec, {
        status: "failed",
        assertions: [
          { spec: { type: "isError", expected: false }, status: "passed" },
          { spec: { type: "isError", expected: false }, status: "failed" },
        ],
      }),
    );

    const observations = capture.observations();
    expect(observations[0]?.status).toBe("failed");
    expect(observations[0]?.assertionStatuses).toEqual(["passed", "failed"]);
  });

  it("케이스가 시작되기 전 호출은 버린다", async () => {
    const capture = createDeterminismCapture(stubClient());

    await capture.client.callTool("echo", {});

    expect(capture.observations()).toHaveLength(0);
  });

  it("순환 참조 응답은 캡처를 건너뛴다", async () => {
    const cyclic: { content: unknown; isError: boolean; raw: Record<string, unknown> } = {
      content: [],
      isError: false,
      raw: {},
    };
    cyclic.raw.self = cyclic;
    const capture = createDeterminismCapture(
      stubClient({ callTool: async () => cyclic as ToolResult }),
    );
    const spec = callToolCase("c1", "순환", "echo");

    capture.onEvent(caseStarted(0, spec));
    const returned = await capture.client.callTool("echo", {});

    const observation = capture.observations()[0];
    expect(Object.hasOwn(observation ?? {}, "response")).toBe(false);
    // 캡처가 실패해도 호출자는 원본을 그대로 받는다. 판정이 달라지면 안 된다.
    expect(returned).toBe(cyclic);
  });

  it("평문화가 undefined 필드를 떨어뜨린다", async () => {
    const response = { a: 1, b: undefined } as unknown as ToolResult;
    const capture = createDeterminismCapture(stubClient({ callTool: async () => response }));
    const spec = callToolCase("c1", "평문화", "echo");

    capture.onEvent(caseStarted(0, spec));
    const returned = await capture.client.callTool("echo", {});

    expect(capture.observations()[0]?.response).toEqual({ a: 1 });
    expect(Object.hasOwn(capture.observations()[0]?.response as object, "b")).toBe(false);
    expect(returned).toBe(response);
  });

  it("close 는 감싼 client 로 그대로 넘어간다", async () => {
    let closed = 0;
    const capture = createDeterminismCapture(
      stubClient({
        close: async () => {
          closed += 1;
        },
      }),
    );

    await capture.client.close();

    expect(closed).toBe(1);
  });
});

describe("suiteCompleted 보완", () => {
  it("중단으로 안 돈 케이스도 보고서에서 채운다", async () => {
    const capture = createDeterminismCapture(stubClient());
    const first = callToolCase("c1", "첫째", "echo");
    const second = callToolCase("c2", "둘째", "echo");

    capture.onEvent(caseStarted(0, first));
    await capture.client.callTool("echo", {});
    capture.onEvent(
      caseCompleted(0, first, {
        status: "timedOut",
        assertions: [{ spec: { type: "isError", expected: false }, status: "notRun" }],
      }),
    );
    // 케이스 2 는 caseStarted 를 받지 못하고 보고서에만 notRun 으로 실린다.
    capture.onEvent({
      type: "suiteCompleted",
      sequence: 9,
      report: {
        schemaVersion: 1,
        suite: { id: "s1", name: "스위트" },
        status: "aborted",
        stopReason: { type: "timeout", caseId: "c1" },
        cases: [
          {
            spec: first,
            status: "timedOut",
            operation: { status: "timedOut" },
            assertions: [{ spec: { type: "isError", expected: false }, status: "notRun" }],
            rejectionBasis: "notApplicable",
          },
          {
            spec: second,
            status: "notRun",
            operation: { status: "notRun" },
            assertions: [{ spec: { type: "isError", expected: false }, status: "notRun" }],
            rejectionBasis: "notApplicable",
          },
        ],
        summary: {
          total: 2,
          passed: 0,
          failed: 0,
          timedOut: 1,
          cancelled: 0,
          notRun: 1,
          rejectionUnverified: 0,
        },
      },
    });

    const observations = capture.observations();
    expect(observations).toHaveLength(2);
    expect(observations[0]?.status).toBe("timedOut");
    expect(observations[1]).toMatchObject({ caseId: "c2", status: "notRun", toolName: "echo" });
    expect(Object.hasOwn(observations[1] ?? {}, "response")).toBe(false);
  });
});

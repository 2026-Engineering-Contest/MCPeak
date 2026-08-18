import type { McpClient } from "@ohmymcp-hsu/core";
import { describe, expect, it } from "vitest";
import {
  type RunnerEvent,
  type RunnerPayloadLimitError,
  runSuite,
  type TestSuiteSpec,
} from "../src/index.js";
import { sanitizeCase } from "../src/sanitization.js";

const secretInput = {
  Authorization: "Bearer top-secret",
  nested: { api_key: "key-secret", note: "caller-secret" },
};
const secretSuite: TestSuiteSpec = {
  schemaVersion: 1,
  id: "secrets",
  name: "secrets",
  cases: [
    {
      id: "call",
      name: "call",
      operation: { type: "callTool", tool: "get_weather", input: secretInput },
      assertions: [{ type: "isError", expected: false }],
    },
  ],
};
function client(records: unknown[]): McpClient {
  return {
    listTools: async () => [],
    callTool: async (name, args) => {
      records.push({ name, args });
      return { content: null, isError: false, raw: { Authorization: "raw-secret" } };
    },
    close: async () => {
      records.push({ close: true });
    },
  };
}

describe("sanitization", () => {
  it("기본 민감 키와 caller 값을 재귀 마스킹한다", () => {
    const value = sanitizeCase(
      {
        id: "x",
        name: "x",
        operation: { type: "callTool", tool: "x", input: secretInput },
        assertions: [{ type: "isError", expected: false }],
      },
      { sensitiveValues: ["caller-secret"] },
    );
    expect(value.operation.type).toBe("callTool");
    if (value.operation.type === "callTool")
      expect(value.operation.input).toEqual({
        Authorization: "[REDACTED]",
        nested: { api_key: "[REDACTED]", note: "[REDACTED]" },
      });
    expect(Object.keys(value.operation.type === "callTool" ? value.operation.input : {})).toEqual([
      "Authorization",
      "nested",
    ]);
    expect(secretInput.nested.note).toBe("caller-secret");
  });
  it("실제 호출은 원본이고 event와 report는 secret-free다", async () => {
    const records: unknown[] = [];
    const events: RunnerEvent[] = [];
    const report = await runSuite({
      client: client(records),
      suite: secretSuite,
      redaction: { sensitiveValues: ["caller-secret"] },
      onEvent: (event) => events.push(event),
    }).report;
    expect(records).toEqual([{ name: "get_weather", args: secretInput }]);
    const serialized = JSON.stringify({ events, report });
    for (const secret of ["top-secret", "key-secret", "caller-secret"])
      expect(serialized).not.toContain(secret);
  });
  it("계약 식별자는 민감값과 같아도 보존한다", async () => {
    const suite = structuredClone(secretSuite);
    const firstCase = suite.cases[0];
    if (firstCase === undefined) throw new Error("fixture case missing");
    firstCase.name = "caller-secret";

    const report = await runSuite({
      client: client([]),
      suite,
      redaction: { sensitiveValues: ["caller-secret"] },
    }).report;

    expect(report.cases[0]?.spec.name).toBe("caller-secret");
  });
  it("operation 실패 진단의 민감값을 마스킹한다", async () => {
    const failingClient = client([]);
    failingClient.callTool = async () => {
      throw new Error("caller-secret");
    };

    const report = await runSuite({
      client: failingClient,
      suite: secretSuite,
      redaction: { sensitiveValues: ["caller-secret"] },
    }).report;

    expect(report.cases[0]?.operation.diagnostic?.actual).toEqual({
      type: "error",
      name: "Error",
      message: "[REDACTED]",
    });
    expect(JSON.stringify(report)).not.toContain("caller-secret");
  });
  it("case payload 초과를 이벤트와 호출 전에 거절한다", async () => {
    const records: unknown[] = [];
    const events: RunnerEvent[] = [];
    const input = structuredClone(secretSuite);
    const firstCase = input.cases[0];
    if (firstCase === undefined) throw new Error("fixture case missing");
    firstCase.operation = {
      type: "callTool",
      tool: "get_weather",
      input: { note: "x".repeat(200) },
    };
    const execution = runSuite({
      client: client(records),
      suite: input,
      payloadLimits: { maxCaseBytes: 128 },
      onEvent: (event) => events.push(event),
    });
    await expect(execution.report).rejects.toMatchObject({
      name: "RunnerPayloadLimitError",
      scope: "case",
    } satisfies Partial<RunnerPayloadLimitError>);
    expect(records).toEqual([]);
    expect(events).toEqual([]);
  });
  it("report 초과는 suiteCompleted 없이 거절하고 invalid limits는 즉시 거절한다", async () => {
    const records: unknown[] = [];
    const events: RunnerEvent[] = [];
    const execution = runSuite({
      client: client(records),
      suite: secretSuite,
      payloadLimits: { maxReportBytes: 256 },
      onEvent: (event) => events.push(event),
    });
    await expect(execution.report).rejects.toMatchObject({
      name: "RunnerPayloadLimitError",
      scope: "report",
    } satisfies Partial<RunnerPayloadLimitError>);
    expect(events.map((event) => event.type)).not.toContain("suiteCompleted");
    for (const payloadLimits of [
      { maxCaseBytes: 0 },
      { maxCaseBytes: 1.5 },
      { maxCaseBytes: 65_537 },
      { maxReportBytes: 1_048_577 },
    ]) {
      const calls: unknown[] = [];
      const observed: RunnerEvent[] = [];
      expect(() =>
        runSuite({
          client: client(calls),
          suite: secretSuite,
          payloadLimits,
          onEvent: (event) => observed.push(event),
        }),
      ).toThrow(RangeError);
      expect(calls).toEqual([]);
      expect(observed).toEqual([]);
    }
  });
});

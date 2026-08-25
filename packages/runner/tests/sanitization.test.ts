import type { McpClient } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import { redactByPath } from "../src/diagnostics.js";
import {
  type RunnerEvent,
  type RunnerPayloadLimitError,
  runSuite,
  type TestSuiteSpec,
} from "../src/index.js";
import { REDACTED, sanitizeCase, sanitizeJsonValue } from "../src/sanitization.js";

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

describe("민감 키 판정 (ADR-0039·0045 접미 단어열 규칙)", () => {
  const mask = (key: string) =>
    (sanitizeJsonValue({ [key]: "v" }) as Record<string, unknown>)[key] === REDACTED;

  it("접미 단어열이 목록과 정확히 일치하면 가린다", () => {
    expect(mask("sessionToken")).toBe(true);
    expect(mask("accessToken")).toBe(true);
    expect(mask("X-Api-Key")).toBe(true);
    expect(mask("user_password")).toBe(true);
    expect(mask("Set-Cookie")).toBe(true);
  });

  it("머리 명사가 다르면 통과시킨다. 과잉 마스킹은 그 필드를 테스트가 영영 못 보게 만든다", () => {
    expect(mask("tokenCount")).toBe(false);
    expect(mask("passwordPolicy")).toBe(false);
    expect(mask("secretariat")).toBe(false);
  });

  it("복수형을 흡수하되 머리 명사는 건드리지 않는다", () => {
    expect(mask("tokens")).toBe(true);
    expect(mask("apiKeys")).toBe(true);
    expect(mask("tokenCounts")).toBe(false);
  });

  it("`key` 단독은 민감이 아니고 합성어만 걸린다", () => {
    expect(mask("key")).toBe(false);
    expect(mask("cacheKey")).toBe(false);
    expect(mask("privateKey")).toBe(true);
    expect(mask("secretKey")).toBe(true);
  });

  it("꼬리 숫자를 떼고 본다", () => {
    expect(mask("apiKey0")).toBe(true);
    expect(mask("cookieCount2")).toBe(false);
  });

  it("sensitiveKeys 로 넘긴 이름도 같은 규칙으로 판정한다", () => {
    const value = sanitizeJsonValue(
      { tenantId: "t", tenantIdCount: 3, legacyTenantId: "l" },
      { sensitiveKeys: ["tenantId"] },
    ) as Record<string, unknown>;
    expect(value).toEqual({ tenantId: REDACTED, tenantIdCount: 3, legacyTenantId: REDACTED });
  });

  it("조상 키 판정(redactByPath)도 같은 규칙을 쓴다", () => {
    expect(redactByPath("sk", ["sessionToken", "value"])).toBe(REDACTED);
    expect(redactByPath("n", ["tokenCount"])).toBe("n");
  });
});

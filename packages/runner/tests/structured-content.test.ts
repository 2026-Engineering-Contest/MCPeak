import type { McpClient, ToolResult } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import {
  assertStructuredContentMatchesSchema,
  extractResponseBody,
  extractStructuredContent,
  runSuite,
  type StructuredContentMatchesSchemaAssertionSpec,
  type TestSuiteSpec,
} from "../src/index.js";

const assertion: StructuredContentMatchesSchemaAssertionSpec = {
  type: "structuredContentMatchesSchema",
  schema: {
    type: "object",
    required: ["sum"],
    properties: { sum: { type: "number" } },
    additionalProperties: false,
  },
};

const result = (structuredContent: unknown): ToolResult => ({
  content: [{ type: "text", text: "합계는 다음과 같습니다." }],
  isError: false,
  raw: { structuredContent },
});

describe("structuredContent 출력 계약", () => {
  it("사람이 읽는 text와 별개로 structuredContent를 추출한다", () => {
    const value = result({ sum: 5 });
    expect(extractResponseBody(value)).toEqual({
      ok: true,
      body: "합계는 다음과 같습니다.",
      form: "text",
    });
    expect(extractStructuredContent(value)).toEqual({ ok: true, value: { sum: 5 } });
    expect(assertStructuredContentMatchesSchema(value, assertion)).toMatchObject({
      status: "passed",
    });
  });

  it("저장된 계약과 다른 필드 타입을 경로·기대 계약·실제 값으로 진단한다", () => {
    const checked = assertStructuredContentMatchesSchema(result({ sum: "5" }), assertion);
    expect(checked).toMatchObject({
      status: "failed",
      diagnostic: {
        code: "STRUCTURED_CONTENT_SCHEMA_MISMATCH",
        expected: assertion.schema,
        actual: { sum: "5" },
        violations: [{ path: "$.sum", expected: "number", actual: "5" }],
      },
    });
  });

  it("저장 당시 number 계약은 서버 선언과 응답이 string으로 함께 바뀌어도 유지된다", async () => {
    const suite: TestSuiteSpec = {
      schemaVersion: 1,
      id: "sum",
      name: "sum",
      cases: [
        {
          id: "sum-success",
          name: "sum",
          operation: { type: "callTool", tool: "sum", input: { a: 2, b: 3 } },
          assertions: [{ type: "isError", expected: false }, assertion],
        },
      ],
    };
    const client: McpClient = {
      // 현재 서버 선언은 string으로 바뀌었지만 실행은 저장 명세의 number 계약을 쓴다.
      listTools: async () => [
        {
          name: "sum",
          inputSchema: { type: "object" },
          outputSchema: { type: "object", properties: { sum: { type: "string" } } },
        },
      ],
      callTool: async () => result({ sum: "5" }),
      close: async () => undefined,
    };

    const report = await runSuite({ client, suite }).report;
    expect(report.cases[0]).toMatchObject({
      status: "failed",
      assertions: [
        { status: "passed" },
        { status: "failed", diagnostic: { code: "STRUCTURED_CONTENT_SCHEMA_MISMATCH" } },
      ],
    });
  });

  it("structuredContent가 없으면 텍스트 fallback으로 성공시키지 않는다", () => {
    const checked = assertStructuredContentMatchesSchema(
      { content: [{ type: "text", text: '{"sum":5}' }], isError: false, raw: {} },
      assertion,
    );
    expect(checked).toMatchObject({
      status: "failed",
      diagnostic: { code: "STRUCTURED_CONTENT_EXTRACTION_FAILED" },
    });
  });

  it("SDK가 먼저 거절한 호출과 Runner가 판정한 출력 계약 위반을 구분한다", async () => {
    const suite: TestSuiteSpec = {
      schemaVersion: 1,
      id: "sum",
      name: "sum",
      cases: [
        {
          id: "sum-success",
          name: "sum",
          operation: { type: "callTool", tool: "sum", input: {} },
          assertions: [assertion],
        },
      ],
    };
    const client: McpClient = {
      listTools: async () => [],
      callTool: async () => {
        throw new Error("Structured content does not match the tool's output schema");
      },
      close: async () => undefined,
    };
    const report = await runSuite({ client, suite }).report;
    expect(report.cases[0]).toMatchObject({
      operation: { status: "failed", diagnostic: { code: "OPERATION_FAILED" } },
      assertions: [{ status: "skipped", diagnostic: { code: "OPERATION_RESULT_UNAVAILABLE" } }],
    });
  });
});

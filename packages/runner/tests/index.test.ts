import { describe, expect, it } from "vitest";
import {
  createMcpTest,
  MCP_SUITE_JSON_SCHEMA,
  toContainTool,
  validateMcpSuite,
} from "../src/index.js";

describe("@mcpeak/runner", () => {
  it("createMcpTest() 는 아직 구현되지 않은 스텁이다", () => {
    expect(createMcpTest).toBeTypeOf("function");
    expect(() => createMcpTest({ client: {} as never }, () => {})).toThrow("not implemented");
  });

  it("toContainTool() 는 아직 구현되지 않은 스텁이다", () => {
    expect(toContainTool).toBeTypeOf("function");
    expect(() => toContainTool({ content: null, isError: false, raw: null }, "x")).toThrow(
      "not implemented",
    );
  });

  it("선언형 공개 계약을 루트에서 재수출한다", () => {
    expect(MCP_SUITE_JSON_SCHEMA).toBeTypeOf("object");
    expect(validateMcpSuite).toBeTypeOf("function");
  });
});

import { describe, expect, it } from "vitest";
import { createMcpTest, toContainTool } from "../src/index.js";

describe("@ohmymcp/runner", () => {
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
});

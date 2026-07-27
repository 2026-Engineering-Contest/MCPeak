import { describe, expect, it } from "vitest";
import { createMockServer, injectResponse } from "../src/index.js";

describe("@mcptest/mock", () => {
  it("createMockServer() 는 아직 구현되지 않은 스텁이다", () => {
    expect(createMockServer).toBeTypeOf("function");
    expect(() => createMockServer({})).toThrow("not implemented");
  });

  it("injectResponse() 도 스텁이다", () => {
    const response: ToolResultLike = { content: null, isError: false, raw: null };
    expect(() => injectResponse("get_weather", response)).toThrow("not implemented");
  });
});

type ToolResultLike = { content: unknown; isError: boolean; raw: unknown };

import { describe, expect, it } from "vitest";
import { generateTests } from "../src/index.js";

describe("@mcptest/generate", () => {
  it("generateTests() 는 아직 구현되지 않은 스텁이다", () => {
    expect(generateTests).toBeTypeOf("function");
    expect(() => generateTests([], { outDir: "out" })).toThrow("not implemented");
  });
});

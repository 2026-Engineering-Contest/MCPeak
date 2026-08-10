import { describe, expect, it } from "vitest";
import { COMMANDS, run } from "../src/index.js";

describe("ohmymcp cli", () => {
  it("run() 은 아직 구현되지 않은 스텁이다", () => {
    expect(run).toBeTypeOf("function");
    expect(() => run([])).toThrow("not implemented");
  });

  it("알려진 서브커맨드를 선언한다", () => {
    expect(COMMANDS).toContain("test");
    expect(COMMANDS.length).toBeGreaterThan(0);
  });
});

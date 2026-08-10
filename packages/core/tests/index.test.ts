import { describe, expect, it } from "vitest";
import { connect } from "../src/index.js";

describe("@ohmymcp/core", () => {
  it("connect() 는 아직 구현되지 않은 스텁이다", () => {
    expect(connect).toBeTypeOf("function");
    expect(() => connect({ command: "node" })).toThrow("not implemented");
  });
});

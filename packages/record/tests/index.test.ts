import { describe, expect, it } from "vitest";
import { record, replay, snapshotContract } from "../src/index.js";

describe("@mcptest/record", () => {
  it("record() 는 아직 구현되지 않은 스텁이다", () => {
    expect(record).toBeTypeOf("function");
    expect(() => record({ path: "cassette.json" })).toThrow("not implemented");
  });

  it("replay() · snapshotContract() 도 스텁이다", () => {
    expect(() => replay({ version: 1, interactions: [] })).toThrow("not implemented");
    expect(() => snapshotContract({ content: null, isError: false, raw: null })).toThrow(
      "not implemented",
    );
  });
});

import { describe, expect, it } from "vitest";
import * as commands from "../src/commands.js";

describe("@mcpeak/cli/commands 공개 면", () => {
  it("optimize 커맨드 함수를 내보낸다", () => {
    expect(typeof commands.runOptimizeCommand).toBe("function");
    expect(typeof commands.parseOptimizeCommand).toBe("function");
  });
  it("parseOptimizeCommand 는 index 를 거치지 않아도 같은 결과를 낸다", () => {
    expect(commands.parseOptimizeCommand(["--out", "o.json", "--command", "node"]).outPath).toBe(
      "o.json",
    );
  });
});

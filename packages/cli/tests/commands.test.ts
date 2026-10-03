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
  it("audit 커맨드 함수와 의존성 조립 함수를 내보낸다", () => {
    expect(typeof commands.runAuditCommand).toBe("function");
    expect(typeof commands.parseAuditCommand).toBe("function");
    expect(typeof commands.nodeAuditDependencies).toBe("function");
  });
  it("parseAuditCommand 는 index 를 거치지 않아도 같은 결과를 낸다", () => {
    const input = commands.parseAuditCommand(["--json", "--command", "node"]);
    expect(input.json).toBe(true);
    expect(input.probe).toBe("readonly");
    expect(input.probeExplicit).toBe(false);
    expect(input.target.transport).toBe("stdio");
  });
  it("nodeAuditDependencies 는 index 의 것과 같은 함수다", async () => {
    const index = await import("../src/index.js");
    expect(index.nodeAuditDependencies).toBe(commands.nodeAuditDependencies);
  });
});

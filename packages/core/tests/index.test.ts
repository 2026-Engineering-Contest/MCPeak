import { describe, expect, it } from "vitest";
import { connect, connectStdio } from "../src/index.js";

describe("@ohmymcp/core", () => {
  it("connect와 connectStdio 공개 진입점을 제공한다", () => {
    expect(connect).toBeTypeOf("function");
    expect(connectStdio).toBeTypeOf("function");
  });

  it("spawn 실패와 handshake 이전 process 종료를 안전한 오류로 정규화한다", async () => {
    const secret = "task3-secret-sentinel";
    await expect(
      connectStdio({ command: "ohmymcp-command-that-does-not-exist", env: { SECRET: secret } }),
    ).rejects.toMatchObject({ code: "PROCESS_START_FAILED", phase: "spawn" });
    await expect(
      connectStdio({ command: process.execPath, args: ["-e", "process.exit(7)"] }),
    ).rejects.toMatchObject({ code: "PROCESS_EXITED", phase: "process" });
    try {
      await connectStdio({
        command: "ohmymcp-command-that-does-not-exist",
        env: { SECRET: secret },
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});

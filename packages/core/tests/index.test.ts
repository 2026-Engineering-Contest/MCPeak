import { describe, expect, it } from "vitest";
import { connect, connectStdio } from "../src/index.js";

describe("@mcpeak/core", () => {
  it("connect와 connectStdio 공개 진입점을 제공한다", () => {
    expect(connect).toBeTypeOf("function");
    expect(connectStdio).toBeTypeOf("function");
  });

  it("spawn 실패와 handshake 이전 process 종료를 안전한 오류로 정규화한다", async () => {
    const secret = "task3-secret-sentinel";
    await expect(
      connectStdio({ command: "mcpeak-command-that-does-not-exist", env: { SECRET: secret } }),
    ).rejects.toMatchObject({ code: "PROCESS_START_FAILED", phase: "spawn" });
    let unexpectedConnection: Awaited<ReturnType<typeof connectStdio>> | undefined;
    try {
      unexpectedConnection = await connectStdio({
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
      });
      throw new Error("process 종료 전에 connectStdio가 성공했습니다");
    } catch (error) {
      expect(error).toMatchObject({ code: "PROCESS_EXITED", phase: "process" });
    } finally {
      await unexpectedConnection?.forceClose();
    }
    try {
      await connectStdio({
        command: "mcpeak-command-that-does-not-exist",
        env: { SECRET: secret },
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});

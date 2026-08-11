import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectStdio } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const weatherServer = fileURLToPath(
  new URL("../../../examples/weather-server/server.mjs", import.meta.url),
);
const openConnections = new Set<Awaited<ReturnType<typeof connectStdio>>>();

afterEach(async () => {
  await Promise.all(
    [...openConnections].map((connection) => connection.forceClose().catch(() => {})),
  );
  openConnections.clear();
});

async function pidPath(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "ohmymcp-core-"));
  return { directory, path: join(directory, "server.pid") };
}

async function assertNoResidue(path: string): Promise<void> {
  let pid: number | undefined;
  for (let attempt = 0; attempt < 20 && pid === undefined; attempt += 1) {
    try {
      pid = Number(await readFile(path, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  expect(pid).toBeTypeOf("number");
  if (pid === undefined) return;
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
}

describe.sequential("stdio 실제 프로세스", () => {
  it("weather-server의 목록, 서울 성공과 미지원 도시 오류를 반환하고 정상 종료한다", async () => {
    const pid = await pidPath();
    const connection = await connectStdio({
      command: process.execPath,
      args: [fixture("handshake-never-completes.mjs")],
      env: {
        OHMYMCP_PID_FILE: pid.path,
        OHMYMCP_TARGET_MODULE: weatherServer,
      },
    });
    openConnections.add(connection);
    try {
      await expect(connection.client.listTools()).resolves.toMatchObject([
        { name: "get_weather" },
        { name: "add" },
      ]);
      await expect(
        connection.client.callTool("get_weather", { city: "서울" }),
      ).resolves.toMatchObject({ isError: false });
      await expect(connection.client.callTool("add", { a: 2, b: 3 })).resolves.toMatchObject({
        isError: false,
      });
      await expect(
        connection.client.callTool("get_weather", { city: "없는도시" }),
      ).resolves.toMatchObject({ isError: true });
    } finally {
      const closing = connection.close();
      expect(connection.client.close()).toBe(closing);
      await closing;
      openConnections.delete(connection);
      await assertNoResidue(pid.path);
      await rm(pid.directory, { recursive: true, force: true });
    }
  });

  it("handshake timeout 뒤 프로세스를 정리한다", async () => {
    const pid = await pidPath();
    try {
      await expect(
        connectStdio({
          command: process.execPath,
          args: [fixture("handshake-never-completes.mjs")],
          connectTimeoutMs: 100,
          env: { OHMYMCP_PID_FILE: pid.path },
        }),
      ).rejects.toMatchObject({ code: "HANDSHAKE_TIMEOUT" });
      await assertNoResidue(pid.path);
    } finally {
      await rm(pid.directory, { recursive: true, force: true });
    }
  });

  it("SDK close 실패는 CLOSE_FAILED로 고정되고 client와 connection은 같은 cleanup Promise를 공유한다", async () => {
    const pid = await pidPath();
    const connection = await connectStdio({
      command: process.execPath,
      args: [fixture("pending-call-tool.mjs")],
      env: { OHMYMCP_PID_FILE: pid.path },
    });
    openConnections.add(connection);
    const sdkClose = vi
      .spyOn(Client.prototype, "close")
      .mockRejectedValueOnce(new Error("sdk close"));
    try {
      const closing = connection.close();
      expect(connection.client.close()).toBe(closing);
      let closeFailure: unknown;
      try {
        await closing;
      } catch (error) {
        closeFailure = error;
      }
      expect(closeFailure).toMatchObject({ code: "CLOSE_FAILED", phase: "close" });
      expect(Object.isFrozen((closeFailure as { diagnostics: unknown }).diagnostics)).toBe(true);
      const cleanup = connection.forceClose();
      expect(connection.forceClose()).toBe(cleanup);
      await cleanup;
      openConnections.delete(connection);
      await assertNoResidue(pid.path);
    } finally {
      sdkClose.mockRestore();
      await rm(pid.directory, { recursive: true, force: true });
    }
  });

  async function assertPendingForceClose(
    script: string,
    operation: "list" | "call",
  ): Promise<void> {
    const pid = await pidPath();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const connection = await connectStdio({
        command: process.execPath,
        args: [fixture(script)],
        env: { OHMYMCP_PID_FILE: pid.path },
      });
      openConnections.add(connection);
      const pending =
        operation === "list"
          ? connection.client.listTools()
          : connection.client.callTool("wait", {});
      await new Promise((resolve) => setTimeout(resolve, 20));
      await connection.forceClose();
      openConnections.delete(connection);
      await expect(pending).rejects.toBeDefined();
      await assertNoResidue(pid.path);
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
      await rm(pid.directory, { recursive: true, force: true });
    }
  }

  it("pending listTools는 forceClose와 PID cleanup 뒤 unhandled rejection이 없다", async () => {
    await assertPendingForceClose("pending-list-tools.mjs", "list");
  });

  it("pending callTool은 forceClose와 PID cleanup 뒤 unhandled rejection이 없다", async () => {
    await assertPendingForceClose("pending-call-tool.mjs", "call");
  });
});

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
  const directory = await mkdtemp(join(tmpdir(), "mcpeak-core-"));
  return { directory, path: join(directory, "server.pid") };
}

/**
 * PID 파일과 프로세스 소멸을 기다리는 예산. 20회 x 10ms 로는 서버를 띄우는 스펙이 여럿 겹칠 때
 * 모자란다(이슈 #93). 판정 대상은 "좀비가 남는가" 이지 "얼마나 빨리 뜨는가" 가 아니다. 정상
 * 실행에서는 첫 시도에 끝나 실행 시간이 늘지 않는다. 실행 격리 자체는 이슈 #119 다.
 */
const RESIDUE_WAIT_ATTEMPTS = 200;

async function assertNoResidue(path: string): Promise<void> {
  let pid: number | undefined;
  for (let attempt = 0; attempt < RESIDUE_WAIT_ATTEMPTS && pid === undefined; attempt += 1) {
    try {
      const value = (await readFile(path, "utf8")).trim();
      const parsed = Number(value);
      if (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(parsed)) pid = parsed;
      else await new Promise((resolve) => setTimeout(resolve, 10));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  expect(pid).toSatisfy(
    (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
  );
  if (pid === undefined) return;
  let missing = false;
  for (let attempt = 0; attempt < RESIDUE_WAIT_ATTEMPTS && !missing; attempt += 1) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch (error) {
      expect(error).toMatchObject({ code: "ESRCH" });
      missing = true;
    }
  }
  expect(missing).toBe(true);
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
          /**
           * 100ms 였다. 그 예산은 **Node 프로세스가 뜨는 시간**과 경쟁한다. 같은 러너에서 서버를
           * 띄우는 스펙이 늘자 자식이 fixture 의 첫 줄에 닿기도 전에 타임아웃이 나 PID 파일이
           * 아예 안 생겼고, 정리 여부를 판정할 대상 자체가 사라졌다(이슈 #93). 이 테스트가 보는
           * 것은 "핸드셰이크가 끝나지 않으면 정리하는가" 이지 타임아웃 값의 크기가 아니다.
           * fixture 는 핸드셰이크를 영원히 완료하지 않으므로 값을 키워도 시나리오는 그대로다.
           */
          connectTimeoutMs: 1_000,
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

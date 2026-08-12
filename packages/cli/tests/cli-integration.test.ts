import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const wrapper = join(here, "fixtures/stdio-server-wrapper.mjs");
const server = join(root, "examples/weather-server/server.mjs");
const success = join(here, "fixtures/weather-suite.json");
const failure = join(here, "fixtures/weather-suite-failing.json");

const parsePid = (text: string): number | undefined => {
  if (!/^[1-9][0-9]*$/.test(text.trim())) return undefined;
  const pid = Number(text.trim());
  return Number.isSafeInteger(pid) ? pid : undefined;
};
async function cleanupPid(pidFile: string): Promise<void> {
  try {
    const pid = parsePid(await readFile(pidFile, "utf8"));
    if (pid === undefined) return;
    try {
      process.kill(pid, "SIGKILL");
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
async function expectExited(pidFile: string): Promise<void> {
  const pid = parsePid(await readFile(pidFile, "utf8"));
  if (pid === undefined) throw new Error("PID 파일은 양의 정수를 포함해야 합니다.");
  const deadline = Date.now() + 1_000;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    if (Date.now() >= deadline)
      throw new Error("weather-server PID가 1초 안에 종료되지 않았습니다.");
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 20));
  }
}

describe.sequential("CLI 실제 weather-server", () => {
  it("성공 report, 종료 코드와 PID 정리를 검증한다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmymcp-cli-"));
    const pidFile = join(dir, "server.pid");
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(
        await run([
          "test",
          success,
          "--command",
          process.execPath,
          "--arg",
          wrapper,
          "--arg",
          pidFile,
          "--arg",
          server,
        ]),
      ).toBe(0);
      const parsed = JSON.parse(out.mock.calls.map(([value]) => String(value)).join(""));
      expect(parsed).toMatchObject({
        schemaVersion: 1,
        suite: { id: "weather-server-cli" },
        status: "passed",
        summary: { total: 3, passed: 3, failed: 0, timedOut: 0, cancelled: 0, notRun: 0 },
      });
      expect(parsed.cases.map((item: { spec: { id: string } }) => item.spec.id)).toEqual([
        "weather-tool-exists",
        "seoul-weather-succeeds",
        "unsupported-city-is-tool-error",
      ]);
      expect(err).not.toHaveBeenCalled();
      await expectExited(pidFile);
    } finally {
      out.mockRestore();
      err.mockRestore();
      await cleanupPid(pidFile);
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("assertion 실패 report, 종료 코드와 PID 정리를 검증한다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmymcp-cli-"));
    const pidFile = join(dir, "server.pid");
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(
        await run([
          "test",
          failure,
          "--command",
          process.execPath,
          "--arg",
          wrapper,
          "--arg",
          pidFile,
          "--arg",
          server,
        ]),
      ).toBe(1);
      const parsed = JSON.parse(out.mock.calls.map(([value]) => String(value)).join(""));
      expect(parsed).toMatchObject({
        schemaVersion: 1,
        suite: { id: "weather-server-cli-failing" },
        status: "failed",
        summary: { total: 1, passed: 0, failed: 1, timedOut: 0, cancelled: 0, notRun: 0 },
      });
      expect(parsed.cases).toHaveLength(1);
      expect(err).not.toHaveBeenCalled();
      await expectExited(pidFile);
    } finally {
      out.mockRestore();
      err.mockRestore();
      await cleanupPid(pidFile);
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("실행할 수 없는 command는 안전한 연결 오류가 된다", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await run(["test", success, "--command", "ohmymcp-command-that-does-not-exist"])).toBe(
        1,
      );
      const text = err.mock.calls.map(([value]) => String(value)).join("");
      expect(out).not.toHaveBeenCalled();
      expect(text).toContain("MCP_CONNECTION_FAILED/PROCESS_START_FAILED");
      expect(text).not.toContain("ohmymcp-command-that-does-not-exist");
      expect(text).not.toMatch(/ENOENT|Error:|at /);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});

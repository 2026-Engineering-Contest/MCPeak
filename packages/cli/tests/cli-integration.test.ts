import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";

vi.mock("@ohmymcp/core", async () => import("../../core/src/index.js"));
vi.mock("@ohmymcp/runner", async () => import("../../runner/src/index.js"));

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const wrapper = join(here, "fixtures/stdio-server-wrapper.mjs");
const server = join(root, "examples/weather-server/server.mjs");
const success = join(here, "fixtures/weather-suite.json");
const failure = join(here, "fixtures/weather-suite-failing.json");
const bodyFailure = join(here, "fixtures/weather-body-assertion-failing.suite.json");

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
/**
 * 프로세스 종료 판정은 조건(ESRCH) 폴링이고, 아래 세 값은 안전장치일 뿐이다. 실측 근거:
 * 15코어를 전부 포화시킨 부하(`yes > /dev/null` × 15)에서 60회 측정한 실제 종료 지연은
 * 최대 1ms였다(58회는 0ms). 이 함수를 부르는 시점에는 CLI가 자식의 종료를 이미 await한 뒤라
 * 정상 경로는 첫 폴링에서 끝난다. 기존 값 1초에는 근거가 없었다.
 */
// 실측 최악값(1ms)의 3000배. vitest 기본 테스트 타임아웃(5초)보다 짧아야 vitest의 무의미한
// 타임아웃 메시지 대신 아래 진단 메시지가 먼저 나온다.
const EXIT_TIMEOUT_MS = 3_000;
// 정상 경로는 첫 폴링에서 끝나므로 이 값은 비정상 상황에서만 의미가 있다. 20ms면 3초 동안
// 150회를 확인하면서 spin으로 CPU를 뺏지 않는다.
const EXIT_POLL_INTERVAL_MS = 20;
// 부하로 이벤트 루프가 밀리면 폴링을 몇 번 못 한 채 벽시계 마감만 지날 수 있다. 그것이 이
// 테스트가 흔들리던 방식이므로, 최소 이 횟수는 실제로 확인한 뒤에만 실패로 판정한다.
const EXIT_MIN_POLLS = 25;

async function expectExited(pidFile: string): Promise<void> {
  const pid = parsePid(await readFile(pidFile, "utf8"));
  if (pid === undefined) throw new Error("PID 파일은 양의 정수를 포함해야 합니다.");
  const started = Date.now();
  for (let polls = 1; ; polls += 1) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    const elapsed = Date.now() - started;
    if (polls >= EXIT_MIN_POLLS && elapsed >= EXIT_TIMEOUT_MS)
      throw new Error(
        `weather-server(PID ${pid})가 ${elapsed}ms 동안 ${polls}회 확인에도 종료되지 않았습니다. ` +
          `확인: \`ps -p ${pid}\`로 생존 여부를 보고, examples/weather-server/server.mjs의 종료 처리와 ` +
          "CLI의 connection close 경로에 좀비 프로세스가 남는지 확인하세요.",
      );
    await new Promise((resolveTimer) => setTimeout(resolveTimer, EXIT_POLL_INTERVAL_MS));
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
          "--json",
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
          "--json",
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
  it("--json 없이 실패 케이스의 진단 문장을 stdout에 쓴다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmymcp-cli-"));
    const pidFile = join(dir, "server.pid");
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(
        await run([
          "test",
          bodyFailure,
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
      const text = out.mock.calls.map(([value]) => String(value)).join("");
      // 실패 메시지가 곧 제품이다. 진단 문장이 실제로 사람 눈앞에 오는지 본다.
      expect(text).toContain("$.temperature: 필수 필드가 없습니다.");
      // 사람용 출력이므로 JSON 이 아니다.
      expect(() => JSON.parse(text)).toThrow();
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

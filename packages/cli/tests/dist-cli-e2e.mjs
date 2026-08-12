import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const cli = join(root, "packages/cli/dist/cli.mjs");
const wrapper = join(here, "fixtures/stdio-server-wrapper.mjs");
const server = join(root, "examples/weather-server/server.mjs");
const parsePid = (text) => {
  if (!/^[1-9][0-9]*$/.test(text.trim())) return undefined;
  const pid = Number(text.trim());
  return Number.isSafeInteger(pid) ? pid : undefined;
};
async function cleanupPid(pidFile) {
  try {
    const pid = parsePid(await readFile(pidFile, "utf8"));
    if (pid === undefined) return;
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
async function expectExited(pidFile) {
  const pid = parsePid(await readFile(pidFile, "utf8"));
  assert.notEqual(pid, undefined, "PID 파일은 양의 정수를 포함해야 합니다.");
  const deadline = Date.now() + 1_000;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    if (Date.now() >= deadline)
      throw new Error("weather-server PID가 1초 안에 종료되지 않았습니다.");
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 20));
  }
}
function execute(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "",
      err = "",
      settled = false,
      timeout;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    child.stdout.on("data", (value) => {
      out += value;
    });
    child.stderr.on("data", (value) => {
      err += value;
    });
    child.once("error", (error) => {
      settle(reject, error);
    });
    child.once("close", (code, signal) => {
      settle(resolvePromise, { code, signal, out, err });
    });
    timeout = setTimeout(() => {
      if (settled) return;
      try {
        child.kill("SIGKILL");
      } catch {}
      settle(reject, new Error("dist CLI E2E child가 10000ms 안에 종료되지 않았습니다."));
    }, 10_000);
    timeout.unref?.();
  });
}
for (const [fixture, expectedStatus, expectedSummary] of [
  [
    "weather-suite.json",
    "passed",
    { total: 3, passed: 3, failed: 0, timedOut: 0, cancelled: 0, notRun: 0 },
  ],
  [
    "weather-suite-failing.json",
    "failed",
    { total: 1, passed: 0, failed: 1, timedOut: 0, cancelled: 0, notRun: 0 },
  ],
]) {
  const dir = await mkdtemp(join(tmpdir(), "ohmymcp-dist-"));
  const pidFile = join(dir, "pid");
  try {
    const result = await execute([
      "test",
      join(here, "fixtures", fixture),
      "--command",
      process.execPath,
      "--arg",
      wrapper,
      "--arg",
      pidFile,
      "--arg",
      server,
    ]);
    assert.equal(result.code, expectedStatus === "passed" ? 0 : 1);
    assert.equal(result.signal, null);
    assert.equal(result.err, "");
    const report = JSON.parse(result.out);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.status, expectedStatus);
    assert.deepEqual(report.summary, expectedSummary);
    assert.equal(report.cases.length, expectedSummary.total);
    await expectExited(pidFile);
  } finally {
    await cleanupPid(pidFile);
    await rm(dir, { recursive: true, force: true });
  }
}

{
  const dir = await mkdtemp(join(tmpdir(), "ohmymcp-dist-generate-"));
  const pidFile = join(dir, "pid");
  const suite = join(dir, "baseline.json");
  try {
    const generated = await execute([
      "generate",
      "--suite-id",
      "weather",
      "--name",
      "Weather",
      "--out",
      suite,
      "--command",
      process.execPath,
      "--arg",
      wrapper,
      "--arg",
      pidFile,
      "--arg",
      server,
      "--baseline-only",
    ]);
    assert.equal(generated.code, 0);
    assert.equal(generated.err, "");
    const value = JSON.parse(await readFile(suite, "utf8"));
    assert.equal(value.cases.length, 2);
    await expectExited(pidFile);
    const result = await execute([
      "test",
      suite,
      "--command",
      process.execPath,
      "--arg",
      wrapper,
      "--arg",
      pidFile,
      "--arg",
      server,
    ]);
    assert.equal(result.code, 1);
    assert.equal(result.err, "");
    assert.deepEqual(JSON.parse(result.out).summary, {
      total: 2,
      passed: 1,
      failed: 1,
      timedOut: 0,
      cancelled: 0,
      notRun: 0,
    });
    await expectExited(pidFile);
  } finally {
    await cleanupPid(pidFile);
    await rm(dir, { recursive: true, force: true });
  }
}

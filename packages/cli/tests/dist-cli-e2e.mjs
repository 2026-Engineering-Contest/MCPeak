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
/**
 * 프로세스 종료 판정은 조건(ESRCH) 폴링이고, 아래 세 값은 안전장치일 뿐이다. 실측 근거:
 * 15코어를 전부 포화시킨 부하(`yes > /dev/null` × 15)에서 60회 측정한 실제 종료 지연은
 * 최대 1ms였다(58회는 0ms). 이 함수를 부르는 시점에는 CLI가 자식의 종료를 이미 await한 뒤라
 * 정상 경로는 첫 폴링에서 끝난다. 기존 값 1초에는 근거가 없었다.
 */
// 실측 최악값(1ms)의 3000배. 이 스크립트는 vitest 밖에서 돌지만 세 파일의 값을 같게 둔다.
const EXIT_TIMEOUT_MS = 3_000;
// 정상 경로는 첫 폴링에서 끝나므로 이 값은 비정상 상황에서만 의미가 있다. 20ms면 3초 동안
// 150회를 확인하면서 spin으로 CPU를 뺏지 않는다.
const EXIT_POLL_INTERVAL_MS = 20;
// 부하로 이벤트 루프가 밀리면 폴링을 몇 번 못 한 채 벽시계 마감만 지날 수 있다. 그것이 이
// 테스트가 흔들리던 방식이므로, 최소 이 횟수는 실제로 확인한 뒤에만 실패로 판정한다.
const EXIT_MIN_POLLS = 25;

async function expectExited(pidFile) {
  const pid = parsePid(await readFile(pidFile, "utf8"));
  assert.notEqual(pid, undefined, "PID 파일은 양의 정수를 포함해야 합니다.");
  const started = Date.now();
  for (let polls = 1; ; polls += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
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

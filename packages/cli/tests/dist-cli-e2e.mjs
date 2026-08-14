import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  [
    "weather-body-assertion.suite.json",
    "passed",
    { total: 3, passed: 3, failed: 0, timedOut: 0, cancelled: 0, notRun: 0 },
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
      "--json",
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
      "--json",
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

{
  const dir = await mkdtemp(join(tmpdir(), "ohmymcp-dist-body-"));
  const pidFile = join(dir, "pid");
  const args = [
    "test",
    join(here, "fixtures", "weather-body-assertion-failing.suite.json"),
    "--command",
    process.execPath,
    "--arg",
    wrapper,
    "--arg",
    pidFile,
    "--arg",
    server,
    "--json",
  ];
  try {
    const first = await execute(args);
    assert.equal(first.code, 1);
    assert.equal(first.err, "");
    const report = JSON.parse(first.out);
    assert.equal(report.status, "failed");

    const diagnostic = report.cases[0].assertions[0].diagnostic;
    assert.equal(diagnostic.code, "BODY_SCHEMA_MISMATCH");
    assert.equal(diagnostic.totalViolations, 1);
    assert.equal(diagnostic.violations.length, 1);
    assert.equal(diagnostic.violations[0].code, "REQUIRED_MISSING");
    assert.equal(diagnostic.violations[0].path, "$.temperature");
    // 실패 메시지가 곧 제품이다. 문장 전문을 고정한다.
    assert.equal(
      diagnostic.violations[0].message,
      "$.temperature: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temp'",
    );
    await expectExited(pidFile);

    // 결정론성: 같은 입력 2회 실행의 표준 출력 바이트가 같아야 한다.
    const second = await execute(args);
    assert.equal(second.out, first.out);
    await expectExited(pidFile);
  } finally {
    await cleanupPid(pidFile);
    await rm(dir, { recursive: true, force: true });
  }
}

{
  const dir = await mkdtemp(join(tmpdir(), "ohmymcp-dist-render-"));
  const pidFile = join(dir, "pid");
  const args = [
    "test",
    join(here, "fixtures", "weather-body-assertion-failing.suite.json"),
    "--command",
    process.execPath,
    "--arg",
    wrapper,
    "--arg",
    pidFile,
    "--arg",
    server,
  ];
  try {
    const first = await execute(args);
    assert.equal(first.code, 1);
    assert.equal(first.err, "");
    // 사람용 출력이므로 JSON 이 아니다.
    assert.throws(() => JSON.parse(first.out));
    // 실패 메시지가 곧 제품이다. 진단 문장이 실제로 사람 눈앞에 오는지 본다.
    assert.ok(
      first.out.includes(
        "$.temperature: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temp'",
      ),
      `진단 문장이 stdout에 없습니다. 실제 출력:\n${first.out}`,
    );
    assert.ok(first.out.includes("해결: "), "해결 힌트 줄이 없습니다.");
    // 색상 없이 나와야 한다. 자식 프로세스의 stdout 은 파이프이므로 TTY 가 아니다.
    assert.ok(!first.out.includes("\u001b"), "TTY 가 아닌데 ANSI 시퀀스가 있습니다.");
    assert.ok(!first.out.includes("\r"), "CRLF 를 쓰고 있습니다.");
    await expectExited(pidFile);

    // 결정론성: 같은 입력 2회 실행의 표준 출력 바이트가 같아야 한다.
    const second = await execute(args);
    assert.equal(second.out, first.out);
    await expectExited(pidFile);
  } finally {
    await cleanupPid(pidFile);
    await rm(dir, { recursive: true, force: true });
  }
}

// 서버 프로세스 진단 (설계 문서 §8.4). 기동 즉시 죽는 서버와 실행 불가능한 command 를 본다.
{
  const dir = await mkdtemp(join(tmpdir(), "ohmymcp-dist-diagnostics-"));
  const dying = join(dir, "dying-server.mjs");
  // SDK 를 쓰지 않는 최소 스크립트다. 핸드셰이크 실패 경로라 MCP 구현이 필요 없다.
  // examples/ 를 오염시키지 않기 위해 임시 디렉터리에 만든다.
  await writeFile(
    dying,
    // process.exit 은 stderr 가 파이프일 때 write 버퍼를 버릴 수 있다. exitCode 만 정하고
    // 이벤트 루프가 비어 자연 종료하게 둔다. 종료 코드는 1 그대로다.
    "process.stderr.write(\"TypeError: Cannot read properties of undefined (reading 'temp')\\n\");\n" +
      "process.exitCode = 1;\n",
  );
  const suite = join(here, "fixtures", "weather-suite.json");
  try {
    // 1. 기동 즉시 죽는 서버: 오류 메시지만 나오던 경로에 진단이 붙는다.
    const dead = await execute(["test", suite, "--command", process.execPath, "--arg", dying]);
    assert.equal(dead.code, 1);
    assert.equal(dead.out, "");
    for (const expected of [
      "MCP_CONNECTION_FAILED",
      "서버 프로세스 진단",
      "TypeError: Cannot read properties of undefined (reading 'temp')",
      "종료 코드: 1",
    ])
      assert.ok(
        dead.err.includes(expected),
        `stderr 에 '${expected}' 가 없습니다. 실제 출력:\n${dead.err}`,
      );

    // 2. --stderr-lines 0: 진단만 사라지고 기존 오류 메시지는 그대로다.
    const silent = await execute([
      "test",
      suite,
      "--command",
      process.execPath,
      "--arg",
      dying,
      "--stderr-lines",
      "0",
    ]);
    assert.equal(silent.code, 1);
    assert.equal(silent.out, "");
    assert.ok(
      silent.err.includes("MCP_CONNECTION_FAILED"),
      `stderr 에 'MCP_CONNECTION_FAILED' 가 없습니다. 실제 출력:\n${silent.err}`,
    );
    assert.ok(
      !silent.err.includes("서버 프로세스 진단"),
      `--stderr-lines 0 인데 진단 블록이 있습니다. 실제 출력:\n${silent.err}`,
    );

    // 3. 실행 불가능한 command: spawn 자체가 실패해 진단이 전부 비므로 블록을 쓰지 않는다.
    const missing = await execute([
      "test",
      suite,
      "--command",
      "ohmymcp-command-that-does-not-exist",
    ]);
    assert.equal(missing.code, 1);
    assert.equal(missing.out, "");
    assert.ok(
      missing.err.includes("PROCESS_START_FAILED"),
      `stderr 에 'PROCESS_START_FAILED' 가 없습니다. 실제 출력:\n${missing.err}`,
    );
    assert.ok(
      !missing.err.includes("서버 프로세스 진단"),
      `정보가 없는 진단 블록이 붙었습니다. 실제 출력:\n${missing.err}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 목 서버(stdio) 경로 — 우리 CLI 로 우리 목 서버를 테스트한다 (CONTRIBUTING §6, ADR-0007).
// dist 산출물끼리 붙인다: packages/cli/dist/cli.mjs → packages/mock/dist/stdio.mjs.
// 위 케이스들과 달리 PID 래퍼를 끼우지 않는다. 좀비 프로세스 판정은 CLI 의 종료 경로를
// 보는 것이고 그건 weather 케이스가 이미 덮는다. 목이 stdin EOF 에 종료하는지는
// packages/mock/tests/stdio.test.ts 가 본다.
{
  const result = await execute([
    "test",
    join(here, "fixtures", "mock-suite.json"),
    "--command",
    process.execPath,
    "--arg",
    join(root, "packages/mock/dist/stdio.mjs"),
    "--arg",
    join(here, "fixtures", "mock-definition.json"),
    "--json",
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.err, "");
  const report = JSON.parse(result.out);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, "passed");
  assert.deepEqual(report.summary, {
    total: 4,
    passed: 4,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    notRun: 0,
  });
}

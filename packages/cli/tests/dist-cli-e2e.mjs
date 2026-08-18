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

// 배포 산출물 자체에서 도움말과 package.json 버전이 동작해야 한다. 소스 단위 테스트만으로는
// JSON 버전이 번들에 포함되는지와 stdout/stderr 채널을 검증할 수 없다.
{
  const packageMetadata = JSON.parse(
    await readFile(join(root, "packages/cli/package.json"), "utf8"),
  );
  for (const args of [[], ["--help"], ["-h"], ["help"]]) {
    const result = await execute(args);
    assert.equal(result.code, 0);
    assert.equal(result.err, "");
    assert.ok(result.out.includes("사용법: ohmymcp <명령> [옵션]"));
    assert.ok(result.out.includes("test"));
    assert.ok(result.out.includes("generate"));
  }
  for (const [args, usage] of [
    [["help", "test"], "ohmymcp test <suite.json>"],
    [["test", "--help"], "ohmymcp test <suite.json>"],
    [["help", "generate"], "ohmymcp generate --suite-id <id>"],
    [["generate", "--help"], "ohmymcp generate --suite-id <id>"],
  ]) {
    const result = await execute(args);
    assert.equal(result.code, 0);
    assert.equal(result.err, "");
    assert.ok(result.out.includes(usage));
  }
  // 시험 실행 옵션 다섯이 배포 산출물의 도움말에 있어야 한다. 옵션을 소스에만 넣고 번들에서
  // 빠뜨리면 사용자는 존재를 알 방법이 없다.
  {
    const generateHelp = await execute(["generate", "--help"]);
    for (const option of [
      "--no-dry-run",
      "--cassette <path>",
      "--record",
      "--reset-cmd <command>",
      "--no-repair",
      "--force",
    ])
      assert.ok(generateHelp.out.includes(option), option);
    assert.ok(generateHelp.out.includes("실패가 곧바로 분류 화면으로 갑니다"), generateHelp.out);
    assert.ok(generateHelp.out.includes(".gitignore 를 확인하세요"), generateHelp.out);
  }
  const version = await execute(["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.err, "");
  assert.equal(version.out, `ohmymcp ${packageMetadata.version}\n`);

  const unknown = await execute(["unknown"]);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.out, "");
  assert.ok(unknown.err.includes("사용 가능한 명령: test, generate"));
}

for (const [fixture, expectedStatus, expectedSummary] of [
  [
    "weather-suite.json",
    "passed",
    {
      total: 3,
      passed: 3,
      failed: 0,
      timedOut: 0,
      cancelled: 0,
      notRun: 0,
      rejectionUnverified: 1,
    },
  ],
  [
    "weather-suite-failing.json",
    "failed",
    {
      total: 1,
      passed: 0,
      failed: 1,
      timedOut: 0,
      cancelled: 0,
      notRun: 0,
      rejectionUnverified: 0,
    },
  ],
  [
    "weather-body-assertion.suite.json",
    "passed",
    {
      total: 3,
      passed: 3,
      failed: 0,
      timedOut: 0,
      cancelled: 0,
      notRun: 0,
      rejectionUnverified: 2,
    },
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
    // 툴당 정상 케이스 1개 + 서버 선언에서 도출한 위반 케이스다(ADR-0022).
    // weather-server 는 get_weather 3개(정상·city 누락·city 타입)와 add 5개(정상·a 누락·
    // b 누락·a 타입·b 타입)를 만든다.
    assert.equal(value.cases.length, 8);
    assert.deepEqual(
      value.cases.map((item) => item.id),
      [
        "get-weather-success",
        "get-weather-missing-city",
        "get-weather-type-city",
        "add-success",
        "add-missing-a",
        "add-missing-b",
        "add-type-a",
        "add-type-b",
      ],
    );
    // 위반 케이스의 단언은 isError: true 하나다. 서버가 거절하면 통과다.
    assert.deepEqual(
      value.cases.filter((item) => item.assertions[0].expected === true).map((item) => item.id),
      [
        "get-weather-missing-city",
        "get-weather-type-city",
        "add-missing-a",
        "add-missing-b",
        "add-type-a",
        "add-type-b",
      ],
    );
    // 저장한 명세에는 승인 지문이 들어간다. 설계 문서 §3.
    assert.match(value.approval?.fingerprint ?? "", /^[0-9a-f]{64}$/);
    // --baseline-only 는 시험 실행을 하지 않는다. 화면에 그 줄이 없고 승인 기록도 없다.
    // 시험 실행이 없으면 입력값 교정도 없으므로 고지의 재호출 줄도 나오지 않는다.
    assert.ok(!generated.out.includes("시험 실행"), generated.out);
    assert.ok(!generated.out.includes("최대 2회까지 다시 호출합니다"), generated.out);
    assert.equal(value.approval?.cases, undefined);
    await expectExited(pidFile);
    // 같은 --out 으로 다시 부르면 서버를 띄우기 전에 끊는다. 파일이 이미 있다는 것은 인자
    // 파싱 때 아는 값이고, 그 뒤로 이어지는 비용을 치르기 전에 알려 줘야 한다.
    {
      const pidBefore = await readFile(pidFile, "utf8");
      const rerun = await execute([
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
      assert.equal(rerun.code, 1);
      assert.ok(rerun.err.includes("시작하지 않았습니다"), rerun.err);
      assert.ok(rerun.err.includes("`--force`"), rerun.err);
      // 서버가 떴다면 wrapper 가 PID 파일을 새 값으로 덮어쓴다. 값이 그대로면 안 떴다는 뜻이다.
      assert.equal(await readFile(pidFile, "utf8"), pidBefore);
      await expectExited(pidFile);
    }
    const runTest = async (path, extra = []) => {
      const outcome = await execute([
        "test",
        path,
        "--command",
        process.execPath,
        "--arg",
        wrapper,
        "--arg",
        pidFile,
        "--arg",
        server,
        ...extra,
      ]);
      await expectExited(pidFile);
      return outcome;
    };
    const result = await runTest(suite, ["--json"]);
    assert.equal(result.code, 1);
    assert.equal(result.err, "");
    // 위반 케이스 6개는 weather-server 가 입력을 검증하므로 전부 통과한다.
    // 실패 1건은 get-weather-success 다. city "example" 이 그 서버의 고정 데이터에 없다.
    // 값의 도메인은 선언에 없어서 규칙 기반 생성이 알 수 없다(설계 §2 비범위).
    assert.deepEqual(JSON.parse(result.out).summary, {
      total: 8,
      passed: 7,
      failed: 1,
      timedOut: 0,
      cancelled: 0,
      notRun: 0,
      // weather-server 는 거절 문장을 손으로 써서 SDK 지문에 안 걸린다(설계 §9).
      rejectionUnverified: 6,
    });
    // baseline 은 실패하는 케이스를 포함하므로 지문이 일치해도 규칙표상 표시된다. 설계 §7.1.
    const matched = await runTest(suite);
    assert.equal(matched.code, 1);
    assert.ok(matched.out.includes("승인 시점과 동일"), matched.out);
    // 케이스 name 한 글자를 바꾸면 명세의 의미가 바뀐 것이고 지문이 달라진다.
    const changed = join(dir, "changed.json");
    const changedValue = JSON.parse(JSON.stringify(value));
    changedValue.cases[0].name = `${changedValue.cases[0].name}x`;
    await writeFile(changed, `${JSON.stringify(changedValue, null, 2)}\n`, "utf8");
    const mismatched = await runTest(changed);
    assert.ok(mismatched.out.includes("승인 시점 이후 변경됨"), mismatched.out);
    // 판정은 케이스 결과로만 정해진다. 지문이 달라도 종료 코드가 바뀌지 않는다. 설계 §6.
    assert.equal(mismatched.code, matched.code);
    // 하위 호환의 실측. 지문 없는 명세도 검증을 통과하고 그대로 실행된다.
    const legacy = join(dir, "legacy.json");
    const legacyValue = JSON.parse(JSON.stringify(value));
    delete legacyValue.approval;
    await writeFile(legacy, `${JSON.stringify(legacyValue, null, 2)}\n`, "utf8");
    const absent = await runTest(legacy);
    assert.equal(absent.code, matched.code);
    assert.ok(absent.out.includes("승인 지문이 없습니다 (미고정)"), absent.out);
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

// 입력 계약 대조 참고 문장 (설계 문서 §7.2). 명세의 입력이 서버 선언과 어긋날 때 실패 보고서
// 뒤에 참고 문장이 붙는지, 그리고 그것이 판정을 바꾸지 않는지 본다. 판정 불변이 사양의 핵심이다.
// weather-server 는 additionalProperties 를 닫지 않으므로 UNDECLARED_FIELD 는 나지 않는다.
// 오타는 REQUIRED_MISSING 으로 걸린다.
{
  const dir = await mkdtemp(join(tmpdir(), "ohmymcp-dist-contract-"));
  const pidFile = join(dir, "pid");
  // 항상 참인 단언. minLength 0 은 어떤 문자열이든 통과시킨다. isError 뒤에 두므로
  // finding 의 path 는 assertions[1] 이 된다.
  const vacuousAssertion = {
    type: "bodyMatchesSchema",
    schema: { type: "string", minLength: 0 },
  };
  const suiteOf = (input, extraAssertions = []) => ({
    schemaVersion: 1,
    id: "weather-contract",
    name: "입력 계약 대조",
    defaultTimeoutMs: 10_000,
    cases: [
      {
        id: "seoul-weather",
        name: "서울 날씨",
        operation: { type: "callTool", tool: "get_weather", input },
        assertions: [{ type: "isError", expected: false }, ...extraAssertions],
      },
    ],
  });
  const typo = join(dir, "typo.json");
  const correct = join(dir, "correct.json");
  // 입력은 멀쩡하고 단언만 무의미한 명세. 입력 계약 finding 이 없어야 단언 실질성 머리글이
  // 단독으로 나오는 것을 볼 수 있다. 없는 도시를 넣어 케이스를 실패시킨다(표시는 실패 케이스
  // 한정이다).
  const vacuous = join(dir, "vacuous.json");
  // 한 케이스에 두 종류가 함께 있는 명세. 머리글이 갈리는지와 순서를 본다.
  const combined = join(dir, "combined.json");
  await writeFile(typo, `${JSON.stringify(suiteOf({ citi: "서울" }), null, 2)}\n`, "utf8");
  await writeFile(correct, `${JSON.stringify(suiteOf({ city: "서울" }), null, 2)}\n`, "utf8");
  await writeFile(
    vacuous,
    `${JSON.stringify(suiteOf({ city: "없는도시" }, [vacuousAssertion]), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    combined,
    `${JSON.stringify(suiteOf({ citi: "서울" }, [vacuousAssertion]), null, 2)}\n`,
    "utf8",
  );
  const runTest = async (path, extra = []) => {
    const outcome = await execute([
      "test",
      path,
      "--command",
      process.execPath,
      "--arg",
      wrapper,
      "--arg",
      pidFile,
      "--arg",
      server,
      ...extra,
    ]);
    await expectExited(pidFile);
    return outcome;
  };
  try {
    const typoRun = await runTest(typo);
    // 판정은 케이스 결과로만 정해진다. 참고 문장이 붙어도 종료 코드가 바뀌지 않는다.
    assert.equal(typoRun.code, 1);
    assert.equal(typoRun.err, "");
    // 실패 메시지가 곧 제품이다. 머리글과 문장 전문을 고정한다.
    for (const expected of [
      "참고: seoul-weather 의 입력이 서버 선언과 다릅니다",
      "필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'",
    ])
      assert.ok(
        typoRun.out.includes(expected),
        `stdout 에 '${expected}' 가 없습니다. 실제 출력:\n${typoRun.out}`,
      );

    // --json 은 문장이 아니라 구조로 담는다. 기계는 code 로 분기한다.
    const jsonRun = await runTest(typo, ["--json"]);
    assert.equal(jsonRun.code, 1);
    assert.deepEqual(JSON.parse(jsonRun.out).spec.findings, [
      {
        code: "REQUIRED_MISSING",
        severity: "blocking",
        caseId: "seoul-weather",
        path: "input.city",
      },
    ]);

    // 단언 실질성은 툴 목록이 없어도 항상 도는 경로다. 입력 계약 finding 이 하나도 없을 때
    // 이 머리글이 단독으로 나오는지 본다. 코드 경로가 입력 계약 쪽과 다르다.
    const vacuousRun = await runTest(vacuous);
    assert.equal(vacuousRun.code, 1);
    assert.equal(vacuousRun.err, "");
    for (const expected of [
      "참고: seoul-weather 의 단언은 무엇이 와도 통과합니다",
      "assertions[1].schema.minLength 는 0이라 모든 문자열이 통과합니다",
    ])
      assert.ok(
        vacuousRun.out.includes(expected),
        `stdout 에 '${expected}' 가 없습니다. 실제 출력:\n${vacuousRun.out}`,
      );
    assert.ok(
      !vacuousRun.out.includes("의 입력이 서버 선언과 다릅니다"),
      `입력은 멀쩡한데 입력 계약 머리글이 붙었습니다. 실제 출력:\n${vacuousRun.out}`,
    );

    // 두 종류가 한 케이스에 함께 있으면 머리글이 갈리고 입력 계약이 먼저다. 설계 문서 §7.2.
    const combinedRun = await runTest(combined);
    assert.equal(combinedRun.code, 1);
    const contractAt = combinedRun.out.indexOf(
      "참고: seoul-weather 의 입력이 서버 선언과 다릅니다",
    );
    const substanceAt = combinedRun.out.indexOf(
      "참고: seoul-weather 의 단언은 무엇이 와도 통과합니다",
    );
    assert.notEqual(contractAt, -1, `입력 계약 머리글이 없습니다. 실제 출력:\n${combinedRun.out}`);
    assert.notEqual(
      substanceAt,
      -1,
      `단언 실질성 머리글이 없습니다. 실제 출력:\n${combinedRun.out}`,
    );
    // 한 머리글 아래 두 종류를 합치면 읽는 사람이 엉뚱한 곳을 고치러 간다.
    assert.ok(
      contractAt < substanceAt,
      `입력 계약 블록이 단언 실질성보다 뒤에 있습니다. 실제 출력:\n${combinedRun.out}`,
    );

    // 부재 단언이 없으면 항상 찍는 회귀를 못 잡는다.
    const correctRun = await runTest(correct);
    assert.equal(correctRun.code, 0);
    assert.equal(correctRun.err, "");
    assert.ok(
      !correctRun.out.includes("참고:"),
      `옳은 명세인데 참고 문장이 붙었습니다. 실제 출력:\n${correctRun.out}`,
    );
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
    rejectionUnverified: 1,
  });
}

// JUnit 리포터 (ADR-0019). 빌드 산출물이 실제 파일을 만드는지, 실패가 XML 에 드러나는지 본다.
{
  const dir = await mkdtemp(join(tmpdir(), "ohmymcp-dist-junit-"));
  const pidFile = join(dir, "pid");
  const xmlPath = join(dir, "junit.xml");
  const args = (fixture, xml, extra = []) => [
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
    "--junit",
    xml,
    ...extra,
  ];
  try {
    // 1. 통과하는 명세: 파일이 생기고 stdout 은 사람용 보고서 그대로다.
    const passed = await execute(args("weather-suite.json", xmlPath));
    assert.equal(passed.code, 0);
    assert.equal(passed.err, "");
    const xml = await readFile(xmlPath, "utf8");
    for (const expected of [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<testsuite name=",
      'tests="3"',
      'failures="0"',
      'errors="0"',
    ])
      assert.ok(
        xml.includes(expected),
        `JUnit XML 에 '${expected}' 가 없습니다. 실제 파일:\n${xml}`,
      );
    assert.ok(
      xml.endsWith("</testsuites>\n"),
      `JUnit XML 이 닫히지 않았습니다. 실제 파일:\n${xml}`,
    );
    // stdout 은 XML 이 아니다. --junit 은 파일만 더할 뿐 사람용 출력을 바꾸지 않는다.
    assert.ok(
      !passed.out.includes("<testsuite"),
      `--junit 인데 XML 이 stdout 에 섞였습니다. 실제 출력:\n${passed.out}`,
    );
    await expectExited(pidFile);

    // 2. 결정론성: 같은 입력 2회 실행의 파일 바이트가 같아야 한다.
    const again = await execute(args("weather-suite.json", xmlPath));
    assert.equal(again.code, 0);
    assert.equal(await readFile(xmlPath, "utf8"), xml);
    await expectExited(pidFile);

    // 3. 실패는 <failure> 로 드러난다. --json 과 함께 쓰면 stdout 은 JSON, XML 은 파일이다.
    const failed = await execute(
      args("weather-body-assertion-failing.suite.json", xmlPath, ["--json"]),
    );
    assert.equal(failed.code, 1);
    assert.equal(failed.err, "");
    assert.equal(JSON.parse(failed.out).status, "failed");
    const failedXml = await readFile(xmlPath, "utf8");
    for (const expected of [
      "<failure message=",
      'failures="1"',
      // 실패 메시지가 곧 제품이다. CI 화면에 오는 문장이 터미널과 같은지 본다.
      "$.temperature: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temp'",
    ])
      assert.ok(
        failedXml.includes(expected),
        `JUnit XML 에 '${expected}' 가 없습니다. 실제 파일:\n${failedXml}`,
      );
    await expectExited(pidFile);

    // 4. 쓸 수 없는 경로: 전부 통과여도 1 이다. 리포트 없이 초록이 되면 안 된다.
    const unwritable = await execute(
      args("weather-suite.json", join(dir, "no-such-dir", "junit.xml")),
    );
    assert.equal(unwritable.code, 1);
    assert.equal(unwritable.out, "");
    assert.ok(
      unwritable.err.includes("JUNIT_WRITE_FAILED"),
      `stderr 에 'JUNIT_WRITE_FAILED' 가 없습니다. 실제 출력:\n${unwritable.err}`,
    );
    await expectExited(pidFile);
  } finally {
    await cleanupPid(pidFile);
    await rm(dir, { recursive: true, force: true });
  }
}

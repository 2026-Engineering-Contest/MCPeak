import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";

vi.mock("@mcpeak/core", async () => import("../../core/src/index.js"));
vi.mock("@mcpeak/runner", async () => import("../../runner/src/index.js"));

/**
 * `--env <NAME>` 의 E2E(설계 §7.2). 파서 유닛은 이름이 `target.envNames` 에 실리는지까지만
 * 보고, `openConnection` 유닛은 `connectStdio` 가 받는 `env` 까지만 본다. 여기서는 **실제
 * 자식 프로세스의 환경**을 본다. SDK 의 spawn env 가 `{...getDefaultEnvironment(), ...env}` 라
 * 부모의 임의 변수는 넘어가지 않는다는 전제가 이 옵션의 존재 이유인데, 그 전제와 이 옵션이
 * 함께 성립하는지는 자식을 띄워야만 안다.
 *
 * 픽스처 서버는 값을 돌려주지 않는다. 존재 여부와 길이만 준다. 테스트 출력에 값이 찍히면 이
 * 옵션이 막으려던 노출을 우리가 만든다. 값은 `sbp_…` 처럼 모양만 맞춘 가짜다.
 *
 * `run` 은 `readEnv` 를 `process.env` 로 배선한다(`src/index.ts`). 부모 환경은 `vi.stubEnv`
 * 로 넣고 훅에서 되돌린다.
 */

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const server = join(here, "fixtures/env-echo-server.mjs");
const suite = join(here, "fixtures/env-echo.suite.json");

/** 길이 7. 명세의 `length: 7` 단언이 이 값을 읽는다. 값 자체는 어디에도 단언하지 않는다. */
const FORWARDED_FAKE_VALUE = "sbp_abc";

const directories: string[] = [];

beforeEach(() => {
  // 둘 다 부모에 있다. `--env` 로 넘긴 쪽만 자식에 가야 한다.
  vi.stubEnv("TEST_FORWARDED_VALUE", FORWARDED_FAKE_VALUE);
  vi.stubEnv("TEST_NOT_FORWARDED", "sbp_never_forwarded");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

/** stdout·stderr 를 가로챈다. `run` 은 진입점이라 실제 스트림에 쓴다. */
function captureOutput(): { out: () => string; err: () => string } {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const joined = (spy: typeof stdout): string =>
    spy.mock.calls.map(([text]) => String(text)).join("");
  return { out: () => joined(stdout), err: () => joined(stderr) };
}

const runTest = (extra: readonly string[]): Promise<number> =>
  run([
    "test",
    suite,
    "--command",
    process.execPath,
    "--arg",
    server,
    "--env",
    "TEST_FORWARDED_VALUE",
    ...extra,
  ]);

describe("mcpeak test --env", () => {
  it("--env 로 넘긴 이름만 자식 환경에 간다", async () => {
    const output = captureOutput();

    const exitCode = await runTest([]);

    expect(exitCode, output.err()).toBe(0);
    // 값이 어느 스트림에도 찍히지 않는다. 명세는 길이만 묻고 픽스처는 길이만 답한다.
    expect(output.out()).not.toContain(FORWARDED_FAKE_VALUE);
    expect(output.err()).not.toContain(FORWARDED_FAKE_VALUE);
  }, 30_000);

  /**
   * 설계 §1.2 의 실측이 이 자리다. `--arg --access-token --arg <값>` 은 값이 `origin.args`
   * 에 원문으로 남았다. `--env` 는 서버 인자가 아니므로 `args` 에 아예 없다.
   */
  it("녹화 출처의 args 에 --env 이름도 값도 없다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcpeak-env-forward-"));
    directories.push(directory);
    const sessionPath = join(directory, "session.db");
    const output = captureOutput();

    const exitCode = await runTest(["--record-session", sessionPath]);
    expect(exitCode, output.err()).toBe(0);

    const { loadSession } = await import("@mcpeak/record/external");
    const origin = loadSession(sessionPath)?.origin;
    expect(origin?.args).toEqual([server]);
    expect(JSON.stringify(origin)).not.toContain("TEST_FORWARDED_VALUE");
    expect(JSON.stringify(origin)).not.toContain(FORWARDED_FAKE_VALUE);
  }, 30_000);

  it("--env 환경변수가 비어 있으면 이름만 말하고 사용 오류로 멈춘다", async () => {
    vi.stubEnv("TEST_FORWARDED_VALUE", "");
    const output = captureOutput();

    const exitCode = await runTest([]);

    expect(exitCode).not.toBe(0);
    expect(output.err()).toContain("환경변수 `TEST_FORWARDED_VALUE` 가 비어 있습니다");
    expect(output.err()).toContain("read -rs TEST_FORWARDED_VALUE");
  }, 30_000);
});

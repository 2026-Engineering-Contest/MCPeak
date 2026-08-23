import { describe, expect, it } from "vitest";
import type { TestForm } from "../src/build-test-argv.js";
import { buildTestArgv } from "../src/build-test-argv.js";

/**
 * 폼 → argv 계약을 전량 단언한다. 서버가 이 배열을 가공 없이 `runCli` 에 넘기므로
 * (`src/server/wiring.ts`), 여기서 틀리면 대시보드만 다른 제품이 된다.
 */

const form = (overrides: Partial<TestForm> = {}): TestForm => ({
  suitePath: "suite.json",
  command: "node",
  args: ["server.mjs"],
  sessionMode: "off",
  sessionPath: "",
  ...overrides,
});

describe("test 플로우 argv 조립", () => {
  /**
   * **이것이 회귀 방어의 핵심이다.** 세션 기능을 더하면서 기존 실행의 argv 가 한 토큰이라도
   * 달라지면, 지금까지 돌던 실행이 조용히 다른 명령이 된다.
   */
  it("세션을 안 쓰면 스위트·명령·인자만 낸다", () => {
    expect(buildTestArgv(form())).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
    ]);
  });

  it("인자가 여러 개면 순서대로 --arg 로 편다", () => {
    expect(buildTestArgv(form({ args: ["a", "b"] }))).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "a",
      "--arg",
      "b",
    ]);
  });

  it("녹화는 --record-session 을 맨 뒤에 붙인다", () => {
    expect(buildTestArgv(form({ sessionMode: "record", sessionPath: "tmp/s.db" }))).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
      "--record-session",
      "tmp/s.db",
    ]);
  });

  it("재생은 --session 을 맨 뒤에 붙인다", () => {
    expect(buildTestArgv(form({ sessionMode: "replay", sessionPath: "tmp/s.db" }))).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
      "--session",
      "tmp/s.db",
    ]);
  });

  /**
   * CLI 는 두 옵션의 동시 사용을 거절한다. 세 갈래 중 하나만 고르는 타입이라 만들 수 없어야
   * 하는데, 그 성질이 실제로 성립하는지는 값으로 확인해야 안다.
   */
  it("어떤 폼으로도 두 세션 옵션이 함께 실리지 않는다", () => {
    for (const sessionMode of ["off", "record", "replay"] as const) {
      const argv = buildTestArgv(form({ sessionMode, sessionPath: "tmp/s.db" }));
      const used = argv.filter((token) => token === "--session" || token === "--record-session");

      expect(used.length).toBeLessThanOrEqual(1);
    }
  });

  it("세션을 켰는데 경로가 비면 거절한다", () => {
    for (const sessionMode of ["record", "replay"] as const) {
      expect(() => buildTestArgv(form({ sessionMode }))).toThrow("세션 파일 경로를 입력하세요.");
    }
  });

  it("명령이 비면 거절한다 — 세션과 무관하게 기존 가드가 살아 있다", () => {
    expect(() => buildTestArgv(form({ command: "" }))).toThrow("실행 명령을 입력하세요.");
  });

  /**
   * `--arg` 는 하이픈으로 시작하는 값을 의도적으로 받는다(`parseTestCommand`). 그 계약을
   * 대시보드가 따로 해석하기 시작하면 CLI 와 갈라진다 — 실제로 CLI 쪽에서 한 번 갈렸던 자리다.
   */
  it("세션 옵션처럼 생긴 서버 인자도 그대로 --arg 로 간다", () => {
    const argv = buildTestArgv(form({ args: ["--session=/tmp/x"] }));

    expect(argv).toEqual(["suite.json", "--command", "node", "--arg", "--session=/tmp/x"]);
    expect(argv).not.toContain("--session");
  });

  it("같은 폼이면 같은 배열이다", () => {
    const input = form({ sessionMode: "record", sessionPath: "tmp/s.db" });

    expect(buildTestArgv(input)).toEqual(buildTestArgv(input));
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TEST_OPTIONS } from "../src/build-test-argv.js";
import type { LastRun } from "../src/last-run.js";
import { readLastRun, saveLastRun } from "../src/last-run.js";

/**
 * 지난 실행값은 편의 기능이다. **못 읽는 것은 불편이고, 던지는 것은 고장이다** — 이 파일이
 * 단언하는 것은 대부분 "이상한 값이 들어와도 화면이 안 죽는다" 쪽이다.
 */

const KEY = "mcpeak-home-last-run";

const run = (overrides: Partial<LastRun> = {}): LastRun => ({
  command: "node",
  args: ["server.mjs"],
  options: DEFAULT_TEST_OPTIONS,
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("지난 실행값", () => {
  it("저장한 스위트의 값이 그대로 돌아온다", () => {
    saveLastRun("a.suite.json", run({ args: ["server.mjs", "--port", "3000"] }));

    expect(readLastRun("a.suite.json")).toEqual(run({ args: ["server.mjs", "--port", "3000"] }));
  });

  it("다른 스위트는 null 이다", () => {
    saveLastRun("a.suite.json", run());

    expect(readLastRun("b.suite.json")).toBeNull();
  });

  it("command 가 문자열이 아니면 null 이다", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ "a.suite.json": { command: 7, args: [], options: {} } }),
    );

    expect(readLastRun("a.suite.json")).toBeNull();
  });

  /**
   * 옵션이 늘어난 뒤에 예전 값을 읽는 경우다. 빠진 키를 기본값으로 메우지 않으면
   * `buildTestArgv` 가 `undefined` 를 읽고 화면이 죽는다.
   */
  it("options 에 빠진 키는 기본값으로 메운다", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        "a.suite.json": { command: "node", args: ["server.mjs"], options: { determinism: true } },
      }),
    );

    expect(readLastRun("a.suite.json")).toEqual(
      run({ options: { ...DEFAULT_TEST_OPTIONS, determinism: true } }),
    );
  });

  /**
   * jsdom 기본 저장소로는 이 경로를 밟을 수 없다. 저장소가 막힌 브라우저를 흉내내지 않으면
   * "예외를 삼킨다" 는 주장이 검증되지 않은 채 녹색이 된다.
   */
  it("localStorage 가 throw 해도 저장·읽기가 던지지 않는다", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      clear: () => {},
    });

    expect(() => saveLastRun("a.suite.json", run())).not.toThrow();
    expect(readLastRun("a.suite.json")).toBeNull();
  });
});

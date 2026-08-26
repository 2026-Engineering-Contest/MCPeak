// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionOrigin } from "../src/session-origin.js";
import { readSessionOrigin, saveSessionOrigin } from "../src/session-origin.js";

/**
 * 녹화본이 어느 실행에서 나왔는지를 기억한다. **세션 파일 안에 있어야 할 정보를 브라우저가
 * 대신 들고 있는 것**이라 없을 수 있고, 없는 것이 정상이다 — CLI 로 녹화했거나 다른
 * 브라우저에서 보는 경우다. 그래서 이 파일이 단언하는 것은 대부분 "이상한 값이 들어와도
 * null 로 떨어지고 화면이 안 죽는다" 쪽이다(`last-run.test.ts` 와 같은 정책).
 */

const KEY = "mcpeak-session-origin";

const origin = (overrides: Partial<SessionOrigin> = {}): SessionOrigin => ({
  command: "node",
  args: ["server.mjs"],
  suitePath: "examples/weather/weather.suite.json",
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("녹화본의 출처", () => {
  it("저장한 세션의 값이 그대로 돌아온다", () => {
    saveSessionOrigin("tmp/weather.db", origin({ args: ["server.mjs", "--port", "3000"] }));

    expect(readSessionOrigin("tmp/weather.db")).toEqual(
      origin({ args: ["server.mjs", "--port", "3000"] }),
    );
  });

  it("다른 세션 경로는 null 이다", () => {
    saveSessionOrigin("tmp/weather.db", origin());

    expect(readSessionOrigin("tmp/geocode.db")).toBeNull();
  });

  it("저장한 적 없는 세션은 null 이다", () => {
    expect(readSessionOrigin("tmp/weather.db")).toBeNull();
  });

  it("같은 경로에 다시 녹화하면 나중 값이 남는다", () => {
    saveSessionOrigin("tmp/weather.db", origin({ suitePath: "old.suite.json" }));
    saveSessionOrigin("tmp/weather.db", origin({ suitePath: "new.suite.json" }));

    expect(readSessionOrigin("tmp/weather.db")?.suitePath).toBe("new.suite.json");
  });

  it("다른 세션의 값을 지우지 않는다", () => {
    saveSessionOrigin("tmp/weather.db", origin({ suitePath: "weather.suite.json" }));
    saveSessionOrigin("tmp/geocode.db", origin({ suitePath: "geocode.suite.json" }));

    expect(readSessionOrigin("tmp/weather.db")?.suitePath).toBe("weather.suite.json");
    expect(readSessionOrigin("tmp/geocode.db")?.suitePath).toBe("geocode.suite.json");
  });

  /**
   * 쓰는 쪽 키는 사용자가 폼에 적은 경로 그대로이고, 읽는 쪽 키는 `/api/sessions` 의
   * `/` 구분 상대경로다. 정규화가 없으면 Windows 에서 역슬래시로 적어 녹화한 사용자는
   * 대시보드로 녹화했는데도 원클릭이 조용히 안 된다.
   */
  it("Windows 구분자로 저장해도 목록의 경로로 읽힌다", () => {
    saveSessionOrigin("tmp\\sessions\\weather.db", origin());

    expect(readSessionOrigin("tmp/sessions/weather.db")).toEqual(origin());
  });

  it("`./` 접두를 붙여 저장해도 목록의 경로로 읽힌다", () => {
    saveSessionOrigin("./tmp/weather.db", origin());

    expect(readSessionOrigin("tmp/weather.db")).toEqual(origin());
  });

  /** 정규화 없이 남은 키(이전 버전이 저장한 값)도 읽는다. 저장이 늘 정규화한다는 데 기대지 않는다. */
  it("저장소에 역슬래시 키로 남아 있어도 읽힌다", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ "tmp\\weather.db": origin() }));

    expect(readSessionOrigin("tmp/weather.db")).toEqual(origin());
  });

  it("command 가 문자열이 아니면 null 이다", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ "tmp/weather.db": { command: 7, args: [], suitePath: "a.json" } }),
    );

    expect(readSessionOrigin("tmp/weather.db")).toBeNull();
  });

  /**
   * suitePath 가 없으면 argv 를 만들 수 없다. 빈 문자열로 메우면 `buildTestArgv` 가 스위트
   * 자리에 빈 값을 실은 명령을 만들어, 실행이 시작된 뒤에야 CLI 가 거절한다.
   */
  it("suitePath 가 없으면 null 이다", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ "tmp/weather.db": { command: "node", args: ["server.mjs"] } }),
    );

    expect(readSessionOrigin("tmp/weather.db")).toBeNull();
  });

  it("args 가 배열이 아니면 null 이다", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        "tmp/weather.db": { command: "node", args: "server.mjs", suitePath: "a.json" },
      }),
    );

    expect(readSessionOrigin("tmp/weather.db")).toBeNull();
  });

  /** 인자는 `--arg` 로 하나씩 실린다. 문자열이 아닌 항목이 섞이면 그 항목만 뺀다. */
  it("args 안의 문자열이 아닌 항목은 걸러낸다", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        "tmp/weather.db": { command: "node", args: ["a", 7, null, "b"], suitePath: "a.json" },
      }),
    );

    expect(readSessionOrigin("tmp/weather.db")?.args).toEqual(["a", "b"]);
  });

  it("저장값이 객체가 아니면 null 이다", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ "tmp/weather.db": "node server.mjs" }));

    expect(readSessionOrigin("tmp/weather.db")).toBeNull();
  });

  it("저장소에 깨진 JSON 이 있어도 null 로 떨어진다", () => {
    window.localStorage.setItem(KEY, "{ 깨진 값");

    expect(readSessionOrigin("tmp/weather.db")).toBeNull();
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
      removeItem: () => {},
      clear: () => {},
    });

    expect(() => saveSessionOrigin("tmp/weather.db", origin())).not.toThrow();
    expect(readSessionOrigin("tmp/weather.db")).toBeNull();
  });
});

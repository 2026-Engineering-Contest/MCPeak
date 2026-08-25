import { describe, expect, it } from "vitest";
import type { FileEntry } from "../../src/api-types.js";
import { matchSuites, suitePrefix } from "../src/home/match-suites.js";

const entry = (path: string): FileEntry => ({ path });

const SUITES: readonly FileEntry[] = [
  entry("examples/weather-server/server.suite.json"),
  entry("examples/weather-server/server.suite_show.json"),
  entry("examples/weather-server/server.json"),
  entry("examples/weather-server/server-extra.suite.json"),
  entry("examples/other/server.suite.json"),
];

describe("suitePrefix", () => {
  it("스크립트 인자에서 확장자를 벗긴다", () => {
    expect(suitePrefix(["examples/weather-server/server.mjs", "--port", "3000"])).toBe(
      "examples/weather-server/server",
    );
  });

  it("실행 방법 프리셋의 확장자를 모두 본다", () => {
    for (const script of ["a.js", "a.mjs", "a.cjs", "a.ts", "a.py"]) {
      expect(suitePrefix([script])).toBe("a");
    }
  });

  it("스크립트가 없으면 null 이다", () => {
    // npx 패키지·HTTP 대상. 되짚을 이름이 없으니 매칭도 없다.
    expect(suitePrefix(["@scope/mcp-server", "--stdio"])).toBeNull();
    expect(suitePrefix([])).toBeNull();
  });
});

describe("matchSuites", () => {
  it("접두사가 같은 스위트만 위로 올린다", () => {
    const { matched, others } = matchSuites(["examples/weather-server/server.mjs"], SUITES);
    expect(matched.map((suite) => suite.path)).toEqual([
      "examples/weather-server/server.suite.json",
      "examples/weather-server/server.suite_show.json",
      "examples/weather-server/server.json",
    ]);
    // `server-extra` 는 접두사로 시작하지만 그 뒤가 `.suite*.json` 이 아니다. 다른 서버다.
    expect(others.map((suite) => suite.path)).toEqual([
      "examples/weather-server/server-extra.suite.json",
      "examples/other/server.suite.json",
    ]);
  });

  it("원래 순서를 지킨다", () => {
    const reversed = [...SUITES].reverse();
    const { matched, others } = matchSuites(["examples/weather-server/server.mjs"], reversed);
    expect(matched.map((suite) => suite.path)).toEqual([
      "examples/weather-server/server.json",
      "examples/weather-server/server.suite_show.json",
      "examples/weather-server/server.suite.json",
    ]);
    expect(others.map((suite) => suite.path)).toEqual([
      "examples/other/server.suite.json",
      "examples/weather-server/server-extra.suite.json",
    ]);
  });

  it("스크립트가 없으면 전부 나머지다", () => {
    const { matched, others } = matchSuites([], SUITES);
    expect(matched).toEqual([]);
    expect(others).toEqual(SUITES);
  });

  it("접두사가 같은 스위트가 없으면 매칭이 0건이다", () => {
    const { matched, others } = matchSuites(["examples/nothing/server.mjs"], SUITES);
    expect(matched).toEqual([]);
    expect(others).toEqual(SUITES);
  });
});

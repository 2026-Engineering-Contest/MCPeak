// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { deriveSuiteName, suggestOutPathFor } from "../src/generate/suggest.js";

/** 설계 §6-3 의 네 갈래. 나머지 필드는 각 케이스가 덮어쓴다. */
const BASE: Parameters<typeof suggestOutPathFor>[0] = {
  transport: "stdio",
  args: [],
  sourcePath: null,
  candidateName: null,
};

describe("suggestOutPathFor", () => {
  it("첫 스크립트 인자 옆에 .suite.json 을 제안한다", () => {
    expect(suggestOutPathFor({ ...BASE, args: ["examples/weather-server/server.mjs"] })).toBe(
      "examples/weather-server/server.suite.json",
    );
  });

  it(".ts·.py·.cjs 도 스크립트로 본다", () => {
    expect(suggestOutPathFor({ ...BASE, args: ["src/server.ts"] })).toBe("src/server.suite.json");
    expect(suggestOutPathFor({ ...BASE, args: ["src/server.py"] })).toBe("src/server.suite.json");
    expect(suggestOutPathFor({ ...BASE, args: ["src/server.cjs"] })).toBe("src/server.suite.json");
    expect(suggestOutPathFor({ ...BASE, args: ["src/Server.MJS"] })).toBe("src/Server.suite.json");
  });

  it("스크립트 인자가 없으면 후보 파일 디렉터리에 <이름>.suite.json 을 제안한다", () => {
    expect(
      suggestOutPathFor({
        ...BASE,
        args: ["-y", "@scope/server"],
        sourcePath: "examples/weather-server/.mcp.json",
        candidateName: "weather",
      }),
    ).toBe("examples/weather-server/weather.suite.json");
  });

  it("후보 파일이 루트에 있으면 디렉터리 없이 <이름>.suite.json 이다", () => {
    expect(suggestOutPathFor({ ...BASE, sourcePath: ".mcp.json", candidateName: "weather" })).toBe(
      "weather.suite.json",
    );
  });

  it("직접 입력 custom 은 빈 문자열이다", () => {
    expect(suggestOutPathFor({ ...BASE, args: [], sourcePath: null })).toBe("");
  });

  it("HTTP 는 빈 문자열이다", () => {
    expect(
      suggestOutPathFor({
        ...BASE,
        transport: "http",
        args: ["examples/weather-server/server.mjs"],
        sourcePath: "examples/weather-server/.mcp.json",
        candidateName: "weather",
      }),
    ).toBe("");
  });
});

describe("deriveSuiteName", () => {
  it("deriveSuiteName 표", () => {
    expect(deriveSuiteName("a.suite.json")).toBe("a");
    expect(deriveSuiteName("A.SUITE.JSON")).toBe("A");
    expect(deriveSuiteName("b.json")).toBe("b");
    expect(deriveSuiteName("dir/c.suite.json")).toBe("c");
    expect(deriveSuiteName("dir\\d.suite.json")).toBe("d");
    expect(deriveSuiteName(".json")).toBe("");
    expect(deriveSuiteName("")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { describeRun } from "../src/run-target.js";

describe("describeRun", () => {
  it("test 는 첫 위치 인자가 스위트, --command 와 --arg 가 서버다", () => {
    expect(
      describeRun("test", [
        "examples/weather-server/server.suite.json",
        "--command",
        "node",
        "--arg",
        "examples/weather-server/server.mjs",
        "--arg",
        "--port",
        "--arg",
        "3000",
        "--repair-bundle",
        ".mcpeak/repair/x.json",
      ]),
    ).toEqual({
      server: "node examples/weather-server/server.mjs --port 3000",
      suite: "examples/weather-server/server.suite.json",
    });
  });

  it("HTTP 대상은 URL 이 서버다", () => {
    expect(describeRun("test", ["s.json", "--url", "https://example.test/mcp"])).toEqual({
      server: "https://example.test/mcp",
      suite: "s.json",
    });
  });

  it("generate 는 --out 이 스위트다", () => {
    expect(
      describeRun("generate", [
        "--command",
        "node",
        "--arg",
        "server.mjs",
        "--suite-id",
        "weather",
        "--out",
        "examples/weather-server/server.suite.json",
      ]),
    ).toEqual({
      server: "node server.mjs",
      suite: "examples/weather-server/server.suite.json",
    });
  });

  it("repair 는 첫 위치 인자가 번들이고 서버는 모른다", () => {
    expect(
      describeRun("repair", [".mcpeak/repair/x.repair-bundle.json", "--provider", "claude"]),
    ).toEqual({ server: null, suite: ".mcpeak/repair/x.repair-bundle.json" });
  });

  it("`--name=value` 꼴도 같게 읽는다", () => {
    expect(describeRun("test", ["s.json", "--command=python", "--arg=server.py"])).toEqual({
      server: "python server.py",
      suite: "s.json",
    });
  });

  /** 모르는 것은 모른다고 둔다. 빈 문자열이나 "알 수 없음" 을 만들지 않는다(#295). */
  it("argv 가 비었거나 옵션으로 시작하면 그 칸은 null 이다", () => {
    expect(describeRun("test", [])).toEqual({ server: null, suite: null });
    expect(describeRun("test", undefined)).toEqual({ server: null, suite: null });
    expect(describeRun("test", ["--url", "https://example.test/mcp"])).toEqual({
      server: "https://example.test/mcp",
      suite: null,
    });
  });

  it("값이 빠진 옵션은 없는 것으로 본다", () => {
    expect(describeRun("test", ["s.json", "--command"])).toEqual({ server: null, suite: "s.json" });
  });
});

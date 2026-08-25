import { describe, expect, it } from "vitest";
import { buildTestArgv, DEFAULT_TEST_OPTIONS } from "../src/build-test-argv.js";
import { buildGenerateArgv } from "../src/generate/build-argv.js";
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

/**
 * `describeRun` 은 CLI 인자 규칙을 새로 판정하지 않는다. **대시보드가 방금 만들어 보낸 argv 를
 * 되읽을 뿐이다.** 그 사실을 표로 두는 것이 이 블록이다 — 조립 쪽(`buildTestArgv`·
 * `buildGenerateArgv`)이 바뀌면 여기서 먼저 깨진다.
 */
describe("describeRun 은 대시보드가 만든 argv 를 되읽는다", () => {
  it("buildTestArgv 가 만든 argv 를 그대로 되읽는다", () => {
    const argv = buildTestArgv({
      suitePath: "examples/weather-server/server.suite.json",
      command: "node",
      args: ["examples/weather-server/server.mjs", "--port", "3000"],
      sessionMode: "off",
      sessionPath: "",
      options: DEFAULT_TEST_OPTIONS,
    });

    expect(describeRun("test", argv)).toEqual({
      server: "node examples/weather-server/server.mjs --port 3000",
      suite: "examples/weather-server/server.suite.json",
    });
  });

  it("HTTP 로 만든 argv 도 그대로 되읽는다", () => {
    const argv = buildTestArgv({
      suitePath: "s.suite.json",
      command: "",
      args: [],
      sessionMode: "off",
      sessionPath: "",
      options: {
        ...DEFAULT_TEST_OPTIONS,
        transport: "http",
        url: "https://example.test/mcp",
      },
    });

    expect(describeRun("test", argv)).toEqual({
      server: "https://example.test/mcp",
      suite: "s.suite.json",
    });
  });

  it("buildGenerateArgv 가 만든 argv 는 --out 이 스위트다", () => {
    const argv = buildGenerateArgv({
      transport: "stdio",
      url: "",
      headerEnvs: [],
      command: "node",
      args: ["examples/weather-server/server.mjs"],
      suiteId: "weather",
      suiteName: "Weather",
      outPath: "examples/weather-server/server.suite.json",
      force: false,
      mode: "baseline",
      provider: "claude",
      model: "",
      dryRun: true,
      repair: true,
      resetCmd: "",
    });

    expect(describeRun("generate", argv)).toEqual({
      server: "node examples/weather-server/server.mjs",
      suite: "examples/weather-server/server.suite.json",
    });
  });
});

import { describe, expect, it } from "vitest";
import type { AnalyzeForm } from "../src/analyze/build-analyze-argv.js";
import { buildAnalyzeArgv } from "../src/analyze/build-analyze-argv.js";

const STDIO: AnalyzeForm = {
  command: "node",
  args: ["s.mjs", "--port", "3000"],
  envNames: ["API_KEY"],
  transport: "stdio",
  url: "",
  headerEnvs: [],
};

const HTTP: AnalyzeForm = {
  command: "node",
  args: ["s.mjs"],
  envNames: ["K"],
  transport: "http",
  url: " http://localhost:3000/mcp ",
  headerEnvs: ["Authorization=TOKEN"],
};

describe("buildAnalyzeArgv", () => {
  it("stdio: --command, --arg…, --env… 순서다", () => {
    expect(buildAnalyzeArgv(STDIO)).toEqual([
      "--command",
      "node",
      "--arg",
      "s.mjs",
      "--arg",
      "--port",
      "--arg",
      "3000",
      "--env",
      "API_KEY",
    ]);
  });

  it("http: --url 과 --header-env 만 싣고 args·envNames 는 버린다", () => {
    expect(buildAnalyzeArgv(HTTP)).toEqual([
      "--url",
      "http://localhost:3000/mcp",
      "--header-env",
      "Authorization=TOKEN",
    ]);
  });

  it("stdio 에 명령이 비면 '서버를 고르거나 실행 명령을 입력하세요.' 로 throw", () => {
    expect(() => buildAnalyzeArgv({ ...STDIO, command: "" })).toThrow(
      "서버를 고르거나 실행 명령을 입력하세요.",
    );
  });

  it("http 에 URL 이 비면 'URL 을 입력하세요.' 로 throw", () => {
    expect(() => buildAnalyzeArgv({ ...HTTP, url: "  " })).toThrow("URL 을 입력하세요.");
  });

  it("헤더 환경변수 형식이 틀리면 buildTestArgv 와 같은 문장으로 throw", () => {
    expect(() => buildAnalyzeArgv({ ...HTTP, headerEnvs: ["bad"] })).toThrow(
      "헤더 환경변수는 <헤더이름>=<환경변수이름> 형식이어야 합니다: 'bad'",
    );
  });
});

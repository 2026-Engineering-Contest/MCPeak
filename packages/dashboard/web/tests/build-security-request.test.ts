import { describe, expect, it } from "vitest";
import {
  buildSecurityRequest,
  INITIAL_SECURITY_FORM,
  type SecurityForm,
} from "../src/analyze/build-security-request.js";

const ARGV = ["--command", "node"];

function form(overrides: Partial<SecurityForm>): SecurityForm {
  return { ...INITIAL_SECURITY_FORM, ...overrides };
}

describe("buildSecurityRequest", () => {
  it("기본 폼이면 argv 만 싣는다", () => {
    expect(buildSecurityRequest(ARGV, undefined, "stdio", INITIAL_SECURITY_FORM)).toEqual({
      argv: ["--command", "node"],
    });
  });

  it("serverId·probe·baselinePath·updateBaseline·sandbox 를 이 키 순서로 싣는다", () => {
    const request = buildSecurityRequest(
      ARGV,
      "s",
      "stdio",
      form({
        probe: "none",
        baselinePath: "b.json",
        updateBaseline: true,
        sandbox: true,
        compareHost: true,
        allowHosts: ["a.example.com"],
      }),
    );

    expect(JSON.stringify(request)).toBe(
      '{"argv":["--command","node"],"serverId":"s","probe":"none","baselinePath":"b.json","updateBaseline":true,"sandbox":{"compareHost":true,"allowHosts":["a.example.com"]}}',
    );
  });

  it("기준 파일 경로는 앞뒤 공백을 떼고, 비면 updateBaseline 도 싣지 않는다", () => {
    expect(
      buildSecurityRequest(ARGV, undefined, "stdio", form({ baselinePath: "  b.json  " })),
    ).toEqual({ argv: ARGV, baselinePath: "b.json" });
    expect(
      buildSecurityRequest(
        ARGV,
        undefined,
        "stdio",
        form({ baselinePath: "   ", updateBaseline: true }),
      ),
    ).toEqual({ argv: ARGV });
  });

  it(".json 으로 끝나지 않는 경로는 throw", () => {
    expect(() =>
      buildSecurityRequest(ARGV, undefined, "stdio", form({ baselinePath: "b.txt" })),
    ).toThrow(new Error("기준 파일 경로는 .json 으로 끝나야 합니다."));
  });

  it("http 대상이면 sandbox 를 싣지 않고 허용 호스트도 검사하지 않는다", () => {
    expect(
      buildSecurityRequest(
        ["--url", "http://localhost:3000/mcp"],
        undefined,
        "http",
        form({ sandbox: true, compareHost: true, allowHosts: ["http://a"] }),
      ),
    ).toEqual({ argv: ["--url", "http://localhost:3000/mcp"] });
  });

  it("호스트 이름이 아닌 허용 호스트는 throw", () => {
    expect(() =>
      buildSecurityRequest(
        ARGV,
        undefined,
        "stdio",
        form({ sandbox: true, allowHosts: ["a.example.com", "http://a"] }),
      ),
    ).toThrow(new Error("허용 호스트는 호스트 이름이어야 합니다(예: api.example.com): 'http://a'"));
    // 길이 상한 253 도 CLI 와 같다. 모양은 호스트 이름이지만 길어서 걸린다.
    const long = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}`;
    expect(long.length).toBe(255);
    expect(() =>
      buildSecurityRequest(ARGV, undefined, "stdio", form({ sandbox: true, allowHosts: [long] })),
    ).toThrow(new Error(`허용 호스트는 호스트 이름이어야 합니다(예: api.example.com): '${long}'`));
  });

  it("격리를 끄면 허용 호스트가 틀려도 throw 하지 않는다", () => {
    expect(
      buildSecurityRequest(
        ARGV,
        undefined,
        "stdio",
        form({ sandbox: false, compareHost: true, allowHosts: ["http://a"] }),
      ),
    ).toEqual({ argv: ARGV });
  });
});

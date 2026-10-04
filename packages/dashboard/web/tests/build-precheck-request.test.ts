import { describe, expect, it } from "vitest";
import { buildPrecheckRequest } from "../src/precheck/build-precheck-request.js";
import type { PastedServer } from "../src/precheck/parse-server-input.js";

const NPX: PastedServer = {
  name: null,
  transport: "stdio",
  command: "npx",
  args: ["-y", "pkg"],
  envNames: [],
  url: "",
  headerNames: [],
};

const NPX_ARGV = ["--command", "npx", "--arg", "-y", "--arg", "pkg"];

const REMOTE: PastedServer = {
  name: "b",
  transport: "http",
  command: "",
  args: [],
  envNames: [],
  url: "https://x.test/mcp",
  headerNames: ["Authorization"],
};

describe("buildPrecheckRequest", () => {
  it("stdio 대상에 격리를 켜면 sandbox 를 싣는다", () => {
    expect(buildPrecheckRequest(NPX, true)).toEqual({
      argv: NPX_ARGV,
      sandbox: { compareHost: false, allowHosts: [] },
    });
  });

  it("격리를 끄면 argv 만 보낸다", () => {
    const request = buildPrecheckRequest(NPX, false);

    expect(request).toEqual({ argv: NPX_ARGV });
    expect("sandbox" in request).toBe(false);
  });

  it("env 이름을 싣지 않는다", () => {
    const request = buildPrecheckRequest({ ...NPX, envNames: ["API_KEY"] }, true);

    expect(request.argv).not.toContain("--env");
    expect(request.argv).not.toContain("API_KEY");
    expect(request.argv).toEqual(NPX_ARGV);
  });

  it("http 대상은 격리를 켜도 sandbox 를 싣지 않고 헤더도 싣지 않는다", () => {
    const request = buildPrecheckRequest(REMOTE, true);

    expect(request).toEqual({ argv: ["--url", "https://x.test/mcp"] });
    expect(request.argv).not.toContain("--header-env");
  });

  it("serverId, probe, baselinePath 를 싣지 않는다", () => {
    expect(Object.keys(buildPrecheckRequest(NPX, true))).toEqual(["argv", "sandbox"]);
    expect(Object.keys(buildPrecheckRequest(NPX, false))).toEqual(["argv"]);
    expect(Object.keys(buildPrecheckRequest(REMOTE, true))).toEqual(["argv"]);
  });

  it("같은 입력은 같은 요청이다", () => {
    expect(JSON.stringify(buildPrecheckRequest(NPX, true))).toBe(
      JSON.stringify(buildPrecheckRequest(NPX, true)),
    );
  });
});

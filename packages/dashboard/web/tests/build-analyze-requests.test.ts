// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildAnalyzeRequests, describeTarget } from "../src/analyze/build-analyze-requests.js";
import type { AnalyzeTarget, AnalyzeTargetState } from "../src/analyze/use-analyze-target.js";
import { WEATHER, WEATHER_ARGV } from "./analyze-fixture-data.js";

/** `use-analyze-target.ts` 의 `INITIAL_STATE` 와 같은 모양. */
const INITIAL_STATE: AnalyzeTargetState = {
  choice: { kind: "manual" },
  command: "",
  args: [],
  envNames: [],
  method: "node",
  target: "",
  transport: "stdio",
  url: "",
  headerEnvs: [],
};

/** `AnalyzeTarget` 모양의 객체. 기본값은 빈 대상이고 `partial` 로 덮는다. */
function targetWith(partial: Partial<AnalyzeTarget>): AnalyzeTarget {
  return {
    state: INITIAL_STATE,
    candidates: [],
    root: null,
    recentCommands: [],
    patchServer: vi.fn(),
    argv: { error: "" },
    serverId: undefined,
    rememberCommand: vi.fn(),
    ...partial,
  };
}

describe("buildAnalyzeRequests", () => {
  it("대상이 오류면 그 문장이고 보안 요청은 만들지 않는다", () => {
    expect(
      buildAnalyzeRequests(
        targetWith({ argv: { error: "서버를 고르거나 실행 명령을 입력하세요." } }),
      ),
    ).toEqual({ error: "서버를 고르거나 실행 명령을 입력하세요." });
  });

  it("node 대상이면 보안 요청에 격리 시도(sandbox·sandboxOptional)를 싣고 토큰은 argv·serverId 뿐이다", () => {
    const out = buildAnalyzeRequests(
      targetWith({ argv: { argv: WEATHER_ARGV }, serverId: WEATHER.id }),
    );
    expect(out).toEqual({
      tokens: { argv: WEATHER_ARGV, serverId: WEATHER.id },
      security: {
        argv: WEATHER_ARGV,
        serverId: WEATHER.id,
        sandbox: { compareHost: false, allowHosts: [] },
        sandboxOptional: true,
      },
    });
  });

  it("직접 입력 갈래면 serverId 키 자체가 없다", () => {
    const out = buildAnalyzeRequests(targetWith({ argv: { argv: WEATHER_ARGV } }));
    expect(out).toEqual({
      tokens: { argv: WEATHER_ARGV },
      security: {
        argv: WEATHER_ARGV,
        sandbox: { compareHost: false, allowHosts: [] },
        sandboxOptional: true,
      },
    });
  });

  it("npx·npm 은 경로가 붙어도 basename 으로 본다", () => {
    for (const command of ["npx", "/usr/local/bin/npm", "C:\\nodejs\\npx"]) {
      const argv = ["--command", command, "--arg", "-y"];
      const out = buildAnalyzeRequests(targetWith({ argv: { argv } }));
      expect("security" in out && out.security.sandbox).toEqual({
        compareHost: false,
        allowHosts: [],
      });
    }
  });

  it("http 대상이면 보안 요청에 sandbox 키가 없다", () => {
    const argv = ["--url", "http://localhost:3000/mcp"];
    const out = buildAnalyzeRequests(
      targetWith({ state: { ...INITIAL_STATE, transport: "http" }, argv: { argv } }),
    );
    expect(out).toEqual({ tokens: { argv }, security: { argv } });
  });

  it("격리 이미지가 실행하지 않는 명령(python 등)이면 보안 요청에 sandbox 키가 없다", () => {
    for (const command of ["python", "uvx", "/usr/bin/python3", "nodemon", "node.exe"]) {
      const argv = ["--command", command, "--arg", "server.py"];
      const out = buildAnalyzeRequests(targetWith({ argv: { argv } }));
      expect(out).toEqual({ tokens: { argv }, security: { argv } });
    }
  });
});

describe("describeTarget", () => {
  it("분석한 대상은 후보 이름이고 후보가 없으면 명령이다", () => {
    expect(describeTarget([WEATHER], { argv: WEATHER_ARGV, serverId: WEATHER.id })).toBe(
      WEATHER.name,
    );
    // `run-target.ts` 의 commandLine 은 `--command` 값 뒤에 `--arg` 값들을 공백으로 잇는다.
    expect(describeTarget([], { argv: ["--command", "node", "--arg", "server.js"] })).toBe(
      "node server.js",
    );
    expect(describeTarget([], { argv: [] })).toBe("");
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildAnalyzeRequests, describeTarget } from "../src/analyze/build-analyze-requests.js";
import { INITIAL_SECURITY_FORM } from "../src/analyze/build-security-request.js";
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
        INITIAL_SECURITY_FORM,
      ),
    ).toEqual({ error: "서버를 고르거나 실행 명령을 입력하세요." });
  });

  it("기준 파일이 .json 이 아니면 그 문장이다", () => {
    expect(
      buildAnalyzeRequests(targetWith({ argv: { argv: WEATHER_ARGV }, serverId: WEATHER.id }), {
        ...INITIAL_SECURITY_FORM,
        baselinePath: "b.txt",
      }),
    ).toEqual({ error: "기준 파일 경로는 .json 으로 끝나야 합니다." });
  });

  it("둘 다 되면 토큰은 argv·serverId, 보안은 buildSecurityRequest 결과다", () => {
    const out = buildAnalyzeRequests(
      targetWith({ argv: { argv: WEATHER_ARGV }, serverId: WEATHER.id }),
      INITIAL_SECURITY_FORM,
    );
    expect(out).toEqual({
      tokens: { argv: WEATHER_ARGV, serverId: WEATHER.id },
      security: { argv: WEATHER_ARGV, serverId: WEATHER.id },
    });
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

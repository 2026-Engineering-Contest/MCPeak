// @vitest-environment node
import type { SandboxReport } from "@mcpeak/audit";
import { describe, expect, it } from "vitest";
import { securityExecution } from "../src/analyze/security-execution.js";
import { DOCKER_MISSING_LINE, RAN, RAN_LINE, securityResponse } from "./analyze-fixture-data.js";

const DAEMON_DOWN: SandboxReport = {
  status: "unavailable",
  reason: { code: "daemon-down", detail: "Cannot connect to the Docker daemon" },
};

describe("securityExecution", () => {
  it("격리가 돌았으면 격리 실행(Docker) 다", () => {
    expect(securityExecution(securityResponse({ sandbox: RAN, sandboxLine: RAN_LINE }))).toBe(
      "격리 실행(Docker)",
    );
  });

  it("Docker 를 못 썼으면 로컬 실행 뒤에 sandboxLine 의 첫 줄이다", () => {
    expect(
      securityExecution(
        securityResponse({
          sandbox: { status: "unavailable", reason: { code: "docker-missing", detail: "" } },
          sandboxLine: DOCKER_MISSING_LINE,
        }),
      ),
    ).toBe(`로컬 실행(readonly): ${DOCKER_MISSING_LINE}`);
  });

  it("sandboxLine 이 여러 줄이면 첫 줄만 싣는다", () => {
    expect(
      securityExecution(securityResponse({ sandbox: DAEMON_DOWN, sandboxLine: "첫째\n둘째" })),
    ).toBe("로컬 실행(readonly): 첫째");
  });

  it("sandboxLine 이 없으면 사유의 detail 첫 줄이다", () => {
    expect(
      securityExecution(
        securityResponse({
          sandbox: { status: "unavailable", reason: { code: "start-failed", detail: "a\nb" } },
          sandboxLine: null,
        }),
      ),
    ).toBe("로컬 실행(readonly): a");
  });

  it("격리 대상 판정에서 거절돼 다시 돌았으면 그 사유다", () => {
    expect(
      securityExecution(
        securityResponse({ sandboxFallbackReason: "서버 인자 'x' 가 범위 밖입니다." }),
      ),
    ).toBe("로컬 실행(readonly): 서버 인자 'x' 가 범위 밖입니다.");
  });

  it("격리를 요청하지 않은 응답이면 격리할 수 없는 대상이다", () => {
    expect(securityExecution(securityResponse())).toBe(
      "로컬 실행(readonly): 격리할 수 없는 대상입니다",
    );
  });

  it("호출 정책은 리포트의 probe 를 따른다", () => {
    const response = securityResponse();
    expect(securityExecution({ ...response, report: { ...response.report, probe: "none" } })).toBe(
      "로컬 실행(none): 격리할 수 없는 대상입니다",
    );
  });

  it("같은 응답 두 번이면 같은 글자다", () => {
    for (const response of [
      securityResponse({ sandbox: RAN, sandboxLine: RAN_LINE }),
      securityResponse({ sandbox: DAEMON_DOWN, sandboxLine: "x" }),
      securityResponse(),
    ]) {
      expect(JSON.stringify(securityExecution(response))).toBe(
        JSON.stringify(securityExecution(response)),
      );
    }
  });
});

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

  /**
   * 윈도우에서 node 는 `node.exe` 이고 npm·npx 는 `npm.cmd`·`npx.cmd` 다. 런처나 IDE,
   * `process.execPath` 가 흔히 그렇게 넘긴다. 확장자를 떼지 않으면 윈도우 사용자는 격리를 시도조차
   * 받지 못한다(#540).
   *
   * 이 표는 `@mcpeak/audit` 의 `sandbox/command-name.ts` 와 같은 규칙을 지킨다. 그 파일이 정본이고,
   * 이 파일은 브라우저 번들이라 그것을 런타임으로 불러올 수 없어 규칙을 복제한다. 복제가 어긋나면
   * 여기가 먼저 깨져야 한다.
   */
  it("윈도우 실행 파일 확장자가 붙어도 격리 가능으로 본다", () => {
    const sandboxable = [
      "node.exe",
      "npx.cmd",
      "npm.cmd",
      "npm.bat",
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\nodejs\\npx.cmd",
      // 확장자 쪽 대소문자는 가리지 않는다.
      "node.EXE",
      "C:\\nodejs\\npx.Cmd",
    ];
    for (const command of sandboxable) {
      const argv = ["--command", command, "--arg", "server.js"];
      const out = buildAnalyzeRequests(targetWith({ argv: { argv } }));
      expect("security" in out && out.security.sandbox, command).toEqual({
        compareHost: false,
        allowHosts: [],
      });
    }
  });

  /**
   * 알려진 한계. 확장자는 대소문자를 가리지 않고 떼지만 **이름 자체는 가린다** — 떼고 남은 `NODE` 가
   * 허용 목록(`node`·`npx`·`npm`)에 없다. `@mcpeak/audit` 의 판정도 똑같아서(`backend.commands`
   * 비교가 대소문자를 구분한다) 두 쪽이 같은 값을 낸다. 여기서 한쪽만 느슨하게 만들면 대시보드는
   * 격리를 싣는데 audit 이 `unsupported-command` 로 거절하는, 설명할 수 없는 상태가 된다.
   *
   * 실제 `.mcp.json` 은 `node.exe`·`npx.cmd` 처럼 소문자로 적으므로 지금 막는 것은 없다. 느슨하게
   * 할 거라면 두 패키지를 함께 바꿔야 한다.
   */
  it("이름이 대문자면 격리 가능으로 보지 않는다 — audit 판정과 같게 둔다", () => {
    for (const command of ["NODE.EXE", "C:\\WINDOWS\\Node.Exe", "NPX"]) {
      const argv = ["--command", command, "--arg", "server.js"];
      const out = buildAnalyzeRequests(targetWith({ argv: { argv } }));
      expect(out, command).toEqual({ tokens: { argv }, security: { argv } });
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
    // `node.exe` 는 이 목록에 있었다. 격리 이미지는 node 를 실행하므로 여기 들 것이 아니다 — 윈도우가
    // node 를 그렇게 부르는 것뿐이고, 확장자를 떼지 않은 버그를 단언하고 있었다(#540).
    // `nodemon` 은 이름이 node 로 시작하지만 다른 실행 파일이라 그대로 남는다.
    for (const command of ["python", "uvx", "/usr/bin/python3", "nodemon", "node.ps1"]) {
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

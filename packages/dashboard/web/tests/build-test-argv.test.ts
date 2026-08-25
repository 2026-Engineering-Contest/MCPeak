import { describe, expect, it } from "vitest";
import type { TestForm, TestOptions } from "../src/build-test-argv.js";
import { buildTestArgv, DEFAULT_TEST_OPTIONS } from "../src/build-test-argv.js";

/**
 * 폼 → argv 계약을 전량 단언한다. 서버가 이 배열을 가공 없이 `runCli` 에 넘기므로
 * (`src/server/wiring.ts`), 여기서 틀리면 대시보드만 다른 제품이 된다.
 */

const form = (overrides: Partial<TestForm> = {}): TestForm => ({
  suitePath: "suite.json",
  command: "node",
  args: ["server.mjs"],
  sessionMode: "off",
  sessionPath: "",
  options: DEFAULT_TEST_OPTIONS,
  ...overrides,
});

describe("test 플로우 argv 조립", () => {
  /**
   * **이것이 회귀 방어의 핵심이다.** 세션 기능을 더하면서 기존 실행의 argv 가 한 토큰이라도
   * 달라지면, 지금까지 돌던 실행이 조용히 다른 명령이 된다.
   */
  it("세션을 안 쓰면 스위트·명령·인자만 낸다", () => {
    expect(buildTestArgv(form())).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
    ]);
  });

  it("인자가 여러 개면 순서대로 --arg 로 편다", () => {
    expect(buildTestArgv(form({ args: ["a", "b"] }))).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "a",
      "--arg",
      "b",
    ]);
  });

  it("녹화는 --record-session 을 맨 뒤에 붙인다", () => {
    expect(buildTestArgv(form({ sessionMode: "record", sessionPath: "tmp/s.db" }))).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
      "--record-session",
      "tmp/s.db",
    ]);
  });

  it("재생은 --session 을 맨 뒤에 붙인다", () => {
    expect(buildTestArgv(form({ sessionMode: "replay", sessionPath: "tmp/s.db" }))).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
      "--session",
      "tmp/s.db",
    ]);
  });

  /**
   * CLI 는 두 옵션의 동시 사용을 거절한다. 세 갈래 중 하나만 고르는 타입이라 만들 수 없어야
   * 하는데, 그 성질이 실제로 성립하는지는 값으로 확인해야 안다.
   */
  it("어떤 폼으로도 두 세션 옵션이 함께 실리지 않는다", () => {
    for (const sessionMode of ["off", "record", "replay"] as const) {
      const argv = buildTestArgv(form({ sessionMode, sessionPath: "tmp/s.db" }));
      const used = argv.filter((token) => token === "--session" || token === "--record-session");

      expect(used.length).toBeLessThanOrEqual(1);
    }
  });

  it("세션을 켰는데 경로가 비면 거절한다", () => {
    for (const sessionMode of ["record", "replay"] as const) {
      expect(() => buildTestArgv(form({ sessionMode }))).toThrow("세션 파일 경로를 입력하세요.");
    }
  });

  it("명령이 비면 거절한다 — 세션과 무관하게 기존 가드가 살아 있다", () => {
    expect(() => buildTestArgv(form({ command: "" }))).toThrow("실행 명령을 입력하세요.");
  });

  /**
   * `--arg` 는 하이픈으로 시작하는 값을 의도적으로 받는다(`parseTestCommand`). 그 계약을
   * 대시보드가 따로 해석하기 시작하면 CLI 와 갈라진다 — 실제로 CLI 쪽에서 한 번 갈렸던 자리다.
   */
  it("세션 옵션처럼 생긴 서버 인자도 그대로 --arg 로 간다", () => {
    const argv = buildTestArgv(form({ args: ["--session=/tmp/x"] }));

    expect(argv).toEqual(["suite.json", "--command", "node", "--arg", "--session=/tmp/x"]);
    expect(argv).not.toContain("--session");
  });

  it("같은 폼이면 같은 배열이다", () => {
    const input = form({ sessionMode: "record", sessionPath: "tmp/s.db" });

    expect(buildTestArgv(input)).toEqual(buildTestArgv(input));
  });
});

/** 옵션만 바꾼 폼. 기본값 위에 얹어 "이 케이스가 켠 것" 이 한눈에 보이게 한다. */
const withOptions = (options: Partial<TestOptions>, overrides: Partial<TestForm> = {}): TestForm =>
  form({ ...overrides, options: { ...DEFAULT_TEST_OPTIONS, ...options } });

describe("test 옵션 argv 조립", () => {
  /**
   * 목표 4 의 증거다. 옵션 섹션을 통째로 더하면서 기본값 폼의 argv 가 한 토큰이라도 달라지면,
   * 지금까지 돌던 실행이 조용히 다른 명령이 된다.
   */
  it("기본 옵션이면 기존 argv 와 완전히 같다", () => {
    expect(buildTestArgv(form())).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
    ]);
  });

  it("determinism 이 --determinism 한 토큰으로 세션 다음에 붙는다", () => {
    // 세션과는 함께 쓸 수 없으므로(아래 거절 케이스), 세션 자리는 비어 있는 것이 정상이다.
    expect(buildTestArgv(withOptions({ determinism: true }))).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
      "--determinism",
    ]);
  });

  it("stderrLines 가 --stderr-lines 값으로 붙고 비어 있으면 없다", () => {
    expect(buildTestArgv(withOptions({ stderrLines: "0" }))).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
      "--stderr-lines",
      "0",
    ]);
    expect(buildTestArgv(withOptions({ stderrLines: "" }))).not.toContain("--stderr-lines");
  });

  it("junit·repair-bundle·reset-cmd 가 이 순서로 붙고 앞뒤 공백은 잘린다", () => {
    const argv = buildTestArgv(
      withOptions({
        junitPath: "  out/j.xml  ",
        repairBundlePath: " out/r.json ",
        resetCmd: "  npm run reset  ",
      }),
    );

    expect(argv).toEqual([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "server.mjs",
      "--junit",
      "out/j.xml",
      "--repair-bundle",
      "out/r.json",
      "--reset-cmd",
      "npm run reset",
    ]);
    // 공백만 있는 값은 미지정과 같다 — 빈 문자열을 CLI 에 넘기면 옵션 값 오류가 된다.
    expect(buildTestArgv(withOptions({ junitPath: "   " }))).not.toContain("--junit");
  });

  it("http 면 --url 과 --header-env 반복이며 --command·--arg 가 없다", () => {
    const argv = buildTestArgv(
      withOptions({
        transport: "http",
        url: "https://example.test/mcp",
        headerEnvs: ["Authorization=MCP_TOKEN", "X-Api-Key=MCP_KEY"],
      }),
    );

    expect(argv).toEqual([
      "suite.json",
      "--url",
      "https://example.test/mcp",
      "--header-env",
      "Authorization=MCP_TOKEN",
      "--header-env",
      "X-Api-Key=MCP_KEY",
    ]);
    expect(argv).not.toContain("--command");
    expect(argv).not.toContain("--arg");
  });

  /**
   * 접속을 http 로 바꿔도 서버 인자 값은 화면에서 지우지 않는다(설계 §5-3). 여기서 안 걸러내면
   * CLI 의 "`--arg` 는 `--url` 과 함께 쓸 수 없습니다" 에 걸려 실행이 서버에서 처음 깨진다.
   */
  it("http 에서 args 가 있어도 argv 에 넣지 않는다", () => {
    const argv = buildTestArgv(
      withOptions(
        { transport: "http", url: "https://example.test/mcp" },
        { args: ["server.mjs", "--port", "3000"] },
      ),
    );

    expect(argv).toEqual(["suite.json", "--url", "https://example.test/mcp"]);
    expect(argv).not.toContain("server.mjs");
  });

  it('stdio 인데 command 가 비면 "서버를 고르거나 실행 명령을 입력하세요." 로 던진다', () => {
    expect(() => buildTestArgv(form({ command: "" }))).toThrow(
      "서버를 고르거나 실행 명령을 입력하세요.",
    );
  });

  it('http 인데 url 이 비면 "URL 을 입력하세요." 로 던진다', () => {
    expect(() => buildTestArgv(withOptions({ transport: "http", url: "   " }))).toThrow(
      "URL 을 입력하세요.",
    );
  });

  it("헤더 환경변수에 = 가 없으면 형식 문장으로 던진다", () => {
    for (const entry of ["Authorization", "=MCP_TOKEN", "Authorization="]) {
      expect(() =>
        buildTestArgv(
          withOptions({
            transport: "http",
            url: "https://example.test/mcp",
            headerEnvs: [entry],
          }),
        ),
      ).toThrow(`헤더 환경변수는 <헤더이름>=<환경변수이름> 형식이어야 합니다: '${entry}'`);
    }
  });

  it('http 와 세션을 함께 켜면 "External 세션은 HTTP 대상과 함께 쓸 수 없습니다..." 로 던진다', () => {
    for (const sessionMode of ["record", "replay"] as const) {
      expect(() =>
        buildTestArgv(
          withOptions(
            { transport: "http", url: "https://example.test/mcp" },
            { sessionMode, sessionPath: "tmp/s.db" },
          ),
        ),
      ).toThrow(
        "External 세션은 HTTP 대상과 함께 쓸 수 없습니다. 접속을 stdio 로 바꾸거나 세션을 끄세요.",
      );
    }
  });

  it('http 와 stderrLines 를 함께 주면 "서버 stderr 줄 수는 HTTP 대상에 쓸 수 없습니다..." 로 던진다', () => {
    expect(() =>
      buildTestArgv(
        withOptions({ transport: "http", url: "https://example.test/mcp", stderrLines: "40" }),
      ),
    ).toThrow("서버 stderr 줄 수는 HTTP 대상에 쓸 수 없습니다. 비워 두세요.");
  });

  it('determinism 과 세션을 함께 켜면 "결정론 검사는 External 세션과 함께 쓸 수 없습니다..." 로 던진다', () => {
    for (const sessionMode of ["record", "replay"] as const) {
      expect(() =>
        buildTestArgv(withOptions({ determinism: true }, { sessionMode, sessionPath: "tmp/s.db" })),
      ).toThrow("결정론 검사는 External 세션과 함께 쓸 수 없습니다. 둘 중 하나를 끄세요.");
    }
  });

  it('stderrLines 가 정수가 아니면 "서버 stderr 줄 수는 0 이상의 정수여야 합니다." 로 던진다', () => {
    for (const stderrLines of ["-1", "1.5", "스물", " 20"]) {
      expect(() => buildTestArgv(withOptions({ stderrLines }))).toThrow(
        "서버 stderr 줄 수는 0 이상의 정수여야 합니다.",
      );
    }
  });
});

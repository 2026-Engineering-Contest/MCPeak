import { describe, expect, it } from "vitest";
import { parsePort, startupLine, USAGE, wantsHelp } from "../src/cli-args.js";

/**
 * 이 진입점에는 테스트가 한 건도 없었다. `--help` 와 탐색 루트 고지를 넣으면서(#296)
 * 기존 `parsePort` 동작도 같이 못 박는다 — 안 그러면 새로 넣은 갈래만 검증되고
 * 원래 있던 갈래는 계속 무방비다.
 */
describe("wantsHelp", () => {
  it("--help 를 받는다", () => {
    expect(wantsHelp(["--help"])).toBe(true);
  });

  it("-h 를 받는다", () => {
    expect(wantsHelp(["-h"])).toBe(true);
  });

  it("다른 인자 뒤에 있어도 받는다", () => {
    expect(wantsHelp(["--port", "8080", "--help"])).toBe(true);
  });

  it("없으면 false 다", () => {
    expect(wantsHelp(["--port", "8080"])).toBe(false);
    expect(wantsHelp([])).toBe(false);
  });

  /** `--port` 값이 잘못돼도 도움말이 이겨야 한다. 고치는 법이 도움말에 있기 때문이다. */
  it("--port 값이 잘못된 채로 같이 와도 받는다", () => {
    expect(wantsHelp(["--port", "99999", "--help"])).toBe(true);
  });
});

describe("USAGE", () => {
  /**
   * 이 이슈의 핵심이다 — `--help` 가 없어서 **유일한 옵션 `--port` 를 발견할 방법이
   * 없었다**(#296). 도움말이 그 이름을 말하지 않으면 넣은 의미가 없다.
   */
  it("--port 를 이름으로 말한다", () => {
    expect(USAGE).toContain("--port");
  });

  it("기본 포트 번호를 말한다", () => {
    expect(USAGE).toContain("7357");
  });

  /** 첫 화면이 비는 이유가 cwd 라는 사실은 도움말에도 있어야 한다. */
  it("스위트를 실행 디렉터리 아래에서 찾는다는 사실을 말한다", () => {
    expect(USAGE).toContain("명령을 실행한 디렉터리 아래");
  });

  it("--help 자신을 말한다", () => {
    expect(USAGE).toContain("--help");
  });
});

describe("startupLine", () => {
  /**
   * 회귀의 본체다. 고치기 전에는 URL 만 찍고 `root` 를 버렸다 — 도구가 그 값을 쥐고
   * 있는데도. 이 단언은 수정을 빼면 실패한다.
   */
  it("탐색 루트를 URL 과 함께 싣는다", () => {
    const line = startupLine(7357, "/tmp/proj");
    expect(line).toContain("http://localhost:7357");
    expect(line).toContain("/tmp/proj");
  });

  it("실제로 열린 포트를 싣는다 (--port 0 으로 자동 선택된 경우)", () => {
    expect(startupLine(51234, "/tmp/proj")).toContain("http://localhost:51234");
  });

  it("한 줄로 끝난다", () => {
    const line = startupLine(7357, "/tmp/proj");
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);
  });
});

describe("parsePort", () => {
  it("--port 가 없으면 기본 포트다", () => {
    expect(parsePort([])).toBe(7357);
  });

  it("--port 뒤의 값을 읽는다", () => {
    expect(parsePort(["--port", "8080"])).toBe(8080);
  });

  it("0 을 허용한다 (빈 포트 자동 선택)", () => {
    expect(parsePort(["--port", "0"])).toBe(0);
  });

  it("값이 없으면 오류다", () => {
    expect(parsePort(["--port"])).toEqual({
      error: "`--port` 뒤에 포트 번호가 없습니다.\n해결: `--port 7357` 처럼 번호를 붙이세요.",
    });
  });

  it("범위 밖이면 오류이고 받은 값을 그대로 되돌려준다", () => {
    const result = parsePort(["--port", "99999"]);
    expect(result).not.toBe(99999);
    expect(typeof result === "object" && result.error).toContain("99999");
  });

  it("정수가 아니면 오류다", () => {
    expect(typeof parsePort(["--port", "abc"])).toBe("object");
    expect(typeof parsePort(["--port", "80.5"])).toBe("object");
  });
});

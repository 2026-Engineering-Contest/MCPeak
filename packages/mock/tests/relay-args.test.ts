import { describe, expect, it } from "vitest";
import { parseArgs, usage } from "../src/relay-args.js";

/**
 * 문안은 전문으로 고정한다. 부분 일치로 두면 뒤에 줄이 더 붙어도 통과한다.
 * 인자 오류는 **전부** 사용법을 달고 나가므로 여기서 함께 박는다.
 */
const withUsage = (line: string) => `${line}\n${usage}`;
const PORT_MISSING = withUsage("→ `--port` 옵션 값이 필요합니다.");
const PORT_INVALID = (echoed: string) =>
  withUsage(`→ \`--port\` 에는 0~65535 의 정수가 필요합니다. 받은 값: '${echoed}'`);
const UNKNOWN_ARG = (echoed: string) => withUsage(`→ 모르는 인자입니다: '${echoed}'`);
const COMMAND_MISSING = withUsage("→ 중계할 서버의 실행 명령이 필요합니다. -- 뒤에 적으세요.");

const reject = (argv: readonly string[]): string => {
  const result = parseArgs(argv);
  if (result.ok) throw new Error(`거절할 줄 알았는데 통과했다: ${JSON.stringify(argv)}`);
  return result.message;
};

const accept = (argv: readonly string[]) => {
  const result = parseArgs(argv);
  if (!result.ok) throw new Error(`통과할 줄 알았는데 거절했다:\n${result.message}`);
  return result.value;
};

describe("parseArgs — 정상 경로", () => {
  it("옵션 전부가 한 객체로 나온다", () => {
    expect(
      parseArgs(["--port", "0", "--json", "--env", "A", "--env", "B", "--", "node", "x"]),
    ).toEqual({
      ok: true,
      value: { port: 0, json: true, envNames: ["A", "B"], command: "node", args: ["x"] },
    });
  });

  it("옵션이 없으면 기본값이다", () => {
    expect(accept(["--", "node", "server.mjs"])).toEqual({
      port: 0,
      json: false,
      envNames: [],
      command: "node",
      args: ["server.mjs"],
    });
  });

  it("`--port 7400` 과 `--port=7400` 이 같은 결과다", () => {
    const spaced = accept(["--port", "7400", "--", "node", "x"]);
    expect(spaced.port).toBe(7400);
    expect(accept(["--port=7400", "--", "node", "x"])).toEqual(spaced);
  });

  it("`--env A` 와 `--env=A` 가 같은 결과다", () => {
    expect(accept(["--env=A", "--", "node", "x"])).toEqual(
      accept(["--env", "A", "--", "node", "x"]),
    );
  });

  it.each(["0", "1", "65535"])("경계 포트를 받는다: %s", (raw) => {
    expect(accept(["--port", raw, "--", "node", "x"]).port).toBe(Number(raw));
  });
});

/**
 * **이 파일에서 제일 중요한 회귀다.** `--` 뒤는 중계 대상 서버의 명령줄이다. 거기 우리
 * 옵션과 같은 철자가 있어도 그 서버의 것이지 중계기의 것이 아니다.
 */
describe("parseArgs — `--` 뒤는 파싱하지 않는다", () => {
  it("중계 대상의 인자가 중계기 옵션으로 먹히지 않는다", () => {
    expect(accept(["--port", "7400", "--", "node", "s.mjs", "--port", "9", "--env", "X"])).toEqual({
      port: 7400,
      json: false,
      envNames: [],
      command: "node",
      args: ["s.mjs", "--port", "9", "--env", "X"],
    });
  });

  it("`--` 뒤의 모르는 인자도 그대로 넘어간다", () => {
    expect(accept(["--", "node", "--nope", "--json"]).args).toEqual(["--nope", "--json"]);
  });

  it("`--` 뒤의 두 번째 `--` 도 대상의 인자다", () => {
    expect(accept(["--", "npx", "-y", "pkg", "--", "--port"]).args).toEqual([
      "-y",
      "pkg",
      "--",
      "--port",
    ]);
  });
});

describe("parseArgs — `--port` 거절", () => {
  it("값이 없으면 값이 필요하다고 말한다", () => {
    expect(reject(["--port"])).toBe(PORT_MISSING);
  });

  it("다음이 `--` 면 구분자를 값으로 삼키지 않는다", () => {
    expect(reject(["--port", "--", "node", "x"])).toBe(PORT_MISSING);
  });

  it("`--port=` 로 값이 비면 포트 0 으로 둔갑하지 않는다", () => {
    expect(reject(["--port=", "--", "node", "x"])).toBe(PORT_MISSING);
  });

  it.each(["abc", "-1", "65536", "1.5"])("정수가 아니거나 범위 밖이면 거절한다: %s", (raw) => {
    expect(reject(["--port", raw, "--", "node", "x"])).toBe(PORT_INVALID(raw));
  });

  it("`--port=abc` 도 같은 문안이다", () => {
    expect(reject(["--port=abc", "--", "node", "x"])).toBe(PORT_INVALID("abc"));
  });
});

describe("parseArgs — 모르는 인자", () => {
  it("전문이 일치한다", () => {
    expect(reject(["--nope", "--", "node", "x"])).toBe(UNKNOWN_ARG("--nope"));
  });

  it("`-h` 같은 짧은 것도 여기로 온다 — `main` 이 가로채는 것은 맨 앞일 때뿐이다", () => {
    expect(reject(["--port", "0", "-h"])).toBe(UNKNOWN_ARG("-h"));
  });
});

describe("parseArgs — 명령 누락", () => {
  it("`--` 가 아예 없으면 거절한다", () => {
    expect(reject(["--port", "7400"])).toBe(COMMAND_MISSING);
  });

  it("`--` 뒤가 비면 거절한다", () => {
    expect(reject(["--port", "7400", "--"])).toBe(COMMAND_MISSING);
  });

  it("인자가 아예 없어도 거절한다", () => {
    expect(reject([])).toBe(COMMAND_MISSING);
  });
});

/**
 * `--env` 문안은 `relay-env.ts` 한 곳에 산다. 여기서 고정하는 것은 **이 파일의 몫**인
 * 중복 거절과, `--env` 거절에는 사용법을 붙이지 않는다는 현 동작이다. 그 문안이 이미
 * 올바른 호출 예시를 품고 있어 겹친다.
 */
describe("parseArgs — `--env`", () => {
  it("같은 이름이 두 번이면 거절한다", () => {
    expect(reject(["--env", "A", "--env", "A", "--", "node", "x"])).toBe(
      "→ `--env A` 이 두 번 있습니다. 한 번만 쓰세요.",
    );
  });

  it("`--env A --env=A` 도 중복이다", () => {
    expect(reject(["--env", "A", "--env=A", "--", "node", "x"])).toBe(
      "→ `--env A` 이 두 번 있습니다. 한 번만 쓰세요.",
    );
  });

  it("이름 거절에는 사용법을 붙이지 않는다", () => {
    const message = reject(["--env", "A=1", "--", "node", "x"]);
    expect(message).not.toContain(usage);
    expect(message.startsWith("→ `--env` 는 환경변수 **이름**만 받습니다: 'A=1'")).toBe(true);
  });

  it("다음이 `--` 면 구분자를 이름으로 삼키지 않는다", () => {
    expect(reject(["--env", "--", "node", "x"])).toBe("→ `--env` 옵션 값이 필요합니다.");
  });
});

/**
 * 거절 문안은 받은 값을 되짚는다. 그 값이 stderr 를 거쳐 터미널에 닿으므로 ANSI 가
 * 실린 인자가 화면을 지울 수 있다. **값 자리에만** 건다 — 문장 전체에 걸면 우리가 쓴
 * 개행까지 이스케이프돼 안내가 한 줄로 뭉개진다(#289).
 */
describe("parseArgs — 되짚는 값의 터미널 이스케이프", () => {
  const ESC = "";

  it("`--port` 값의 ANSI 를 무해한 토큰으로 바꾼다", () => {
    const message = reject(["--port", `${ESC}[2J`, "--", "node", "x"]);
    expect(message).toBe(PORT_INVALID("\\u001b[2J"));
    expect(message).not.toContain(ESC);
  });

  it("모르는 인자의 ANSI 도 바꾼다", () => {
    const message = reject([`${ESC}[2J--nope`]);
    expect(message).toBe(UNKNOWN_ARG("\\u001b[2J--nope"));
    expect(message).not.toContain(ESC);
  });

  it("우리가 쓴 개행은 살아 있다 — 안내가 한 줄로 뭉개지지 않는다", () => {
    const message = reject(["--port", "A\nB", "--", "node", "x"]);
    expect(message).toBe(PORT_INVALID("A\\u000aB"));
    // 오류 한 줄 + 사용법 다섯 줄.
    expect(message.split("\n")).toHaveLength(6);
  });
});

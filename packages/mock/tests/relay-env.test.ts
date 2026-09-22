import { describe, expect, it } from "vitest";
import { parseEnvName, resolveEnv } from "../src/relay-env.js";

/** 실패 문안은 부분 일치로 두지 않는다 — 뒤에 줄이 더 붙어도 통과하기 때문이다. */
const NOT_A_NAME = (raw: string) =>
  `→ \`--env\` 는 환경변수 **이름**만 받습니다: '${raw}'\n` +
  "→ 값을 명령줄에 쓰면 `ps` 목록과 셸 히스토리에 그대로 남기 때문입니다.\n" +
  "→ 값은 환경변수에 넣고 이름만 넘기세요:\n" +
  "     read -rs WEATHER_API_KEY; export WEATHER_API_KEY\n" +
  "     mcpeak-relay --port 7400 --env WEATHER_API_KEY -- node ./server.mjs";

const EMPTY_ENV = (name: string) =>
  `→ 환경변수 \`${name}\` 가 비어 있습니다.\n` +
  "→ 값을 넣고 다시 실행하세요:\n" +
  `     read -rs ${name}; export ${name}`;

/** 이 파일이 `process.env` 를 건드리지 않게 하는 주입점. */
const reader = (table: Record<string, string | undefined>) => (name: string) => table[name];

describe("parseEnvName", () => {
  it.each(["WEATHER_API_KEY", "_X", "A1", "PATH", "_", "Z9_z9"])(
    "정상 이름을 통과시킨다: %s",
    (raw) => {
      expect(parseEnvName(raw)).toEqual({ ok: true, value: raw });
    },
  );

  it("앞뒤 공백은 떼고 받는다", () => {
    expect(parseEnvName("  WEATHER_API_KEY \n")).toEqual({ ok: true, value: "WEATHER_API_KEY" });
  });

  it.each(["", "   ", "\t\n"])("빈 값·공백만 있는 값은 거절한다: %j", (raw) => {
    expect(parseEnvName(raw)).toEqual({
      ok: false,
      message: "→ `--env` 옵션 값이 필요합니다.",
    });
  });

  it("`KEY=VALUE` 형태를 거절한다 — 문안 전문이 일치한다", () => {
    const result = parseEnvName("WEATHER_API_KEY=sk-live-1234");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(NOT_A_NAME("WEATHER_API_KEY=sk-live-1234"));
  });

  /**
   * 소문자는 **통과한다.** 명세의 패턴이 `[A-Za-z_]` 로 시작을 허용하고 cli 의
   * `ENV_NAME_PATTERN`(`connect-target.ts:98`)도 같다. 두 진입점의 규약이 갈리지 않도록
   * 여기에 고정한다.
   */
  it.each(["weather_api_key", "http_proxy"])("소문자 이름도 통과시킨다: %s", (raw) => {
    expect(parseEnvName(raw)).toEqual({ ok: true, value: raw });
  });

  it.each(["1KEY", "MY-KEY", "MY KEY", "KEY;rm -rf /", "KEY.SUB", "한글이름"])(
    "이름 규칙에 맞지 않으면 거절한다: %s",
    (raw) => {
      expect(parseEnvName(raw)).toEqual({ ok: false, message: NOT_A_NAME(raw) });
    },
  );
});

describe("resolveEnv", () => {
  it("이름 목록을 이름→값 맵으로 바꾼다", () => {
    const result = resolveEnv(
      ["WEATHER_API_KEY", "REGION"],
      reader({ WEATHER_API_KEY: "sk-live-1234", REGION: "kr", OTHER: "x" }),
    );
    expect(result).toEqual({ ok: true, value: { WEATHER_API_KEY: "sk-live-1234", REGION: "kr" } });
  });

  it("이름이 0개면 빈 객체다", () => {
    expect(resolveEnv([], reader({}))).toEqual({ ok: true, value: {} });
  });

  it("값이 `undefined` 면 거절한다 — 이름만 말한다", () => {
    const result = resolveEnv(["WEATHER_API_KEY"], reader({}));
    expect(result).toEqual({ ok: false, message: EMPTY_ENV("WEATHER_API_KEY") });
  });

  it("값이 빈 문자열이면 거절한다 — 이름만 말한다", () => {
    const result = resolveEnv(["WEATHER_API_KEY"], reader({ WEATHER_API_KEY: "" }));
    expect(result).toEqual({ ok: false, message: EMPTY_ENV("WEATHER_API_KEY") });
  });

  it("실패 문안에 값이 실리지 않는다", () => {
    const result = resolveEnv(
      ["A", "WEATHER_API_KEY"],
      reader({ A: "sk-live-1234", WEATHER_API_KEY: "" }),
    );
    if (result.ok) throw new Error("unreachable");
    expect(result.message).not.toContain("sk-live-1234");
    expect(result.message).toBe(EMPTY_ENV("WEATHER_API_KEY"));
  });
});

/**
 * 중계기는 `NODE_OPTIONS`·`MCPEAK_*` 를 거절하지 않는다. cli 가 그것을 거절하는 이유는
 * 녹화·재생 배선이 자식 환경에 직접 쓰기 때문인데, 중계기에는 그 배선이 없다.
 * 이 두 케이스가 그 판단을 고정한다.
 */
describe("cli 와 일부러 다른 것", () => {
  it.each(["NODE_OPTIONS", "MCPEAK_FOO"])("%s 를 통과시킨다", (raw) => {
    expect(parseEnvName(raw)).toEqual({ ok: true, value: raw });
  });

  it("NODE_OPTIONS·MCPEAK_* 도 값으로 해석된다", () => {
    expect(
      resolveEnv(
        ["NODE_OPTIONS", "MCPEAK_FOO"],
        reader({ NODE_OPTIONS: "--enable-source-maps", MCPEAK_FOO: "1" }),
      ),
    ).toEqual({ ok: true, value: { NODE_OPTIONS: "--enable-source-maps", MCPEAK_FOO: "1" } });
  });
});

/**
 * 거절 문안은 **받은 값을 그대로 싣는다.** 그 값이 stderr 를 거쳐 터미널에 닿으므로,
 * `mcpeak-relay --env $'\e[2J…'` 같은 인자가 화면을 지우거나 커서를 옮길 수 있다.
 * 값 자리에만 이스케이프를 걸고, 우리가 쓴 개행은 살려 둔다 (#289).
 */
describe("거절 문안의 터미널 이스케이프", () => {
  it("ANSI 제어 문자를 무해한 토큰으로 바꾼다", () => {
    const result = parseEnvName("\u001b[2J");
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(NOT_A_NAME("\\u001b[2J"));
    // 날것의 ESC 가 문장에 남지 않는다.
    expect(result.message).not.toContain("\u001b");
  });

  it("값에 섞인 개행은 이스케이프하고 우리가 쓴 개행은 남긴다", () => {
    const result = parseEnvName("A\nB");
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(NOT_A_NAME("A\\u000aB"));
    // 안내가 한 줄로 뭉개지지 않는다 — 문안은 다섯 줄이다.
    expect(result.message.split("\n")).toHaveLength(5);
  });

  it("DEL·C1 제어 문자도 바꾼다", () => {
    const result = parseEnvName("A\u007fB\u009bC");
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(NOT_A_NAME("A\\u007fB\\u009bC"));
  });

  it("200자를 넘으면 자르고 말줄임표를 붙인다", () => {
    const result = parseEnvName(`${"A".repeat(250)}!`);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(NOT_A_NAME(`${"A".repeat(200)}…`));
  });

  it("평범한 값은 그대로 실린다", () => {
    const result = parseEnvName("MY-KEY");
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(NOT_A_NAME("MY-KEY"));
  });
});

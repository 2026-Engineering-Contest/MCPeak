import { describe, expect, it } from "vitest";
import { echoValue, escapeTerminalText } from "../src/relay-echo.js";

/** 리터럴로 적으면 소스에 날것의 제어 문자가 들어간다. 이름으로 부른다. */
const ESC = "";
const DEL = "";
const CSI8 = "";

describe("escapeTerminalText", () => {
  it("평범한 글자는 그대로 둔다", () => {
    expect(escapeTerminalText("WEATHER_API_KEY 한글 ok")).toBe("WEATHER_API_KEY 한글 ok");
  });

  it.each([
    [`${ESC}[2J`, "\\u001b[2J"],
    ["A\nB", "A\\u000aB"],
    ["A\tB", "A\\u0009B"],
    [`A${DEL}B`, "A\\u007fB"],
    [`A${CSI8}B`, "A\\u009bB"],
    ["A B C", "A\\u2028B\\u2029C"],
  ])("제어 문자를 토큰으로 바꾼다: %j", (raw, expected) => {
    expect(escapeTerminalText(raw)).toBe(expected);
  });

  it("서로게이트 쌍을 쪼개지 않는다", () => {
    expect(escapeTerminalText("a🙂b")).toBe("a🙂b");
  });
});

describe("echoValue", () => {
  it("200자까지는 그대로 둔다", () => {
    expect(echoValue("A".repeat(200))).toBe("A".repeat(200));
  });

  it("200자를 넘으면 자르고 말줄임표를 붙인다", () => {
    expect(echoValue(`${"A".repeat(250)}!`)).toBe(`${"A".repeat(200)}…`);
  });

  /** 상한은 **이스케이프한 뒤** 길이로 잰다 — 한 글자가 여섯 자로 부푸는 자리다. */
  it("이스케이프로 부푼 길이를 기준으로 자른다", () => {
    expect(echoValue(ESC.repeat(50))).toBe(`${"\\u001b".repeat(33)}\\u…`);
  });
});

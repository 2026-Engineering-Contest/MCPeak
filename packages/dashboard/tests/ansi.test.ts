import { describe, expect, it } from "vitest";
import { ansiToHtml } from "../src/server/ansi.js";

const ESC = "\u001b";

describe("ansiToHtml", () => {
  it("색 코드가 span으로 바뀐다", () => {
    expect(ansiToHtml(`${ESC}[31m빨강${ESC}[0m`)).toBe('<span class="ansi-31">빨강</span>');
  });

  it("HTML 특수문자는 항상 이스케이프된다", () => {
    expect(ansiToHtml("<b>&")).toBe("&lt;b&gt;&amp;");
  });

  it("모르는 이스케이프는 제거된다", () => {
    expect(ansiToHtml(`${ESC}[2J지움`)).toBe("지움");
  });

  it("같은 입력 2회가 같은 출력이다", () => {
    const input = `${ESC}[1m굵게${ESC}[90m회색 <tag> & ${ESC}[2K제어${ESC}[0m꼬리${ESC}[32m초록`;
    expect(ansiToHtml(input)).toBe(ansiToHtml(input));
  });
});

import { describe, expect, it } from "vitest";
import { percent, tokens } from "../src/analyze/format.js";

describe("analyze 숫자 표기", () => {
  it("percent 는 소수 첫째 자리이고 분모 0 이면 0.0 이다", () => {
    expect(percent(1, 3)).toBe("33.3");
    expect(percent(0, 0)).toBe("0.0");
    expect(percent(-5, 100)).toBe("-5.0");
  });

  it("tokens 는 바이트÷4 를 반올림한다", () => {
    expect(tokens(10)).toBe(3);
    expect(tokens(2)).toBe(1);
  });
});

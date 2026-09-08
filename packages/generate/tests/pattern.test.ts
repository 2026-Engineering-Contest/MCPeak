import { describe, expect, it } from "vitest";
import { compilePattern, synthesizePatternString } from "../src/pattern.js";

const NO_BOUNDS = { minLength: null, maxLength: null } as const;

/** 계획서 §4 의 최소 문자열 표. `만든 값은 항상 자기 pattern 을 통과한다` 도 이 표를 돈다. */
const MINIMAL: readonly (readonly [string, string])[] = [
  ["^[a-z-]+$", "a"],
  ["^a$", "a"],
  ["abc", "abc"],
  ["", ""],
  ["^$", ""],
  ["\\d{3}-\\d{4}", "000-0000"],
  ["^[A-Z][a-z]*$", "A"],
  ["^(foo|bar)$", "foo"],
  ["^(?:x|y){2}$", "xx"],
  ["^[^0-9]$", "a"],
  ["^[^a-zA-Z0-9]$", "-"],
  ["^\\w+@\\w+\\.\\w+$", "a@a.a"],
  ["^.$", "a"],
  ["^\\.$", "."],
  ["^\\u0041$", "A"],
  ["^a?b$", "b"],
  ["^a*?b$", "b"],
  ["^(?<n>ab)$", "ab"],
  ["^\\bab\\b$", "ab"],
];

describe("최소 문자열", () => {
  it.each(MINIMAL)("%j → %s", (pattern, expected) => {
    expect(synthesizePatternString(pattern, NO_BOUNDS, "p")).toBe(expected);
  });
});

describe("minLength 채움", () => {
  it.each([
    ["^[a-z]+$", { minLength: 3, maxLength: null }, "aaa"],
    ["^[a-z]*x$", { minLength: 3, maxLength: null }, "aax"],
    ["^(ab)+$", { minLength: 3, maxLength: null }, "abab"],
    ["^a{1,2}b*$", { minLength: 4, maxLength: null }, "aabb"],
    ["^a{1,2}$", { minLength: 2, maxLength: null }, "aa"],
  ] as const)("%j → %s", (pattern, bounds, expected) => {
    expect(synthesizePatternString(pattern, bounds, "p")).toBe(expected);
  });
});

describe("길이 불가", () => {
  it("최소 문자열이 minLength 에 못 미치고 늘릴 수량자가 없으면 값과 제약을 싣고 건너뛴다", () => {
    expect(() =>
      synthesizePatternString("^a-\\d{2}$", { minLength: 6, maxLength: null }, "p"),
    ).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA",
        message: expect.stringContaining('"a-00"'),
      }),
    );
    expect(() =>
      synthesizePatternString("^a-\\d{2}$", { minLength: 6, maxLength: null }, "p"),
    ).toThrow(expect.objectContaining({ message: expect.stringContaining("minLength 6") }));
  });

  it("최소 문자열이 maxLength 를 넘으면 건너뛴다", () => {
    expect(() => synthesizePatternString("^abc$", { minLength: null, maxLength: 2 }, "p")).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA",
        message: expect.stringContaining("maxLength 2"),
      }),
    );
  });

  it("채운 값이 상한을 넘으면 건너뛴다", () => {
    // 최소 "ab"(2자) 는 minLength 에 모자라고 한 번 늘리면 "abab"(4자) 로 상한을 넘는다.
    expect(() => synthesizePatternString("^(ab)+$", { minLength: 3, maxLength: 3 }, "p")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });
});

describe("미지원 구문", () => {
  it.each([
    ["(?=a)b", 0],
    ["a(?!b)", 1],
    ["(a)\\1", 3],
    ["\\p{L}", 0],
    ["\\cA", 0],
    ["(?<=a)b", 0],
    ["(?<!a)b", 0],
  ])("%j 는 오프셋 %s 를 들고 건너뛴다", (pattern, offset) => {
    expect(() => synthesizePatternString(pattern, NO_BOUNDS, "p")).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA",
        path: "p.pattern",
        message: expect.stringContaining(`오프셋 ${offset}`),
      }),
    );
  });
});

describe("컴파일", () => {
  it("정규식이 아니면 INVALID_SCHEMA_CONSTRAINT 다", () => {
    expect(() => compilePattern("[", "p")).toThrow(
      expect.objectContaining({ code: "INVALID_SCHEMA_CONSTRAINT", path: "p.pattern" }),
    );
  });

  it("문자열이 아니어도 같은 코드다", () => {
    expect(() => compilePattern(5, "p")).toThrow(
      expect.objectContaining({ code: "INVALID_SCHEMA_CONSTRAINT", path: "p.pattern" }),
    );
  });

  it("컴파일되지만 생성만 미지원인 구문은 컴파일에서 던지지 않는다", () => {
    expect(() => compilePattern("\\p{L}", "p")).not.toThrow();
    expect(() => compilePattern("(?<a>x)\\k<a>", "p")).not.toThrow();
    expect(() => synthesizePatternString("(?<a>x)\\k<a>", NO_BOUNDS, "p")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });
});

it("만든 값은 항상 자기 pattern 을 통과한다", () => {
  for (const [pattern] of MINIMAL) {
    const value = synthesizePatternString(pattern, NO_BOUNDS, "p");
    expect(compilePattern(pattern, "p").test(value)).toBe(true);
  }
});

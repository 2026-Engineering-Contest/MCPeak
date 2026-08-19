import { describe, expect, it } from "vitest";
import { resolveProjectPath } from "../src/server/paths.js";

describe("resolveProjectPath", () => {
  it("상대경로를 루트 아래 절대경로로 해석한다", () => {
    expect(resolveProjectPath("/r", "a/b.json")).toBe("/r/a/b.json");
  });

  it("루트 자신을 허용한다", () => {
    expect(resolveProjectPath("/r", ".")).toBe("/r");
  });

  it("..으로 루트를 벗어나면 null이다", () => {
    expect(resolveProjectPath("/r", "../x")).toBeNull();
  });

  it("절대경로는 null이다", () => {
    expect(resolveProjectPath("/r", "/etc/passwd")).toBeNull();
  });

  it("NUL 문자는 null이다", () => {
    expect(resolveProjectPath("/r", "a\0b")).toBeNull();
  });

  it("루트와 접두만 같은 형제 디렉터리는 null이다", () => {
    expect(resolveProjectPath("/r", "../r2/x")).toBeNull();
  });
});

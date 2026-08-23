import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectPath } from "../src/server/paths.js";

/**
 * **기대값을 하드코딩하지 않는다.** `resolveProjectPath` 는 `node:path` 의 `resolve`·`sep` 를
 * 쓰므로 결과가 플랫폼을 탄다 — Windows 에서 `/r` 은 현재 드라이브 기준 `C:` 로 풀린다.
 * `"/r/a/b.json"` 을 적어 두면 그 환경에서 **제품 코드가 맞는데 테스트만 빨개진다**(#304).
 *
 * 아래 거부 케이스들은 반환이 `null` 이라 플랫폼과 무관하다.
 */
describe("resolveProjectPath", () => {
  it("상대경로를 루트 아래 절대경로로 해석한다", () => {
    expect(resolveProjectPath("/r", "a/b.json")).toBe(resolve("/r", "a/b.json"));
  });

  it("루트 자신을 허용한다", () => {
    expect(resolveProjectPath("/r", ".")).toBe(resolve("/r"));
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

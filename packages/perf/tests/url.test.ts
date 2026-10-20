import { describe, expect, it } from "vitest";
import { displayUrl } from "../src/url.js";

describe("displayUrl", () => {
  it("스킴·userinfo·fragment 를 지우고 쿼리 값을 … 로 바꾼다", () => {
    expect(displayUrl("https://u:p@api.example.com:8443/v1/x?key=SECRET&q=a#f")).toBe(
      "api.example.com:8443/v1/x?key=…&q=…",
    );
  });

  it("쿼리가 없으면 물음표도 없다", () => {
    expect(displayUrl("https://h.example/")).toBe("h.example/");
  });

  it("기본 포트는 표기하지 않는다", () => {
    expect(displayUrl("http://h.example:80/a")).toBe("h.example/a");
  });

  it("같은 이름이 반복되면 반복해 적는다", () => {
    expect(displayUrl("https://h.example/a?x=1&x=2")).toBe("h.example/a?x=…&x=…");
  });

  it("파싱할 수 없으면 [URL]", () => {
    expect(displayUrl("not a url")).toBe("[URL]");
  });
});

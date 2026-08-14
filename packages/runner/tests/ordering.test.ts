import { describe, expect, it } from "vitest";
import { byCodeUnit } from "../src/ordering.js";

describe("byCodeUnit", () => {
  it("사전순으로 정렬한다", () => {
    expect(["c", "a", "b"].sort(byCodeUnit)).toEqual(["a", "b", "c"]);
  });

  it("대문자가 소문자보다 앞이다. UTF-16 코드 단위 순서다", () => {
    expect(["a", "Z"].sort(byCodeUnit)).toEqual(["Z", "a"]);
  });

  it("로캘 정렬과 달라지는 입력에서도 코드 단위 순서를 지킨다", () => {
    // localeCompare 는 로캘에 따라 "a" < "ä" < "b" 로 놓는다. 코드 단위로는 "ä"(U+00E4)가 뒤다.
    expect(["ä", "b", "a"].sort(byCodeUnit)).toEqual(["a", "b", "ä"]);
  });

  it("같은 값은 0을 돌려준다", () => {
    expect(byCodeUnit("x", "x")).toBe(0);
  });
});

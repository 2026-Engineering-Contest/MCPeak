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

  it("BMP 밖 문자를 코드 포인트가 아니라 코드 단위로 놓는다", () => {
    // U+1F600 은 대리쌍(0xD83D 0xDE00)으로 저장된다. 코드 포인트로 비교하면
    // U+E000 이 U+1F600 보다 앞이지만, 코드 단위로는 첫 단위 0xD83D 가 0xE000 보다
    // 작아 대리쌍 쪽이 앞이다. 두 기준이 갈리는 유일한 종류의 입력이다.
    // 이 케이스가 없으면 구현이 코드 포인트 비교로 바뀌어도 나머지가 전부 통과한다.
    expect(["\uE000", "\u{1F600}"].sort(byCodeUnit)).toEqual(["\u{1F600}", "\uE000"]);
  });

  it("같은 값은 0을 돌려준다", () => {
    expect(byCodeUnit("x", "x")).toBe(0);
  });
});

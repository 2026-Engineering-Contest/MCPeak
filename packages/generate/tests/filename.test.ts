import { describe, expect, it } from "vitest";
import { fieldSlug, safeBaseName } from "../src/filename.js";

describe("fieldSlug", () => {
  it("영숫자 이름은 그대로 소문자 슬러그다", () => {
    expect(fieldSlug("city")).toBe("city");
    expect(fieldSlug("maxResults")).toBe("maxresults");
  });
  it("비영숫자는 하이픈이 된다", () => {
    expect(fieldSlug("a_b")).toBe("a-b");
    expect(fieldSlug("a.b")).toBe("a-b");
  });
  it("배열 원소 경로는 item 으로 읽는다", () => {
    // 안 그러면 fieldSlug("tags") 와 fieldSlug("tags[]") 가 같은 문자열이 되어, 배열 자신의
    // 위반과 원소의 위반이 id 의 -2 접미사로만 갈린다(#388).
    expect(fieldSlug("tags[]")).toBe("tags-item");
    expect(fieldSlug("tags[].id")).toBe("tags-item-id");
  });
  it("경로가 아닌 이름은 종전과 같다", () => {
    expect(fieldSlug("tags")).toBe("tags");
    expect(fieldSlug("user.name")).toBe("user-name");
  });
  it("슬러그가 비면 field- 접두사와 해시를 쓴다", () => {
    expect(fieldSlug("한국어")).toMatch(/^field-[0-9a-f]{8}$/);
  });
  it("같은 이름은 항상 같은 슬러그다", () => {
    expect(fieldSlug("한국어")).toBe(fieldSlug("한국어"));
  });
  it("Windows 예약어를 피하지 않는다. 케이스 id 는 파일 이름이 아니다", () => {
    expect(fieldSlug("con")).toBe("con");
    expect(safeBaseName("con", 0)).toMatch(/^tool-[0-9a-f]{8}$/);
  });
});

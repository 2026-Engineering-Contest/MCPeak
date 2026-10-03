import { describe, expect, it } from "vitest";
import * as audit from "../src/index.js";
import { describeLocation, escapeInvisible } from "../src/index.js";

describe("@mcpeak/audit 표시용 공개 면", () => {
  it("describeLocation 과 escapeInvisible 을 index 에서 내보낸다", () => {
    expect(typeof audit.describeLocation).toBe("function");
    expect(typeof audit.escapeInvisible).toBe("function");
  });

  it("도구 위치는 이름의 숨은 문자를 드러낸다", () => {
    expect(
      describeLocation({
        kind: "tool",
        toolIndex: 1,
        toolName: "get" + "\u200B" + "time",
        path: "name",
      }),
    ).toBe("도구 'get<U+200B>time' 의 name");
  });

  it("호출 위치는 호출 id 를 싣는다", () => {
    expect(
      describeLocation({
        kind: "call",
        toolIndex: 0,
        toolName: "read_note",
        callId: "read_note#1",
        path: "",
      }),
    ).toBe("도구 'read_note' 호출(read_note#1) 중");
  });

  it("도구에 걸리지 않은 위치는 고정 문장이다", () => {
    expect(describeLocation({ kind: "server", path: "" })).toBe("서버 전체");
    expect(describeLocation({ kind: "protocol", path: "" })).toBe("프로토콜");
    expect(describeLocation({ kind: "surface", path: "" })).toBe("도구 표면");
    expect(describeLocation({ kind: "launch", path: "args[1]" })).toBe("실행 명령 args[1]");
  });

  it("escapeInvisible 은 양방향 제어 문자를 표기로 바꾼다", () => {
    expect(escapeInvisible("a" + "\u202E" + "b")).toBe("a<U+202E>b");
  });
});

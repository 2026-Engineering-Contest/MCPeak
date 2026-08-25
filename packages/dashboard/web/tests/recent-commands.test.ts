// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readRecentCommands, saveRecentCommand } from "../src/recent-commands.js";

/**
 * 홈과 Generate 마법사가 같은 목록을 읽고 쓴다. 저장 키가 바뀌면 이미 쌓인 사용자 값이
 * 사라지므로, 키 자체를 값으로 못 박는다.
 */

beforeEach(() => {
  window.localStorage.clear();
});

describe("최근 명령", () => {
  it("저장 키가 mcpeak-generate-recent-commands 다", () => {
    saveRecentCommand("server.mjs");

    expect(window.localStorage.getItem("mcpeak-generate-recent-commands")).toBe(
      JSON.stringify(["server.mjs"]),
    );
  });

  it("같은 값은 앞으로 올라오고 8개를 넘지 않는다", () => {
    for (const target of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) {
      saveRecentCommand(target);
    }
    saveRecentCommand("d");

    const recent = readRecentCommands();

    expect(recent[0]).toBe("d");
    expect(recent).toHaveLength(8);
    expect(recent.filter((item) => item === "d")).toHaveLength(1);
    // 9번째까지 넣었으므로 가장 오래된 "a" 는 이미 밀려나 있다.
    expect(recent).not.toContain("a");
  });
});

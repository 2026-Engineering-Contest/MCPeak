import { describe, expect, it } from "vitest";
import { type CommandParseError, tokenizeCommand } from "../src/command.js";

describe("tokenizeCommand", () => {
  it("공백으로 실행 파일과 인자를 나눈다", () => {
    expect(tokenizeCommand("  node   -e process.exit(0)  ")).toEqual([
      "node",
      "-e",
      "process.exit(0)",
    ]);
  });

  it("큰따옴표로 감싼 실행 파일 경로의 공백을 보존한다", () => {
    expect(tokenizeCommand('"C:\\Program Files\\node.exe" -e process.exit(0)')).toEqual([
      "C:\\Program Files\\node.exe",
      "-e",
      "process.exit(0)",
    ]);
  });

  it("닫히지 않은 실행 파일 따옴표를 빈 명령과 구분한다", () => {
    expect(() => tokenizeCommand('"unterminated')).toThrowError(
      expect.objectContaining<Partial<CommandParseError>>({
        code: "UNTERMINATED_EXECUTABLE_QUOTE",
      }),
    );
  });

  it("빈 실행 파일 경로를 빈 명령과 구분한다", () => {
    expect(() => tokenizeCommand('""')).toThrowError(
      expect.objectContaining<Partial<CommandParseError>>({ code: "EMPTY_EXECUTABLE" }),
    );
  });

  it("공백뿐인 명령은 빈 토큰 목록을 반환한다", () => {
    expect(tokenizeCommand("   ")).toEqual([]);
  });
});

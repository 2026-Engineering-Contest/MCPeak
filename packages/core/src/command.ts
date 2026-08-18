export type CommandParseErrorCode = "EMPTY_EXECUTABLE" | "UNTERMINATED_EXECUTABLE_QUOTE";

/** 셸을 거치지 않고 실행할 명령의 실행 파일 부분을 해석할 수 없을 때 발생한다. */
export class CommandParseError extends TypeError {
  constructor(readonly code: CommandParseErrorCode) {
    super(
      code === "EMPTY_EXECUTABLE"
        ? "command executable must not be empty"
        : "command has an unterminated executable quote",
    );
    this.name = "CommandParseError";
  }
}

/**
 * 첫 토큰을 실행 파일, 나머지를 인자로 나눈다. 실행 파일 경로에 공백이 있으면 맨 앞 토큰만
 * 큰따옴표로 감쌀 수 있다. 셸 구문과 인자의 따옴표는 해석하지 않는다.
 */
export function tokenizeCommand(command: string): readonly string[] {
  const trimmed = command.trim();
  if (!trimmed.startsWith('"')) {
    return trimmed.split(/\s+/).filter((token) => token.length > 0);
  }

  const closingQuote = trimmed.indexOf('"', 1);
  if (closingQuote === -1) {
    throw new CommandParseError("UNTERMINATED_EXECUTABLE_QUOTE");
  }

  const file = trimmed.slice(1, closingQuote);
  if (file.length === 0) throw new CommandParseError("EMPTY_EXECUTABLE");

  const args = trimmed
    .slice(closingQuote + 1)
    .split(/\s+/)
    .filter((token) => token.length > 0);
  return [file, ...args];
}

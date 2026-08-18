export type CommandParseErrorCode =
  | "EMPTY_EXECUTABLE"
  | "UNTERMINATED_EXECUTABLE_QUOTE"
  | "MISSING_EXECUTABLE_ARGUMENT_SEPARATOR";

const ERROR_MESSAGES: Record<CommandParseErrorCode, string> = {
  EMPTY_EXECUTABLE: "command executable must not be empty",
  UNTERMINATED_EXECUTABLE_QUOTE: "command has an unterminated executable quote",
  MISSING_EXECUTABLE_ARGUMENT_SEPARATOR: "quoted command executable must be followed by whitespace",
};

/** 셸을 거치지 않고 실행할 명령의 실행 파일 부분을 해석할 수 없을 때 발생한다. */
export class CommandParseError extends TypeError {
  constructor(readonly code: CommandParseErrorCode) {
    super(ERROR_MESSAGES[code]);
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

  const remainder = trimmed.slice(closingQuote + 1);
  if (remainder.length > 0 && !/^\s/.test(remainder)) {
    throw new CommandParseError("MISSING_EXECUTABLE_ARGUMENT_SEPARATOR");
  }

  const args = remainder.split(/\s+/).filter((token) => token.length > 0);
  return [file, ...args];
}

import type { McpClient } from "@ohmymcp-hsu/core";
import type { Cassette, CassetteVerifyResult } from "@ohmymcp-hsu/record";
import { VERIFY_USAGE_HINT } from "./help.js";

/**
 * `verify` — 카세트가 아직 실서버와 맞는지 확인한다. **카세트를 고치지 않는다.**
 *
 * 이 명령이 있는 이유는 `auto` 모드의 사각지대다. `auto` 는 히트하면 서버를 부르지 않으므로
 * 서버 응답이 바뀌어도 영원히 모른다. 지금까지 그것을 확인할 방법은 파괴적인 `--record`
 * 뿐이었고, 재동기화가 무서우니 사람들이 피했고, 그래서 카세트가 낡아 갔다. 손으로 쓴 목이
 * 조용히 어긋나는 것과 같은 실패가 카세트에서도 일어났다.
 *
 * 그래서 이 명령은 **읽기 전용이다.** 파일을 쓰는 경로가 아예 없다.
 */

export interface VerifyCommandInput {
  readonly cassettePath: string;
  readonly command: string;
  readonly args: readonly string[];
}

export type VerifyErrorCode =
  | "CLI_USAGE"
  | "VERIFY_RUNTIME_UNAVAILABLE"
  | "CASSETTE_NOT_FOUND"
  | "CASSETTE_READ_FAILED"
  | "SERVER_CONNECT_FAILED"
  | "CASSETTE_DRIFTED";

/**
 * 런타임 모듈을 못 불러 fallback 의존성이 쓰일 때 던진다.
 *
 * 타입을 따로 두는 이유는 이 실패가 **카세트 손상과 구분돼야** 하기 때문이다. 그냥 던지면
 * `CASSETTE_READ_FAILED` 로 잡혀 "카세트 파일이 손상되지 않았는지 확인하세요" 가 나가고,
 * 사용자는 멀쩡한 파일을 들여다보게 된다. 고칠 곳은 설치다.
 */
export class VerifyRuntimeUnavailableError extends Error {
  constructor() {
    super("verify 실행에 필요한 모듈을 로드하지 못했습니다.");
    this.name = "VerifyRuntimeUnavailableError";
  }
}

export interface VerifyFailure {
  readonly code: VerifyErrorCode;
  readonly message: string;
  readonly hint: string;
}

export interface VerifyCommandDependencies {
  loadCassette(path: string): Promise<Cassette | null>;
  connect(options: { command: string; args: readonly string[] }): Promise<McpClient>;
  verifyCassette(
    client: McpClient,
    cassette: Cassette,
    options?: { cassettePath?: string },
  ): Promise<CassetteVerifyResult>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

const dictionary: Record<Exclude<VerifyErrorCode, "CLI_USAGE">, Omit<VerifyFailure, "code">> = {
  VERIFY_RUNTIME_UNAVAILABLE: {
    message: "verify 에 필요한 @ohmymcp-hsu/record 를 로드하지 못했습니다.",
    hint: "의존성을 설치한 뒤 다시 실행하세요. 카세트 파일의 문제가 아닙니다.",
  },
  CASSETTE_NOT_FOUND: {
    message: "카세트 파일이 없습니다.",
    hint: "`ohmymcp generate --cassette <path> --record` 로 먼저 녹화하세요.",
  },
  CASSETTE_READ_FAILED: {
    message: "카세트를 읽지 못했습니다.",
    hint: "카세트 파일이 손상되지 않았는지 확인하세요.",
  },
  SERVER_CONNECT_FAILED: {
    message: "MCP 서버에 연결하지 못했습니다.",
    hint: "--command 와 --arg 가 카세트를 녹화할 때 쓴 서버와 같은지 확인하세요.",
  },
  CASSETTE_DRIFTED: {
    message: "카세트가 실서버 응답과 다릅니다.",
    hint: "서버가 바뀐 것이라면 `--record` 로 카세트를 다시 만드세요.",
  },
};

class VerifyCommandError extends Error {
  constructor(readonly failure: VerifyFailure) {
    super(failure.message);
  }
}

const usage = (message: string): never => {
  throw new VerifyCommandError({ code: "CLI_USAGE", message, hint: VERIFY_USAGE_HINT });
};

/**
 * 값을 하나 읽는다. `--opt value` 와 `--opt=value` 를 모두 받는다.
 *
 * `--arg` 만 값의 모양을 검사하지 않는다. 서버 인자는 대부분 플래그 모양이고(`-y`, `--with`,
 * `--db-path`) 빈 문자열도 정상적인 인자다. `generate` 와 `test` 가 이미 `--arg` 를 그렇게
 * 받으므로, 여기서 거절하면 **`generate --record` 로 녹화한 바로 그 서버를 `verify` 로는
 * 부를 수 없다.** 같은 명령줄을 못 받는 verify 는 그 카세트를 확인할 방법이 아예 없다.
 *
 * `--command` 는 그대로 검사한다. 실행 파일 자리에 들어온 플래그는 값을 빠뜨린 오타다.
 */
function optionValue(argv: readonly string[], index: number, name: string): [string, number] {
  const anyShape = name === "--arg";
  const token = argv[index] ?? "";
  if (token.startsWith(`${name}=`)) {
    const value = token.slice(name.length + 1);
    if (value === "" && !anyShape) usage(`${name} 옵션 값이 필요합니다.`);
    return [value, index];
  }
  const next = argv[index + 1];
  if (next === undefined || (!anyShape && (next === "" || next.startsWith("--"))))
    usage(`${name} 옵션 값이 필요합니다.`);
  return [next as string, index + 1];
}

export function parseVerifyCommand(argv: readonly string[]): VerifyCommandInput {
  let cassettePath: string | undefined;
  let command: string | undefined;
  const args: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? "";
    const [name] = token.startsWith("--") ? token.split("=", 1) : [token];

    if (name === "--command") {
      if (command !== undefined) usage("--command 는 한 번만 사용할 수 있습니다.");
      [command, index] = optionValue(argv, index, "--command");
      continue;
    }
    if (name === "--arg") {
      let value: string;
      [value, index] = optionValue(argv, index, "--arg");
      args.push(value);
      continue;
    }
    // 카세트를 고치지 않는 명령이라 --record 를 조용히 무시하면 안 된다. ADR-0028 과 같은 이유다.
    if (name === "--record")
      usage("verify 는 카세트를 고치지 않습니다. 다시 녹화하려면 generate --record 를 쓰세요.");
    if (token.startsWith("--")) usage(`알 수 없는 옵션입니다: ${token}`);
    if (cassettePath !== undefined) usage(`카세트는 하나만 받습니다: ${token}`);
    cassettePath = token;
  }

  if (cassettePath === undefined || cassettePath === "") usage("카세트 JSON 경로가 필요합니다.");
  if (command === undefined) usage("--command 에 MCP 서버 실행 명령이 필요합니다.");
  return Object.freeze({
    cassettePath: cassettePath as string,
    command: command as string,
    args: Object.freeze([...args]),
  });
}

const format = (failure: VerifyFailure): string =>
  `오류 [${failure.code}]: ${failure.message}\n해결: ${failure.hint}\n`;

const writeFailure = (dependencies: VerifyCommandDependencies, failure: VerifyFailure): number => {
  dependencies.writeStderr(format(failure));
  return 1;
};

/**
 * 결과 요약. 숫자만 찍고 끝내지 않는다 — 무엇이 어떻게 다른지가 이 명령의 산출물이다.
 * `record` 가 만든 문장을 그대로 싣는다. 여기서 다시 쓰면 두 곳이 갈린다.
 */
export function formatVerifyResult(result: CassetteVerifyResult, cassettePath: string): string {
  const lines: string[] = [];
  const total =
    result.matched + result.mismatched.length + result.failed.length + result.skipped.length;

  for (const item of [...result.mismatched, ...result.failed, ...result.skipped])
    lines.push(item.message, "");

  lines.push(`카세트: ${cassettePath}`);
  lines.push(
    `  일치 ${result.matched} · 불일치 ${result.mismatched.length} · 실패 ${result.failed.length} · 확인불가 ${result.skipped.length} (총 ${total})`,
  );

  if (result.skipped.length > 0)
    lines.push(
      "  확인불가는 args 에 마스킹된 비밀값이 있어 실서버에 그대로 보낼 수 없는 요청입니다.",
    );
  // 확인하지 못한 것이 있으면 "일치합니다" 라고 단언하지 않는다. skipped 는 비교를 못 한
  // 것이지 같다고 확인한 것이 아니다. 전수 검사인 척하면 사용자가 낡은 카세트를 믿는다.
  if (result.mismatched.length === 0 && result.failed.length === 0)
    lines.push(
      result.skipped.length === 0
        ? "  카세트가 실서버와 일치합니다."
        : `  확인한 ${result.matched}개는 실서버와 일치합니다. ${result.skipped.length}개는 확인하지 못했습니다.`,
    );

  return `${lines.join("\n")}\n`;
}

export async function runVerifyCommand(
  argv: readonly string[],
  dependencies: VerifyCommandDependencies,
): Promise<number> {
  let input: VerifyCommandInput;
  try {
    input = parseVerifyCommand(argv);
  } catch (error) {
    if (error instanceof VerifyCommandError) return writeFailure(dependencies, error.failure);
    throw error;
  }

  let cassette: Cassette | null;
  try {
    cassette = await dependencies.loadCassette(input.cassettePath);
  } catch (error) {
    // 런타임을 못 부른 것과 카세트가 깨진 것은 고칠 곳이 다르다. 같은 문안으로 묶으면
    // 멀쩡한 파일을 들여다보게 된다.
    const code =
      error instanceof VerifyRuntimeUnavailableError
        ? "VERIFY_RUNTIME_UNAVAILABLE"
        : "CASSETTE_READ_FAILED";
    return writeFailure(dependencies, { code, ...dictionary[code] });
  }
  if (cassette === null)
    return writeFailure(dependencies, {
      code: "CASSETTE_NOT_FOUND",
      ...dictionary.CASSETTE_NOT_FOUND,
    });

  let client: McpClient;
  try {
    client = await dependencies.connect({ command: input.command, args: input.args });
  } catch {
    return writeFailure(dependencies, {
      code: "SERVER_CONNECT_FAILED",
      ...dictionary.SERVER_CONNECT_FAILED,
    });
  }

  let result: CassetteVerifyResult;
  try {
    result = await dependencies.verifyCassette(client, cassette, {
      cassettePath: input.cassettePath,
    });
  } finally {
    // 연결은 우리가 열었으므로 우리가 닫는다. verifyCassette 는 닫지 않는다.
    await client.close().catch(() => {});
  }

  dependencies.writeStdout(formatVerifyResult(result, input.cassettePath));

  // 확인불가(skipped)는 실패가 아니다. "달라졌다" 가 아니라 "확인할 수 없다" 이고, 그것은
  // 마스킹의 결과이지 카세트의 결함이 아니다. 이걸로 CI 를 빨갛게 만들면 끌 방법이 없다.
  if (result.mismatched.length === 0 && result.failed.length === 0) return 0;
  dependencies.writeStderr(format({ code: "CASSETTE_DRIFTED", ...dictionary.CASSETTE_DRIFTED }));
  return 1;
}

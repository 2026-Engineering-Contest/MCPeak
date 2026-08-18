import { spawn } from "node:child_process";
import { CommandParseError, tokenizeCommand } from "@ohmymcp/core";

/**
 * 시험 실행 직전에 서버 상태를 되돌리는 초기화 명령을 실행한다. ADR-0023 의 결정을 구현한다.
 *
 * 셸을 거치지 않는다. `;`·`&&`·백틱은 해석되지 않고 그대로 인자가 된다. 실행 파일을 감싼
 * 큰따옴표만 경계로 인식하며 인자의 따옴표는 해석하지 않는다. 공백이 든 인자가 필요하면
 * 사용자가 스크립트 파일을 만들어야 한다. 이 제약은 도움말에 적힌 사양이지 구현 편의가 아니다.
 */

/** 초기화 명령의 제한 시간. 설계 문서 §6. */
const TIMEOUT_MS = 60_000;

/** 보관하는 stderr 상한. 실패 안내에 쓰는 꼬리만 있으면 되고 그 이상은 화면을 덮는다. */
const MAX_STDERR_BYTES = 8 * 1024;

/** 제한 시간 초과일 때 `stderr` 에 넣는 문장. 종료 코드가 없으므로 사유가 여기에만 남는다. */
const TIMEOUT_STDERR = `타임아웃(60초)`;

/**
 * 초기화 명령이 정상 종료하지 못한 경우. 시험 실행을 시작하지 않고 저장도 하지 않는 사유가
 * 되므로, 호출 측이 화면에 쓸 수 있도록 명령·종료 코드·stderr 을 그대로 들고 다닌다.
 *
 * `exitCode` 가 `null` 인 경우는 셋이다. 실행 파일이 없거나(ENOENT), 시그널로 죽었거나,
 * 제한 시간을 넘겨 우리가 죽였을 때다.
 */
export class ResetCommandError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`초기화 명령이 실패했습니다: ${command}`);
    this.name = "ResetCommandError";
  }
}

/**
 * stderr 의 **마지막** 상한만큼을 모은다. 앞부분을 버리는 것이 요점이다. 화면에 쓰는 것은
 * 마지막 3줄이고, 실패 원인은 출력의 끝에 있다. 앞에서 잘라 보관하면 긴 출력을 내는 명령에서
 * 정작 사유가 담긴 마지막 줄이 사라진다.
 */
class StderrTail {
  private chunks: Buffer[] = [];
  private size = 0;

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.byteLength;
    // 상한을 넘으면 앞쪽 덩어리부터 버린다. 경계에 걸친 덩어리는 뒤쪽만 남긴다.
    while (this.size > MAX_STDERR_BYTES) {
      const first = this.chunks[0];
      if (first === undefined) break;
      const excess = this.size - MAX_STDERR_BYTES;
      if (first.byteLength <= excess) {
        this.chunks.shift();
        this.size -= first.byteLength;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.size -= excess;
      }
    }
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/**
 * 초기화 명령을 한 번 실행한다. 재시도하지 않는다.
 *
 * stdout 은 아예 받지 않는다. 성공 경로에서 남의 명령 출력을 우리 화면에 섞지 않기 위함이고,
 * 버퍼 상한에 걸려 멀쩡한 명령이 죽는 일도 없앤다.
 *
 * 빈 문자열이나 공백뿐인 명령은 `ResetCommandError` 가 아니라 `TypeError` 다. 옵션 파싱에서
 * 이미 걸러야 하는 값이고, 여기까지 왔다면 사용자 입력 문제가 아니라 호출 측 결함이다.
 */
export async function runResetCommand(command: string): Promise<void> {
  let tokens: readonly string[];
  try {
    tokens = tokenizeCommand(command);
  } catch (error) {
    if (!(error instanceof CommandParseError)) throw error;
    const reason = {
      EMPTY_EXECUTABLE: "실행 파일 경로가 비어 있습니다.",
      UNTERMINATED_EXECUTABLE_QUOTE: "실행 파일을 감싼 큰따옴표가 닫히지 않았습니다.",
      MISSING_EXECUTABLE_ARGUMENT_SEPARATOR: "실행 파일을 감싼 큰따옴표 뒤에는 공백이 필요합니다.",
    }[error.code];
    throw new ResetCommandError(command, null, `잘못된 초기화 명령: ${reason}`);
  }

  const [file, ...args] = tokens;
  if (file === undefined) {
    throw new TypeError("초기화 명령이 비어 있습니다.");
  }

  return new Promise<void>((resolve, reject) => {
    const stderr = new StderrTail();
    let timedOut = false;
    let settled = false;

    const child = spawn(file, args, { stdio: ["ignore", "ignore", "pipe"], shell: false });

    // 자체 타이머를 쓴다. spawn 의 timeout 옵션에 맡기면 초과 사유를 exitCode 로만 받게 되어
    // 시그널로 죽은 경우와 구분할 수 없다.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle();
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });

    // 실행 파일이 없으면(ENOENT) close 가 아니라 error 로 온다. 종료 코드가 없다.
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(() => {
        reject(new ResetCommandError(command, null, error.message));
      });
    });

    child.on("close", (code, signal) => {
      finish(() => {
        if (timedOut) {
          reject(new ResetCommandError(command, null, TIMEOUT_STDERR));
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        // 시그널로 죽으면 code 가 null 이다. 그대로 넘겨 "코드 없음" 을 보존한다.
        reject(new ResetCommandError(command, code, stderr.text() || describeSignal(signal)));
      });
    });
  });
}

/** stderr 이 비어 있는데 시그널로 죽었으면 그 사실만이라도 남긴다. */
const describeSignal = (signal: NodeJS.Signals | null): string =>
  signal === null ? "" : `시그널 ${signal} 로 종료되었습니다.`;

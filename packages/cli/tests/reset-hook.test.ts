import { describe, expect, it, vi } from "vitest";
import { ResetCommandError, runResetCommand } from "../src/reset-hook.js";

/**
 * 임시 스크립트 파일을 만들지 않는다. `process.execPath` 와 `-e` 만 쓴다. 터미널을 병렬로
 * 돌리므로 파일을 만들면 같은 경로를 두 터미널이 잡는다.
 *
 * 실행 파일은 큰따옴표로 감싼다. Windows 의 `process.execPath` 는 보통 `Program Files` 아래라
 * 공백이 있다. 인자는 여전히 공백으로 잘리므로 아래 인라인 스크립트는 전부 붙여 쓴다.
 */
const nodeCommand = (script: string, ...args: readonly string[]): string =>
  [`"${process.execPath}"`, "-e", script, ...args].join(" ");

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("거부될 것으로 기대한 Promise 가 이행되었습니다.");
};

describe("runResetCommand", () => {
  it("종료 코드 0 이면 resolve 한다", async () => {
    await expect(runResetCommand(nodeCommand("process.exit(0)"))).resolves.toBeUndefined();
  });

  it("종료 코드 1 이면 ResetCommandError 를 던지고 exitCode 가 1 이다", async () => {
    const error = await rejection(runResetCommand(nodeCommand("process.exit(1)")));
    expect(error).toBeInstanceOf(ResetCommandError);
    expect((error as ResetCommandError).exitCode).toBe(1);
  });

  it("실행 파일이 없으면 ResetCommandError 를 던지고 exitCode 가 null 이다", async () => {
    const error = await rejection(runResetCommand("ohmymcp-존재하지-않는-실행파일"));
    expect(error).toBeInstanceOf(ResetCommandError);
    expect((error as ResetCommandError).exitCode).toBeNull();
  });

  it("큰따옴표로 감싼 실행 파일 경로를 실행한다", async () => {
    await expect(
      runResetCommand(`"${process.execPath}" -e process.exit(0)`),
    ).resolves.toBeUndefined();
  });

  it("닫히지 않은 실행 파일 따옴표를 구체적인 파싱 실패로 보고한다", async () => {
    const error = await rejection(runResetCommand('"unterminated'));
    expect(error).toBeInstanceOf(ResetCommandError);
    expect((error as ResetCommandError).stderr).toBe(
      "잘못된 초기화 명령: 실행 파일을 감싼 큰따옴표가 닫히지 않았습니다.",
    );
  });

  it("빈 따옴표 실행 파일 경로를 구체적인 파싱 실패로 보고한다", async () => {
    const error = await rejection(runResetCommand('""'));
    expect(error).toBeInstanceOf(ResetCommandError);
    expect((error as ResetCommandError).stderr).toBe(
      "잘못된 초기화 명령: 실행 파일 경로가 비어 있습니다.",
    );
  });

  it("stderr 이 ResetCommandError.stderr 에 담긴다", async () => {
    const error = await rejection(
      runResetCommand(nodeCommand("process.stderr.write('시드실패');process.exit(2)")),
    );
    expect((error as ResetCommandError).stderr).toBe("시드실패");
  });

  it("셸 메타문자가 인자로 그대로 전달된다", async () => {
    // 셸을 거쳤다면 `&&` 뒤가 별도 명령으로 실행되고 argv 에는 남지 않는다.
    const error = await rejection(
      runResetCommand(
        nodeCommand(
          "process.stderr.write(JSON.stringify(process.argv.slice(1)));process.exit(1)",
          "&&",
          "echo",
          "hacked",
        ),
      ),
    );
    expect((error as ResetCommandError).stderr).toBe('["&&","echo","hacked"]');
  });

  it("60초를 넘기면 프로세스를 죽이고 ResetCommandError 를 던진다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const promise = runResetCommand(nodeCommand("setInterval(()=>{},1000)"));
      const settled = rejection(promise);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
      const error = await settled;
      expect(error).toBeInstanceOf(ResetCommandError);
      expect((error as ResetCommandError).exitCode).toBeNull();
      expect((error as ResetCommandError).stderr).toBe("타임아웃(60초)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("공백뿐인 명령은 TypeError 다", async () => {
    await expect(runResetCommand("   ")).rejects.toBeInstanceOf(TypeError);
    await expect(runResetCommand("")).rejects.toBeInstanceOf(TypeError);
  });

  it("stderr 이 8KB 를 넘으면 8KB 로 잘린다", async () => {
    const error = await rejection(
      runResetCommand(nodeCommand("process.stderr.write('x'.repeat(20000));process.exit(1)")),
    );
    expect((error as ResetCommandError).stderr).toHaveLength(8 * 1024);
  });

  it("8KB 를 넘겨도 마지막 줄이 남는다", async () => {
    // 화면에 쓰는 것은 마지막 3줄이고 실패 사유는 출력의 끝에 있다. 앞에서 잘라 보관하면
    // 정작 사유가 사라진다.
    const error = await rejection(
      runResetCommand(
        nodeCommand(
          // 공백을 넣지 않는다. 초기화 명령은 따옴표를 해석하지 않으므로 공백이 인자를 가른다.
          "process.stderr.write('x'.repeat(20000));process.stderr.write('\\nFATAL:마지막줄\\n');process.exit(1)",
        ),
      ),
    );
    expect((error as ResetCommandError).stderr).toContain("FATAL:마지막줄");
  });
});

/** 구현과 같은 값. 여기서만 쓰므로 모듈에서 내보내지 않는다. */
const TIMEOUT_MS = 60_000;

import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type AuthoringProviderFailureCode =
  | "providerUnavailable"
  | "nonZeroExit"
  | "timedOut"
  | "cancelled"
  | "outputLimitExceeded"
  | "invalidUtf8"
  | "invalidJson"
  | "schemaMismatch"
  | "internal";

/**
 * 비정상 종료의 원인 분류. CLI가 돌려준 숫자 상태 코드에서만 유도하는 닫힌 enum이며,
 * raw stream의 어떤 부분 문자열도 여기에 담기지 않는다. 근거가 없으면 undefined다.
 */
export type AuthoringProviderFailureReason =
  | "notAuthenticated"
  | "unknownModel"
  | "rateLimited"
  | "badRequest"
  | "serverError";

export interface ProviderProcessChild {
  readonly stdin: {
    write(value: string): unknown;
    end(): unknown;
    /** stdin 스트림의 비동기 error(EPIPE 등)를 받는다. 없으면 리스너를 달지 않는다. */
    on?(event: "error", listener: (error: Error) => void): unknown;
  };
  readonly stdout: NodeJS.EventEmitter;
  readonly stderr: NodeJS.EventEmitter;
  kill(signal: NodeJS.Signals): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}
export interface ProviderProcessClock {
  setTimeout(callback: () => void, ms: number): { unref(): void; cancel(): void };
}
export interface ProviderProcessDeps {
  readonly spawn: (
    command: string,
    args: readonly string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      shell: false;
      stdio: "pipe";
    },
  ) => ProviderProcessChild;
  readonly mkdtemp: (prefix: string) => Promise<string>;
  readonly rm: (path: string) => Promise<void>;
  readonly writeFile: (path: string, contents: string) => Promise<void>;
  readonly clock?: ProviderProcessClock;
}
export interface ProviderProcessSpec {
  readonly command: string;
  readonly args: readonly string[] | ((cwd: string) => readonly string[]);
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly env: NodeJS.ProcessEnv;
  readonly cwdPrefix: string;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
  readonly files?: readonly { readonly name: string; readonly contents: string }[];
  /**
   * 비정상 종료 시 실패 원인을 분류한다. raw stream은 이 함수 밖으로 나가지 않으며 반환값은
   * 닫힌 enum이다. provider별 신호 위치가 달라 provider 어댑터가 주입한다.
   */
  readonly classifyFailure?: (streams: {
    readonly stdout: string;
    readonly stderr: string;
  }) => AuthoringProviderFailureReason | undefined;
}
export type ProviderProcessResult =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly stderr?: { readonly captured: boolean; readonly truncated: boolean };
    }
  | {
      readonly ok: false;
      readonly code: AuthoringProviderFailureCode;
      readonly exitCode?: number;
      readonly reason?: AuthoringProviderFailureReason;
      readonly stderr?: { readonly captured: boolean; readonly truncated: boolean };
    };

const stderrLimit = 65_536;
/**
 * 분류에 넘길 stderr 상한. provider가 우리가 보낸 프롬프트를 stderr로 그대로 echo하는 경우가 있고
 * 그 안에는 untrusted한 툴 설명이 들어 있다. 상태 코드 줄은 항상 끝부분에 오므로 마지막 8192자만
 * 링버퍼로 들고, classifyFailure가 없으면 아예 보관하지 않는다.
 */
const stderrClassifyLimit = 8_192;
const defaultClock: ProviderProcessClock = {
  setTimeout: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return { unref: () => timer.unref(), cancel: () => clearTimeout(timer) };
  },
};
const systemDeps: ProviderProcessDeps = {
  spawn: (command, args, options) =>
    nodeSpawn(command, args, options) as ChildProcessWithoutNullStreams,
  mkdtemp: (prefix) => mkdtemp(prefix),
  rm: (path) => rm(path, { recursive: true, force: true }),
  writeFile: (path, contents) => writeFile(path, contents, { encoding: "utf8", flag: "wx" }),
  clock: defaultClock,
};

export async function runProviderProcess(
  spec: ProviderProcessSpec,
  supplied?: ProviderProcessDeps,
): Promise<ProviderProcessResult> {
  const deps = supplied ?? systemDeps;
  if (spec.signal?.aborted) return { ok: false, code: "cancelled" };
  const cwd = await deps.mkdtemp(join(spec.cwdPrefix, "ohmymcp-provider-"));
  try {
    for (const file of spec.files ?? []) {
      if (
        file.name.includes("/") ||
        file.name.includes("\\") ||
        file.name === "." ||
        file.name === ".."
      )
        throw new TypeError("provider temp file name is invalid");
      await deps.writeFile(join(cwd, file.name), file.contents);
    }
  } catch {
    await deps.rm(cwd);
    return { ok: false, code: "internal" };
  }
  let child: ProviderProcessChild;
  try {
    child = deps.spawn(spec.command, typeof spec.args === "function" ? spec.args(cwd) : spec.args, {
      cwd,
      env: spec.env,
      shell: false,
      stdio: "pipe",
    });
  } catch {
    await deps.rm(cwd);
    return { ok: false, code: "providerUnavailable" };
  }
  return await new Promise((resolve) => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let output = "";
    let outputBytes = 0;
    let stderrBytes = 0;
    let stderrTail = "";
    const stderrDecoder = new TextDecoder("utf-8");
    let stderrCaptured = false;
    let stderrTruncated = false;
    let finished = false;
    let closed = false;
    let stdinWriteFailed = false;
    let reason: AuthoringProviderFailureCode | undefined;
    const clock = deps.clock ?? defaultClock;
    let timeoutTimer: { unref(): void; cancel(): void } | undefined;
    let killTimer: { unref(): void; cancel(): void } | undefined;
    let deadlineTimer: { unref(): void; cancel(): void } | undefined;
    const diagnostics = () => ({ captured: stderrCaptured, truncated: stderrTruncated });
    const cleanup = () => {
      if (closed) void deps.rm(cwd).catch(() => undefined);
    };
    const settle = (result: ProviderProcessResult) => {
      if (finished) return;
      finished = true;
      timeoutTimer?.cancel();
      deadlineTimer?.cancel();
      // killTimer는 여기서 취소하지 않는다. SIGTERM을 무시하는 자식에게 SIGKILL이 가야
      // 좀비가 남지 않는다. 이 타이머는 close 이벤트에서만 취소한다.
      resolve(result);
    };
    const terminate = (next: AuthoringProviderFailureCode) => {
      if (reason !== undefined) {
        if (next === "cancelled") reason = next;
        return;
      }
      reason = next;
      try {
        child.kill("SIGTERM");
      } catch {
        /* safe public failure keeps the original reason */
      }
      killTimer = clock.setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 1000);
      killTimer.unref();
      deadlineTimer = clock.setTimeout(
        () => settle({ ok: false, code: reason ?? "internal", stderr: diagnostics() }),
        2000,
      );
      deadlineTimer.unref();
    };
    const abort = () => terminate("cancelled");
    spec.signal?.addEventListener("abort", abort, { once: true });
    timeoutTimer = clock.setTimeout(() => terminate("timedOut"), spec.timeoutMs);
    timeoutTimer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      if (finished || reason !== undefined) return;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > spec.maxOutputBytes) {
        terminate("outputLimitExceeded");
        settle({ ok: false, code: "outputLimitExceeded", stderr: diagnostics() });
        return;
      }
      try {
        output += decoder.decode(chunk, { stream: true });
      } catch {
        terminate("invalidUtf8");
        settle({ ok: false, code: "invalidUtf8", stderr: diagnostics() });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrCaptured = true;
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > stderrLimit) stderrTruncated = true;
      if (spec.classifyFailure !== undefined)
        stderrTail = (stderrTail + stderrDecoder.decode(chunk, { stream: true })).slice(
          -stderrClassifyLimit,
        );
    });
    child.on("error", () => {
      if (!finished) terminate("internal");
    });
    child.on("close", (code: number | null) => {
      closed = true;
      killTimer?.cancel();
      cleanup();
      spec.signal?.removeEventListener("abort", abort);
      if (finished) return;
      if (reason !== undefined) {
        settle({ ok: false, code: reason, stderr: diagnostics() });
        return;
      }
      if (code !== 0) {
        // 프롬프트 쓰기가 실패한 뒤의 비정상 종료는 provider의 판정이 아니라 우리 쪽 입력 문제다.
        if (stdinWriteFailed) {
          settle({
            ok: false,
            code: "internal",
            exitCode: code ?? undefined,
            stderr: diagnostics(),
          });
          return;
        }
        let classified: AuthoringProviderFailureReason | undefined;
        if (spec.classifyFailure !== undefined) {
          try {
            output += decoder.decode();
          } catch {
            /* 분류용 flush 실패는 무시한다. 분류 근거가 없으면 reason 없이 간다. */
          }
          try {
            classified = spec.classifyFailure({ stdout: output, stderr: stderrTail });
          } catch {
            classified = undefined;
          }
        }
        settle({
          ok: false,
          code: "nonZeroExit",
          exitCode: code ?? undefined,
          ...(classified === undefined ? {} : { reason: classified }),
          stderr: diagnostics(),
        });
        return;
      }
      try {
        output += decoder.decode();
      } catch {
        settle({
          ok: false,
          code: stdinWriteFailed ? "internal" : "invalidUtf8",
          stderr: diagnostics(),
        });
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(output);
      } catch {
        settle({
          ok: false,
          code: stdinWriteFailed ? "internal" : "invalidJson",
          stderr: diagnostics(),
        });
        return;
      }
      // 여기까지 왔으면 exit 0 + 유효한 결과다. 쓰기 오류가 있었더라도 provider가 프롬프트를
      // 다 읽고 stdin을 먼저 닫은 경우이므로 무시한다.
      settle({ ok: true, value, stderr: diagnostics() });
    });
    // stdin 스트림의 error는 비동기로 오므로 아래 try/catch가 잡지 못하고, 리스너가 없으면
    // 처리되지 않은 stream error가 host 프로세스를 죽인다. 그래서 리스너를 단다.
    //
    // 쓰기 오류를 그냥 무시하면 프롬프트가 잘려 나갔는데도 조용히 진행해 provider가 불완전한
    // 입력으로 답한 결과를 성공으로 받게 된다. 그렇다고 곧바로 실패로 보면, provider가 프롬프트를
    // 다 읽고 stdin을 먼저 닫아 생긴 정상 EPIPE까지 실패가 된다. 그래서 사실만 기억하고
    // close 시점에 판정한다. exit code 0이면서 stdout이 유효한 결과면 무시하고, 그 외는 internal이다.
    child.stdin.on?.("error", () => {
      stdinWriteFailed = true;
    });
    try {
      child.stdin.write(spec.stdin);
      child.stdin.end();
    } catch {
      terminate("internal");
    }
  });
}

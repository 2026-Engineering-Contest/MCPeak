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

export interface ProviderProcessChild {
  readonly stdin: { write(value: string): unknown; end(): unknown };
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
      readonly stderr?: { readonly captured: boolean; readonly truncated: boolean };
    };

const stderrLimit = 65_536;
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
    let stderrCaptured = false;
    let stderrTruncated = false;
    let finished = false;
    let closed = false;
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
      killTimer?.cancel();
      deadlineTimer?.cancel();
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
    });
    child.on("error", () => {
      if (!finished) terminate("internal");
    });
    child.on("close", (code: number | null) => {
      closed = true;
      cleanup();
      spec.signal?.removeEventListener("abort", abort);
      if (finished) return;
      if (reason !== undefined) {
        settle({ ok: false, code: reason, stderr: diagnostics() });
        return;
      }
      if (code !== 0) {
        settle({
          ok: false,
          code: "nonZeroExit",
          exitCode: code ?? undefined,
          stderr: diagnostics(),
        });
        return;
      }
      try {
        output += decoder.decode();
      } catch {
        settle({ ok: false, code: "invalidUtf8", stderr: diagnostics() });
        return;
      }
      try {
        settle({ ok: true, value: JSON.parse(output), stderr: diagnostics() });
      } catch {
        settle({ ok: false, code: "invalidJson", stderr: diagnostics() });
      }
    });
    try {
      child.stdin.write(spec.stdin);
      child.stdin.end();
    } catch {
      terminate("internal");
    }
  });
}

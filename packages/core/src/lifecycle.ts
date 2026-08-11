import type { McpProcessDiagnostics } from "./diagnostics.js";
import { McpClientError } from "./errors.js";

export const STDIN_CLOSE_GRACE_MS = 500;
export const SIGTERM_GRACE_MS = 500;
export const SIGKILL_OBSERVE_MS = 500;

export type LifecycleState =
  | "created"
  | "starting"
  | "handshaking"
  | "open"
  | "closing"
  | "forceClosing"
  | "closed"
  | "failed";

export interface LifecycleTimer {
  unref(): void;
  cancel(): void;
}
export interface LifecycleClock {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): LifecycleTimer;
}
export interface LifecycleStream {
  end?(): void;
  destroy?(): void;
}
export interface LifecycleChild {
  stdin?: LifecycleStream | null;
  stdout?: LifecycleStream | null;
  stderr?: LifecycleStream | null;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal: NodeJS.Signals): boolean;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

export interface LifecycleHooks {
  /** SDK protocol close와 reader 종료처럼 정상 close에 속한 추가 정리다. */
  normalClose?(): void | Promise<void>;
}

const productionClock: LifecycleClock = {
  now: () => performance.now(),
  setTimeout: (callback, milliseconds) => {
    const handle = setTimeout(callback, milliseconds);
    return { unref: () => handle.unref(), cancel: () => clearTimeout(handle) };
  },
};

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: unknown): void } {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function isMissingProcess(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

/** child process 종료의 deadline과 side effect를 한 곳에서 직렬화한다. */
export class LifecycleController {
  #state: LifecycleState = "open";
  #closePromise?: Promise<void>;
  #forcePromise?: Promise<void>;
  #terminalPromise?: Promise<void>;
  #closeDeferred?: ReturnType<typeof deferred>;
  #forceDeferred?: ReturnType<typeof deferred>;
  #timer?: LifecycleTimer;
  #deadlineAt?: number;
  #deadlineStage?: "stdin" | "term" | "kill";
  #stdinEnded = false;
  #stdinDestroyed = false;
  #stdoutDestroyed = false;
  #stderrDestroyed = false;
  #termSent = false;
  #killSent = false;
  #onProcessCloseCalled = false;
  #finalDiagnostics?: McpProcessDiagnostics;

  constructor(
    readonly child: LifecycleChild,
    readonly clock: LifecycleClock = productionClock,
    readonly diagnostics: () => McpProcessDiagnostics,
    private readonly onProcessClose?: () => void,
    private readonly hooks: LifecycleHooks = {},
  ) {
    child.on("close", (code, signal) => this.#observeClose(code, signal));
  }

  get state(): LifecycleState {
    return this.#state;
  }
  getDiagnostics(): McpProcessDiagnostics {
    return this.#finalDiagnostics ?? this.diagnostics();
  }

  close(): Promise<void> {
    if (this.#state === "forceClosing") return this.#forcePromise ?? this.#terminal();
    if (this.#state === "closed") return this.#completed();
    if (this.#state === "failed")
      return this.#forcePromise ?? this.#closePromise ?? this.#terminal();
    if (this.#closePromise) return this.#closePromise;
    this.#closeDeferred = deferred();
    this.#closePromise = this.#closeDeferred.promise;
    this.#state = "closing";
    try {
      if (!this.#stdinEnded) {
        this.child.stdin?.end?.();
        this.#stdinEnded = true;
      }
      const normalClose = this.hooks.normalClose?.();
      if (normalClose) {
        void Promise.resolve(normalClose).then(
          () => this.#finishNormalClose(),
          (cause) => this.#failClose(cause),
        );
      } else this.#finishNormalClose();
    } catch (cause) {
      this.#failClose(cause);
    }
    return this.#closePromise;
  }

  forceClose(): Promise<void> {
    if (this.#state === "forceClosing") return this.#forcePromise ?? this.#terminal();
    if (this.#state === "closed") return this.#completed();
    if (this.#state === "failed") return this.#forcePromise ?? this.#terminal();
    return this.#beginForce(false);
  }

  #beginForce(preserveFailure: boolean): Promise<void> {
    this.#forceDeferred = deferred();
    this.#forcePromise = this.#forceDeferred.promise;
    if (!preserveFailure) this.#state = "forceClosing";
    this.#cancelTimer();
    try {
      this.#destroyReaders();
      if (!this.#stdinDestroyed) {
        this.child.stdin?.destroy?.();
        this.#stdinDestroyed = true;
      }
      this.#sendKill("SIGKILL");
      this.#schedule("kill");
    } catch (cause) {
      this.#state = "failed";
      this.#freezeDiagnostics();
      this.#forceDeferred.reject(
        new McpClientError({
          code: "FORCE_CLOSE_FAILED",
          phase: "forceClose",
          diagnostics: this.getDiagnostics(),
          cause,
        }),
      );
    }
    return this.#forcePromise;
  }

  #schedule(stage: "stdin" | "term" | "kill"): void {
    const wait =
      stage === "stdin"
        ? STDIN_CLOSE_GRACE_MS
        : stage === "term"
          ? SIGTERM_GRACE_MS
          : SIGKILL_OBSERVE_MS;
    this.#deadlineAt = this.clock.now() + wait;
    this.#deadlineStage = stage;
    this.#timer = this.clock.setTimeout(() => this.#atDeadline(stage), wait);
    this.#timer.unref();
  }
  #finishNormalClose(): void {
    if (this.#state !== "closing") return;
    try {
      this.#destroyReaders();
      this.#schedule("stdin");
    } catch (cause) {
      this.#failClose(cause);
    }
  }
  #atDeadline(stage: "stdin" | "term" | "kill"): void {
    if (this.clock.now() < (this.#deadlineAt ?? Infinity)) return;
    this.#timer = undefined;
    this.#deadlineStage = undefined;
    if (this.#state === "closed") return;
    if (this.#state === "failed") {
      if (stage === "kill")
        this.#forceDeferred?.reject(
          new McpClientError({
            code: "FORCE_CLOSE_TIMEOUT",
            phase: "forceClose",
            diagnostics: this.getDiagnostics(),
          }),
        );
      return;
    }
    try {
      if (stage === "stdin") {
        this.#sendKill("SIGTERM");
        this.#schedule("term");
        return;
      }
      if (stage === "term") {
        this.#sendKill("SIGKILL");
        this.#state = "forceClosing";
        this.#schedule("kill");
        return;
      }
      this.#state = "failed";
      this.#freezeDiagnostics();
      this.#forceDeferred?.reject(
        new McpClientError({
          code: "FORCE_CLOSE_TIMEOUT",
          phase: "forceClose",
          diagnostics: this.getDiagnostics(),
        }),
      );
      this.#closeDeferred?.reject(
        new McpClientError({
          code: "FORCE_CLOSE_TIMEOUT",
          phase: "forceClose",
          diagnostics: this.getDiagnostics(),
        }),
      );
    } catch (cause) {
      this.#failForce(cause);
    }
  }
  #sendKill(signal: NodeJS.Signals): void {
    if (signal === "SIGTERM" && this.#termSent) return;
    if (signal === "SIGKILL" && this.#killSent) return;
    try {
      this.child.kill(signal);
    } catch (error) {
      if (!isMissingProcess(error)) throw error;
    }
    if (signal === "SIGTERM") this.#termSent = true;
    else this.#killSent = true;
  }
  #destroyReaders(): void {
    if (!this.#stdoutDestroyed) {
      this.#stdoutDestroyed = true;
      this.child.stdout?.destroy?.();
    }
    if (!this.#stderrDestroyed) {
      this.#stderrDestroyed = true;
      this.child.stderr?.destroy?.();
    }
  }
  #observeClose(code: number | null, signal: NodeJS.Signals | null): void {
    const deadlineStage = this.#deadlineStage;
    if (deadlineStage && this.clock.now() >= (this.#deadlineAt ?? Infinity)) {
      this.#atDeadline(deadlineStage);
    }
    if (this.#state === "failed") {
      this.#cancelTimer();
      this.#notifyProcessClose();
      this.#forceDeferred?.resolve();
      this.#terminalPromise ??= Promise.resolve();
      return;
    }
    this.#cancelTimer();
    this.#state = "closed";
    this.#finalDiagnostics = Object.freeze({ ...this.diagnostics(), exitCode: code, signal });
    this.#notifyProcessClose();
    this.#forceDeferred?.resolve();
    this.#closeDeferred?.resolve();
    this.#terminalPromise ??= Promise.resolve();
  }
  #failClose(cause: unknown): void {
    this.#state = "failed";
    this.#freezeDiagnostics();
    this.#closeDeferred?.reject(
      new McpClientError({
        code: "CLOSE_FAILED",
        phase: "close",
        diagnostics: this.getDiagnostics(),
        cause,
      }),
    );
    if (!this.#forcePromise) void this.#beginForce(true).catch(() => {});
  }
  #failForce(cause: unknown): void {
    this.#state = "failed";
    this.#freezeDiagnostics();
    const error = new McpClientError({
      code: "FORCE_CLOSE_FAILED",
      phase: "forceClose",
      diagnostics: this.getDiagnostics(),
      cause,
    });
    this.#forceDeferred?.reject(error);
    this.#closeDeferred?.reject(error);
  }
  #freezeDiagnostics(): void {
    this.#finalDiagnostics ??= Object.freeze({ ...this.diagnostics() });
  }
  #notifyProcessClose(): void {
    if (this.#onProcessCloseCalled) return;
    this.#onProcessCloseCalled = true;
    this.onProcessClose?.();
  }
  #cancelTimer(): void {
    this.#timer?.cancel();
    this.#timer = undefined;
    this.#deadlineStage = undefined;
  }
  #terminal(): Promise<void> {
    if (!this.#terminalPromise) this.#terminalPromise = Promise.resolve();
    return this.#terminalPromise;
  }
  #completed(): Promise<void> {
    return this.#forcePromise ?? this.#closePromise ?? this.#terminal();
  }
}

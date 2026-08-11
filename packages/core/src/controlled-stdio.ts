import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { BoundedStderr, type McpProcessDiagnostics } from "./diagnostics.js";
import { McpClientError } from "./errors.js";
import { type LifecycleClock, LifecycleController, type LifecycleState } from "./lifecycle.js";
import type { ResolvedConnectOptions } from "./options.js";

type SpawnedChild = ChildProcessWithoutNullStreams;
type SpawnFactory = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
) => SpawnedChild;

export interface ControlledStdioTransport extends Transport {
  readonly state: LifecycleState;
  getDiagnostics(): McpProcessDiagnostics;
  markOpen(): void;
  forceClose(): Promise<void>;
}

/** SDK public Transport만 구현하면서 child handle과 종료 정책을 Core가 소유한다. */
export class NodeControlledStdioTransport implements ControlledStdioTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;
  #child?: SpawnedChild;
  #lifecycle?: LifecycleController;
  #startPromise?: Promise<void>;
  #state: LifecycleState = "created";
  #readBuffer: ReadBuffer;
  #stderr: BoundedStderr;
  #exitCode: number | null = null;
  #signal: NodeJS.Signals | null = null;
  #oncloseCalled = false;
  #transportFailureObserved = false;
  #startReject?: (reason?: unknown) => void;
  #normalCloseHook?: () => void | Promise<void>;

  constructor(
    readonly options: ResolvedConnectOptions,
    private readonly spawnProcess: SpawnFactory = (command, args, options) =>
      spawn(command, args, options) as SpawnedChild,
    private readonly clock?: LifecycleClock,
  ) {
    this.#readBuffer = new ReadBuffer({ maxBufferSize: options.maxMessageBytes });
    this.#stderr = new BoundedStderr(options.maxStderrBytes);
  }

  get state(): LifecycleState {
    const lifecycleState = this.#lifecycle?.state;
    if (
      lifecycleState === "closing" ||
      lifecycleState === "forceClosing" ||
      lifecycleState === "closed" ||
      lifecycleState === "failed"
    )
      return lifecycleState;
    return this.#state;
  }
  getDiagnostics(): McpProcessDiagnostics {
    return this.#lifecycle?.getDiagnostics() ?? this.#diagnostics();
  }
  markOpen(): void {
    if (this.#state === "handshaking") this.#state = "open";
  }
  /** Task 3의 SDK adapter가 lifecycle과 동일한 close Promise에 연결하는 package-private hook이다. */
  setNormalCloseHook(hook: (() => void | Promise<void>) | undefined): void {
    this.#normalCloseHook = hook;
  }

  start(): Promise<void> {
    if (this.#startPromise) return this.#startPromise;
    this.#state = "starting";
    this.#startPromise = new Promise((resolve, reject) => {
      this.#startReject = reject;
      const environment = { ...getDefaultEnvironment(), ...this.options.env };
      let child: SpawnedChild;
      try {
        child = this.spawnProcess(this.options.command, this.options.args, {
          cwd: this.options.cwd,
          env: environment,
          shell: false,
          windowsHide: true,
          stdio: "pipe",
        });
      } catch (cause) {
        this.#startFailed(reject, cause);
        return;
      }
      this.#child = child;
      this.#lifecycle = new LifecycleController(
        child,
        this.clock,
        () => this.#diagnostics(),
        () => this.#notifyClose(),
        { normalClose: () => this.#normalCloseHook?.() },
      );
      const onSpawn = () => {
        child.removeListener("error", startError);
        if (this.state !== "starting") return;
        this.#state = "handshaking";
        resolve();
      };
      const startError = (cause: Error) => {
        child.removeListener("spawn", onSpawn);
        child.removeListener("error", startError);
        this.#startFailed(reject, cause);
      };
      child.once("spawn", onSpawn);
      child.once("error", startError);
      child.on("error", (cause) => this.#transportFailed(cause));
      child.stdout.on("data", (chunk: Buffer) => this.#readStdout(chunk));
      child.stdout.on("error", (cause) => this.#transportFailed(cause));
      child.stdin.on("error", (cause) => this.#transportFailed(cause));
      child.stderr.on("data", (chunk: Buffer) => this.#stderr.append(chunk));
      child.stderr.on("error", () => {
        /* stderr is diagnostic only */
      });
    });
    return this.#startPromise;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const child = this.#child;
    if (!child || this.state === "closed" || this.state === "failed")
      throw new Error("stdio transport is not connected");
    await new Promise<void>((resolve, reject) => {
      try {
        if (child.stdin.write(serializeMessage(message))) resolve();
        else child.stdin.once("drain", resolve);
      } catch (cause) {
        reject(cause);
      }
    });
  }

  close(): Promise<void> {
    return this.#lifecycle?.close() ?? Promise.resolve();
  }
  forceClose(): Promise<void> {
    if (this.#state === "starting" && this.#startReject) {
      this.#startReject(
        new McpClientError({
          code: "PROCESS_START_FAILED",
          phase: "spawn",
          diagnostics: this.#diagnostics(),
        }),
      );
      this.#startReject = undefined;
    }
    return this.#lifecycle?.forceClose() ?? Promise.resolve();
  }

  #readStdout(chunk: Buffer): void {
    if (this.state === "closed" || this.state === "failed") return;
    try {
      this.#readBuffer.append(chunk);
      while (true) {
        const message = this.#readBuffer.readMessage();
        if (!message) break;
        this.onmessage?.(message);
      }
    } catch (cause) {
      this.#transportFailed(cause);
    }
  }
  #transportFailed(cause: unknown): void {
    if (this.#transportFailureObserved || this.state === "closed" || this.state === "failed")
      return;
    this.#transportFailureObserved = true;
    const error = new McpClientError({
      code: "TRANSPORT_FAILED",
      phase: "transport",
      diagnostics: this.getDiagnostics(),
      cause,
    });
    this.onerror?.(error);
    void this.forceClose().catch(() => {});
  }
  #startFailed(reject: (reason?: unknown) => void, cause: unknown): void {
    if (this.#state === "failed" || this.#state === "closed") return;
    const error = new McpClientError({
      code: "PROCESS_START_FAILED",
      phase: "spawn",
      diagnostics: this.#diagnostics(),
      cause,
    });
    this.onerror?.(error);
    reject(error);
    this.#startReject = undefined;
    if (this.#lifecycle) void this.#lifecycle.forceClose().catch(() => {});
    else this.#state = "failed";
  }
  #notifyClose(): void {
    if (this.#oncloseCalled) return;
    this.#oncloseCalled = true;
    this.#exitCode = this.#child?.exitCode ?? this.#exitCode;
    this.#signal = this.#child?.signalCode ?? this.#signal;
    this.onclose?.();
  }
  #diagnostics(): McpProcessDiagnostics {
    return this.#stderr.snapshot(this.#exitCode, this.#signal);
  }
}

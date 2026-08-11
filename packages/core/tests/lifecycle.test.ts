import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { NodeControlledStdioTransport } from "../src/controlled-stdio.js";
import { type LifecycleChild, type LifecycleClock, LifecycleController } from "../src/lifecycle.js";
import { resolveConnectOptions } from "../src/options.js";

class FakeClock implements LifecycleClock {
  #now = 0;
  #timers: { at: number; callback: () => void; cancelled: boolean; unrefCalls: number }[] = [];
  now = () => this.#now;
  setTimeout = (callback: () => void, ms: number) => {
    const timer = { at: this.#now + ms, callback, cancelled: false, unrefCalls: 0 };
    this.#timers.push(timer);
    return {
      unref: () => {
        timer.unrefCalls += 1;
      },
      cancel: () => {
        timer.cancelled = true;
      },
    };
  };
  advance(ms: number) {
    this.#now += ms;
    for (const timer of [...this.#timers].filter(
      (item) => !item.cancelled && item.at <= this.#now,
    )) {
      timer.cancelled = true;
      timer.callback();
    }
  }
  get unrefCalls() {
    return this.#timers.reduce((count, timer) => count + timer.unrefCalls, 0);
  }
}

class FakeChild extends EventEmitter implements LifecycleChild {
  stdin = {
    endCalls: 0,
    destroyCalls: 0,
    end: () => {
      if (this.stdinEndError) throw this.stdinEndError;
      this.stdin.endCalls += 1;
    },
    destroy: () => {
      this.stdin.destroyCalls += 1;
    },
  };
  stdout = {
    destroyCalls: 0,
    destroy: () => {
      if (this.stdoutDestroyError) throw this.stdoutDestroyError;
      this.stdout.destroyCalls += 1;
    },
  };
  stderr = {
    destroyCalls: 0,
    destroy: () => {
      if (this.stderrDestroyError) throw this.stderrDestroyError;
      this.stderr.destroyCalls += 1;
    },
  };
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kills: NodeJS.Signals[] = [];
  killError: unknown;
  stdinEndError: unknown;
  stdoutDestroyError: unknown;
  stderrDestroyError: unknown;
  kill(signal: NodeJS.Signals) {
    this.kills.push(signal);
    if (this.killError) throw this.killError;
    return true;
  }
  close(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("close", code, signal);
  }
}

class FakeTransportChild extends FakeChild {
  override stdin = Object.assign(new EventEmitter(), {
    endCalls: 0,
    destroyCalls: 0,
    writes: [] as string[],
    end: () => {
      this.stdin.endCalls += 1;
    },
    destroy: () => {
      this.stdin.destroyCalls += 1;
    },
    write: (value: string) => {
      this.stdin.writes.push(value);
      return true;
    },
  });
  override stdout = Object.assign(new EventEmitter(), {
    destroyCalls: 0,
    destroy: () => {
      this.stdout.destroyCalls += 1;
    },
  });
  override stderr = Object.assign(new EventEmitter(), {
    destroyCalls: 0,
    destroy: () => {
      this.stderr.destroyCalls += 1;
    },
  });
}

function controlled(
  child = new FakeTransportChild(),
  clock = new FakeClock(),
  maxMessageBytes = 10 * 1024 * 1024,
) {
  let spawnCalls = 0;
  let spawnedOptions: unknown;
  const transport = new NodeControlledStdioTransport(
    resolveConnectOptions({
      command: "node",
      env: { PATH: "explicit-path", EXPLICIT: "yes" },
      maxMessageBytes,
    }),
    ((_: string, _args: readonly string[], options: unknown) => {
      spawnCalls += 1;
      spawnedOptions = options;
      return child;
    }) as never,
    clock,
  );
  return {
    transport,
    child,
    clock,
    get spawnCalls() {
      return spawnCalls;
    },
    get spawnedOptions() {
      return spawnedOptions;
    },
  };
}

function setup() {
  const child = new FakeChild();
  const clock = new FakeClock();
  const controller = new LifecycleController(child, clock, () => ({
    stderr: "",
    stderrTruncated: false,
    exitCode: child.exitCode,
    signal: child.signalCode,
  }));
  return { child, clock, controller };
}

describe("LifecycleController", () => {
  it("정상 close는 stdin 종료로 끝나며 grace timer를 unref한다", async () => {
    const { child, clock, controller } = setup();
    const closing = controller.close();
    expect(child.stdin.endCalls).toBe(1);
    clock.advance(499);
    expect(child.kills).toEqual([]);
    child.close();
    await closing;
    expect(child.kills).toEqual([]);
    expect(clock.unrefCalls).toBe(1);
  });

  it("500ms 경계에서는 deadline이 SIGTERM과 SIGKILL을 우선한다", async () => {
    const { child, clock, controller } = setup();
    const closing = controller.close();
    clock.advance(500);
    expect(child.kills).toEqual(["SIGTERM"]);
    clock.advance(500);
    // FakeClock은 한 번의 advance 안에서 새 timer를 재귀적으로 실행하지 않는다.
    clock.advance(0);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(clock.unrefCalls).toBe(3);
    child.close(null, "SIGKILL");
    await closing;
  });

  it("forceClose는 즉시 reader, stdin을 중단하고 SIGKILL한다", async () => {
    const { child, controller } = setup();
    const forced = controller.forceClose();
    expect(child.stdout.destroyCalls).toBe(1);
    expect(child.stderr.destroyCalls).toBe(1);
    expect(child.stdin.destroyCalls).toBe(1);
    expect(child.kills).toEqual(["SIGKILL"]);
    child.close(null, "SIGKILL");
    await forced;
  });

  it("반복 종료는 동일 Promise를 공유하고 force 뒤 close도 force Promise다", async () => {
    const { child, controller } = setup();
    const close = controller.close();
    expect(controller.close()).toBe(close);
    const force = controller.forceClose();
    expect(controller.forceClose()).toBe(force);
    expect(controller.close()).toBe(force);
    expect(child.stdin.endCalls).toBe(1);
    expect(child.kills).toEqual(["SIGKILL"]);
    child.close();
    await force;
  });

  it("SIGKILL 뒤 500ms close event가 없으면 failed로 확정하고 늦은 close를 무시한다", async () => {
    const { child, clock, controller } = setup();
    const forced = controller.forceClose();
    clock.advance(499);
    expect(controller.state).toBe("forceClosing");
    clock.advance(1);
    await expect(forced).rejects.toMatchObject({
      code: "FORCE_CLOSE_TIMEOUT",
      phase: "forceClose",
    });
    const diagnostics = controller.getDiagnostics();
    child.close(0, null);
    expect(controller.state).toBe("failed");
    expect(controller.getDiagnostics()).toEqual(diagnostics);
  });

  it("ESRCH는 강제 종료 성공이고 권한 오류는 안전한 실패다", async () => {
    const first = setup();
    const esrch = Object.assign(new Error("missing"), { code: "ESRCH" });
    first.child.killError = esrch;
    const forced = first.controller.forceClose();
    first.child.close();
    await forced;

    const second = setup();
    second.child.killError = Object.assign(new Error("denied"), { code: "EPERM" });
    await expect(second.controller.forceClose()).rejects.toMatchObject({
      code: "FORCE_CLOSE_FAILED",
    });
  });

  it("close 중 forceClose는 timer를 취소하고 SIGKILL을 한 번만 보낸다", async () => {
    const { child, clock, controller } = setup();
    const close = controller.close();
    const force = controller.forceClose();
    clock.advance(499);
    expect(child.kills).toEqual(["SIGKILL"]);
    child.close();
    await expect(close).resolves.toBeUndefined();
    await expect(force).resolves.toBeUndefined();
  });

  it("closed 뒤 종료 API는 같은 terminal Promise를 반환하고 side effect가 없다", async () => {
    const { child, controller } = setup();
    const first = controller.close();
    child.close(0, null);
    await first;
    const diagnostics = controller.getDiagnostics();
    const close = controller.close();
    const force = controller.forceClose();
    expect(close).toBe(force);
    expect(child.stdin.endCalls).toBe(1);
    expect(child.kills).toEqual([]);
    expect(controller.getDiagnostics()).toEqual(diagnostics);
  });

  it("normal close 훅 실패는 CLOSE_FAILED와 cached force cleanup을 보존한다", async () => {
    const child = new FakeChild();
    const clock = new FakeClock();
    const controller = new LifecycleController(
      child,
      clock,
      () => ({ stderr: "frozen", stderrTruncated: false, exitCode: null, signal: null }),
      undefined,
      {
        normalClose: () => {
          throw new Error("sdk close failed");
        },
      },
    );
    const close = controller.close();
    await expect(close).rejects.toMatchObject({ code: "CLOSE_FAILED", phase: "close" });
    expect(controller.state).toBe("failed");
    const cleanup = controller.forceClose();
    expect(cleanup).toBe(controller.forceClose());
    expect(child.kills).toEqual(["SIGKILL"]);
    child.close();
    await cleanup;
  });

  it("async SDK close 훅이 끝나기 전에는 normal close deadline을 시작하지 않는다", async () => {
    const { child, clock } = setup();
    let release!: () => void;
    const controller = new LifecycleController(
      child,
      clock,
      () => ({ stderr: "", stderrTruncated: false, exitCode: null, signal: null }),
      undefined,
      {
        normalClose: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    );
    const close = controller.close();
    clock.advance(500);
    expect(child.kills).toEqual([]);
    release();
    await Promise.resolve();
    clock.advance(500);
    expect(child.kills).toEqual(["SIGTERM"]);
    child.close();
    await close;
  });

  it("stdin end와 각 reader destroy 실패는 CLOSE_FAILED 후 cached force cleanup을 공유한다", async () => {
    for (const failingPart of ["stdin", "stdout", "stderr"] as const) {
      const { child, controller } = setup();
      if (failingPart === "stdin") child.stdinEndError = new Error("stdin");
      if (failingPart === "stdout") child.stdoutDestroyError = new Error("stdout");
      if (failingPart === "stderr") child.stderrDestroyError = new Error("stderr");
      const close = controller.close();
      await expect(close).rejects.toMatchObject({ code: "CLOSE_FAILED", phase: "close" });
      const diagnostics = controller.getDiagnostics();
      expect(Object.isFrozen(diagnostics)).toBe(true);
      expect(controller.state).toBe("failed");
      const cleanup = controller.forceClose();
      expect(cleanup).toBe(controller.forceClose());
      // 실패한 stream은 한 번만 시도해 side effect를 반복하지 않는다.
      child.close();
      await cleanup.catch(() => {});
    }
  });

  it("process close는 중복 close/error 경쟁에도 onclose를 한 번만 호출한다", async () => {
    const child = new FakeChild();
    let closed = 0;
    const controller = new LifecycleController(
      child,
      new FakeClock(),
      () => ({ stderr: "", stderrTruncated: false, exitCode: null, signal: null }),
      () => {
        closed += 1;
      },
    );
    const closing = controller.close();
    child.close();
    child.close();
    await closing;
    expect(closed).toBe(1);
  });
});

describe("NodeControlledStdioTransport", () => {
  it("spawn 전 start는 pending이며 spawn error는 PROCESS_START_FAILED다", async () => {
    const pending = controlled();
    let settled = false;
    void pending.transport.start().then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(pending.spawnCalls).toBe(1);
    pending.child.emit("error", new Error("secret spawn failure"));
    await expect(pending.transport.start()).rejects.toMatchObject({
      code: "PROCESS_START_FAILED",
      phase: "spawn",
    });
    expect(pending.child.listenerCount("spawn")).toBe(0);
    expect(pending.child.kills).toEqual(["SIGKILL"]);
    pending.child.close();
  });

  it("synchronous spawn throw는 PROCESS_START_FAILED로 reject되고 child cleanup을 만들지 않는다", async () => {
    const transport = new NodeControlledStdioTransport(
      resolveConnectOptions({ command: "node" }),
      (() => {
        throw new Error("spawn throw");
      }) as never,
    );
    await expect(transport.start()).rejects.toMatchObject({
      code: "PROCESS_START_FAILED",
      phase: "spawn",
    });
    await expect(transport.forceClose()).resolves.toBeUndefined();
  });

  it("forceClose 뒤 late spawn은 transport handshake를 시작하지 않는다", async () => {
    const { transport, child } = controlled();
    const started = transport.start();
    const forced = transport.forceClose();
    child.emit("spawn");
    expect(transport.state).toBe("forceClosing");
    child.close();
    await forced;
    await expect(started).rejects.toMatchObject({ code: "PROCESS_START_FAILED", phase: "spawn" });
  });

  it("controlled transport onclose는 process close 전에는 0회이고 error/close 경쟁에도 한 번이다", async () => {
    const { transport, child } = controlled();
    let closed = 0;
    transport.onclose = () => {
      closed += 1;
    };
    const started = transport.start();
    child.emit("spawn");
    await started;
    child.emit("error", new Error("transport error"));
    expect(closed).toBe(0);
    child.close();
    child.close();
    expect(closed).toBe(1);
  });

  it("stdout framing 오류는 TRANSPORT_FAILED이고 stderr는 nonfatal snapshot이다", async () => {
    const { transport, child } = controlled();
    const errors: Error[] = [];
    transport.onerror = (error) => errors.push(error);
    const started = transport.start();
    child.emit("spawn");
    await started;
    child.stderr.emit("data", Buffer.from("abcdef"));
    expect(transport.getDiagnostics().stderr).toBe("abcdef");
    child.stdout.emit("data", Buffer.from("not-json\n"));
    expect(errors[0]).toMatchObject({ code: "TRANSPORT_FAILED", phase: "transport" });
    expect(child.kills).toEqual(["SIGKILL"]);
    child.close();
    await transport.forceClose();
  });

  it("invalid JSON-RPC와 max bytes stdout도 각각 한 번만 fatal force close한다", async () => {
    for (const [chunk, maxMessageBytes] of [
      ["{}\n", 10],
      ["123456", 1],
    ] as const) {
      const { transport, child } = controlled(undefined, undefined, maxMessageBytes);
      const errors: Error[] = [];
      transport.onerror = (error) => errors.push(error);
      const started = transport.start();
      child.emit("spawn");
      await started;
      child.stdout.emit("data", Buffer.from(chunk));
      child.stdout.emit("data", Buffer.from(chunk));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: "TRANSPORT_FAILED", phase: "transport" });
      expect(child.kills).toEqual(["SIGKILL"]);
      child.close();
      await transport.forceClose();
    }
  });

  it("SDK safe environment만 상속하고 explicit env가 우선한다", async () => {
    const previous = process.env.PARENT_SECRET_SENTINEL;
    process.env.PARENT_SECRET_SENTINEL = "must-not-leak";
    const context = controlled();
    const started = context.transport.start();
    context.child.emit("spawn");
    await started;
    const environment = (context.spawnedOptions as { env: Record<string, string> }).env;
    expect(environment.PARENT_SECRET_SENTINEL).toBeUndefined();
    expect(environment.PATH).toBe("explicit-path");
    expect(environment.EXPLICIT).toBe("yes");
    if (previous === undefined) delete process.env.PARENT_SECRET_SENTINEL;
    else process.env.PARENT_SECRET_SENTINEL = previous;
    const closed = context.transport.forceClose();
    context.child.close();
    await closed;
  });
});

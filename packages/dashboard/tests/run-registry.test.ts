import { describe, expect, it } from "vitest";
import type { RunEvent } from "../src/api-types.js";
import { type RunIo, RunRegistry } from "../src/server/run-registry.js";

/** 마이크로태스크·타이머 큐를 한 바퀴 비운다. 백그라운드 execute가 끝날 틈을 준다. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("RunRegistry", () => {
  it("start 직후 running이고 완료 후 done이다", async () => {
    const registry = new RunRegistry();
    const gate = deferred<number>();
    const handle = registry.start("test", () => gate.promise);

    expect(handle.summary.status).toBe("running");
    expect(handle.summary.exitCode).toBeNull();
    expect(handle.summary.flow).toBe("test");
    expect(registry.get(handle.runId)).toBe(handle);
    expect(registry.list()).toHaveLength(1);

    gate.resolve(0);
    await tick();
    expect(handle.summary.status).toBe("done");
    expect(handle.summary.exitCode).toBe(0);
    expect(handle.events.at(-1)).toEqual({ kind: "done", exitCode: 0 });
  });

  it("exitCode 0이 아니면 failed다", async () => {
    const registry = new RunRegistry();
    const handle = registry.start("replay", () => Promise.resolve(3));
    await tick();
    expect(handle.summary.status).toBe("failed");
    expect(handle.summary.exitCode).toBe(3);
    expect(handle.events.at(-1)).toEqual({ kind: "done", exitCode: 3 });
  });

  it("execute가 던지면 stderr 이벤트 후 done(1)이다", async () => {
    const registry = new RunRegistry();
    const handle = registry.start("generate", () => Promise.reject(new Error("터졌다")));
    await tick();
    expect(handle.events).toEqual([
      { kind: "stderr", html: "터졌다\n" },
      { kind: "done", exitCode: 1 },
    ]);
    expect(handle.summary.status).toBe("failed");
    expect(handle.summary.exitCode).toBe(1);
  });

  it("늦은 구독자가 과거 이벤트를 전부 받는다", async () => {
    const registry = new RunRegistry();
    const gate = deferred<number>();
    let io!: RunIo;
    const handle = registry.start("repair", (injected) => {
      io = injected;
      return gate.promise;
    });
    await tick();

    io.writeStdout("하나");
    io.writeStdout("둘");
    io.writeStderr("셋");
    expect(handle.events).toEqual([
      { kind: "stdout", html: "하나" },
      { kind: "stdout", html: "둘" },
      { kind: "stderr", html: "셋" },
    ]);

    const received: RunEvent[] = [];
    handle.subscribe((event) => {
      received.push(event);
    });
    io.writeStdout("넷");
    expect(received).toEqual([{ kind: "stdout", html: "넷" }]);
    expect(handle.events).toHaveLength(4);

    gate.resolve(0);
    await tick();
  });

  it("unsubscribe 후 이벤트를 받지 않는다", async () => {
    const registry = new RunRegistry();
    const gate = deferred<number>();
    let io!: RunIo;
    const handle = registry.start("test", (injected) => {
      io = injected;
      return gate.promise;
    });
    await tick();

    const received: RunEvent[] = [];
    const unsubscribe = handle.subscribe((event) => {
      received.push(event);
    });
    io.writeStdout("보인다");
    unsubscribe();
    io.writeStdout("안 보인다");

    expect(received).toEqual([{ kind: "stdout", html: "보인다" }]);
    expect(handle.events).toHaveLength(2);

    gate.resolve(0);
    await tick();
  });
});

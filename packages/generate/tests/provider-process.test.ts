import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  type ProviderProcessChild,
  type ProviderProcessDeps,
  runProviderProcess,
} from "../src/provider-process.js";

class FakeChild extends EventEmitter implements ProviderProcessChild {
  readonly stdin = {
    writes: [] as string[],
    end: () => undefined,
    write: (value: string) => this.stdin.writes.push(value),
  };
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kills: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals) {
    this.kills.push(signal);
    return true;
  }
  close(code: number | null = 0) {
    this.emit("close", code, null);
  }
}
class Clock {
  now = 0;
  timers: { at: number; cb: () => void; active: boolean }[] = [];
  setTimeout = (cb: () => void, ms: number) => {
    const timer = { at: this.now + ms, cb, active: true };
    this.timers.push(timer);
    return {
      unref() {},
      cancel: () => {
        timer.active = false;
      },
    };
  };
  advance(ms: number) {
    this.now += ms;
    for (const timer of [...this.timers])
      if (timer.active && timer.at <= this.now) {
        timer.active = false;
        timer.cb();
      }
  }
}
function setup() {
  const child = new FakeChild();
  const clock = new Clock();
  const calls: unknown[] = [];
  const removed: string[] = [];
  const deps: ProviderProcessDeps = {
    spawn: (...args) => {
      calls.push(args);
      return child;
    },
    mkdtemp: async () => "/empty/provider",
    rm: async (path) => {
      removed.push(path);
    },
    clock,
  };
  return { child, clock, calls, removed, deps };
}
const spec = {
  command: "fake",
  args: ["run"],
  stdin: '{"ok":true}',
  timeoutMs: 10,
  env: { PATH: "/bin" },
  cwdPrefix: "/empty/",
  maxOutputBytes: 262_144,
} as const;

describe("provider process", () => {
  it("stdout byte 상한을 parse 전에 적용한다", async () => {
    const s = setup();
    const done = runProviderProcess(spec, s.deps);
    await Promise.resolve();
    s.child.stdout.emit("data", Buffer.alloc(262_145, 97));
    await expect(done).resolves.toMatchObject({ ok: false, code: "outputLimitExceeded" });
    expect(s.child.kills).toEqual(["SIGTERM"]);
  });
  it("chunk UTF-8 상태와 final flush를 검증한다", async () => {
    const s = setup();
    const good = runProviderProcess(spec, s.deps);
    await Promise.resolve();
    const bytes = Buffer.from('{"city":"서울"}');
    s.child.stdout.emit("data", bytes.subarray(0, 11));
    s.child.stdout.emit("data", bytes.subarray(11));
    s.child.close();
    await expect(good).resolves.toMatchObject({ ok: true, value: { city: "서울" } });
    const bad = setup();
    const invalid = runProviderProcess(spec, bad.deps);
    await Promise.resolve();
    bad.child.stdout.emit("data", Buffer.from([0xc3]));
    bad.child.close();
    await expect(invalid).resolves.toMatchObject({ ok: false, code: "invalidUtf8" });
  });
  it("timeout과 cancel을 bounded 종료한다", async () => {
    const s = setup();
    const controller = new AbortController();
    const pending = runProviderProcess({ ...spec, signal: controller.signal }, s.deps);
    await Promise.resolve();
    controller.abort();
    s.clock.advance(10);
    expect(s.child.kills).toEqual(["SIGTERM"]);
    s.clock.advance(1_000);
    expect(s.child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    s.clock.advance(1_000);
    await expect(pending).resolves.toMatchObject({ ok: false, code: "cancelled" });
    const pre = setup();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      runProviderProcess({ ...spec, signal: aborted.signal }, pre.deps),
    ).resolves.toMatchObject({ code: "cancelled" });
    expect(pre.calls).toHaveLength(0);
  });
  it("active cwd는 child가 닫히기 전에 삭제하지 않는다", async () => {
    const s = setup();
    const done = runProviderProcess(spec, s.deps);
    await Promise.resolve();
    s.clock.advance(10);
    s.clock.advance(1_000);
    s.clock.advance(1_000);
    await done;
    expect(s.removed).toEqual([]);
    s.child.close();
    await Promise.resolve();
    expect(s.removed).toEqual(["/empty/provider"]);
  });
  it("nonzero invalid JSON schema mismatch를 안전하게 구분한다", async () => {
    const nonzero = setup();
    const one = runProviderProcess(spec, nonzero.deps);
    await Promise.resolve();
    nonzero.child.stderr.emit("data", Buffer.from("SECRET"));
    nonzero.child.close(7);
    await expect(one).resolves.toEqual({
      ok: false,
      code: "nonZeroExit",
      exitCode: 7,
      stderr: { captured: true, truncated: false },
    });
    const invalid = setup();
    const two = runProviderProcess(spec, invalid.deps);
    await Promise.resolve();
    invalid.child.stdout.emit("data", Buffer.from("not json"));
    invalid.child.close();
    await expect(two).resolves.toMatchObject({ code: "invalidJson" });
  });
  it("timeout·취소 뒤 늦은 settlement를 관찰한다", async () => {
    const s = setup();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const done = runProviderProcess(spec, s.deps);
      await Promise.resolve();
      s.clock.advance(10);
      s.clock.advance(2_000);
      const result = await done;
      s.child.emit("error", new Error("late"));
      s.child.close();
      await Promise.resolve();
      expect(unhandled).toEqual([]);
      expect(result).toMatchObject({ code: "timedOut" });
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

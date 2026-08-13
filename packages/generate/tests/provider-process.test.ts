import { EventEmitter } from "node:events";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ProviderProcessChild,
  type ProviderProcessDeps,
  runProviderProcess,
} from "../src/provider-process.js";

class FakeStdin extends EventEmitter {
  readonly writes: string[] = [];
  end() {
    return undefined;
  }
  write(value: string) {
    return this.writes.push(value);
  }
}
class FakeChild extends EventEmitter implements ProviderProcessChild {
  readonly stdin = new FakeStdin();
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
  const written: { path: string; contents: string }[] = [];
  const deps: ProviderProcessDeps = {
    spawn: (...args) => {
      calls.push(args);
      return child;
    },
    mkdtemp: async () => "/empty/provider",
    rm: async (path) => {
      removed.push(path);
    },
    writeFile: async (path, contents) => {
      written.push({ path, contents });
    },
    clock,
  };
  return { child, clock, calls, removed, written, deps };
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
  it("실행 cwd와 Codex schema 파일을 child 종료 뒤 함께 정리한다", async () => {
    const s = setup();
    const done = runProviderProcess(
      {
        ...spec,
        args: (cwd: string) => ["--output-schema", `${cwd}/authoring-output-schema.json`],
        files: [{ name: "authoring-output-schema.json", contents: '{"type":"object"}' }],
      },
      s.deps,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(s.calls[0]).toMatchObject([
      "fake",
      ["--output-schema", "/empty/provider/authoring-output-schema.json"],
      { cwd: "/empty/provider" },
    ]);
    expect(s.written).toEqual([
      {
        path: join("/empty/provider", "authoring-output-schema.json"),
        contents: '{"type":"object"}',
      },
    ]);
    s.child.close();
    await done;
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
  it("classifyFailure가 없으면 stderr 내용을 보관하지 않는다", async () => {
    const s = setup();
    const done = runProviderProcess(spec, s.deps);
    await Promise.resolve();
    s.child.stderr.emit("data", Buffer.from('ERROR: {"status":404}'));
    s.child.close(1);
    const result = await done;
    expect(result).toMatchObject({ ok: false, code: "nonZeroExit", exitCode: 1 });
    expect("reason" in result).toBe(false);
  });
  it("비정상 종료 시 classifyFailure 결과를 reason으로 올린다", async () => {
    const s = setup();
    const seen: { stdout: string; stderr: string }[] = [];
    const done = runProviderProcess(
      {
        ...spec,
        classifyFailure: (streams) => {
          seen.push({ ...streams });
          return "unknownModel";
        },
      },
      s.deps,
    );
    await Promise.resolve();
    s.child.stderr.emit("data", Buffer.from("boom"));
    s.child.close(1);
    await expect(done).resolves.toMatchObject({
      ok: false,
      code: "nonZeroExit",
      exitCode: 1,
      reason: "unknownModel",
    });
    expect(seen).toEqual([{ stdout: "", stderr: "boom" }]);
  });
  it("classifyFailure가 undefined를 주면 reason이 없다", async () => {
    const s = setup();
    const done = runProviderProcess({ ...spec, classifyFailure: () => undefined }, s.deps);
    await Promise.resolve();
    s.child.close(1);
    const result = await done;
    expect(result).toMatchObject({ ok: false, code: "nonZeroExit" });
    expect("reason" in result).toBe(false);
  });
  it("정상 종료에는 classifyFailure를 부르지 않는다", async () => {
    const s = setup();
    let calls = 0;
    const done = runProviderProcess(
      {
        ...spec,
        classifyFailure: () => {
          calls++;
          return "serverError";
        },
      },
      s.deps,
    );
    await Promise.resolve();
    s.child.stdout.emit("data", Buffer.from('{"ok":true}'));
    s.child.close(0);
    await expect(done).resolves.toMatchObject({ ok: true, value: { ok: true } });
    expect(calls).toBe(0);
  });
  it("stderr는 마지막 8KB만 분류에 넘긴다", async () => {
    const s = setup();
    let received = "";
    const done = runProviderProcess(
      {
        ...spec,
        classifyFailure: (streams) => {
          received = streams.stderr;
          return undefined;
        },
      },
      s.deps,
    );
    await Promise.resolve();
    s.child.stderr.emit("data", Buffer.alloc(20_000, 97));
    s.child.stderr.emit("data", Buffer.from("TAIL_MARKER"));
    s.child.close(1);
    await done;
    expect(received.length).toBeLessThanOrEqual(8_192);
    expect(received.endsWith("TAIL_MARKER")).toBe(true);
  });
  it("settle 뒤에도 SIGTERM을 무시한 자식에게 SIGKILL을 보낸다", async () => {
    const s = setup();
    const done = runProviderProcess(spec, s.deps);
    await Promise.resolve();
    s.child.stdout.emit("data", Buffer.alloc(262_145, 97));
    await expect(done).resolves.toMatchObject({ ok: false, code: "outputLimitExceeded" });
    expect(s.child.kills).toEqual(["SIGTERM"]);
    s.clock.advance(1_000);
    expect(s.child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });
  it("자식이 이미 닫혔으면 SIGKILL을 보내지 않는다", async () => {
    const s = setup();
    const done = runProviderProcess(spec, s.deps);
    await Promise.resolve();
    s.clock.advance(10);
    expect(s.child.kills).toEqual(["SIGTERM"]);
    s.child.close(1);
    await done;
    s.clock.advance(1_000);
    expect(s.child.kills).toEqual(["SIGTERM"]);
  });
  it("stdin 쓰기 오류가 나면 정상 종료와 유효한 JSON도 성공으로 보지 않는다", async () => {
    const s = setup();
    const unhandled: unknown[] = [];
    const onUnhandled = (value: unknown) => unhandled.push(value);
    process.on("unhandledRejection", onUnhandled);
    try {
      const done = runProviderProcess(spec, s.deps);
      await Promise.resolve();
      s.child.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      s.child.stdout.emit("data", Buffer.from('{"ok":true}'));
      s.child.close(0);
      await expect(done).resolves.toMatchObject({ ok: false, code: "internal" });
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
  it("stdin 쓰기 오류 뒤 비정상 종료도 internal로 보고한다", async () => {
    const s = setup();
    const done = runProviderProcess(spec, s.deps);
    await Promise.resolve();
    s.child.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    s.child.close(1);
    await expect(done).resolves.toMatchObject({ ok: false, code: "internal" });
  });
  it("stdin 쓰기 오류 뒤 살아 있는 자식에게 종료 신호를 보낸다", async () => {
    const s = setup();
    const done = runProviderProcess(spec, s.deps);
    await Promise.resolve();
    s.child.stdin.emit("error", new Error("write EPIPE"));
    expect(s.child.kills).toEqual(["SIGTERM"]);
    s.clock.advance(1_000);
    expect(s.child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    s.clock.advance(1_000);
    await expect(done).resolves.toMatchObject({ ok: false, code: "internal" });
  });
  it("stdin 쓰기 오류가 없으면 invalidUtf8·invalidJson 판정이 그대로다", async () => {
    const badJson = setup();
    const one = runProviderProcess(spec, badJson.deps);
    await Promise.resolve();
    badJson.child.stdout.emit("data", Buffer.from("not json"));
    badJson.child.close(0);
    await expect(one).resolves.toMatchObject({ ok: false, code: "invalidJson" });
    const badUtf8 = setup();
    const two = runProviderProcess(spec, badUtf8.deps);
    await Promise.resolve();
    badUtf8.child.stdout.emit("data", Buffer.from([0xc3]));
    badUtf8.child.close(0);
    await expect(two).resolves.toMatchObject({ ok: false, code: "invalidUtf8" });
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

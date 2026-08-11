import { describe, expect, it } from "vitest";
import { resolveConnectOptions } from "../src/options.js";

describe("resolveConnectOptions", () => {
  it("연결 옵션 기본값을 결정론적으로 채운다", () => {
    expect(resolveConnectOptions({ command: "node" })).toEqual({
      command: "node",
      args: [],
      env: {},
      connectTimeoutMs: 10_000,
      maxMessageBytes: 10 * 1024 * 1024,
      maxStderrBytes: 64 * 1024,
    });
  });

  it("잘못된 구조를 process 시작 전에 거절한다", () => {
    const invalid = [
      [{ command: "" }, "command"],
      [{ command: "node", args: ["ok", 1] }, "args[1]"],
      [{ command: "node", env: { OK: 1 } }, "env.OK"],
      [{ command: "node", cwd: "" }, "cwd"],
      [{ command: "node", extra: true }, "extra"],
      [{ command: "node", env: [] }, "env"],
      [{ command: "node", args: { 0: "x" } }, "args"],
    ] as const;

    for (const [options, path] of invalid) {
      expect(() => resolveConnectOptions(options as never)).toThrow(TypeError);
      expect(() => resolveConnectOptions(options as never)).toThrow(path);
    }
  });

  it("Object.prototype 또는 null prototype plain object만 허용한다", () => {
    const nullPrototypeEnv = Object.assign(Object.create(null), { TOKEN: "ok" });
    expect(resolveConnectOptions({ command: "node", env: nullPrototypeEnv }).env).toEqual({
      TOKEN: "ok",
    });
    expect(() => resolveConnectOptions(Object.create({ command: "node" }))).toThrow(TypeError);
    expect(() => resolveConnectOptions({ command: "node", env: new Map() as never })).toThrow(
      TypeError,
    );
  });

  it("지원하지 않는 Windows command를 시작 전에 거절한다", () => {
    for (const command of ["tool.cmd", "TOOL.BAT"]) {
      expect(() => resolveConnectOptions({ command }, "win32")).toThrow(TypeError);
    }
  });

  it("수치 옵션 경계를 검증한다", () => {
    const limits = [
      ["connectTimeoutMs", 60_000],
      ["maxMessageBytes", 64 * 1024 * 1024],
      ["maxStderrBytes", 1024 * 1024],
    ] as const;
    for (const [key, max] of limits) {
      for (const value of [0, Number.NaN, Infinity, -Infinity, -1, 1.5, max + 1]) {
        expect(() => resolveConnectOptions({ command: "node", [key]: value })).toThrow(RangeError);
      }
      expect(resolveConnectOptions({ command: "node", [key]: 1 })[key]).toBe(1);
      expect(resolveConnectOptions({ command: "node", [key]: max })[key]).toBe(max);
    }
  });

  it("연결 옵션을 immutable snapshot으로 복사한다", () => {
    const args = ["server.mjs"];
    const env = { TOKEN: "before" };
    const resolved = resolveConnectOptions({ command: "node", args, env });
    args[0] = "changed.mjs";
    env.TOKEN = "after";
    expect(resolved.args).toEqual(["server.mjs"]);
    expect(resolved.env).toEqual({ TOKEN: "before" });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.args)).toBe(true);
    expect(Object.isFrozen(resolved.env)).toBe(true);
  });
});

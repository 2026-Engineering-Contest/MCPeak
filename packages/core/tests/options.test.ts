import { describe, expect, it } from "vitest";
import {
  isHttpConnectOptions,
  resolveConnectOptions,
  resolveHttpConnectOptions,
} from "../src/options.js";

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

describe("resolveHttpConnectOptions", () => {
  const URL_BASE = "http://127.0.0.1:8080/mcp";

  it("HTTP 옵션 기본값을 결정론적으로 채운다", () => {
    expect(resolveHttpConnectOptions({ url: URL_BASE })).toEqual({
      url: URL_BASE,
      headers: {},
      connectTimeoutMs: 10_000,
    });
  });

  it("HTTP 옵션을 immutable snapshot으로 복사한다", () => {
    const headers = { "x-token": "before" };
    const resolved = resolveHttpConnectOptions({ url: URL_BASE, headers });
    headers["x-token"] = "after";
    expect(resolved.headers).toEqual({ "x-token": "before" });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.headers)).toBe(true);
  });

  it("잘못된 구조를 socket 연결 전에 거절한다", () => {
    const invalid = [
      [{ url: "" }, "url"],
      [{ url: "not a url" }, "url"],
      [{ url: "ftp://host/mcp" }, "http or https"],
      [{ url: "http://user:pw@host/mcp" }, "credentials"],
      [{ url: "http://host/mcp#frag" }, "fragment"],
      [{ url: "http://host/mcp", headers: { "bad key": "v" } }, "HTTP token"],
      [{ url: "http://host/mcp", headers: { "x-a": "v\r\nInjected: 1" } }, "control characters"],
      [
        { url: "http://host/mcp", headers: { Authorization: "a", authorization: "b" } },
        "duplicate key",
      ],
      [{ url: "http://host/mcp", headers: { "x-a": 1 } }, "x-a"],
      [{ url: "http://host/mcp", headers: [] }, "headers"],
      [{ url: "http://host/mcp", cwd: "/tmp" }, "cwd is not supported"],
      [{ command: "node", url: "http://host/mcp" }, "exactly one of command or url"],
      [{}, "exactly one of command or url"],
    ] as const;

    for (const [options, path] of invalid) {
      expect(() => resolveHttpConnectOptions(options as never)).toThrow(TypeError);
      expect(() => resolveHttpConnectOptions(options as never)).toThrow(path);
    }
  });

  it("transport를 고를 수 없는 입력을 stdio 경로에서도 거절한다", () => {
    expect(() => resolveConnectOptions({} as never)).toThrow("exactly one of command or url");
    expect(() => resolveConnectOptions({ command: "node", url: URL_BASE } as never)).toThrow(
      "exactly one of command or url",
    );
  });

  it("connectTimeoutMs 경계를 stdio와 같은 규칙으로 검증한다", () => {
    for (const value of [0, Number.NaN, Infinity, -1, 1.5, 60_001]) {
      expect(() => resolveHttpConnectOptions({ url: URL_BASE, connectTimeoutMs: value })).toThrow(
        RangeError,
      );
    }
    expect(resolveHttpConnectOptions({ url: URL_BASE, connectTimeoutMs: 1 }).connectTimeoutMs).toBe(
      1,
    );
    expect(
      resolveHttpConnectOptions({ url: URL_BASE, connectTimeoutMs: 60_000 }).connectTimeoutMs,
    ).toBe(60_000);
  });

  it("헤더 키를 소문자로 정규화한다", () => {
    const resolved = resolveHttpConnectOptions({
      url: URL_BASE,
      headers: { Authorization: "Bearer x" },
    });
    expect(Object.keys(resolved.headers)).toEqual(["authorization"]);
    expect(resolved.headers.authorization).toBe("Bearer x");
  });

  it("헤더 값을 오류 메시지에 싣지 않는다", () => {
    const secret = "Bearer super-secret\r\n";
    let message = "";
    try {
      resolveHttpConnectOptions({ url: URL_BASE, headers: { "x-a": secret } });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("x-a");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("\r\n");
  });

  it("url 로 transport 를 판정한다", () => {
    expect(isHttpConnectOptions({ command: "node" })).toBe(false);
    expect(isHttpConnectOptions({ url: URL_BASE })).toBe(true);
  });
});

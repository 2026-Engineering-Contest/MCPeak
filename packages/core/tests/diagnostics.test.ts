import { describe, expect, it } from "vitest";
import {
  BoundedStderr,
  createDiagnosticsSnapshot,
  createHttpDiagnosticsSnapshot,
} from "../src/diagnostics.js";

describe("BoundedStderr", () => {
  it("stderr 최근 byte만 보존한다", () => {
    const stderr = new BoundedStderr(4);
    stderr.append(Buffer.from("abcdef"));
    expect(stderr.snapshot(null, null)).toMatchObject({ stderr: "cdef", stderrTruncated: true });
  });

  it("UTF-8 byte 경계도 안전한 문자열을 반환한다", () => {
    const stderr = new BoundedStderr(2);
    stderr.append(Buffer.from("가", "utf8"));
    expect(stderr.snapshot(null, null).stderr).toContain("�");
  });

  it("진단 snapshot은 호출마다 새 frozen 값이다", () => {
    const stderr = new BoundedStderr(8);
    stderr.append(Buffer.from("one"));
    const first = stderr.snapshot(0, null);
    const second = stderr.snapshot(0, null);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => Object.assign(first, { stderr: "changed" })).toThrow();
    expect(second.stderr).toBe("one");
  });
});

describe("진단 snapshot", () => {
  it("stdio snapshot은 transport stdio와 기존 네 field를 담는다", () => {
    expect(createDiagnosticsSnapshot("boom", true, 3, "SIGTERM")).toEqual({
      transport: "stdio",
      stderr: "boom",
      stderrTruncated: true,
      exitCode: 3,
      signal: "SIGTERM",
    });
  });

  it("BoundedStderr snapshot에도 transport stdio가 붙는다", () => {
    const stderr = new BoundedStderr(8);
    stderr.append(Buffer.from("one"));
    expect(stderr.snapshot(0, null)).toEqual({
      transport: "stdio",
      stderr: "one",
      stderrTruncated: false,
      exitCode: 0,
      signal: null,
    });
  });

  it("http snapshot은 transport http와 URL, 상태, session id를 담는다", () => {
    const snapshot = createHttpDiagnosticsSnapshot("http://h/mcp", 404, "Not Found", "s1");
    expect(snapshot).toEqual({
      transport: "http",
      url: "http://h/mcp",
      status: 404,
      statusText: "Not Found",
      sessionId: "s1",
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => Object.assign(snapshot, { url: "http://other/mcp" })).toThrow();
  });
});

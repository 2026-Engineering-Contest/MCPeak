import { describe, expect, it } from "vitest";
import { BoundedStderr } from "../src/diagnostics.js";

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

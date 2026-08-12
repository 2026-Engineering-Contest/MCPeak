import { describe, expect, it, vi } from "vitest";
import { COMMANDS, run } from "../src/index.js";

describe("ohmymcp cli", () => {
  it("알려진 서브커맨드를 선언한다", () => {
    expect(COMMANDS).toEqual(["test", "generate", "record", "replay", "mock"]);
  });

  it("사용자 입력 오류를 reject하지 않고 종료 코드 1로 반환한다", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(run([])).resolves.toBe(1);
    } finally {
      stderr.mockRestore();
    }
  });
});

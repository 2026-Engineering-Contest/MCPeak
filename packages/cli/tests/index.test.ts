import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("동적 Core 의존성 로드 실패를 안전한 내부 오류로 정규화한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ohmymcp-index-"));
    const suite = join(directory, "suite.json");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.doMock("@ohmymcp/core", () => {
      throw new Error("DYNAMIC_IMPORT_SECRET_STACK");
    });
    try {
      await writeFile(suite, "{}", "utf8");
      await expect(run(["test", suite, "--command", "node"])).resolves.toBe(1);
      expect(stderr.mock.calls.map(([text]) => String(text)).join("")).toBe(
        "오류 [CLI_INTERNAL_ERROR]: 예상하지 못한 CLI 내부 오류가 발생했습니다.\n해결: 다시 실행한 뒤 재현 정보와 함께 이슈를 보고하세요.\n",
      );
    } finally {
      vi.doUnmock("@ohmymcp/core");
      stderr.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("generate 의존성 로드 실패를 raw 오류 없이 정규화한다", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.doMock("@ohmymcp/generate", () => {
      throw new Error("GENERATE_DYNAMIC_SECRET_STACK");
    });
    try {
      await expect(
        run([
          "generate",
          "--suite-id",
          "weather",
          "--name",
          "Weather",
          "--out",
          "suite.json",
          "--command",
          "node",
          "--baseline-only",
        ]),
      ).resolves.toBe(1);
      expect(stderr.mock.calls.map(([text]) => String(text)).join("")).not.toContain(
        "GENERATE_DYNAMIC_SECRET_STACK",
      );
    } finally {
      vi.doUnmock("@ohmymcp/generate");
      stderr.mockRestore();
    }
  });
});

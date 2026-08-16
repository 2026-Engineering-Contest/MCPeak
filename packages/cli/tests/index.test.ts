import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json";
import type { GenerateCommandDependencies } from "../src/generate-command.js";
import { COMMANDS, run } from "../src/index.js";

type OptionalKey<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];

type OptionalFunctionDependencyKey = {
  [K in OptionalKey<GenerateCommandDependencies>]: NonNullable<
    GenerateCommandDependencies[K]
  > extends (...args: never[]) => unknown
    ? K
    : never;
}[OptionalKey<GenerateCommandDependencies>];

const OPTIONAL_GENERATE_DEPENDENCIES = {
  prepareAuthoringRequest: true,
  dispatchAuthoringRequest: true,
  createAuthoringDiff: true,
  applyAuthoringChanges: true,
  reviewLocalAuthoringCandidate: true,
  computeCoverage: true,
} as const satisfies Record<OptionalFunctionDependencyKey, true>;

describe("ohmymcp cli", () => {
  it("알려진 서브커맨드를 선언한다", () => {
    expect(COMMANDS).toEqual(["test", "generate", "record", "replay", "mock"]);
  });

  it("사용자 입력 오류를 reject하지 않고 종료 코드 1로 반환한다", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(run(["unknown"])).resolves.toBe(1);
    } finally {
      stderr.mockRestore();
    }
  });

  it.each([[[]], [["--help"]], [["-h"]], [["help"]]])(
    "%j 는 전체 도움말을 stdout 에 쓰고 성공한다",
    async (argv) => {
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        await expect(run(argv)).resolves.toBe(0);
        const output = stdout.mock.calls.map(([text]) => String(text)).join("");
        expect(output).toContain("사용법: ohmymcp <명령> [옵션]");
        expect(output).toContain("test");
        expect(output).toContain("generate");
        expect(stderr).not.toHaveBeenCalled();
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
      }
    },
  );

  it.each([
    [["help", "test"], "ohmymcp test <suite.json>"],
    [["test", "--help"], "ohmymcp test <suite.json>"],
    [["help", "generate"], "ohmymcp generate --suite-id <id>"],
    [["generate", "--help"], "ohmymcp generate --suite-id <id>"],
  ])("%j 는 해당 서브커맨드 도움말을 stdout 에 쓴다", async (argv, expected) => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(run(argv)).resolves.toBe(0);
      expect(stdout.mock.calls.map(([text]) => String(text)).join("")).toContain(expected);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("--version 은 CLI package.json 버전을 stdout 에 쓴다", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(run(["--version"])).resolves.toBe(0);
      expect(stdout).toHaveBeenCalledWith(`ohmymcp ${packageMetadata.version}\n`);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("generate 실행 경로에 선택 함수 의존성을 전부 주입한다", async () => {
    let capturedDependencies: GenerateCommandDependencies | undefined;
    vi.doMock("../src/generate-command.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/generate-command.js")>();
      return {
        ...actual,
        runGenerateCommand: vi.fn(
          async (_argv: string[], dependencies: GenerateCommandDependencies): Promise<number> => {
            capturedDependencies = dependencies;
            return 0;
          },
        ),
      };
    });

    try {
      vi.resetModules();
      const [{ run: isolatedRun }, generate] = await Promise.all([
        import("../src/index.js"),
        import("@ohmymcp/generate"),
      ]);

      await expect(isolatedRun(["generate"])).resolves.toBe(0);
      expect(capturedDependencies).toBeDefined();

      const dependencyKeys = Object.keys(
        OPTIONAL_GENERATE_DEPENDENCIES,
      ) as OptionalFunctionDependencyKey[];
      expect(
        Object.fromEntries(dependencyKeys.map((key) => [key, capturedDependencies?.[key]])),
      ).toEqual(Object.fromEntries(dependencyKeys.map((key) => [key, generate[key]])));
    } finally {
      vi.doUnmock("../src/generate-command.js");
      vi.resetModules();
    }
  });

  it("알 수 없는 명령 오류에서도 test 와 generate 를 발견할 수 있다", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(run(["unknown"])).resolves.toBe(1);
      const output = stderr.mock.calls.map(([text]) => String(text)).join("");
      expect(output).toContain("CLI_USAGE");
      expect(output).toContain("test");
      expect(output).toContain("generate");
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
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

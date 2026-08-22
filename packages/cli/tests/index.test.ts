import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json";
import type { GenerateCommandDependencies } from "../src/generate-command.js";
import {
  COMMANDS,
  nodeRepairDependencies,
  run,
  unavailableReplayDependencies,
} from "../src/index.js";
import { ReplayRuntimeUnavailableError } from "../src/replay-command.js";

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
  preparePreFillRequest: true,
  previewPreFillRequest: true,
  dispatchPreFillRequest: true,
  prepareRejectionDiagnosisRequests: true,
  dispatchRejectionDiagnosis: true,
} as const satisfies Record<OptionalFunctionDependencyKey, true>;

describe("mcpeak cli", () => {
  it("알려진 서브커맨드를 선언한다", () => {
    expect(COMMANDS).toEqual(["test", "generate", "repair", "record", "replay", "mock"]);
  });

  /**
   * 배선을 직접 단언한다. 여기가 평범한 Error 로 되돌아가면 `validateSuite` 자리에서
   * `CLI_INTERNAL_ERROR` 로 잡혀 "이슈를 보고하세요" 가 나가고, 사용자는 자기 설치 문제로
   * 버그 리포트를 쓴다. 모듈 모킹으로는 이 경로를 재현할 수 없어 배선을 직접 본다.
   */
  it("replay fallback 의존성이 런타임 미가용 전용 오류를 던진다", async () => {
    const runtime = [
      () => unavailableReplayDependencies.validateSuite({}),
      () => unavailableReplayDependencies.loadCassette("c.json"),
      () => unavailableReplayDependencies.startRunner({} as never),
      () => unavailableReplayDependencies.finalize({} as never),
      () => unavailableReplayDependencies.renderReport({} as never),
    ];
    for (const call of runtime) {
      await expect(async () => await call()).rejects.toBeInstanceOf(ReplayRuntimeUnavailableError);
    }
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
        expect(output).toContain("사용법: mcpeak <명령> [옵션]");
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
    [["help", "test"], "mcpeak test <suite.json>"],
    [["test", "--help"], "mcpeak test <suite.json>"],
    [["help", "generate"], "mcpeak generate --suite-id <id>"],
    [["generate", "--help"], "mcpeak generate --suite-id <id>"],
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
      expect(stdout).toHaveBeenCalledWith(`mcpeak ${packageMetadata.version}\n`);
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
        import("@mcpeak/generate"),
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
    const directory = await mkdtemp(join(tmpdir(), "mcpeak-index-"));
    const suite = join(directory, "suite.json");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.doMock("@mcpeak/core", () => {
      throw new Error("DYNAMIC_IMPORT_SECRET_STACK");
    });
    try {
      await writeFile(suite, "{}", "utf8");
      await expect(run(["test", suite, "--command", "node"])).resolves.toBe(1);
      expect(stderr.mock.calls.map(([text]) => String(text)).join("")).toBe(
        "오류 [CLI_INTERNAL_ERROR]: 예상하지 못한 CLI 내부 오류가 발생했습니다.\n해결: 다시 실행한 뒤 재현 정보와 함께 이슈를 보고하세요.\n",
      );
    } finally {
      vi.doUnmock("@mcpeak/core");
      stderr.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("generate 의존성 로드 실패를 raw 오류 없이 정규화한다", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.doMock("@mcpeak/generate", () => {
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
      vi.doUnmock("@mcpeak/generate");
      stderr.mockRestore();
    }
  });

  /**
   * 확인 화면이 실사용에서 뜨려면 `reviewIO` 가 주입돼 있어야 한다. 분기 안에 리터럴로 두면
   * 빠뜨려도 아무 테스트가 안 깨진다. 실제로 한 번 빠뜨렸으므로 주입 자체를 단언한다.
   */
  it("repair 의존성에 reviewIO 와 진단 통로가 모두 들어 있다", () => {
    const generate = {
      prepareDiagnosisRequest: () => undefined,
      dispatchDiagnosisRequest: async () => undefined,
      createCodexProvider: () => undefined,
      createClaudeProvider: () => undefined,
    } as unknown as typeof import("@mcpeak/generate");
    const dependencies = nodeRepairDependencies(generate);
    try {
      expect(dependencies.reviewIO).toBeDefined();
      expect(typeof dependencies.reviewIO?.confirm).toBe("function");
      expect(typeof dependencies.reviewIO?.interactive).toBe("boolean");
      expect(dependencies.diagnosis).toBeDefined();
      expect(typeof dependencies.diagnosis?.providers.codex).toBe("function");
    } finally {
      dependencies.reviewIO?.close?.();
    }
  });
});

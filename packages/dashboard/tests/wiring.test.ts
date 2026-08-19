import { describe, expect, it, vi } from "vitest";
import type { RunEventInput } from "../src/api-types.js";
import { WebReviewIO } from "../src/server/review-bridge.js";
import type { RunIo } from "../src/server/run-registry.js";
import { executeFlow } from "../src/server/wiring.js";

/** wiring.ts가 조립 결과를 검사할 수 있도록 캡처만 하고 아무 것도 하지 않는 IO. */
function fakeIo(): RunIo {
  const events: RunEventInput[] = [];
  return {
    writeStdout: (text) => {
      events.push({ kind: "stdout", html: text });
    },
    writeStderr: (text) => {
      events.push({ kind: "stderr", html: text });
    },
    reviewIO: new WebReviewIO((event) => {
      events.push(event);
    }),
  };
}

function fakeCoreModule(): typeof import("@ohmymcp-hsu/core") {
  return { connectStdio: vi.fn() } as unknown as typeof import("@ohmymcp-hsu/core");
}

function fakeRunnerModule(): typeof import("@ohmymcp-hsu/runner") {
  return {
    validateMcpSuite: vi.fn(),
    runSuite: vi.fn(),
    finalizeRunnerExecution: vi.fn(),
    renderReport: vi.fn(),
    renderJUnit: vi.fn(),
  } as unknown as typeof import("@ohmymcp-hsu/runner");
}

function fakeRecordModule(): typeof import("@ohmymcp-hsu/record") {
  return { loadCassette: vi.fn() } as unknown as typeof import("@ohmymcp-hsu/record");
}

function fakeGenerateModule(): typeof import("@ohmymcp-hsu/generate") {
  const noop = vi.fn();
  return {
    createBaselineSuite: noop,
    createAuthoringSession: noop,
    finalizeAuthoringDraft: noop,
    getAuthoringExecutionSuite: noop,
    createCodexAuthoringProvider: noop,
    createClaudeAuthoringProvider: noop,
    prepareAuthoringRequest: noop,
    dispatchAuthoringRequest: noop,
    createAuthoringDiff: noop,
    applyAuthoringChanges: noop,
    reviewLocalAuthoringCandidate: noop,
    computeCoverage: noop,
    preparePreFillRequest: noop,
    previewPreFillRequest: noop,
    dispatchPreFillRequest: noop,
    createCodexProvider: noop,
    createClaudeProvider: noop,
    prepareRejectionDiagnosisRequests: noop,
    dispatchRejectionDiagnosis: noop,
    GenerateTestsError: class GenerateTestsError extends Error {},
  } as unknown as typeof import("@ohmymcp-hsu/generate");
}

/** `TestCommandDependencies`의 필수(비선택) 키 전량. `packages/cli/src/test-command.ts` 참조. */
const TEST_COMMAND_REQUIRED_KEYS = [
  "readFile",
  "validateSuite",
  "connect",
  "startRunner",
  "finalize",
  "renderReport",
  "renderJUnit",
  "writeFile",
  "colorEnabled",
  "writeStdout",
  "writeStderr",
].sort();

describe("wiring.ts executeFlow", () => {
  it("test 플로우가 cli와 같은 의존성 항목을 조립한다", async () => {
    let capturedDeps: Record<string, unknown> | undefined;
    const io = fakeIo();

    await executeFlow({ flow: "test", argv: ["test", "suite.json"] }, io, {
      runners: {
        test: async (_argv, deps) => {
          capturedDeps = deps as unknown as Record<string, unknown>;
          return 0;
        },
      },
      loaders: {
        loadCore: () => Promise.resolve(fakeCoreModule()),
        loadRunner: () => Promise.resolve(fakeRunnerModule()),
      },
    });

    expect(capturedDeps).toBeDefined();
    expect(Object.keys(capturedDeps ?? {}).sort()).toEqual(TEST_COMMAND_REQUIRED_KEYS);
  });

  it("IO 3필드만 교체되고 나머지는 실함수다", async () => {
    let capturedDeps: Record<string, unknown> | undefined;
    const io = fakeIo();

    await executeFlow({ flow: "generate", argv: ["generate", "--baseline-only"] }, io, {
      runners: {
        generate: async (_argv, deps) => {
          capturedDeps = deps as unknown as Record<string, unknown>;
          return 0;
        },
      },
      loaders: {
        loadCore: () => Promise.resolve(fakeCoreModule()),
        loadRunner: () => Promise.resolve(fakeRunnerModule()),
        loadGenerate: () => Promise.resolve(fakeGenerateModule()),
      },
    });

    expect(capturedDeps).toBeDefined();
    const deps = capturedDeps ?? {};
    // 교체 대상 3필드: 주입한 io의 것 그대로다.
    expect(deps.writeStdout).toBe(io.writeStdout);
    expect(deps.writeStderr).toBe(io.writeStderr);
    expect(deps.reviewIO).toBe(io.reviewIO);
    // 나머지는 nodeGenerateDependencies()·모듈이 준 실함수다(자리표시자가 아니다).
    expect(typeof deps.exists).toBe("function");
    expect(typeof deps.openTemp).toBe("function");
    expect(typeof deps.readFile).toBe("function");
    expect(typeof deps.link).toBe("function");
    expect(typeof deps.unlink).toBe("function");
    expect(typeof deps.connect).toBe("function");
    expect(typeof deps.createBaselineSuite).toBe("function");
    expect(typeof deps.validateSuite).toBe("function");
  });

  it("test 플로우 실행이 generate 모듈을 로드하지 않는다", async () => {
    const loadGenerateSpy = vi.fn(() => Promise.resolve(fakeGenerateModule()));
    const io = fakeIo();

    await executeFlow({ flow: "test", argv: ["test", "suite.json"] }, io, {
      runners: {
        test: async () => 0,
      },
      loaders: {
        loadCore: () => Promise.resolve(fakeCoreModule()),
        loadRunner: () => Promise.resolve(fakeRunnerModule()),
        loadGenerate: loadGenerateSpy,
      },
    });

    expect(loadGenerateSpy).not.toHaveBeenCalled();
  });

  it("test 플로우가 서브커맨드 없는 argv를 받는다", async () => {
    let capturedArgv: readonly string[] | undefined;
    const io = fakeIo();

    await executeFlow({ flow: "test", argv: ["suite.json", "--json"] }, io, {
      runners: {
        test: async (argv) => {
          capturedArgv = argv;
          return 0;
        },
      },
      loaders: {
        loadCore: () => Promise.resolve(fakeCoreModule()),
        loadRunner: () => Promise.resolve(fakeRunnerModule()),
      },
    });

    expect(capturedArgv).toEqual(["test", "suite.json", "--json"]);
  });

  it("test 플로우가 서브커맨드 있는 argv도 받는다", async () => {
    let capturedArgv: readonly string[] | undefined;
    const io = fakeIo();

    await executeFlow({ flow: "test", argv: ["test", "suite.json", "--json"] }, io, {
      runners: {
        test: async (argv) => {
          capturedArgv = argv;
          return 0;
        },
      },
      loaders: {
        loadCore: () => Promise.resolve(fakeCoreModule()),
        loadRunner: () => Promise.resolve(fakeRunnerModule()),
      },
    });

    expect(capturedArgv).toEqual(["test", "suite.json", "--json"]);
  });

  it("replay 플로우가 서브커맨드 없는 argv에서 스위트 경로를 보존한다", async () => {
    const captured: (readonly string[])[] = [];
    const io = fakeIo();
    const loaders = {
      loadRunner: () => Promise.resolve(fakeRunnerModule()),
      loadRecord: () => Promise.resolve(fakeRecordModule()),
    };
    const runners = {
      replay: async (argv: readonly string[]) => {
        captured.push(argv);
        return 0;
      },
    };

    await executeFlow({ flow: "replay", argv: ["suite.json", "--cassette", "c.json"] }, io, {
      runners,
      loaders,
    });
    // cli 형태(서브커맨드 포함)도 같은 자리로 수렴한다.
    await executeFlow(
      { flow: "replay", argv: ["replay", "suite.json", "--cassette", "c.json"] },
      io,
      { runners, loaders },
    );

    expect(captured[0]).toEqual(["suite.json", "--cassette", "c.json"]);
    expect(captured[1]).toEqual(["suite.json", "--cassette", "c.json"]);
  });
});

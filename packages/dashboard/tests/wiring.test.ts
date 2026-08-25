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

function fakeCoreModule(): typeof import("@mcpeak/core") {
  return {
    connectStdio: vi.fn(),
    connectHttp: vi.fn(),
  } as unknown as typeof import("@mcpeak/core");
}

function fakeRunnerModule(): typeof import("@mcpeak/runner") {
  return {
    validateMcpSuite: vi.fn(),
    runSuite: vi.fn(),
    finalizeRunnerExecution: vi.fn(),
    renderReport: vi.fn(),
    renderJUnit: vi.fn(),
  } as unknown as typeof import("@mcpeak/runner");
}

function fakeGenerateModule(): typeof import("@mcpeak/generate") {
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
  } as unknown as typeof import("@mcpeak/generate");
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

/**
 * 원격(Streamable HTTP) 대상용 선택 키. `TestCommandDependencies` 에서는 선택이지만
 * 정상 경로는 cli `index.ts` 와 같이 둘 다 배선한다(설계 §6-5).
 */
const TEST_COMMAND_HTTP_KEYS = ["connectHttp", "readEnv"];

const TEST_COMMAND_WIRED_KEYS = [...TEST_COMMAND_REQUIRED_KEYS, ...TEST_COMMAND_HTTP_KEYS].sort();

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
    expect(Object.keys(capturedDeps ?? {}).sort()).toEqual(TEST_COMMAND_WIRED_KEYS);
  });

  it("test 플로우 의존성에 connectHttp 가 core.connectHttp 로 들어간다", async () => {
    let capturedDeps: Record<string, unknown> | undefined;
    const io = fakeIo();
    const core = fakeCoreModule();

    await executeFlow({ flow: "test", argv: ["test", "suite.json"] }, io, {
      runners: {
        test: async (_argv, deps) => {
          capturedDeps = deps as unknown as Record<string, unknown>;
          return 0;
        },
      },
      loaders: {
        loadCore: () => Promise.resolve(core),
        loadRunner: () => Promise.resolve(fakeRunnerModule()),
      },
    });

    expect(capturedDeps?.connectHttp).toBe(core.connectHttp);
  });

  it("readEnv 가 process.env 의 값을 돌려준다", async () => {
    let capturedDeps: Record<string, unknown> | undefined;
    const io = fakeIo();

    // 바깥에 같은 이름이 이미 있으면 지우지 말고 되돌린다. 테스트가 환경을 바꾼 채 끝나면 안 된다.
    const original = process.env.MCPEAK_TEST_HDR;
    process.env.MCPEAK_TEST_HDR = "토큰-값";
    try {
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

      const readEnv = capturedDeps?.readEnv as (name: string) => string | undefined;
      expect(readEnv("MCPEAK_TEST_HDR")).toBe("토큰-값");
      expect(readEnv("MCPEAK_TEST_HDR_없음")).toBeUndefined();
    } finally {
      // 다른 테스트로 새면 결정론이 깨진다.
      if (original === undefined) delete process.env.MCPEAK_TEST_HDR;
      else process.env.MCPEAK_TEST_HDR = original;
    }
  });

  it("런타임 의존성 로드 실패 경로에는 connectHttp·readEnv 가 없다", async () => {
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
        loadCore: () => Promise.reject(new Error("core 를 로드할 수 없습니다.")),
        loadRunner: () => Promise.resolve(fakeRunnerModule()),
      },
    });

    expect(Object.keys(capturedDeps ?? {}).sort()).toEqual(TEST_COMMAND_REQUIRED_KEYS);
    expect(capturedDeps).not.toHaveProperty("connectHttp");
    expect(capturedDeps).not.toHaveProperty("readEnv");
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
});

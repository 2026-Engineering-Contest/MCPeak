import { readFile, writeFile } from "node:fs/promises";
import {
  type GenerateCommandDependencies,
  nodeGenerateDependencies,
  type RepairCommandDependencies,
  runCli,
  runGenerateCommand,
  runRepairCommand,
  type TestCommandDependencies,
} from "@mcpeak/cli/commands";
import type { StartRunRequest } from "../api-types.js";
import type { RunIo } from "./run-registry.js";

/**
 * flow별 커맨드 함수 실행기. `packages/cli/src/index.ts`의 `run()` 분기(112–208행 부근)와
 * 항목 단위로 동일하게 조립하되 `writeStdout`/`writeStderr`/`reviewIO`만 `RunIo`의 것으로
 * 바꾼다. cli의 동적 import 구조도 그대로 따라간다(test 경로가 generate를 로드하지 않는다).
 *
 * 테스트가 실제 커맨드 함수(서버 연결·프로세스 기동을 하는 함수)를 돌리지 않고 fake를
 * 주입할 수 있도록, 커맨드 함수와 동적 import 로더를 `overrides`로 바꿔치기할 수 있게
 * 열어 둔다. 기본값은 실제 구현이다.
 */
export interface FlowRunners {
  readonly test: typeof runCli;
  readonly generate: typeof runGenerateCommand;
  readonly repair: typeof runRepairCommand;
}

export interface FlowModuleLoaders {
  readonly loadCore: () => Promise<typeof import("@mcpeak/core")>;
  readonly loadRunner: () => Promise<typeof import("@mcpeak/runner")>;
  readonly loadGenerate: () => Promise<typeof import("@mcpeak/generate")>;
}

export interface ExecuteFlowOverrides {
  readonly runners?: Partial<FlowRunners>;
  readonly loaders?: Partial<FlowModuleLoaders>;
}

const defaultRunners: FlowRunners = {
  test: runCli,
  generate: runGenerateCommand,
  repair: runRepairCommand,
};

const defaultLoaders: FlowModuleLoaders = {
  loadCore: () => import("@mcpeak/core"),
  loadRunner: () => import("@mcpeak/runner"),
  loadGenerate: () => import("@mcpeak/generate"),
};

/** 런타임 의존성 로드 실패 시 자리표시자. cli의 `unavailableDependencies`와 같은 값이다. */
function unavailable<T>(): () => Promise<T> {
  return () => Promise.reject(new Error("runtime dependencies unavailable"));
}
function unavailableSync<T>(): () => T {
  return () => {
    throw new Error("runtime dependencies unavailable");
  };
}

/**
 * 서버 경계의 argv 관용(계획서 §5 T6). §4-4 는 "CLI argv 배열 그대로" 를 기준면으로 정했는데,
 * 그 "그대로" 를 프론트는 서브커맨드 없이(`["suite.json"]`), cli 는 서브커맨드를 포함해
 * (`["test","suite.json"]`) 읽는다. 두 규약 다 실전에서 들어오므로 서버가 흡수한다.
 * 프론트와 cli 는 손대지 않는다.
 */

/** `runCli` 는 `argv[0] === "test"` 를 요구한다. 없으면 붙여 준다. */
function withTestSubcommand(argv: readonly string[]): readonly string[] {
  return argv[0] === "test" ? argv : ["test", ...argv];
}

export function executeFlow(
  request: StartRunRequest,
  io: RunIo,
  overrides: ExecuteFlowOverrides = {},
): Promise<number> {
  const runners: FlowRunners = { ...defaultRunners, ...overrides.runners };
  const loaders: FlowModuleLoaders = { ...defaultLoaders, ...overrides.loaders };
  switch (request.flow) {
    case "test":
      return executeTest(request.argv, io, runners, loaders);
    case "generate":
      return executeGenerate(request.argv, io, runners, loaders);
    case "repair":
      return executeRepair(request.argv, io, runners, loaders);
    default: {
      const exhaustive: never = request;
      throw new Error(`알 수 없는 flow: ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function executeTest(
  argv: readonly string[],
  io: RunIo,
  runners: FlowRunners,
  loaders: FlowModuleLoaders,
): Promise<number> {
  const commandArgv = withTestSubcommand(argv);
  const ioFields = { writeStdout: io.writeStdout, writeStderr: io.writeStderr };
  let core: typeof import("@mcpeak/core");
  let runner: typeof import("@mcpeak/runner");
  try {
    [core, runner] = await Promise.all([loaders.loadCore(), loaders.loadRunner()]);
  } catch {
    const dependencies: TestCommandDependencies = {
      readFile,
      validateSuite: unavailableSync(),
      connect: unavailable(),
      startRunner: unavailableSync(),
      finalize: unavailable(),
      renderReport: unavailableSync(),
      renderJUnit: unavailableSync(),
      writeFile: unavailable(),
      colorEnabled: true,
      ...ioFields,
    };
    return runners.test(commandArgv, dependencies);
  }
  const dependencies: TestCommandDependencies = {
    readFile,
    validateSuite: runner.validateMcpSuite,
    connect: core.connectStdio,
    // 원격(Streamable HTTP) 대상용 배선(설계 §6-5). `readEnv` 는 `--header-env` 가 가리키는
    // 환경변수를 읽는 유일한 지점이며, `process` 를 읽는 것은 대시보드 서버 프로세스의
    // 일이다(ADR-0013 의 주입 지점 그대로). cli `index.ts` 의 test 배선과 같은 값이다.
    connectHttp: core.connectHttp,
    readEnv: (name) => process.env[name],
    startRunner: runner.runSuite,
    finalize: runner.finalizeRunnerExecution,
    renderReport: runner.renderReport,
    renderJUnit: runner.renderJUnit,
    writeFile: (path, text) => writeFile(path, text, "utf8"),
    // 웹은 터미널 TTY 개념이 없다. ANSI를 항상 켜 두고 ansiToHtml이 색을 HTML로 옮긴다.
    // (계획서 §2 목표4: 실패 메시지는 터미널 문장 그대로, ANSI 색만 HTML로 변환)
    colorEnabled: true,
    ...ioFields,
  };
  return runners.test(commandArgv, dependencies);
}

async function executeGenerate(
  argv: readonly string[],
  io: RunIo,
  runners: FlowRunners,
  loaders: FlowModuleLoaders,
): Promise<number> {
  const base = nodeGenerateDependencies();
  const ioFields = {
    writeStdout: io.writeStdout,
    writeStderr: io.writeStderr,
    reviewIO: io.reviewIO,
  };
  let core: typeof import("@mcpeak/core");
  let runner: typeof import("@mcpeak/runner");
  let generate: typeof import("@mcpeak/generate");
  try {
    [core, runner, generate] = await Promise.all([
      loaders.loadCore(),
      loaders.loadRunner(),
      loaders.loadGenerate(),
    ]);
  } catch {
    const dependencies: GenerateCommandDependencies = {
      ...base,
      ...ioFields,
      connect: unavailable(),
      createBaselineSuite: unavailableSync(),
      createAuthoringSession: unavailableSync(),
      finalizeAuthoringDraft: unavailableSync(),
      getAuthoringExecutionSuite: unavailableSync(),
      validateSuite: unavailableSync(),
    };
    return runners.generate(argv, dependencies);
  }
  const dependencies: GenerateCommandDependencies = {
    ...base,
    ...ioFields,
    connect: core.connectStdio,
    // 원격(Streamable HTTP) 대상용 배선(설계 §6-5). 없으면 `--url` 이 서버에서
    // `connectHttp 미배선` 으로 멈춘다. 위 test 배선과 같은 값이다.
    connectHttp: core.connectHttp,
    readEnv: (name) => process.env[name],
    createBaselineSuite: generate.createBaselineSuite,
    createAuthoringSession: generate.createAuthoringSession,
    finalizeAuthoringDraft: generate.finalizeAuthoringDraft,
    getAuthoringExecutionSuite: generate.getAuthoringExecutionSuite,
    validateSuite: runner.validateMcpSuite,
    providers: {
      codex: (model) => generate.createCodexAuthoringProvider({ model }),
      claude: (model) => generate.createClaudeAuthoringProvider({ model }),
    },
    prepareAuthoringRequest: generate.prepareAuthoringRequest,
    dispatchAuthoringRequest: generate.dispatchAuthoringRequest,
    createAuthoringDiff: generate.createAuthoringDiff,
    applyAuthoringChanges: generate.applyAuthoringChanges,
    reviewLocalAuthoringCandidate: generate.reviewLocalAuthoringCandidate,
    computeCoverage: generate.computeCoverage,
    preparePreFillRequest: generate.preparePreFillRequest,
    previewPreFillRequest: generate.previewPreFillRequest,
    dispatchPreFillRequest: generate.dispatchPreFillRequest,
    // authoring과 같은 실행 경로를 쓰는 provider다. cli 분기의 주석과 같은 이유(#89).
    preFillProviders: {
      codex: (model) => generate.createCodexProvider({ model }),
      claude: (model) => generate.createClaudeProvider({ model }),
    },
    prepareRejectionDiagnosisRequests: generate.prepareRejectionDiagnosisRequests,
    dispatchRejectionDiagnosis: generate.dispatchRejectionDiagnosis,
    rejectionProviders: {
      codex: (model) => generate.createCodexProvider({ model }),
      claude: (model) => generate.createClaudeProvider({ model }),
    },
    GenerateTestsError: generate.GenerateTestsError,
  };
  return runners.generate(argv, dependencies);
}

async function executeRepair(
  argv: readonly string[],
  io: RunIo,
  runners: FlowRunners,
  loaders: FlowModuleLoaders,
): Promise<number> {
  let generate: typeof import("@mcpeak/generate");
  try {
    generate = await loaders.loadGenerate();
  } catch {
    io.writeStderr(
      "오류 [REPAIR_RUNTIME_UNAVAILABLE]: 진단에 필요한 @mcpeak/generate 를 로드하지 못했습니다.\n해결: 의존성을 설치한 뒤 다시 실행하세요.\n",
    );
    return 1;
  }
  const dependencies: RepairCommandDependencies = {
    readFile: (path) => readFile(path, "utf8"),
    writeStdout: io.writeStdout,
    writeStderr: io.writeStderr,
    reviewIO: io.reviewIO,
    diagnosis: {
      prepare: generate.prepareDiagnosisRequest,
      dispatch: generate.dispatchDiagnosisRequest,
      providers: {
        codex: (model) => generate.createCodexProvider({ model }),
        claude: (model) => generate.createClaudeProvider({ model }),
      },
    },
  };
  try {
    return await runners.repair(argv, dependencies);
  } finally {
    // 웹 IO에는 닫을 readline이 없다. cli와 같은 형태로 optional chain만 그대로 둔다(no-op).
    dependencies.reviewIO?.close?.();
  }
}

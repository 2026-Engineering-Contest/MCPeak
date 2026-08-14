import { readFile, writeFile } from "node:fs/promises";
import { nodeGenerateDependencies, nodeReviewIO, runGenerateCommand } from "./generate-command.js";
import { parseTestCommand, runCli } from "./test-command.js";

export type Command = (argv: string[]) => Promise<number>;
export const COMMANDS = ["test", "generate", "record", "replay", "mock"] as const;

const unavailableDependencies = {
  readFile: async (): Promise<Uint8Array> => {
    throw new Error("runtime dependencies unavailable");
  },
  validateSuite: (): never => {
    throw new Error("runtime dependencies unavailable");
  },
  connect: async (): Promise<never> => {
    throw new Error("runtime dependencies unavailable");
  },
  startRunner: (): never => {
    throw new Error("runtime dependencies unavailable");
  },
  finalize: async (): Promise<never> => {
    throw new Error("runtime dependencies unavailable");
  },
  renderReport: (): never => {
    throw new Error("runtime dependencies unavailable");
  },
  renderJUnit: (): never => {
    throw new Error("runtime dependencies unavailable");
  },
  writeFile: async (): Promise<never> => {
    throw new Error("runtime dependencies unavailable");
  },
  colorEnabled: false,
  writeStdout: (text: string): boolean => process.stdout.write(text),
  writeStderr: (text: string): boolean => process.stderr.write(text),
};

const unavailableRuntimeDependencies = {
  ...unavailableDependencies,
  readFile,
};

export async function run(argv: string[]): Promise<number> {
  if (argv[0] === "generate") {
    let core: typeof import("@ohmymcp/core");
    let runner: typeof import("@ohmymcp/runner");
    let generate: typeof import("@ohmymcp/generate");
    try {
      [core, runner, generate] = await Promise.all([
        import("@ohmymcp/core"),
        import("@ohmymcp/runner"),
        import("@ohmymcp/generate"),
      ]);
    } catch {
      return runGenerateCommand(argv, {
        ...nodeGenerateDependencies(),
        connect: unavailableDependencies.connect,
        createBaselineSuite: unavailableDependencies.validateSuite,
        createAuthoringSession: unavailableDependencies.validateSuite,
        finalizeAuthoringDraft: unavailableDependencies.validateSuite,
        getAuthoringExecutionSuite: unavailableDependencies.validateSuite,
        validateSuite: unavailableDependencies.validateSuite,
      } as never);
    }
    return runGenerateCommand(argv, {
      ...nodeGenerateDependencies(),
      connect: core.connectStdio,
      createBaselineSuite: generate.createBaselineSuite,
      createAuthoringSession: generate.createAuthoringSession,
      finalizeAuthoringDraft: generate.finalizeAuthoringDraft,
      getAuthoringExecutionSuite: generate.getAuthoringExecutionSuite,
      validateSuite: runner.validateMcpSuite,
      reviewIO: nodeReviewIO(),
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
    });
  }
  if (argv[0] !== "test") return runCli(argv, unavailableDependencies);
  try {
    const input = parseTestCommand(argv.slice(1));
    if (!input.suitePath.toLowerCase().endsWith(".json"))
      return runCli(argv, unavailableDependencies);
  } catch {
    return runCli(argv, unavailableDependencies);
  }
  let core: typeof import("@ohmymcp/core");
  let runner: typeof import("@ohmymcp/runner");
  try {
    [core, runner] = await Promise.all([import("@ohmymcp/core"), import("@ohmymcp/runner")]);
  } catch {
    return runCli(argv, unavailableRuntimeDependencies);
  }
  return runCli(argv, {
    readFile,
    validateSuite: runner.validateMcpSuite,
    connect: core.connectStdio,
    startRunner: runner.runSuite,
    finalize: runner.finalizeRunnerExecution,
    renderReport: runner.renderReport,
    renderJUnit: runner.renderJUnit,
    writeFile: (path, text) => writeFile(path, text, "utf8"),
    // process 를 읽는 유일한 지점이다. renderReport 는 순수 함수로 남는다.
    colorEnabled: process.stdout.isTTY === true && process.env.NO_COLOR === undefined,
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  });
}

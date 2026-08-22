import { readFile, writeFile } from "node:fs/promises";
import packageMetadata from "../package.json";
import { nodeGenerateDependencies, nodeReviewIO, runGenerateCommand } from "./generate-command.js";
import { COMMAND_DISCOVERY_HINT, commandHelp, GLOBAL_HELP } from "./help.js";
import { type RepairCommandDependencies, runRepairCommand } from "./repair-command.js";
import { escapeTerminalText } from "./repair-render.js";
import { parseTestCommand, runCli } from "./test-command.js";

export type Command = (argv: string[]) => Promise<number>;
export const COMMANDS = ["test", "generate", "repair", "record", "mock"] as const;

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

/**
 * `repair` 실행 의존성. 함수로 빼 둔 이유는 **주입 자체를 테스트가 단언할 수 있게** 하기
 * 위해서다. 분기 안에 리터럴로 두면 `reviewIO` 를 빠뜨려도 아무 테스트도 안 깨진다.
 * 실제로 그렇게 한 번 빠뜨렸다(T10 보고서).
 *
 * 대화형 판정은 `generate` 와 같은 기준이다. 같은 `nodeReviewIO()` 를 쓰고, 그 구현이
 * stdin·stdout 이 둘 다 TTY 일 때만 `interactive` 를 참으로 만든다.
 */
export function nodeRepairDependencies(
  generate: typeof import("@mcpeak/generate"),
): RepairCommandDependencies {
  return {
    readFile: (path) => readFile(path, "utf8"),
    writeStdout: (text) => void process.stdout.write(text),
    writeStderr: (text) => void process.stderr.write(text),
    reviewIO: nodeReviewIO(),
    diagnosis: {
      prepare: generate.prepareDiagnosisRequest,
      dispatch: generate.dispatchDiagnosisRequest,
      providers: {
        codex: (model) => generate.createCodexProvider({ model }),
        claude: (model) => generate.createClaudeProvider({ model }),
      },
    },
  };
}

/** `mcpeak help <이름>` 으로 볼 수 있는 명령. 위 두 갈래가 같은 목록을 봐야 한다. */
// `replay`·`verify` 는 ADR-0059 로 제거됐다. 그 둘은 위쪽에서 마이그레이션 안내로 간다.
const HELP_TOPICS = ["test", "generate", "repair"] as const;
const isHelpTopic = (value: string | undefined): value is (typeof HELP_TOPICS)[number] =>
  HELP_TOPICS.includes(value as (typeof HELP_TOPICS)[number]);

export async function run(argv: string[]): Promise<number> {
  if (
    argv.length === 0 ||
    (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0] ?? ""))
  ) {
    process.stdout.write(GLOBAL_HELP);
    return 0;
  }
  if (argv.length === 2) {
    const command = argv[0] === "help" ? argv[1] : argv[1] === "--help" ? argv[0] : undefined;
    // 제거된 명령은 도움말을 물어도 마이그레이션 안내로 답한다(ADR-0059). 여기서 흘려보내면
    // `mcpeak help replay` 가 뒤에서 `argv[0]` 인 `"help"` 를 알 수 없는 명령으로 지목한다 —
    // 사용자가 묻지도 않은 이름을 탓하는 실패 메시지가 된다. 안내 문구의 정본은 `runCli` 다.
    if (command === "replay" || command === "verify")
      return runCli([command], unavailableDependencies);
    if (isHelpTopic(command)) {
      process.stdout.write(commandHelp(command));
      return 0;
    }
  }
  /**
   * `help` 로 시작했는데 위에서 안 걸렸다면 **뒤에 붙은 인자가 틀린 것**이다.
   *
   * 여기서 안 막고 아래로 흘려보내면 `runCli` 가 `argv[0]` 인 `help` 를 명령으로 읽어
   * "알 수 없는 CLI 명령 'help'입니다" 라고 한다. 사용자가 정확히 친 토큰을 틀렸다고
   * 지목하는 셈이라, 무엇을 고쳐야 하는지가 화면에서 사라진다.
   */
  if (argv[0] === "help") {
    const target = argv[1] ?? "";
    const message = isHelpTopic(target)
      ? `\`help ${escapeTerminalText(target)}\` 뒤에는 인자를 더 받지 않습니다.`
      : `도움말이 없는 명령 '${escapeTerminalText(target)}'입니다.`;
    process.stderr.write(`오류 [CLI_USAGE]: ${message}\n해결: ${COMMAND_DISCOVERY_HINT}\n`);
    return 1;
  }
  if (argv.length === 1 && argv[0] === "--version") {
    process.stdout.write(`mcpeak ${packageMetadata.version}\n`);
    return 0;
  }
  if (argv[0] === "generate") {
    let core: typeof import("@mcpeak/core");
    let runner: typeof import("@mcpeak/runner");
    let generate: typeof import("@mcpeak/generate");
    try {
      [core, runner, generate] = await Promise.all([
        import("@mcpeak/core"),
        import("@mcpeak/runner"),
        import("@mcpeak/generate"),
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
      preparePreFillRequest: generate.preparePreFillRequest,
      previewPreFillRequest: generate.previewPreFillRequest,
      dispatchPreFillRequest: generate.dispatchPreFillRequest,
      // authoring 과 같은 실행 경로를 쓰는 provider 다. 다른 것은 stdin 과 출력 스키마뿐이다.
      preFillProviders: {
        codex: (model) => generate.createCodexProvider({ model }),
        claude: (model) => generate.createClaudeProvider({ model }),
      },
      prepareRejectionDiagnosisRequests: generate.prepareRejectionDiagnosisRequests,
      dispatchRejectionDiagnosis: generate.dispatchRejectionDiagnosis,
      // 같은 provider 객체가 diagnoseRejection 도 갖는다. 실행 경로는 위와 같고 stdin 과
      // 출력 스키마만 다르다(#89).
      rejectionProviders: {
        codex: (model) => generate.createCodexProvider({ model }),
        claude: (model) => generate.createClaudeProvider({ model }),
      },
      GenerateTestsError: generate.GenerateTestsError,
    });
  }
  if (argv[0] === "repair") {
    /**
     * `generate` 분기와 같은 모양으로 동적 import 한다. `test` 경로는 이 분기를 지나지 않으므로
     * 여전히 `core` 와 `runner` 만 로드한다. 계획서 §8 위험표 첫 줄.
     */
    let generate: typeof import("@mcpeak/generate");
    try {
      generate = await import("@mcpeak/generate");
    } catch {
      process.stderr.write(
        "오류 [REPAIR_RUNTIME_UNAVAILABLE]: 진단에 필요한 @mcpeak/generate 를 로드하지 못했습니다.\n해결: 의존성을 설치한 뒤 다시 실행하세요.\n",
      );
      return 1;
    }
    const dependencies = nodeRepairDependencies(generate);
    try {
      return await runRepairCommand(argv, dependencies);
    } finally {
      // 확인 화면을 띄웠으면 readline 이 열려 있다. 닫지 않으면 TTY 에서 프로세스가 안 끝난다.
      dependencies.reviewIO?.close?.();
    }
  }
  if (argv[0] !== "test") return runCli(argv, unavailableDependencies);
  try {
    const input = parseTestCommand(argv.slice(1));
    if (!input.suitePath.toLowerCase().endsWith(".json"))
      return runCli(argv, unavailableDependencies);
  } catch {
    return runCli(argv, unavailableDependencies);
  }
  let core: typeof import("@mcpeak/core");
  let runner: typeof import("@mcpeak/runner");
  try {
    [core, runner] = await Promise.all([import("@mcpeak/core"), import("@mcpeak/runner")]);
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

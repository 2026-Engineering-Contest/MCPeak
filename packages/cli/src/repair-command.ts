import type { ReviewIO } from "./generate-command.js";
import { REPAIR_USAGE_HINT } from "./help.js";
import { describeRepairBundleInvalid, readRepairBundle } from "./repair-bundle.js";
import {
  escapeTerminalText,
  REPAIR_APPROVAL_INVALIDATED_LINE,
  REPAIR_CANCELLED_LINE,
  REPAIR_CONFIRM_REQUIRED_LINE,
  REPAIR_INVALID_RESULT_LINE,
  REPAIR_RESULT_LIMIT_LINE,
  renderRepairConfirm,
  renderRepairProviderFailure,
  renderRepairResult,
} from "./repair-render.js";

/**
 * 한 번에 보낼 실패 개수 기본 상한. `@mcpeak/generate` 의 `DEFAULT_MAX_REPAIR_CASES` 와 같은
 * 값이어야 한다. 파싱은 generate 를 로드하지 않는 경로에서도 돌아야 해서 여기서 상수를 받는다.
 * 실제 값 대조는 테스트가 generate 의 export 와 직접 비교해 고정한다.
 */
export const DEFAULT_REPAIR_MAX_CASES = 10;

export interface RepairCommandInput {
  readonly bundlePath: string;
  readonly providerId: "codex" | "claude";
  readonly model: string;
  readonly yes: boolean;
  readonly includeStderr: boolean;
  readonly maxCases: number;
}

export interface RepairCommandDependencies {
  readFile(path: string): Promise<string>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  /** 전송 확인 화면. 없으면 비대화형으로 본다. `generate` 가 쓰는 그 인터페이스다. */
  readonly reviewIO?: ReviewIO;
  /**
   * 진단 통로. `@mcpeak/generate` 를 값으로 import 하지 않고 주입받는다. 정적으로 import 하면
   * `test` 경로가 `generate` 를 함께 로드한다. 계획서 §8 위험표 첫 줄이다.
   */
  readonly diagnosis?: {
    readonly prepare: typeof import("@mcpeak/generate").prepareDiagnosisRequest;
    readonly dispatch: typeof import("@mcpeak/generate").dispatchDiagnosisRequest;
    readonly providers: {
      readonly codex: (model: string) => import("@mcpeak/generate").ServerDiagnosisProvider;
      readonly claude: (model: string) => import("@mcpeak/generate").ServerDiagnosisProvider;
    };
  };
}

class UsageError extends Error {}

const optionNames = new Set(["--provider", "--model", "--max-cases", "--no-stderr", "--yes"]);
/** 값을 받지 않는 옵션. `=` 를 붙여 쓸 수 없고 두 번 쓸 수 없다. */
const flagNames = new Set(["--no-stderr", "--yes"]);

function optionValue(argv: readonly string[], index: number, option: string): [string, number] {
  const item = argv[index] as string;
  const equals = item.indexOf("=");
  if (equals > 0) return [item.slice(equals + 1), index];
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new UsageError(`\`${option}\` 옵션 값이 필요합니다.`);
  return [value, index + 1];
}

export function parseRepairCommand(argv: readonly string[]): RepairCommandInput {
  let bundlePath: string | undefined;
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === undefined) continue;
    if (!item.startsWith("--")) {
      if (bundlePath !== undefined)
        throw new UsageError(`추가 위치 인자 '${item}'는 허용되지 않습니다.`);
      bundlePath = item;
      continue;
    }
    const option = item.includes("=") ? item.slice(0, item.indexOf("=")) : item;
    if (!optionNames.has(option))
      throw new UsageError(`지원하지 않는 repair 옵션 '${option}'입니다.`);
    if (flagNames.has(option)) {
      if (item !== option || flags.has(option))
        throw new UsageError(`\`${option}\`는 한 번만 사용할 수 있습니다.`);
      flags.add(option);
      continue;
    }
    const [value, consumed] = optionValue(argv, index, option);
    index = consumed;
    if (value === "") throw new UsageError(`\`${option}\` 옵션 값이 필요합니다.`);
    if (values.has(option)) throw new UsageError(`\`${option}\`는 한 번만 사용할 수 있습니다.`);
    values.set(option, value);
  }
  if (bundlePath === undefined) throw new UsageError("repair 번들 JSON 경로가 필요합니다.");
  // provider·model 에 기본값을 두지 않는다. 임의의 기본값은 그대로 CLI 인자가 되어 사용자가
  // 승인한 적 없는 모델을 부르게 된다. providers.ts 의 model 주석과 같은 이유다.
  const rawProvider = values.get("--provider");
  if (rawProvider === undefined) throw new UsageError("`--provider` 옵션이 필요합니다.");
  if (rawProvider !== "codex" && rawProvider !== "claude")
    throw new UsageError("`--provider`는 codex 또는 claude여야 합니다.");
  const model = values.get("--model");
  if (model === undefined) throw new UsageError("`--model` 옵션이 필요합니다.");
  const rawMaxCases = values.get("--max-cases");
  let maxCases = DEFAULT_REPAIR_MAX_CASES;
  if (rawMaxCases !== undefined) {
    if (!/^\d+$/.test(rawMaxCases))
      throw new UsageError("`--max-cases` 값은 1 이상의 정수여야 합니다.");
    maxCases = Number.parseInt(rawMaxCases, 10);
    if (!Number.isSafeInteger(maxCases) || maxCases < 1)
      throw new UsageError("`--max-cases` 값은 1 이상의 정수여야 합니다.");
  }
  return Object.freeze({
    bundlePath,
    providerId: rawProvider,
    model,
    yes: flags.has("--yes"),
    includeStderr: !flags.has("--no-stderr"),
    maxCases,
  });
}

/**
 * `repair` 명령. 번들을 읽고, 전송 내용을 확인받고, provider 에게 진단을 물어 화면에 찍는다.
 * 파일도 명세도 고치지 않는다. 종료 코드는 운영 실패에만 1 이다(설계서 §7.1).
 */
/**
 * 진단 요청이 크기 상한을 넘었을 때의 문장.
 *
 * `repair-render.ts` 가 아니라 여기 두는 이유는 그 파일이 화면 조립을 맡고 이 문장은 이
 * 명령의 실패 경로에만 쓰이기 때문이다. 다른 실패 문장들처럼 `deps.writeStderr` 로 나간다.
 *
 * 무엇이 왜 큰지와 사용자가 할 수 있는 일을 함께 적는다. 상한 계산이 틀렸을 때 스택
 * 트레이스만 뜨면 사용자는 할 수 있는 일이 없다(#393).
 */
export const REPAIR_REQUEST_TOO_LARGE_LINE =
  "오류 [REPAIR_REQUEST_TOO_LARGE]: 진단 요청이 크기 상한을 넘었습니다.\n" +
  "  번들의 도구 선언이 너무 큽니다. --max-cases 를 줄여 실패 케이스 수를 낮추면\n" +
  "  함께 실리는 도구도 줄어듭니다.\n";

export async function runRepairCommand(
  argv: readonly string[],
  deps: RepairCommandDependencies,
): Promise<number> {
  let input: RepairCommandInput;
  try {
    input = parseRepairCommand(argv[0] === "repair" ? argv.slice(1) : argv);
  } catch (error) {
    const message =
      error instanceof UsageError ? error.message : "repair 입력을 해석할 수 없습니다.";
    deps.writeStderr(`오류 [CLI_USAGE]: ${message}\n해결: ${REPAIR_USAGE_HINT}\n`);
    return 1;
  }
  let text: string;
  try {
    text = await deps.readFile(input.bundlePath);
  } catch {
    deps.writeStderr(
      `오류 [REPAIR_BUNDLE_READ_FAILED]: repair 번들 파일을 읽지 못했습니다. 경로: ${escapeTerminalText(input.bundlePath)}\n해결: 경로와 읽기 권한을 확인하세요. 번들은 \`mcpeak test --repair-bundle <path>\` 가 만듭니다.\n`,
    );
    return 1;
  }
  const read = readRepairBundle(text);
  if (read.status !== "ok") {
    deps.writeStderr(`오류 [REPAIR_BUNDLE_INVALID]: ${describeRepairBundleInvalid(read.reason)}\n`);
    return 1;
  }
  const bundle = read.bundle;
  if (deps.diagnosis === undefined) {
    deps.writeStderr(
      "오류 [REPAIR_RUNTIME_UNAVAILABLE]: 진단 통로를 쓸 수 없습니다.\n해결: 의존성을 설치한 뒤 다시 실행하세요.\n",
    );
    return 1;
  }
  const provider = deps.diagnosis.providers[input.providerId](input.model);
  /**
   * 요청 크기 상한을 넘으면 `prepareDiagnosisRequest` 가 `RangeError` 를 던진다.
   * 도구 선언을 싣기 시작하면서 실제로 닿을 수 있는 자리가 됐다(#393).
   *
   * 던진 것을 그대로 두면 스택 트레이스가 화면에 뜨고 사용자가 할 수 있는 일이 없다.
   * 번들을 다시 만들 수도 없다. 그 안에 이미 도구가 들어 있기 때문이다.
   */
  let preview: ReturnType<NonNullable<typeof deps.diagnosis>["prepare"]>;
  try {
    preview = deps.diagnosis.prepare({
      specTrust: { fingerprint: bundle.spec.approval, runHistory: bundle.spec.runHistory },
      suite: { id: bundle.spec.suiteId, name: bundle.spec.suiteName },
      failures: bundle.failures.map((failure) => ({
        caseId: failure.caseId,
        caseName: failure.caseName,
        ...(failure.tool === undefined ? {} : { tool: failure.tool }),
        ...(failure.input === undefined ? {} : { input: failure.input }),
        ...(failure.approvedAs === undefined ? {} : { approvedAs: failure.approvedAs }),
        diagnostics: failure.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      })),
      ...(bundle.process === undefined ? {} : { processDiagnostics: bundle.process }),
      // 번들이 실어 온 도구 선언을 그대로 넘긴다. `repair` 는 서버를 안 띄우므로 이것이
      // 유일한 계약 출처다(#393).
      tools: bundle.tools.map((tool) => ({
        name: tool.name,
        inputSchema: tool.inputSchema,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
      })),
      providerId: input.providerId,
      model: input.model,
      maxCases: input.maxCases,
      includeStderr: input.includeStderr,
    });
  } catch (error: unknown) {
    if (!(error instanceof RangeError)) throw error;
    deps.writeStderr(REPAIR_REQUEST_TOO_LARGE_LINE);
    return 1;
  }
  const confirmView = {
    providerId: input.providerId,
    model: input.model,
    totalFailures: bundle.failures.length,
    sentFailures: preview.request.failures.length,
    omittedFailures: preview.omitted.failures,
    maxCases: input.maxCases,
    approval: bundle.spec.approval,
    runHistory: bundle.spec.runHistory,
    includeStderr: input.includeStderr,
    ...(preview.request.processDiagnostics === undefined
      ? {}
      : { stderr: preview.request.processDiagnostics.stderr }),
    // 번들이 실어 온 도구 수를 그대로 적는다. 사용자가 무엇을 보내는지 보고 승인해야 한다.
    sentTools: bundle.tools.length,
    omittedToolSchemas: bundle.tools.filter((tool) => tool.schemasOmitted === true).length,
    requestBytes: preview.byteLength,
  };
  if (!input.yes) {
    // 물어볼 수 없는 곳에서 조용히 보내지 않는다. provider 는 아직 한 번도 안 불렀다.
    if (deps.reviewIO?.interactive !== true) {
      deps.writeStdout(renderRepairConfirm(confirmView));
      deps.writeStderr(REPAIR_CONFIRM_REQUIRED_LINE);
      return 1;
    }
    deps.reviewIO.write(renderRepairConfirm(confirmView));
    // 사용자가 의도한 대로 끝났다. 실패가 아니므로 종료 코드는 0 이다. 설계서 §7.1.
    if (!(await deps.reviewIO.confirm("보내시겠습니까?"))) {
      deps.writeStdout(REPAIR_CANCELLED_LINE);
      return 0;
    }
  }
  const dispatched = await deps.diagnosis.dispatch({
    provider,
    preview,
    approval: { approved: true, fingerprint: preview.fingerprint },
  });
  if (dispatched.status === "providerFailed") {
    deps.writeStderr(renderRepairProviderFailure(dispatched.failure));
    return 1;
  }
  if (dispatched.status === "invalid") {
    deps.writeStderr(REPAIR_INVALID_RESULT_LINE);
    return 1;
  }
  if (dispatched.status === "resultLimitExceeded") {
    deps.writeStderr(REPAIR_RESULT_LIMIT_LINE);
    return 1;
  }
  if (dispatched.status !== "diagnosis") {
    deps.writeStderr(REPAIR_APPROVAL_INVALIDATED_LINE);
    return 1;
  }
  deps.writeStdout(
    renderRepairResult({
      bundle,
      result: dispatched.result,
      providerId: input.providerId,
      model: input.model,
    }),
  );
  // 진단을 받았든 unsure 든 0 이다. AI 답변 품질이 CI 판정이 되면 안 된다. 설계서 §7.1.
  return 0;
}

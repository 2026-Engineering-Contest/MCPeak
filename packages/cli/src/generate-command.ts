import { access, link, open, readFile, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { McpHttpConnection, McpStdioConnection, ToolDef } from "@mcpeak/core";
import type {
  AuthoringDiffPreview,
  AuthoringExecutionSnapshot,
  AuthoringRequestPreview,
  AuthoringSessionView,
  BaselineGenerationResult,
  CoverageResult,
  PreFillDiscard,
  PreFillProvider,
  PreFillRequestPreview,
  PublicProviderFailure,
  RejectionDiagnosisProvider,
  RejectionDiagnosisResult,
  RejectionVerdict,
  SanitizedAuthoringCandidate,
  SkippedTool,
  TestCaseOrigin,
  ToolCoverage,
} from "@mcpeak/generate";
import type {
  CallToolCaseSpec,
  ContractAxisKind,
  JsonObject,
  JsonValue,
  SpecFinding,
  SuiteCaseApproval,
  SuiteValidationResult,
  TestCaseSpec,
  TestSuiteSpec,
} from "@mcpeak/runner";
import { describeSpecFinding, suiteFingerprint } from "@mcpeak/runner";
import {
  type CliConnection,
  type ConnectTarget,
  ConnectTargetError,
  createHeaderEnvCollector,
  describeTarget,
  openConnection,
  parseHeaderEnvOption,
  parseUrlOption,
} from "./connect-target.js";
import type { DryRunCaseOutcome, DryRunResult } from "./dry-run.js";
import { runDryRun } from "./dry-run.js";
import { reviewDryRun } from "./dry-run-review.js";
import type { FindingGroup } from "./finding-group.js";
import { FINDING_GROUP } from "./finding-group.js";
import { GENERATE_USAGE_HINT } from "./help.js";
import { httpDiagnostics, renderHttpDiagnostics } from "./http-diagnostics.js";
import { repairInputs } from "./input-repair.js";
import type { UnknownFormatSkip } from "./pre-fill-wiring.js";
import { applyPreFill, dropSkippedTools, unknownFormatSkips } from "./pre-fill-wiring.js";
import {
  hasDiagnosticContent,
  processDiagnostics,
  renderProcessDiagnostics,
} from "./process-diagnostics.js";
import { proposeRepair } from "./repair-proposal.js";
import { escapeTerminalText } from "./repair-render.js";
import type { RepairAttempt } from "./repair-target.js";
import { selectRepairTargets } from "./repair-target.js";
import { ResetCommandError, runResetCommand } from "./reset-hook.js";

export { GENERATE_USAGE } from "./help.js";

export interface GenerateCommandInput {
  readonly suiteId: string;
  readonly name: string;
  readonly outPath: string;
  /**
   * 명세를 뽑을 대상. `--command`/`--arg` 면 stdio, `--url` 이면 Streamable HTTP 다(#137).
   * `command` · `args` 두 필드를 이 하나로 바꾼 근거는 `TestCommandInput.target` 과 같다.
   */
  readonly target: ConnectTarget;
  readonly baselineOnly: boolean;
  readonly provider?: "codex" | "claude";
  readonly model?: string;
  /** 승인 전 시험 실행 여부. 기본은 실행이고 `--no-dry-run` 이 끈다. 설계 문서 §4.3. */
  readonly dryRun: boolean;
  /** `--force`. `--out` 에 파일이 있으면 지우고 새로 쓴다. 설계 문서 §5. */
  readonly force: boolean;
  /** `--reset-cmd`. 시험 실행 직전 1회 실행한다. */
  readonly resetCmd?: string;
  /** 입력값 교정 단계를 돌릴지 여부. 기본은 실행이고 `--no-repair` 가 끈다. 설계 문서 §7. */
  readonly repair: boolean;
}
export interface GenerateCommandDependencies {
  connect(options: { command: string; args: readonly string[] }): Promise<McpStdioConnection>;
  /**
   * 원격(Streamable HTTP) 대상용 연결. `core.connectHttp` 다. 선택 사항으로 두는 근거는
   * `TestCommandDependencies.connectHttp` 와 같다(#137).
   */
  connectHttp?(options: {
    url: string;
    headers?: Readonly<Record<string, string>>;
  }): Promise<McpHttpConnection>;
  /** `--header-env` 가 가리키는 환경변수를 읽는다. CLI 가 `process` 를 직접 읽지 않기 위한 주입점. */
  readEnv?(name: string): string | undefined;
  createBaselineSuite(
    tools: readonly ToolDef[],
    options: { suiteId: string; suiteName: string },
  ): BaselineGenerationResult;
  createAuthoringSession(
    baseline: BaselineGenerationResult,
    options?: { readonly preFilledCaseIds?: readonly string[] },
  ): AuthoringSessionView;
  finalizeAuthoringDraft(options: {
    session: AuthoringSessionView;
    approval: { approved: boolean; fingerprint: string };
  }): { finalized: true; snapshot: AuthoringExecutionSnapshot } | { finalized: false };
  getAuthoringExecutionSuite(snapshot: AuthoringExecutionSnapshot): TestSuiteSpec;
  validateSuite(value: unknown): SuiteValidationResult;
  exists(path: string): Promise<boolean>;
  openTemp(path: string): Promise<{
    writeFile(data: string, encoding: "utf8"): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }>;
  readFile(path: string): Promise<Uint8Array>;
  /**
   * 임시 파일을 최종 경로에 커밋한다. `rename`이 아니라 `link`인 것이 요점이다.
   * `rename`은 대상이 있으면 말없이 덮어쓴다. `link`는 EEXIST로 실패하므로
   * 원자성과 no-clobber를 동시에 얻는다. 덮어쓸 수 있는 primitive를 아예 두지 않는다.
   */
  link(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  reviewIO?: ReviewIO;
  providers?: Partial<
    Record<"codex" | "claude", (model: string) => TestAuthoringProvider | undefined>
  >;
  /**
   * 거절 근거 진단 통로 (#89 · 설계 문서 §6). `providers` 와 **따로 둔다.** 그쪽은
   * `TestAuthoringProvider`(`author`)이고 이쪽은 `diagnoseRejection` 이라 다른 계약이다.
   * `preFillProviders` 와 같은 선례다. 없으면 진단을 아예 묻지 않는다.
   */
  rejectionProviders?: Partial<
    Record<
      "codex" | "claude",
      (model: string) => import("@mcpeak/generate").RejectionDiagnosisProvider | undefined
    >
  >;
  prepareRejectionDiagnosisRequests?: typeof import("@mcpeak/generate").prepareRejectionDiagnosisRequests;
  dispatchRejectionDiagnosis?: typeof import("@mcpeak/generate").dispatchRejectionDiagnosis;
  prepareAuthoringRequest?: typeof import("@mcpeak/generate").prepareAuthoringRequest;
  dispatchAuthoringRequest?: typeof import("@mcpeak/generate").dispatchAuthoringRequest;
  createAuthoringDiff?: typeof import("@mcpeak/generate").createAuthoringDiff;
  applyAuthoringChanges?: typeof import("@mcpeak/generate").applyAuthoringChanges;
  reviewLocalAuthoringCandidate?: typeof import("@mcpeak/generate").reviewLocalAuthoringCandidate;
  computeCoverage?: typeof import("@mcpeak/generate").computeCoverage;
  /**
   * AI 사전보완 통로. 넷 다 주입돼야 사전보완이 돈다. 하나라도 없으면 건너뛴다.
   * 위 authoring 통로와 같은 이유로 값 import 가 아니라 주입이다.
   */
  preparePreFillRequest?: typeof import("@mcpeak/generate").preparePreFillRequest;
  previewPreFillRequest?: typeof import("@mcpeak/generate").previewPreFillRequest;
  dispatchPreFillRequest?: typeof import("@mcpeak/generate").dispatchPreFillRequest;
  preFillProviders?: Partial<
    Record<"codex" | "claude", (model: string) => PreFillProvider | undefined>
  >;
  /**
   * `instanceof` 용 클래스. 값 import 가 아니라 주입인 것이 요점이다.
   *
   * 이 파일은 `@mcpeak/generate` 에서 타입만 가져온다(위 `import type`). 클래스를 값으로
   * 가져오면 `index.ts` 가 정적으로 끌어와 `test` 경로까지 `generate` 를 로드한다.
   * `typeof import(...)` 는 타입 위치라 런타임 import 가 생기지 않고, 주입하면 클래스
   * 동일성도 보장된다. 위 6개 필드가 같은 방식이다.
   */
  GenerateTestsError?: typeof import("@mcpeak/generate").GenerateTestsError;
}
export interface ReviewIO {
  input(message: string): Promise<string>;
  choose(message: string, choices: readonly string[]): Promise<string>;
  confirm(message: string): Promise<boolean>;
  write(text: string): void;
  readonly interactive: boolean;
  close?(): void;
}
type TestAuthoringProvider = import("@mcpeak/generate").TestAuthoringProvider;
class UsageError extends Error {}
/**
 * 출력 경로에 이미 파일이 있어 저장을 멈춘 경우. 다른 I/O 실패와 사용자 조치가 다르므로
 * 타입으로 갈라 둔다. 뭉뚱그리면 "저장하지 못했습니다"만 남아 어떤 파일이 왜 막았는지 모른다.
 */
class OutputExistsError extends Error {
  constructor(readonly path: string) {
    super("output exists");
  }
}
/**
 * 출력 파일 충돌 안내. 경로는 라벨 뒤에 두어 조사가 변수에 붙지 않게 한다.
 *
 * 두 자리에서 같은 코드로 끊는다. 다른 것은 사용자가 무엇을 잃었는지뿐이라 그 한 마디만
 * 갈라 적는다. 선검사는 아직 아무것도 안 했고, 저장 단계는 검토와 시험 실행을 이미 지났다.
 * 설계 문서 §6.
 */
function outputExistsFailure(
  deps: GenerateCommandDependencies,
  path: string,
  stage: "start" | "save" = "save",
): void {
  const lost = stage === "start" ? "시작하지" : "저장하지";
  deps.writeStderr(
    `오류 [GENERATE_OUTPUT_EXISTS]: 출력 파일이 이미 있어 ${lost} 않았습니다. 경로: ${path}\n해결: 다른 \`--out\` 경로를 지정하거나, 기존 파일을 덮어쓰려면 \`--force\` 를 붙이세요.\n`,
  );
}
/**
 * `--force` 인데 기존 출력 파일을 지우지 못한 경우. `ENOENT` 는 원하는 상태와 같으므로
 * 여기 오지 않는다. `GENERATE_FAILED` 로 뭉뚱그리면 사용자가 무엇을 확인해야 할지 모른다.
 */
class OutputReplaceError extends Error {
  constructor(
    readonly path: string,
    readonly code: string | undefined,
  ) {
    super("output replace failed");
  }
}
/**
 * 기존 출력 파일 삭제 실패 안내. 원인을 단정하지 않는다. `--out` 이 디렉터리인지 권한
 * 문제인지 여기서 구분할 수단이 없고, 그것을 알려고 `stat` 을 주입하지 않는다. 설계 문서 §6.
 */
function outputReplaceFailure(
  deps: GenerateCommandDependencies,
  path: string,
  code: string | undefined,
): void {
  // 코드가 없으면 괄호를 통째로 뺀다. `(undefined)` 는 사용자에게 아무것도 알려주지 않는다.
  const suffix = code === undefined ? "" : ` (${code})`;
  deps.writeStderr(
    `오류 [GENERATE_OUTPUT_REPLACE_FAILED]: 기존 출력 파일을 지우지 못해 저장하지 않았습니다. 경로: ${path}${suffix}\n해결: 그 경로가 디렉터리이거나 쓰기 권한이 없는지 확인하세요. 다른 \`--out\` 경로를 지정해도 됩니다.\n`,
  );
}
/**
 * `generate` 가 이미 만들어 둔 원인을 그대로 보여 준다.
 *
 * `GENERATE_FAILED` 로 뭉개면 사용자는 "MCP 서버와 출력 경로를 확인하세요" 를 보는데,
 * 스키마 거절에서 그건 **틀린 조치다** — 서버도 경로도 멀쩡하다. 실제로 이 결함 때문에
 * 원인을 알아내려고 `generate` 소스를 읽어야 했다 (#136 · `docs/adoption.md` §2.3).
 */
function generateTestsFailure(
  deps: GenerateCommandDependencies,
  error: {
    readonly code: string;
    readonly path: string;
    readonly message: string;
    readonly hint: string;
  },
): void {
  deps.writeStderr(
    `오류 [${error.code}]: ${error.message} 경로: ${error.path}\n해결: ${error.hint}\n`,
  );
}

/**
 * core 의 McpClientError 인지 구조로 확인한다. core 를 import 하지 않는다.
 * `test-command.ts` 의 `coreError` 와 같은 판별인데, 그쪽은 AggregateError 안까지 내려가고
 * 진단을 함께 꺼낸다. 여기 연결 오류는 core 가 직접 던지므로 겉모양 검사로 충분하다.
 */
function isCoreClientError(value: unknown): value is {
  readonly code: string;
  readonly message: string;
  readonly hint: string;
  readonly diagnostics?: unknown;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    value.name === "McpClientError" &&
    "code" in value &&
    typeof value.code === "string" &&
    "message" in value &&
    typeof value.message === "string" &&
    "hint" in value &&
    typeof value.hint === "string"
  );
}

/** 커밋에 쓰는 hard link를 출력 디렉터리가 지원하지 않거나 권한이 없는 경우. */
type LinkUnsupportedCode = "EPERM" | "ENOTSUP";
class LinkUnsupportedError extends Error {
  constructor(
    readonly path: string,
    readonly code: LinkUnsupportedCode,
  ) {
    super("link unsupported");
  }
}
/**
 * hard link 불가 안내. `code`는 위 두 값만 들어오는 닫힌 집합이라 그대로 보여준다.
 * errno 이름은 사용자가 검색할 때 쓰는 단서이고 raw stderr나 인증정보가 아니다.
 * 임의의 오류 문자열을 흘려보내지 않으려고 타입으로 좁혀 뒀다.
 */
function linkUnsupportedFailure(
  deps: GenerateCommandDependencies,
  path: string,
  code: LinkUnsupportedCode,
): void {
  deps.writeStderr(
    `오류 [GENERATE_LINK_UNSUPPORTED]: 출력 디렉터리가 hard link를 지원하지 않거나 권한이 없어 저장하지 못했습니다. 경로: ${path} (원인: ${code})\n해결: 로컬 디스크의 다른 디렉터리를 \`--out\`으로 지정한 뒤 다시 저장하세요. 네트워크 마운트(NFS·SMB 일부), FAT/exFAT USB, 컨테이너 바인드 마운트에서 주로 납니다.\n`,
  );
}
/** 검토 도중 입력 스트림이 닫혔음을 알리는 sentinel. 사용자 취소와 같은 경로로 처리한다. */
class ReviewInputClosedError extends Error {}
/**
 * 입력 스트림이 닫혀 발생한 오류인지 판정한다.
 * sentinel 외에 Node readline의 ERR_USE_AFTER_CLOSE도 인정한다. nodeReviewIO가 아닌 ReviewIO
 * 구현이 readline을 직접 감싸도 같은 종료 경로를 타게 하기 위함이다.
 */
function isReviewInputClosed(error: unknown): boolean {
  if (error instanceof ReviewInputClosedError) return true;
  return (error as { code?: unknown } | null)?.code === "ERR_USE_AFTER_CLOSE";
}

const optionNames = new Set([
  "--suite-id",
  "--name",
  "--out",
  "--command",
  "--arg",
  "--url",
  "--header-env",
  "--baseline-only",
  "--provider",
  "--model",
  "--no-dry-run",
  "--reset-cmd",
  "--no-repair",
  "--force",
]);
/** 값을 받지 않는 옵션. `=` 를 붙여 쓸 수 없고 두 번 쓸 수 없다. */
const flagNames = new Set(["--baseline-only", "--no-dry-run", "--no-repair", "--force"]);
const removedGenerateOptions = new Set(["--cassette", "--record"]);
const removedGenerateOptionMessage = (option: string): string =>
  `\`${option}\` generate 옵션은 Tool 카세트와 함께 제거되었습니다(ADR-0059). ` +
  "시험 실행은 서버를 직접 호출합니다. 서버의 외부 HTTP 호출을 녹화하려면 " +
  "`mcpeak test <suite.json> --command <executable> --record-session <path>`를, " +
  "재생하려면 `mcpeak test <suite.json> --command <executable> --session <path>`를 사용하세요. " +
  "서버를 대신하려면 `mcpeak test <suite.json> --command mcpeak-mock --arg <mock.json>`을 사용하세요.";
function optionValue(argv: readonly string[], index: number, option: string): [string, number] {
  const item = argv[index];
  if (item === undefined) throw new UsageError(`\`${option}\` 옵션 값이 필요합니다.`);
  const equals = item.indexOf("=");
  if (equals > 0) return [item.slice(equals + 1), index];
  const value = argv[index + 1];
  if (value === undefined || (option !== "--arg" && value.startsWith("--")))
    throw new UsageError(`\`${option}\` 옵션 값이 필요합니다.`);
  return [value, index + 1];
}

/**
 * `--out` 에서 스위트 id·name 을 유도한다. `contract.suite.json` → `contract`(#242).
 * 명시한 값이 있으면 그쪽이 이긴다. 뽑을 이름이 없으면 `undefined` 를 주고 호출 측이 요구한다.
 *
 * **파일명이 승인 지문에 들어간다.** `suiteFingerprint` 가 `approval` 만 빼고 전부 해시하므로
 * (`packages/runner/src/fingerprint.ts`) 출력 파일명을 바꿔 다시 생성하면 지문이 달라져
 * 재승인이 뜬다. 그 사실을 `--out` 도움말이 말한다. ADR-0073.
 */
const deriveSuiteName = (out: string): string | undefined => {
  // `--out` 검사가 `.json` 을 대소문자 비구분으로 받으므로(아래 outPath 검사) 여기도 같아야
  // 한다. 한쪽만 구분하면 `contract.SUITE.JSON` 이 통과한 뒤 id 로 파일명 전체가 들어간다.
  const strip = (value: string, suffix: string): string =>
    value.toLowerCase().endsWith(suffix) ? value.slice(0, -suffix.length) : value;
  const derived = strip(strip(basename(out), ".json"), ".suite");
  return derived === "" ? undefined : derived;
};

export function parseGenerateCommand(argv: readonly string[]): GenerateCommandInput {
  const values = new Map<string, string>();
  const args: string[] = [];
  const flags = new Set<string>();
  // `--arg` 와 같이 되풀이할 수 있는 옵션이라 `values` 맵에 넣지 않는다(#137).
  const headerEnv = createHeaderEnvCollector();
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === undefined) continue;
    /**
     * `--` 뒤는 전부 서버를 띄울 명령이다. npm · cargo · docker 가 쓰는 관례다(#242).
     * 첫 토큰이 실행 파일, 나머지가 그 인자다. **뒤에 오는 것을 해석하지 않으므로**
     * `--arg` 가 값 검사에 두던 특수분기가 이 경로에는 필요 없다.
     */
    if (item === "--") {
      if (values.has("--command"))
        throw new UsageError(
          "`--command` 와 `--` 를 함께 쓸 수 없습니다.\n" +
            "→ 둘 다 서버를 띄울 명령을 정하므로 대상이 둘이 됩니다.\n" +
            "→ `--` 뒤에는 실행 파일과 인자를 그대로 적습니다.",
        );
      // `--arg` 는 `--command` 의 짝이다. `--` 와 섞으면 앞의 값이 통과 인자 **앞에**
      // 조용히 끼어들어 사용자가 적지 않은 순서로 서버가 뜬다.
      if (args.length > 0)
        throw new UsageError(
          "`--arg` 와 `--` 를 함께 쓸 수 없습니다.\n" +
            "→ `--arg` 로 준 값이 `--` 뒤의 인자 앞에 끼어듭니다.\n" +
            "→ `--` 를 쓰면 인자도 그 뒤에 모두 적습니다.",
        );
      const rest = argv.slice(index + 1);
      const executable = rest[0];
      if (executable === undefined || executable === "")
        throw new UsageError(
          "`--` 뒤에 실행할 명령이 없습니다.\n" +
            "→ `-- <executable> [args...]` 처럼 첫 토큰에 실행 파일을 적으세요.",
        );
      values.set("--command", executable);
      args.push(...rest.slice(1));
      break;
    }
    const option = item.includes("=") ? item.slice(0, item.indexOf("=")) : item;
    if (!option.startsWith("--"))
      throw new UsageError(`추가 위치 인자 '${item}'는 허용되지 않습니다.`);
    if (removedGenerateOptions.has(option))
      throw new UsageError(removedGenerateOptionMessage(option));
    if (!optionNames.has(option))
      throw new UsageError(`지원하지 않는 generate 옵션 '${option}'입니다.`);
    if (flagNames.has(option)) {
      if (item !== option || flags.has(option))
        throw new UsageError(`\`${option}\`는 한 번만 사용할 수 있습니다.`);
      flags.add(option);
      continue;
    }
    const [value, consumed] = optionValue(argv, index, option);
    index = consumed;
    if (option === "--arg") {
      args.push(value);
      continue;
    }
    if (option === "--header-env") {
      const parsed = parseHeaderEnvOption(value);
      if (!parsed.ok) throw new UsageError(parsed.message);
      const rejected = headerEnv.add(parsed.value.header, parsed.value.envName);
      if (rejected !== undefined) throw new UsageError(rejected);
      continue;
    }
    if (values.has(option)) throw new UsageError(`\`${option}\`는 한 번만 사용할 수 있습니다.`);
    values.set(option, value);
  }
  const out = values.get("--out");
  if (out === undefined) throw new UsageError("`--out` 옵션이 필요합니다.");
  const derived = deriveSuiteName(out);
  for (const option of ["--suite-id", "--name"] as const) {
    if (values.get(option) !== undefined) continue;
    if (derived === undefined)
      throw new UsageError(
        `\`${option}\` 옵션이 필요합니다.\n` +
          "→ `--out` 파일명에서 이름을 뽑을 수 없어 직접 지정해야 합니다.",
      );
    values.set(option, derived);
  }
  // transport 확정. 규칙과 문장은 `test` 와 같아야 한다 — 같은 사람이 두 커맨드를 잇달아
  // 쓰는데 한쪽만 다르게 거절하면 그 차이를 기능으로 읽는다(#137).
  const command = values.get("--command");
  const rawUrl = values.get("--url");
  if (command !== undefined && rawUrl !== undefined)
    throw new UsageError(
      "`--command` 와 `--url` 은 함께 쓸 수 없습니다.\n" +
        "→ `--command` 는 서버를 프로세스로 띄우고, `--url` 은 이미 떠 있는 원격 서버에 붙습니다.\n" +
        "→ 둘 중 무엇에서 명세를 뽑을지 하나만 고르세요.",
    );
  if (command === undefined && rawUrl === undefined)
    throw new UsageError("`--command` 또는 `--url` 옵션이 필요합니다.");
  if (rawUrl !== undefined && args.length > 0)
    throw new UsageError(
      "`--arg` 는 `--url` 과 함께 쓸 수 없습니다.\n" +
        "→ `--arg` 는 우리가 띄우는 프로세스에 넘길 인자입니다. 원격 서버에는 띄울 프로세스가 없습니다.",
    );
  if (command !== undefined && !headerEnv.isEmpty())
    throw new UsageError(
      "`--header-env` 는 `--url` 과 함께만 쓸 수 있습니다.\n" +
        "→ 헤더는 HTTP 요청에 실립니다. `--command` 로 띄운 서버와는 stdio 로 이야기합니다.",
    );
  const url = ((): string | undefined => {
    if (rawUrl === undefined) return undefined;
    const parsed = parseUrlOption(rawUrl);
    if (!parsed.ok) throw new UsageError(parsed.message);
    return parsed.value;
  })();
  const outPath = values.get("--out") as string;
  if (!outPath.toLowerCase().endsWith(".json"))
    throw new UsageError("`--out`은 .json 파일이어야 합니다.");
  const rawProvider = values.get("--provider");
  if (rawProvider !== undefined && rawProvider !== "codex" && rawProvider !== "claude")
    throw new UsageError("`--provider`는 codex 또는 claude여야 합니다.");
  if (values.has("--model") && rawProvider === undefined)
    throw new UsageError("`--model`은 `--provider`와 함께만 사용할 수 있습니다.");
  const dryRun = !flags.has("--no-dry-run");
  const repair = !flags.has("--no-repair");
  // 교정은 시험 실행 안에서만 일어난다. 실행을 끈 채로 교정을 끄면 끄는 대상이 없고, 그 조합은
  // 사용자가 둘 중 하나를 착각한 것이다. 조용히 무시하는 대신 사용 오류로 돌려준다.
  if (!dryRun && !repair)
    throw new UsageError("`--no-dry-run`과 `--no-repair`는 함께 사용할 수 없습니다.");
  const resetCmd = values.get("--reset-cmd");
  // 시험 실행을 끄면 서버를 접촉하지 않는다. 초기화는 접촉을 전제한 옵션이므로 함께 주면
  // 조용히 무시된다. 무시하는 대신 사용 오류로 돌려준다.
  if (!dryRun && resetCmd !== undefined)
    throw new UsageError("`--no-dry-run`과 `--reset-cmd`는 함께 사용할 수 없습니다.");
  if (resetCmd !== undefined && resetCmd.trim() === "")
    throw new UsageError("`--reset-cmd` 옵션 값이 필요합니다.");
  return Object.freeze({
    suiteId: values.get("--suite-id") as string,
    name: values.get("--name") as string,
    outPath,
    target:
      url === undefined
        ? Object.freeze({
            transport: "stdio" as const,
            // 위 두 검사가 "둘 다" 와 "둘 다 아님" 을 걷어냈으므로 여기 오면 반드시 있다.
            command: command as string,
            args: Object.freeze(args),
          })
        : Object.freeze({
            transport: "http" as const,
            url,
            headerEnv: headerEnv.snapshot(),
          }),
    baselineOnly: flags.has("--baseline-only"),
    provider: rawProvider,
    model: values.get("--model"),
    dryRun,
    force: flags.has("--force"),
    resetCmd,
    repair,
  });
}

/**
 * 저장 키 순서는 설계 문서 §3.3이 고정한다. `approval`을 `cases` 앞에 두는 이유는 사람이
 * 파일을 열었을 때 첫 화면에서 보이게 하기 위해서다. 지문 계산은 `canonicalJson`이 키를
 * 정렬하므로 이 순서에 영향받지 않는다. 즉 가독성 결정이지 계약이 아니다.
 */
function renderSuite(
  suite: TestSuiteSpec,
  fingerprint: string,
  cases: readonly SuiteCaseApproval[],
): string {
  const ordered: Record<string, unknown> = {
    schemaVersion: suite.schemaVersion,
    id: suite.id,
    name: suite.name,
    // 빈 배열이면 키를 넣지 않는다. `[]` 는 "시험 실행을 했는데 케이스가 0개" 와 "시험 실행을
    // 하지 않았다" 를 구분하지 못한다. 키가 없는 것이 후자의 표현이다.
    approval: cases.length === 0 ? { fingerprint } : { fingerprint, cases },
  };
  if (suite.defaultTimeoutMs !== undefined) ordered.defaultTimeoutMs = suite.defaultTimeoutMs;
  ordered.cases = suite.cases;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
let temporarySequence = 0;
/**
 * 임시 파일 이름은 실행마다 고유해야 한다. 고정 이름이면 같은 디렉터리에서 두 실행이 겹칠 때
 * `openTemp`의 `wx`가 EEXIST로 실패하는데, 그것은 출력 경로 충돌과 전혀 다른 실패다.
 * 저장되는 suite 내용에는 들어가지 않으므로 결정론성 요구와 무관하다.
 */
function temporaryPath(outPath: string): string {
  temporarySequence += 1;
  return join(
    dirname(outPath),
    `.${basename(outPath)}.mcpeak.${process.pid}.${temporarySequence}.tmp`,
  );
}
async function saveSuite(
  input: GenerateCommandInput,
  suite: TestSuiteSpec,
  fingerprint: string,
  deps: GenerateCommandDependencies,
  approvals: readonly SuiteCaseApproval[] = [],
): Promise<void> {
  // 선검사는 사용자에게 더 빨리 알려주기 위한 것이고 **보장이 아니다.** 여기서 통과해도
  // 커밋 직전에 다른 프로세스가 같은 경로를 만들 수 있다. no-clobber 보장은 아래 link에 있다.
  // `--force` 는 사용자가 이 경로를 지우겠다고 밝힌 것이므로 편의 검사를 건너뛴다.
  if (!input.force && (await deps.exists(input.outPath)))
    throw new OutputExistsError(input.outPath);
  const temporary = temporaryPath(input.outPath);
  let created = false;
  try {
    const handle = await deps.openTemp(temporary);
    created = true;
    try {
      await handle.writeFile(renderSuite(suite, fingerprint, approvals), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const bytes = await deps.readFile(temporary);
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const validated = deps.validateSuite(parsed);
    // 셋째 조건이 필요한 이유. 둘째 조건은 `approval`을 제외해 계산하므로 파일에 적힌 지문이
    // 틀려도 통과한다. 즉 renderSuite가 지문을 잘못 써넣는 결함을 둘째 조건만으로는 못 잡는다.
    // 설계 문서 §8.
    if (
      !validated.valid ||
      suiteFingerprint(validated.value) !== fingerprint ||
      validated.value.approval?.fingerprint !== fingerprint
    )
      throw new Error("invalid saved suite");
    // 커밋. link는 대상이 있으면 EEXIST로 실패한다. rename처럼 남의 파일을 덮어쓰지 않는다.
    //
    // hard link를 못 쓰는 파일시스템(EPERM/ENOTSUP)에서 rename으로 떨어뜨리고 싶어지는
    // 자리다. 하지 마라. rename은 대상이 있으면 **말없이 덮어쓴다.** 실측으로 확인했다
    // (docs/reports/task-r4.md: link는 EEXIST로 실패하며 기존 내용 PRECIOUS를 보존했고,
    // rename은 같은 상황에서 NEW로 덮어썼다). fallback을 넣는 순간 R4에서 없앤 데이터 손실
    // 결함이 그대로 돌아온다. 저장하지 못하는 편이 남의 파일을 날리는 것보다 낫다.
    // `--force` 의 덮어쓰기. 지우고 link 하는 순서를 지킨다. rename 으로 바꾸지 마라.
    // 덮어쓸 수 있는 primitive 를 두지 않는다는 것이 R4 의 결론이고, `--force` 는 "이 경로를
    // 내가 지운다" 는 뜻이지 "무엇이든 덮어쓴다" 는 뜻이 아니다. 설계 문서 §5.
    //
    // 이 사이에 다른 프로세스가 같은 경로를 만들면 아래 link 가 EEXIST 로 실패한다. 그 창을
    // 없애려고 rename 을 쓰면 남의 파일을 말없이 덮어쓰는 결함이 돌아온다.
    if (input.force)
      await deps.unlink(input.outPath).catch((error: unknown) => {
        const code = (error as { code?: unknown } | null)?.code;
        // 선검사와 저장 사이에 사용자가 파일을 치운 경우다. 결과가 원하는 상태와 같다.
        if (code === "ENOENT") return;
        throw new OutputReplaceError(input.outPath, typeof code === "string" ? code : undefined);
      });
    try {
      await deps.link(temporary, input.outPath);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === "EEXIST") throw new OutputExistsError(input.outPath);
      if (code === "EPERM" || code === "ENOTSUP")
        throw new LinkUnsupportedError(input.outPath, code);
      throw error;
    }
  } finally {
    // link는 원본을 남기므로 성공해도 임시를 지운다. 실패했을 때의 정리 경로와 같다.
    if (created) await deps.unlink(temporary).catch(() => undefined);
  }
}

const defaultModel = (provider: "codex" | "claude") =>
  provider === "codex" ? "gpt-5.6-luna" : "haiku";

function showRequest(io: ReviewIO, preview: AuthoringRequestPreview): void {
  io.write(
    `Provider: ${preview.providerId}\nModel: ${preview.model}\nPayload: ${preview.byteLength} bytes\nResult limit: ${preview.maxResultBytes} bytes\nTimeout: ${preview.providerTimeoutMs}ms\nFingerprint: ${preview.fingerprint}\n전송 데이터: 사용자 요청, baseline suite, current candidate, 툴 이름·설명·inputSchema\n`,
  );
}
// 승인 화면은 스크롤 없이 읽혀야 한다. 케이스 하나의 diff가 이보다 커지면 사람이 화면으로
// 판단할 수 없고 저장 후 JSON을 여는 편이 맞는 경로다. 40줄은 흔한 터미널 높이(24~50줄)에서
// 헤더와 메뉴 프롬프트를 빼고 남는 분량이다.
const MAX_DIFF_BODY_LINES = 40;

/**
 * leaf 경로와 JSON 값을 문서 순서(Object.keys 순, 배열 인덱스 순)로 모은다.
 * 정렬하지 않는다. 같은 입력에 항상 같은 출력이 나와야 하고 문서 순서로 그것이 만족된다.
 * 빈 객체와 빈 배열은 그 자체를 leaf로 본다. 그러지 않으면 경로가 조용히 사라진다.
 */
function leaves(value: unknown, prefix = ""): (readonly [string, string])[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [[prefix, "[]"] as const];
    return value.flatMap((item, index) => leaves(item, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return [[prefix, "{}"] as const];
    return entries.flatMap(([key, nested]) =>
      leaves(nested, prefix === "" ? key : `${prefix}.${key}`),
    );
  }
  return [[prefix, JSON.stringify(value) ?? "undefined"] as const];
}
/** before/after의 leaf를 비교해 다른 경로만 남긴다. 같은 경로의 -와 +는 붙여서 쓴다. */
function changedLeaves(before: unknown, after: unknown): string[] {
  const afterLeaves = leaves(after);
  const afterByPath = new Map(afterLeaves);
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const [path, value] of leaves(before)) {
    seen.add(path);
    if (!afterByPath.has(path)) {
      lines.push(`- ${path}: ${value}`);
      continue;
    }
    const next = afterByPath.get(path);
    if (next === value) continue;
    lines.push(`- ${path}: ${value}`, `+ ${path}: ${next}`);
  }
  for (const [path, value] of afterLeaves) if (!seen.has(path)) lines.push(`+ ${path}: ${value}`);
  return lines;
}
function diffBody(change: AuthoringDiffPreview["changes"][number]): string[] {
  switch (change.type) {
    case "addCase":
      return leaves(change.case).map(([path, value]) => `+ ${path}: ${value}`);
    case "removeCase":
      return leaves(change.case).map(([path, value]) => `- ${path}: ${value}`);
    case "caseOrder":
      return [`- ${change.before.join(", ")}`, `+ ${change.after.join(", ")}`];
    default:
      return changedLeaves(change.before, change.after);
  }
}
function showDiff(io: ReviewIO, preview: AuthoringDiffPreview): void {
  if (preview.changes.length === 0) {
    io.write(
      "AI가 제안한 변경이 없습니다.\n" +
        "  → 원하는 케이스를 `AI 요청:`에 구체적으로 적어 다시 물어보세요.\n" +
        "  → 지금 상태로 저장하려면 save를 고르세요.\n",
    );
    return;
  }
  for (const change of preview.changes) {
    const body = diffBody(change);
    const shown =
      body.length > MAX_DIFF_BODY_LINES
        ? [
            ...body.slice(0, MAX_DIFF_BODY_LINES),
            `... 이하 ${body.length - MAX_DIFF_BODY_LINES}줄 생략. 전체는 저장 후 JSON을 확인하세요.`,
          ]
        : body;
    io.write(
      `${change.id} ${change.type}${"caseId" in change ? ` ${change.caseId}` : ""}\n` +
        shown.map((line) => `  ${line}\n`).join(""),
    );
  }
}
/**
 * 머리글 하나와 그 아래 케이스별 문장을 찍는다. finding 이 없으면 아무것도 안 찍는다.
 * `byCase` 순회는 `Map` 삽입 순서이고 그것이 곧 `runner` 가 정한 finding 순서다. 정렬하지
 * 않는다. 여기서 다시 정렬하면 같은 명세가 화면마다 다른 순서로 보인다.
 */
function writeFindingBlock(
  io: ReviewIO,
  diff: AuthoringDiffPreview,
  heading: string,
  findings: readonly SpecFinding[],
): void {
  if (findings.length === 0) return;
  const byCase = new Map<string, SpecFinding[]>();
  for (const finding of findings) {
    const list = byCase.get(finding.caseId) ?? [];
    list.push(finding);
    byCase.set(finding.caseId, list);
  }
  io.write(`${heading} ${findings.length}건 (선택한 변경 기준)\n`);
  for (const [caseId, list] of byCase) {
    const change = diff.changes.find((item) => "caseId" in item && item.caseId === caseId);
    io.write(`  → ${change?.id ?? ""} ${caseId}\n`);
    // 문장은 describeSpecFinding 만 만든다. 여기서는 들여쓰기만 붙인다.
    for (const finding of list) io.write(`     ${describeSpecFinding(finding)}\n`);
  }
}

/**
 * 선택한 change 의 caseId 집합에 걸린 finding 만 뽑는다. 순서는 재정렬하지 않는다.
 * runner 가 정한 순서가 곧 사양이고, 여기서 다시 정렬하면 화면마다 순서가 갈린다.
 *
 * caseId 가 없는 change 종류(suiteMetadata · caseOrder)는 집합에 아무것도 넣지 않는다.
 * 위반 케이스를 선택에서 뺐으면 경고할 이유가 없다.
 */
function findingsForSelection(
  candidate: SanitizedAuthoringCandidate,
  preview: AuthoringDiffPreview,
  selectedChangeIds: readonly string[],
): readonly SpecFinding[] {
  const ids = new Set(selectedChangeIds);
  const caseIds = new Set(
    preview.changes
      .filter((change) => ids.has(change.id) && "caseId" in change)
      .map((change) => (change as { caseId: string }).caseId),
  );
  return [
    ...candidate.specFindings.inputContract.findings,
    ...candidate.specFindings.assertionSubstance.findings,
  ].filter((finding) => caseIds.has(finding.caseId));
}

/**
 * 선택한 변경에 걸린 위반을 두 블록으로 갈라 찍고, 위반이 있으면 재확인을 하나 더 받는다.
 * 반환값이 false 면 적용을 멈추고 메뉴로 돌아간다.
 *
 * 두 검사를 한 머리글 아래 합치지 않는다. `VACUOUS_MIN_LENGTH` 는 입력 문제가 아니라 단언
 * 문제인데 `입력 계약 위반` 아래 붙으면 읽는 사람이 입력을 고치러 간다. 화면에 찍히는 문장이
 * 곧 제품이므로 어디를 고쳐야 하는지가 머리글에서 갈려야 한다.
 *
 * 재확인은 하나만 받는다. 개수는 두 종류의 합이다. 종류마다 확인을 받으면 화면만 길어지고
 * 사용자가 내리는 판단은 여전히 "그래도 적용할까" 하나다.
 *
 * 거부하지 않고 재확인만 받는다. 서버가 inputSchema 를 느슨하게 선언하면 정상 명세도
 * UNDECLARED_FIELD 로 걸리므로, 거부하면 옳은 명세를 저장할 길이 막힌다.
 */
async function confirmSpecFindings(
  io: ReviewIO,
  candidate: SanitizedAuthoringCandidate,
  diff: AuthoringDiffPreview,
  selected: readonly string[],
): Promise<boolean> {
  const findings = findingsForSelection(candidate, diff, selected);
  const grouped = (group: FindingGroup): readonly SpecFinding[] =>
    findings.filter((finding) => FINDING_GROUP[finding.code] === group);
  const inputContract = grouped("inputContract");
  const assertionSubstance = grouped("assertionSubstance");
  const rejectionIntent = grouped("rejectionIntent");
  const skipped = grouped("skipped").length;
  // 입력 계약 블록이 먼저다. 명세를 고칠 때 입력이 먼저 맞아야 단언을 볼 수 있다.
  writeFindingBlock(io, diff, "입력 계약 위반", inputContract);
  writeFindingBlock(io, diff, "항상 통과하는 단언", assertionSubstance);
  // 위반이 아니라 의도 불명 신호(#94)다. '위반 N건' 재확인에 넣으면 문구가 거짓이 되고,
  // 선언 밖 제약으로 거절받는 정당한 케이스의 저장에 마찰을 더한다. 표시만 하고 total 에서 뺀다.
  writeFindingBlock(io, diff, "거절 근거가 불분명한 케이스", rejectionIntent);
  if (skipped > 0) io.write(`  → 해석하지 못한 서버 스키마 ${skipped}건은 검사에서 빠졌습니다.\n`);
  const total = inputContract.length + assertionSubstance.length;
  if (total === 0) return true;
  return io.confirm(`위반 ${total}건이 남아 있습니다. 그래도 적용합니까?`);
}
function safeFailure(deps: GenerateCommandDependencies, code: string): void {
  deps.writeStderr(
    `오류 [GENERATE_${code}]: AI 검토 요청을 완료하지 못했습니다.\n해결: 입력과 provider 상태를 확인한 뒤 메뉴에서 다시 요청하세요.\n`,
  );
}
/** provider별 로그인 확인 명령. 두 provider의 명령을 함께 찍으면 사용자가 헛수고한다. */
const authCommand = (provider: "codex" | "claude") =>
  provider === "codex" ? "codex login status" : "claude /status";
/**
 * nonZeroExit의 reason별 안내. reason은 nonZeroExit 경로에서만 채워지는 닫힌 enum이며,
 * 값이 없으면 원인을 모르는 것이므로 추측하지 않고 확인할 것을 모두 알려준다.
 *
 * 문구 규칙: 변수 바로 뒤에 조사를 붙이지 않는다. 한국어 조사는 앞말의 받침에 따라 형태가
 * 갈리는데(을/를, 으로/로) 모델 이름과 종료 코드는 어떤 값이 올지 모른다. 어느 쪽으로 고정해도
 * 반드시 틀리는 경우가 생기므로 `모델: {model}`처럼 라벨을 붙이거나 `명령으로`처럼 고정된
 * 명사를 끼워 조사가 앞말에 의존하지 않게 한다.
 */
function exitMessage(failure: PublicProviderFailure, model: string): string {
  const id = failure.providerId;
  const fallback = defaultModel(id);
  switch (failure.reason) {
    case "unknownModel":
      return `오류 [GENERATE_PROVIDER_MODEL]: ${id}가 이 모델을 사용할 수 없습니다. 모델: ${model}\n해결: 모델 이름을 확인하세요. 이 계정에서 쓸 수 없는 모델일 수도 있습니다. ${id} 기본값은 ${fallback}입니다.\n`;
    case "notAuthenticated":
      return `오류 [GENERATE_PROVIDER_AUTH]: ${id} 인증이 유효하지 않습니다.\n해결: \`${authCommand(id)}\` 명령으로 로그인 상태를 확인한 뒤 다시 요청하세요.\n`;
    case "rateLimited":
      return `오류 [GENERATE_PROVIDER_RATE_LIMIT]: ${id}가 요청 한도를 초과했습니다.\n해결: 잠시 뒤 다시 요청하세요. 반복되면 도구 수를 줄여 payload를 줄이세요.\n`;
    // codex는 없는 모델에도, 잘못된 output schema에도 400을 준다. 둘을 구분할 수 없으므로
    // 구분한 척하지 않고 사용자가 확인할 두 가지를 다 알려준다.
    case "badRequest":
      return `오류 [GENERATE_PROVIDER_REQUEST]: ${id}가 요청을 거절했습니다. 모델: ${model}\n해결: 두 가지를 확인하세요.\n  1. 모델 이름이 이 계정에서 쓸 수 있는지. ${id} 기본값은 ${fallback}입니다.\n  2. provider가 전송 schema를 받아들이는지. 반복되면 다른 provider로 시도하세요.\n`;
    case "serverError":
      return `오류 [GENERATE_PROVIDER_SERVER]: ${id} 쪽 서버 오류입니다.\n해결: 잠시 뒤 다시 요청하세요. 계속되면 provider 상태 페이지를 확인하세요.\n`;
    // 설치된 CLI 버전에 우리가 넘긴 옵션이 없으면 요청이 API 에 닿지도 못한다. 예전에는 근거가
    // 없어 이 경우가 아래 default 로 떨어졌고, 화면이 로그인·모델을 확인하라고 했다(#285).
    case "unknownOption": {
      // 옵션 이름은 우리 args 에서 고른 값이다. 없으면 라벨째 뺀다.
      const option = failure.option === undefined ? "" : ` 옵션: ${failure.option}`;
      return `오류 [GENERATE_PROVIDER_OPTION]: 설치된 ${id}가 우리가 넘긴 옵션을 모릅니다.${option}\n  → 로그인도 모델도 원인이 아닙니다. CLI가 뜨기도 전에 옵션 해석에서 멈췄습니다.\n해결: \`${id} --version\` 으로 버전을 확인하고 최신 버전으로 올리세요.\n`;
    }
    default: {
      // exitCode도 변수다. `코드 3로`는 "삼으로"라 틀린다. 라벨 형태로 조사를 떼어 둔다.
      const exit = failure.exitCode === undefined ? "" : `종료 코드: ${failure.exitCode}, `;
      return `오류 [GENERATE_PROVIDER_EXIT]: ${id}가 종료했습니다. ${exit}모델: ${model}\n해결: \`${authCommand(id)}\` 명령으로 로그인 상태를 확인하고, 모델 이름이 맞는지 확인하세요.\n`;
    }
  }
}
/**
 * provider 실패를 원인별 안내로 분기한다. 사용자 조치가 다르므로 문구를 나눈다.
 * 먼저 failure.code로 갈리고, nonZeroExit은 exitMessage에서 reason으로 한 겹 더 갈린다.
 * failure를 알 수 없는 경로(dispatch 자체가 throw)는 기존 GENERATE_PROVIDER_FAILED를 유지한다.
 */
function providerFailure(
  deps: GenerateCommandDependencies,
  failure: PublicProviderFailure | undefined,
  model: string,
): void {
  if (!failure) {
    safeFailure(deps, "PROVIDER_FAILED");
    return;
  }
  const id = failure.providerId;
  const message = (() => {
    switch (failure.code) {
      case "providerUnavailable":
        return `오류 [GENERATE_PROVIDER_UNAVAILABLE]: ${id} CLI를 실행할 수 없습니다.\n해결: \`${id} --version\` 명령으로 설치와 PATH를 확인한 뒤 다시 요청하세요.\n`;
      case "nonZeroExit":
        return exitMessage(failure, model);
      case "timedOut":
        return `오류 [GENERATE_PROVIDER_TIMEOUT]: ${id} 응답이 ${failure.timeoutMs}ms 안에 오지 않았습니다.\n해결: 도구 수를 줄이거나 timeout을 늘려 다시 요청하세요.\n`;
      case "schemaMismatch":
        return `오류 [GENERATE_PROVIDER_SCHEMA]: ${id}가 요구한 형식과 다른 결과를 돌려줬습니다.\n해결: 다시 요청하세요. 반복되면 다른 provider로 바꿔 시도하세요.\n`;
      case "cancelled":
        return "오류 [GENERATE_PROVIDER_CANCELLED]: AI 검토 요청이 취소됐습니다.\n해결: 메뉴에서 다시 요청하세요.\n";
      default:
        return undefined;
    }
  })();
  if (message === undefined) safeFailure(deps, "PROVIDER_FAILED");
  else deps.writeStderr(message);
}

/**
 * 시험 실행 화면이 쓰는 서버 stderr 줄 수. `test` 의 `--stderr-lines` 기본값과 같은 값이다.
 * `generate` 에는 그 옵션이 없으므로 기본값 하나만 둔다.
 */
const DRY_RUN_STDERR_LINES = 20;

/**
 * 실패 케이스 머리글. 결과 화면(§8.2)과 분류 화면(dry-run-review.ts, §8.3)이 **같은 모양**이어야
 * 한다. 두 화면이 같은 케이스를 다르게 부르면 사용자가 둘을 대조하지 못한다.
 */
const failureHeading = (index: number, caseName: string): string =>
  `  [${index + 1}] ${caseName}\n`;

/**
 * `renderReport` 가 만든 케이스 블록을 이 화면 들여쓰기로 옮긴다. 두 칸을 앞에 붙이기만 하고
 * 문장은 건드리지 않는다. dry-run-review.ts 의 같은 처리와 규칙이 같다.
 */
const detailBlock = (detail: string): string =>
  detail === ""
    ? ""
    : `${detail
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")}\n`;

/** 시험 실행 고지(§8.1). 초기화는 값이 있을 때만 줄이 나간다. */
function writeDryRunNotice(
  io: ReviewIO,
  notice: {
    readonly caseCount: number;
    readonly target: string;
    readonly resetCmd?: string;
    /** 교정 단계가 켜져 있는가. 켜져 있으면 실제 호출 수가 케이스 수보다 많을 수 있다(§10). */
    readonly repair: boolean;
  },
): void {
  io.write(`시험 실행: 케이스 ${notice.caseCount}개를 실제 서버에 보냅니다.\n`);
  io.write(`  대상: ${notice.target}\n`);
  if (notice.resetCmd !== undefined) io.write(`  초기화: ${notice.resetCmd}\n`);
  if (notice.repair) io.write("  실패한 케이스는 값을 고쳐 최대 2회까지 다시 호출합니다.\n");
  io.write(
    "\n이 실행은 서버 상태를 바꿀 수 있습니다. 입력 검증이 없는 서버라면 외부 API 호출도\n그대로 나갑니다.\n",
  );
}

/** 시험 실행 결과(§8.2). 0건인 종류는 찍지 않는다. */
function writeDryRunResult(io: ReviewIO, result: DryRunResult): void {
  const failures = result.outcomes.filter((outcome) => outcome.status !== "passed");
  const passed = result.outcomes.length - failures.length;
  io.write("\n");
  if (passed > 0) io.write(`  ✓ 통과 ${passed}건\n`);
  if (failures.length > 0) io.write(`  ✗ 실패 ${failures.length}건\n`);
  for (const [index, outcome] of failures.entries()) {
    io.write("\n");
    io.write(failureHeading(index, outcome.caseName));
    io.write(detailBlock(outcome.detail));
  }
  // 결과 목록과 그 뒤에 이어지는 분류 질문 사이를 띄운다. 붙으면 같은 케이스가 두 번 찍힌
  // 것처럼 보인다.
  if (failures.length > 0) io.write("\n");
}

/**
 * 거절 근거 미확인 목록 (#89 · 설계 문서 §5.2). 시험 실행 결과 블록 바로 아래에 붙는다.
 *
 * **이 케이스들은 통과했다.** 목록은 판정도 저장 여부도 바꾸지 않는다. `unverified` 는
 * "거절이 아니다" 가 아니라 "확인하지 못했다" 는 뜻이라, 문장이 실패나 결함이라고 말하지 않고
 * 무엇을 확인하지 못했는지만 적는다. 0건이면 아무것도 안 찍는다.
 *
 * 응답 본문은 `escapeTerminalText` 를 그대로 쓴다. 그 함수가 개행(0x0a)까지 이스케이프하므로
 * 여러 줄 응답이 한 줄이 되고 제어 문자도 함께 무해해진다. 자르기는 `runner` 가 이미 진단 값과
 * 같은 상한에서 했다(`clampObservedText`). 여기서 규칙을 새로 만들지 않는다.
 */
function writeRejectionUnverified(io: ReviewIO, result: DryRunResult): void {
  const unverified = result.outcomes.filter((outcome) => outcome.rejectionBasis === "unverified");
  if (unverified.length === 0) return;
  // 열은 이스케이프한 뒤의 폭으로 맞춘다. 순서를 뒤집으면 열이 어긋난다(reporter.ts 와 같다).
  const ids = unverified.map((outcome) => escapeTerminalText(outcome.caseId));
  const column = Math.max(...ids.map((id) => Array.from(id).length));
  io.write(`\n거절 근거 미확인 ${unverified.length}건\n`);
  for (const [index, outcome] of unverified.entries()) {
    const id = ids[index] ?? "";
    const pad = " ".repeat(Math.max(0, column - Array.from(id).length));
    // 본문이 없는 케이스가 있다. 호출이 오류로 끝나면 읽을 응답 자체가 없다(설계 §4.2).
    // 그 사실을 빈칸으로 두지 않고 적는다. 무엇을 못 봤는지가 사용자의 판단 재료다.
    const body =
      outcome.rejectionBody === undefined
        ? "(본문 없음)"
        : escapeTerminalText(outcome.rejectionBody);
    io.write(`  → ${id}${pad}   응답: ${body}\n`);
  }
  // 뒤에 이어지는 질문과 띄운다. 붙으면 안내 문장이 그 질문의 일부처럼 읽힌다.
  // `writeDryRunResult` 가 실패 목록 뒤에 같은 이유로 빈 줄을 넣는다.
  io.write("  이 응답이 서버의 정상 거절인지 내부 오류인지 확인하지 못했습니다.\n\n");
}

/**
 * `verdict` 를 화면 문구로 옮긴다. `Record` 라서 `RejectionVerdict` 가 늘면 여기서 타입 오류가
 * 난다. 문자열 배열로 두면 새 값이 조용히 빠지고, 이 화면에서 누락은 "판단이 없었다" 로 읽힌다.
 */
const VERDICT_LABEL: Readonly<Record<RejectionVerdict, string>> = {
  rejected: "거절로 보임",
  crashed: "서버 내부 오류로 보임",
  unsure: "판단 불가",
};

/**
 * AI 진단 결과를 찍는다. 문안은 설계 문서 §6.4 가 고정한다.
 *
 * **마지막 줄을 빼면 안 된다.** AI 답변이 판정으로 읽히면 사용자가 초록·빨강을 잘못 해석한다.
 */
function writeRejectionDiagnosis(
  io: ReviewIO,
  requested: number,
  results: readonly RejectionDiagnosisResult[],
): void {
  io.write(`\n거절 근거 미확인 ${requested}건에 대해 AI 진단을 요청했습니다.\n\n`);
  const ids = results.map((item) => escapeTerminalText(item.caseId));
  const column = Math.max(0, ...ids.map((id) => Array.from(id).length));
  for (const [index, item] of results.entries()) {
    const id = ids[index] ?? "";
    const pad = " ".repeat(Math.max(0, column - Array.from(id).length));
    io.write(`  ${id}${pad}   ${VERDICT_LABEL[item.verdict]}\n`);
    io.write(`    → ${escapeTerminalText(item.reason)}\n`);
  }
  io.write("\n이 진단은 참고입니다. 케이스 판정과 저장 여부를 바꾸지 않습니다.\n\n");
}

/**
 * 확인 못 한 케이스를 AI 에게 물을지 사람에게 묻고, 답을 받으면 화면에 찍는다 (#89 · §6).
 *
 * 아무것도 안 하고 조용히 지나가는 경우가 셋이다. provider 가 없을 때(대다수 사용자),
 * 확인 못 한 케이스가 없을 때, 물어볼 본문이 하나도 없을 때다. 그때는 질문 자체를 안 한다.
 *
 * **본문이 없는 케이스는 진단에서 뺀다.** 호출이 오류로 끝나 응답이 아예 없는 케이스가 있는데
 * (설계 문서 §4.2), 그것을 빈 문자열로 채워 물으면 AI 에게 판단 재료가 없고 지어낸 `verdict`
 * 만 돌아온다. 뺀 사실은 화면에 남긴다 — 몇 건을 왜 못 물었는지가 사용자의 판단 재료다.
 *
 * 실패는 흐름을 끊지 않는다. 안내만 찍고 승인 화면이 이어진다. 진단은 참고이지 전제가 아니다.
 */
async function askRejectionDiagnosis(options: {
  readonly io: ReviewIO;
  readonly deps: GenerateCommandDependencies;
  readonly result: DryRunResult;
  readonly suite: TestSuiteSpec;
  readonly tools: readonly ToolDef[];
  readonly provider: RejectionDiagnosisProvider | undefined;
  readonly model: string;
}): Promise<void> {
  const { io, deps, provider } = options;
  const prepare = deps.prepareRejectionDiagnosisRequests;
  const dispatch = deps.dispatchRejectionDiagnosis;
  if (provider === undefined || prepare === undefined || dispatch === undefined) return;

  const unverified = options.result.outcomes.filter(
    (outcome) => outcome.rejectionBasis === "unverified",
  );
  if (unverified.length === 0) return;

  const cases = unverified.flatMap((outcome) => {
    // 본문이 없으면 물을 수 없다. 여기서 빠진 수를 아래에서 화면에 적는다.
    if (outcome.rejectionBody === undefined) return [];
    const spec = options.suite.cases.find((item) => item.id === outcome.caseId);
    if (spec === undefined || !isCallTool(spec)) return [];
    const schema = options.tools.find((tool) => tool.name === spec.operation.tool)?.inputSchema;
    return [
      {
        caseId: outcome.caseId,
        tool: spec.operation.tool,
        input: spec.operation.input as JsonObject,
        // 스키마를 못 찾거나 객체가 아니면 빈 객체로 보낸다. 지어내지 않는다.
        inputSchema: (typeof schema === "object" && schema !== null && !Array.isArray(schema)
          ? schema
          : {}) as JsonObject,
        responseBody: outcome.rejectionBody,
        basis: "unverified" as const,
      },
    ];
  });
  const skipped = unverified.length - cases.length;
  if (cases.length === 0) {
    io.write(
      `  응답 본문이 없어 ${skipped}건 전부를 AI 에게 물을 수 없습니다. 진단을 건너뜁니다.\n\n`,
    );
    return;
  }
  if (skipped > 0)
    io.write(
      `  응답 본문이 없는 ${skipped}건은 진단에서 제외합니다. AI 에게 줄 근거가 없습니다.\n`,
    );
  // 값 치환을 적용하지 않는다는 사실을 **묻기 전에** 적는다(ADR-0049). 위 목록이 나가는 본문을
  // 그대로 보여주고 있으므로, 사용자가 그것을 읽고 판단할 재료가 이 한 줄로 완성된다.
  // 문장은 `repair` 의 stderr 안내(`repair-render.ts`)와 같은 계열로 맞춘다. 두 통로가 다른
  // 문장을 쓰면 한쪽만 고쳐지고, 어느 쪽이 최신인지 알 방법이 없다.
  io.write(
    "  ※ 응답 본문은 서버가 자유롭게 쓰는 텍스트라 경로·토큰·데이터가 섞일 수 있습니다.\n" +
      "    값 치환을 적용하지 않습니다.\n",
  );
  if (!(await io.confirm(`  나머지 ${cases.length}건의 진단을 AI 에게 요청할까요?`))) return;

  // `prepare` 는 요청이 상한(256KB)을 넘으면 던진다. **인자 자리에서 부르면 안 된다** —
  // `dispatch` 의 try/catch 밖이고, 검토 루프의 catch 는 입력 종료가 아닌 오류를 다시 던져서
  // 사용자가 안내 대신 스택트레이스를 본다. 진단은 참고이지 저장의 전제가 아니므로, 못 보내면
  // 그 사실만 적고 승인 흐름을 잇는다.
  let requests: Awaited<ReturnType<typeof prepare>>;
  try {
    requests = prepare({ cases });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    io.write(
      `  진단 요청이 크기 상한(256KB)을 넘어 보내지 못했습니다. 미확인 ${cases.length}건의 입력 스키마와 응답을 합친 크기입니다.\n` +
        "  해결: 툴 수가 적은 명세로 나눠 생성한 뒤 다시 시도하세요. 케이스 판정과 저장에는 영향이 없습니다.\n\n",
    );
    return;
  }

  const dispatched = await dispatch({ provider, requests });
  if (dispatched.type === "failed") {
    providerFailure(deps, dispatched.failure, options.model);
    return;
  }
  writeRejectionDiagnosis(io, cases.length, dispatched.results);
}

/** 교정으로 바뀐 값 한 줄. 반영 요약(§8.8)이 쓴다. */
interface RepairApplication {
  readonly tool: string;
  readonly field: string;
  readonly before: JsonValue;
  readonly after: JsonValue;
}

/**
 * 반영 요약(§8.8). 저장 확인 직전에 찍는다. 교정이 0건이면 아무것도 찍지 않는다.
 * 지문이 바뀐 이유가 화면에 남아야 사용자가 나중에 diff 를 보고 놀라지 않는다(§5.4).
 */
function writeRepairSummary(
  io: ReviewIO,
  repairedCases: number,
  changes: readonly RepairApplication[],
): void {
  if (repairedCases === 0) return;
  io.write(`  입력값 교정 ${repairedCases}건이 명세에 반영되었습니다.\n`);
  for (const change of changes)
    io.write(
      `    ${change.tool}.${change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}\n`,
    );
}

/**
 * 교정 대상 판별에 넘길 provenance. `approvedDraft.provenance` 가 유일한 출처다.
 * 여기서 비면 사용자가 손으로 쓴 케이스까지 교정 대상이 되므로(§4.2 의 기본값이
 * `schemaBaseline` 이다) 세션이 실제로 싣는 값을 그대로 쓴다.
 */
const originsOf = (session: AuthoringSessionView): ReadonlyMap<string, TestCaseOrigin> =>
  new Map(session.approvedDraft.provenance.map((item) => [item.caseId, item.origin]));

/**
 * 입력값을 가진 케이스인가. 중첩 필드로는 판별 유니온이 좁혀지지 않아 술어로 뽑는다.
 * 교정은 `callTool` 케이스에만 있다(§4.2).
 */
const isCallTool = (spec: TestCaseSpec): spec is CallToolCaseSpec =>
  spec.operation.type === "callTool";

/** 실제로 값이 바뀐 필드만 §8.8 줄로 만든다. 안 바뀐 필드까지 적으면 요약이 사실과 달라진다. */
const repairApplications = (
  suite: TestSuiteSpec,
  repaired: ReadonlyMap<string, Readonly<Record<string, JsonValue>>>,
): readonly RepairApplication[] => {
  const changes: RepairApplication[] = [];
  for (const item of suite.cases) {
    const input = repaired.get(item.id);
    if (input === undefined || !isCallTool(item)) continue;
    for (const [field, after] of Object.entries(input)) {
      const before = item.operation.input[field] as JsonValue;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      changes.push({ tool: item.operation.tool, field, before, after });
    }
  }
  return changes;
};

/** 교정으로 통과한 값을 케이스에 얹은 후보 명세. `cli` 는 이 객체를 만들기만 하고 반영은 §5 의 3단 경로가 한다. */
const withRepairedInputs = (
  suite: TestSuiteSpec,
  repaired: ReadonlyMap<string, Readonly<Record<string, JsonValue>>>,
): TestSuiteSpec => ({
  ...suite,
  cases: suite.cases.map((item) => {
    const input = repaired.get(item.id);
    if (input === undefined || !isCallTool(item)) return item;
    return { ...item, operation: { ...item.operation, input: input as JsonObject } };
  }),
});

/**
 * 시험 실행이 끝까지 못 간 경우(§8.4). stderr 블록은 단계 1 의 `renderProcessDiagnostics` 를
 * 그대로 쓴다. 여기서 새 렌더러를 만들지 않는다.
 *
 * `outcomes.length` 가 곧 "몇 번째에서 끊겼는가" 다. dry-run.ts 가 끊긴 케이스까지 담아 주므로
 * 여기서 더하거나 빼지 않는다.
 */
function writeDryRunAborted(
  io: ReviewIO,
  result: DryRunResult,
  totalCases: number,
  /**
   * `connection.getDiagnostics()` 의 원값. 좁힌 타입이 아니라 원값을 받는 이유는 대상이
   * stdio 일 수도 원격일 수도 있어서다 — 두 구조 가드가 여기서 갈래를 고른다(#137).
   */
  diagnostics: unknown,
): void {
  const aborted = result.aborted;
  if (aborted === undefined) return;
  const progress = `${result.outcomes.length}/${totalCases}`;
  io.write(
    aborted.reason === "connectionLost"
      ? `✗ 시험 실행을 마치지 못했습니다. ${progress} 케이스에서 연결이 끊겼습니다.\n`
      : aborted.reason === "stopped"
        ? `✗ 시험 실행을 마치지 못했습니다. ${progress} 케이스에서 멈췄습니다.\n`
        : "✗ 시험 실행을 마치지 못했습니다.\n",
  );
  io.write(`  → ${aborted.detail}\n`);
  const local = processDiagnostics(diagnostics);
  if (local !== undefined && hasDiagnosticContent(local)) {
    const block = renderProcessDiagnostics(local, { maxLines: DRY_RUN_STDERR_LINES });
    if (block !== "") io.write(`\n${block}`);
  }
  /**
   * 원격 대상. 내용 판정을 걸지 않는다 — 이 함수는 위에서 `aborted === undefined` 면 이미
   * 돌아갔으므로 **중단된 실행에서만** 여기 닿는다. 그 자리에서는 상태 코드가 없어도 어느
   * 엔드포인트에서 끊겼는지가 정보다. `test` 의 연결 실패 경로와 같은 규칙이다.
   */
  const remote = httpDiagnostics(diagnostics);
  if (remote !== undefined) io.write(`\n${renderHttpDiagnostics(remote)}`);
  io.write("\n저장하지 않았습니다. 서버를 고친 뒤 다시 save 를 고르세요.\n");
}

/** 분류가 저장을 막았을 때의 안내(§8.3). */
function writeReviewBlocked(io: ReviewIO, specErrors: number, caseCount: number): void {
  io.write("\n");
  if (specErrors > 0) {
    io.write(`  명세 오류 ${specErrors}건이 있어 저장할 수 없습니다.\n`);
    io.write("  → 검토 메뉴의 revise 또는 edit 으로 고친 뒤 다시 save 를 고르세요.\n");
  } else {
    // 보류는 고칠 것이 없다. revise·edit 으로 보내면 사용자가 고칠 데를 찾다 만다.
    io.write("  분류하지 않은 케이스가 있어 저장할 수 없습니다.\n");
  }
  io.write(`  → 다시 save 를 고르면 케이스 ${caseCount}개가 모두 서버에 다시 나갑니다.\n`);
}

/** 초기화 명령 실패 안내. stderr 은 마지막 3줄만 보여준다. 설계 문서 §6. */
function writeResetFailure(io: ReviewIO, error: ResetCommandError): void {
  const exit = error.exitCode === null ? "없음" : String(error.exitCode);
  io.write(`✗ 초기화 명령이 실패했습니다. 명령: ${error.command} (종료 코드: ${exit})\n`);
  for (const line of error.stderr.split("\n").filter(Boolean).slice(-3)) io.write(`  → ${line}\n`);
  io.write("저장하지 않았습니다. 초기화 명령을 고친 뒤 다시 save 를 고르세요.\n");
}

async function runInteractiveReview(
  input: GenerateCommandInput,
  tools: readonly ToolDef[],
  session: AuthoringSessionView,
  deps: GenerateCommandDependencies,
  connection: CliConnection,
  skippedTools: readonly SkippedTool[] = [],
): Promise<number> {
  const io = deps.reviewIO;
  const prepare = deps.prepareAuthoringRequest;
  const dispatch = deps.dispatchAuthoringRequest;
  const makeDiff = deps.createAuthoringDiff;
  const apply = deps.applyAuthoringChanges;
  const reviewLocal = deps.reviewLocalAuthoringCandidate;
  if (!io?.interactive || !prepare || !dispatch || !makeDiff || !apply || !reviewLocal) {
    safeFailure(deps, "INTERACTIVE_REQUIRED");
    return 1;
  }
  let candidate: SanitizedAuthoringCandidate | undefined = session.workingCandidate;
  let preferred = input.provider;
  let model = input.model;
  /**
   * 진단 읽기가 판정을 바꾸면 안 된다. getDiagnostics 가 던지면 삼킨다.
   *
   * 좁히지 않고 원값을 넘긴다. 여기서 `processDiagnostics` 로 좁히면 원격 대상의 진단이
   * 버려져, 시험 실행이 중단됐을 때 엔드포인트도 상태 코드도 화면에 닿지 못한다(#137).
   */
  const diagnostics = (): unknown => {
    try {
      return connection.getDiagnostics();
    } catch {
      return undefined;
    }
  };
  try {
    while (true) {
      const action = await io.choose("검토 메뉴", [
        "codex",
        "claude",
        "apply-all",
        "select",
        "revise",
        "edit",
        "save",
        "cancel",
      ]);
      if (action === "cancel") return 0;
      if (action === "save") {
        const dryRunSuite = session.approvedDraft.suite;
        const caseCount = dryRunSuite.cases.length;
        let approvals: readonly SuiteCaseApproval[] = [];
        /** 교정으로 통과한 케이스 수와 바뀐 값. 반영 요약(§8.8)이 쓴다. */
        let repairedCases = 0;
        let repairChanges: readonly RepairApplication[] = [];
        if (!input.dryRun) {
          // §8.5. 시험 실행을 건너뛰면 approval.cases 가 없는 파일이 되고, 그 사실을 저장 직전에
          // 한 번 더 보여준다.
          io.write(
            `⚠ 시험 실행을 건너뜁니다. 케이스 ${caseCount}건이 실제 서버에서 확인되지 않은 채 저장됩니다.\n` +
              "   저장된 명세에 승인 기록(approval.cases)이 남지 않습니다.\n",
          );
          if (!(await io.confirm("   계속할까요?"))) continue;
        } else {
          writeDryRunNotice(io, {
            caseCount,
            target: describeTarget(input.target),
            resetCmd: input.resetCmd,
            repair: input.repair,
          });
          if (!(await io.confirm("계속할까요?"))) continue;
          if (input.resetCmd !== undefined) {
            try {
              await runResetCommand(input.resetCmd);
            } catch (error) {
              if (!(error instanceof ResetCommandError)) throw error;
              writeResetFailure(io, error);
              continue;
            }
            io.write(`▸ 초기화: ${input.resetCmd}\n`);
          }
          // 진행 표시는 한 번만 나간다. 중간 갱신에 터미널 제어 문자를 쓰면 파이프로 받은
          // 출력이 깨지고 그 출력을 E2E 가 비교한다.
          io.write(`▸ 시험 실행 중... ${caseCount}/${caseCount}\n`);
          const result = await runDryRun({ client: connection.client, suite: dryRunSuite });
          if (result.aborted !== undefined) {
            writeDryRunAborted(io, result, caseCount, diagnostics());
            continue;
          }
          writeDryRunResult(io, result);
          // 거절 근거 미확인 목록(§5.2). 결과 블록 바로 아래다. 판정을 바꾸지 않으므로 아래
          // 교정·분류 흐름은 이 값을 읽지 않는다.
          writeRejectionUnverified(io, result);
          // 8.5. 거절 근거 AI 진단(§6). **호출은 사용자가 시작한다.** 자동으로 부르지 않는다 —
          // 케이스가 많으면 비용이 곱해지고 provider 가 없는 사용자가 대다수다. 결과는 화면에만
          // 나가고 아래 교정·분류·저장 흐름은 이 값을 읽지 않는다.
          await askRejectionDiagnosis({
            io,
            deps,
            result,
            suite: dryRunSuite,
            tools,
            provider:
              preferred === undefined
                ? undefined
                : deps.rejectionProviders?.[preferred]?.(model ?? defaultModel(preferred)),
            model: model ?? (preferred === undefined ? "" : defaultModel(preferred)),
          });
          // 9. 입력값 교정(§4). 대상이 없으면 아무것도 묻지 않는다.
          // AI 제안은 `--provider` 가 있을 때만 쓴다. 별도 옵션을 두지 않는다(§7).
          const repairProvider =
            preferred === undefined
              ? undefined
              : deps.providers?.[preferred]?.(model ?? defaultModel(preferred));
          const targets = input.repair
            ? selectRepairTargets({
                suite: dryRunSuite,
                outcomes: result.outcomes,
                origins: originsOf(session),
              })
            : [];
          let attempts: ReadonlyMap<string, readonly RepairAttempt[]> | undefined;
          let effective = result;
          if (targets.length > 0) {
            const repairs = await repairInputs({
              io,
              suite: dryRunSuite,
              targets,
              tools,
              // 케이스 하나만 담은 스위트로 부른다. 전량을 다시 돌리면 앞서 통과한 케이스가
              // 상태 변화로 뒤집힌다(설계 §9).
              rerun: async (caseId, value) => {
                const spec = dryRunSuite.cases.find((item) => item.id === caseId);
                if (spec === undefined || !isCallTool(spec)) return { passed: false, detail: "" };
                const one = await runDryRun({
                  client: connection.client,
                  suite: {
                    ...dryRunSuite,
                    cases: [
                      { ...spec, operation: { ...spec.operation, input: value as JsonObject } },
                    ],
                  },
                });
                // 끝까지 못 간 실행은 통과가 아니다. 판정을 모르는 것과 통과는 다르다.
                if (one.aborted !== undefined) return { passed: false, detail: "" };
                const outcome = one.outcomes[0];
                return { passed: outcome?.status === "passed", detail: outcome?.detail ?? "" };
              },
              // provider 가 없으면 제안 없이 사람 입력만 쓴다. AI 제안은 선택이지 전제가 아니다.
              propose:
                repairProvider === undefined
                  ? undefined
                  : (target) =>
                      proposeRepair({
                        target,
                        session,
                        tools,
                        provider: repairProvider,
                        prepare,
                        dispatch,
                      }),
            });
            const repaired = new Map(
              repairs
                .filter((item) => item.repaired && item.input !== undefined)
                .map((item) => [item.caseId, item.input as Readonly<Record<string, JsonValue>>]),
            );
            attempts = new Map(
              repairs
                .filter((item) => !item.repaired && item.attempts.length > 0)
                .map((item) => [item.caseId, item.attempts]),
            );
            // 10. 교정 결과를 후보 명세에 반영(§5). 케이스마다가 아니라 한 번만 탄다.
            if (repaired.size > 0) {
              repairedCases = repaired.size;
              repairChanges = repairApplications(dryRunSuite, repaired);
              const local = reviewLocal({
                session,
                candidate: withRepairedInputs(dryRunSuite, repaired),
                tools,
              });
              if (local.status !== "preview") {
                io.write("교정한 값을 명세에 반영하지 못했습니다.\n");
                continue;
              }
              const diff = makeDiff({ session, candidate: local.preview });
              const applied = apply({
                session,
                preview: diff,
                selectedChangeIds: diff.changes.map((change) => change.id),
                approval: { approved: true, fingerprint: diff.candidateFingerprint },
              });
              if (!applied.applied) {
                io.write("교정한 값을 명세에 반영하지 못했습니다.\n");
                continue;
              }
            }
            // 교정으로 통과한 케이스는 실패가 아니다. 분류 화면에 다시 올리지 않는다(§6.3).
            effective = {
              ...result,
              outcomes: result.outcomes.map(
                (outcome): DryRunCaseOutcome =>
                  repaired.has(outcome.caseId)
                    ? { ...outcome, status: "passed", detail: "" }
                    : outcome,
              ),
            };
          }
          // 11. 남은 실패를 분류(§8.3). 교정을 시도했던 케이스는 이력이 함께 나온다(§8.7).
          const review = await reviewDryRun(io, effective, attempts);
          if (!review.cleared) {
            writeReviewBlocked(io, review.specErrors.length, caseCount);
            continue;
          }
          approvals = review.approvals;
        }
        // 12. 최종 지문 표시(§6). 교정이 명세를 바꿨을 수 있으므로 반영이 끝난 뒤에 읽는다.
        // 화면에 찍은 값과 저장되는 approval.fingerprint 는 언제나 같아야 한다.
        const fingerprint = session.approvedDraft.suiteFingerprint;
        io.write(`Final fingerprint: ${fingerprint}\n`);
        writeRepairSummary(io, repairedCases, repairChanges);
        if (!(await io.confirm("최종 JSON을 저장할까요?"))) continue;
        const final = deps.finalizeAuthoringDraft({
          session,
          approval: { approved: true, fingerprint },
        });
        if (!final.finalized) {
          safeFailure(deps, "FINALIZE_FAILED");
          continue;
        }
        try {
          const finalSuite = deps.getAuthoringExecutionSuite(final.snapshot);
          await saveSuite(input, finalSuite, final.snapshot.fingerprint, deps, approvals);
          // 최종 suite 는 baseline 과 다르다. 사용자가 케이스를 지웠거나 AI 후보를 적용했을 수
          // 있으므로 저장한 그 suite 로 다시 계산한다.
          //
          // 저장 뒤이므로 커버리지 실패를 저장 실패로 보고하지 않는다. reportCoverageSafely 가
          // 자기 오류 경계를 갖는다.
          // 건너뛴 툴은 케이스가 있을 수 없으므로 커버리지 분모에서 뺀다. baseline 경로의
          // computeCoverage 가 이미 같은 기준이다. 넣으면 매 실행 거짓 "미검증" 이 쌓인다.
          // 이름이 아니라 인덱스로 뺀다. 서버가 같은 이름을 두 번 선언할 수 있고, 그때 이름으로
          // 빼면 동명의 지원 툴 커버리지까지 사라진다. tools 는 listTools 결과 그대로이므로
          // SkippedTool.index 가 이 배열의 위치와 같다.
          const skippedIndexes = new Set(skippedTools.map((tool) => tool.index));
          reportCoverageSafely(
            deps,
            () =>
              deps.computeCoverage?.({
                suite: finalSuite,
                tools: tools.filter((_tool, index) => !skippedIndexes.has(index)),
              }),
            finalSuite,
            skippedTools,
          );
          return 0;
        } catch (error) {
          if (error instanceof OutputExistsError) outputExistsFailure(deps, error.path);
          else if (error instanceof OutputReplaceError)
            outputReplaceFailure(deps, error.path, error.code);
          else if (error instanceof LinkUnsupportedError)
            linkUnsupportedFailure(deps, error.path, error.code);
          else safeFailure(deps, "SAVE_FAILED");
          continue;
        }
      }
      if (action === "apply-all" || action === "select") {
        if (!candidate) {
          io.write("적용할 candidate가 없습니다.\n");
          continue;
        }
        const diff = makeDiff({ session, candidate });
        showDiff(io, diff);
        const selected =
          action === "apply-all"
            ? diff.changes.map((change) => change.id)
            : (await io.input("적용할 change ID를 쉼표로 입력하세요: "))
                .split(",")
                .map((id) => id.trim())
                .filter(Boolean);
        if (!(await confirmSpecFindings(io, candidate, diff, selected))) continue;
        if (!(await io.confirm("선택한 변경을 적용할까요?"))) continue;
        const result = apply({
          session,
          preview: diff,
          selectedChangeIds: selected,
          approval: { approved: true, fingerprint: diff.candidateFingerprint },
        });
        if (!result.applied) io.write(`변경을 적용하지 않았습니다: ${result.reason}\n`);
        else io.write(`revision ${result.draft.revision}을 승인했습니다.\n`);
        continue;
      }
      if (action === "edit") {
        const path = await io.input("편집한 JSON 파일 경로: ");
        try {
          const parsed = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(await deps.readFile(path)),
          );
          const result = reviewLocal({ session, candidate: parsed, tools });
          if (result.status === "preview") {
            candidate = result.preview;
            showDiff(io, makeDiff({ session, candidate }));
          } else io.write("편집한 JSON을 candidate로 사용할 수 없습니다.\n");
        } catch {
          safeFailure(deps, "LOCAL_JSON_INVALID");
        }
        continue;
      }
      const providerId = action === "revise" ? preferred : action;
      if (providerId !== "codex" && providerId !== "claude") {
        io.write("지원하지 않는 메뉴입니다.\n");
        continue;
      }
      if (action !== "revise" && providerId !== preferred)
        model = input.provider === providerId ? input.model : undefined;
      preferred = providerId;
      const selectedModel =
        model ?? (await io.input(`${providerId} model (${defaultModel(providerId)}): `));
      model = selectedModel || defaultModel(providerId);
      const provider = deps.providers?.[providerId]?.(model);
      if (!provider) {
        io.write(`${providerId} provider를 사용할 수 없습니다.\n`);
        continue;
      }
      const instruction = await io.input(action === "revise" ? "피드백: " : "AI 요청: ");
      const preview = prepare({
        mode: action === "revise" ? "revise" : "initial",
        instruction,
        baseline: session.baseline.suite,
        candidate: candidate?.result.suite ?? session.baseline.suite,
        tools,
        providerId,
        model,
      });
      showRequest(io, preview);
      if (!(await io.confirm("이 요청을 전송할까요?"))) continue;
      let result: Awaited<ReturnType<typeof dispatch>>;
      try {
        result = await dispatch({
          provider,
          preview,
          approval: { approved: true, fingerprint: preview.fingerprint },
          session,
        });
      } catch {
        providerFailure(deps, undefined, model);
        continue;
      }
      if (result.status === "preview") {
        candidate = result.preview;
        showDiff(io, makeDiff({ session, candidate }));
      } else if (result.status === "questions") io.write(`질문:\n${result.questions.join("\n")}\n`);
      else if (result.status === "providerFailed") providerFailure(deps, result.failure, model);
      else io.write("AI 결과를 검토 후보로 사용할 수 없습니다.\n");
    }
  } catch (error) {
    if (!isReviewInputClosed(error)) throw error;
    deps.writeStdout("입력이 종료되어 검토를 취소했습니다. 저장하지 않았습니다.\n");
    return 0;
  } finally {
    io.close?.();
  }
}

/**
 * 축 종류를 사람 문장으로 바꾼다. `Record<ContractAxisKind, string>` 이라서 `runner` 가 축을
 * 늘리면 여기서 타입 오류가 난다. 문자열 배열로 두면 새 축이 화면에서 조용히 사라지고,
 * **이 화면에서 누락은 "검증했다" 로 읽힌다.** `FINDING_GROUP` 이 같은 이유로 같은 형태다.
 */
const AXIS_LABEL: Readonly<Record<ContractAxisKind, string>> = {
  HAPPY_PATH: "선언을 지킨 입력에 정상 응답",
  REQUIRED_OMITTED: "필수 필드 누락 거절",
  TYPE_VIOLATION: "타입 위반 거절",
  ENUM_VIOLATION: "선언되지 않은 값 거절",
  RANGE_VIOLATION: "선언된 범위 밖 값 거절",
};

/**
 * runner 보고서 상한(1MB)에 닿기 전에 알리는 임계.
 *
 * 케이스당 보고서가 관측 범위에서 300~600 바이트다. 600 으로 계산해도 1500 케이스면 900KB 로
 * DEFAULT_MAX_REPORT_BYTES(1MB) 안에 들어간다. 그보다 크면 사용자가 조치할 시간이 필요하다.
 * 이 상한은 올릴 수 없다(resolvePayloadLimits 가 기본값을 최대치로 쓴다).
 */
const CASE_COUNT_WARNING_THRESHOLD = 1500;

/**
 * 터미널 표시 폭. 한글은 두 칸을 차지하므로 문자 수로 맞추면 열이 어긋난다.
 * 화면 정렬이 목적이므로 코드 포인트 단위로 세고 넓은 글자만 2로 계산한다.
 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

/** 표시 폭 기준 오른쪽 공백 채우기. 이미 넓으면 그대로 둔다. */
function padToWidth(text: string, width: number): string {
  const padding = width - displayWidth(text);
  return padding > 0 ? text + " ".repeat(padding) : text;
}

/** 축 하나를 사람이 읽는 문장으로. 필드가 없는 축(HAPPY_PATH)은 종류만 적는다. */
function axisLabel(kind: ContractAxisKind, field: string | null): string {
  return field === null ? AXIS_LABEL[kind] : `${field} 의 ${AXIS_LABEL[kind]}`;
}

/** 툴 한 개의 줄과 그 아래 들여쓴 줄들. */
function coverageToolLines(tool: ToolCoverage, nameWidth: number): string[] {
  const head = `  ${padToWidth(tool.tool, nameWidth)}`;
  if (!tool.analyzable) {
    return [
      `${head}해석 불가`,
      `    → 입력 스키마를 해석하지 못해 이 툴의 축을 세지 못했습니다 (${tool.unanalyzableReason ?? "schema"})`,
      "    → 이 툴은 커버리지 숫자에 들어가지 않습니다",
    ];
  }
  const unverified = tool.axes.filter((axis) => axis.caseId === null);
  const labels = unverified.map((axis) => axisLabel(axis.kind, axis.field));
  // 미검증 라벨을 한 열에 맞춘다. 여백은 가장 긴 라벨 기준이라 툴마다 달라질 수 있고, 같은
  // 입력에는 항상 같은 폭이 나온다.
  const labelWidth = Math.max(0, ...labels.map(displayWidth)) + 5;
  const lines = [`${head}${tool.verified}/${tool.total}`];
  for (const label of labels) lines.push(`    ? ${padToWidth(label, labelWidth)}미검증`);
  if (tool.unanalyzedFields.length > 0)
    lines.push(
      `    → 해석 못 한 필드 ${tool.unanalyzedFields.length}개: ${tool.unanalyzedFields.join(", ")}. 이 필드의 축은 세지 않았습니다`,
    );
  return lines;
}

/**
 * 커버리지 화면. 순수 함수라서 테스트가 문자열을 그대로 비교한다.
 *
 * 전부 검증되면 한 줄이다. 기본 생성이 축을 다 채우므로 그것이 대다수 실행의 모습이고,
 * 거기서 툴 30개를 나열하면 매 실행 30줄이 영구 소음이 된다.
 *
 * `total` 이 0 이면 `verified === total` 이 참이지만 "전부 검증" 이라고 쓰지 않는다. 축을
 * 하나도 세지 못한 것이지 전부 확인한 것이 아니다. 그 화면은 거짓이다.
 */
export function renderCoverage(coverage: CoverageResult): string {
  if (coverage.tools.length === 0) return "";
  const count = coverage.tools.length;
  // 한 줄로 줄이는 것은 숨길 것이 하나도 없을 때뿐이다. 해석 못 한 툴이나 필드가 있으면
  // 숫자가 다 차 있어도 그 사실을 함께 보여야 한다. 안 보이면 "전부 확인했다" 로 읽힌다.
  const nothingHidden = coverage.tools.every(
    (tool) => tool.analyzable && tool.unanalyzedFields.length === 0,
  );
  if (coverage.total > 0 && coverage.verified === coverage.total && nothingHidden)
    return `커버리지  ${count} tools, ${coverage.total} axes 전부 검증\n`;
  const nameWidth = Math.max(0, ...coverage.tools.map((tool) => displayWidth(tool.tool))) + 3;
  const lines = [`커버리지  ${count} tools, ${coverage.verified}/${coverage.total} axes 검증`];
  for (const tool of coverage.tools) lines.push(...coverageToolLines(tool, nameWidth));
  // 범위 축은 이번 버전에 새로 들어왔다. 같은 명세를 어제 돌린 사용자에게는 분모만 커지고
  // 숫자가 내려간 것으로 보인다. 이유를 안 적으면 우리가 뭔가 망가뜨린 것으로 읽힌다.
  // 미검증인 범위 축이 실제로 있을 때만 적는다. 조건 없이 매번 찍으면 영구 소음이 된다.
  if (
    coverage.tools.some((tool) =>
      tool.axes.some((axis) => axis.kind === "RANGE_VIOLATION" && axis.caseId === null),
    )
  )
    lines.push(
      "  → 범위 제약(minimum·maxItems 등)이 이번 버전부터 검증 축에 들어갑니다. 이전보다 숫자가 낮으면 새로 드러난 빈틈입니다",
    );
  return `${lines.join("\n")}\n`;
}

/**
 * 건너뛴 툴 고지. 없으면 빈 문자열이다. 순수 함수라서 테스트가 문자열을 그대로 비교한다.
 *
 * 종전에는 미지원 키워드 하나가 서버 전체를 거절했다(도그푸딩 실측: 공식 서버 7개 중 5개).
 * 이제 그 툴만 건너뛰므로, 건너뛴 사실이 안 보이면 "이 서버의 툴을 전부 검증했다" 로 읽힌다.
 * 커버리지 화면과 같은 이유로 침묵이 거짓말이 되는 자리다.
 */
export function renderSkippedTools(skipped: readonly SkippedTool[]): string {
  if (skipped.length === 0) return "";
  // "키워드" 로 단정하지 않는다. UNSUPPORTED_SCHEMA 는 키워드뿐 아니라 루트 type 이 object 가
  // 아닌 경우에도 나오므로, 머리글이 키워드라고 못 박으면 그 케이스에서 원인 줄과 어긋난다.
  const lines = [`건너뜀  ${skipped.length} tools — 지원하지 않는 입력 스키마`];
  for (const tool of skipped) lines.push(`  ${tool.name}  ${tool.path}: ${tool.message}`);
  lines.push(
    "  → 이 툴의 케이스는 생성되지 않았습니다. 필요하면 명세에 케이스를 손으로 추가하세요.",
  );
  return `${lines.join("\n")}\n`;
}

/**
 * 사전보완 요청의 전송 전 확인 화면.
 *
 * authoring 화면의 어법을 따르되 **전송 데이터 목록은 사실대로** 적는다. 여기서 나가는 것은
 * suite 전량이 아니라 툴 선언과 baseline 이 넣은 값뿐이다. authoring 문안을 그대로 태우면
 * 사용자가 승인하는 내용과 실제로 나가는 내용이 달라진다.
 */
function showPreFillRequest(io: ReviewIO, preview: PreFillRequestPreview): void {
  const { request } = preview;
  const fields = request.cases.reduce((sum, item) => sum + item.assistFields.length, 0);
  io.write(
    `AI 사전보완 요청\n` +
      `Provider: ${preview.providerId}\nModel: ${preview.model}\n` +
      `Payload: ${preview.byteLength} bytes\nResult limit: ${preview.maxResultBytes} bytes\n` +
      `Timeout: ${preview.providerTimeoutMs}ms\nFingerprint: ${preview.fingerprint}\n` +
      `대상: 툴 ${request.tools.length}개, 케이스 ${request.cases.length}개, 채울 필드 ${fields}개\n` +
      "전송 데이터: 툴 이름·설명·inputSchema, baseline 이 넣은 값, 그 값의 출처\n" +
      "받는 것: 값 제안뿐입니다. 케이스를 더하거나 구조를 바꾸지 않습니다.\n",
  );
  // 조용히 자르지 않는다. 무엇이 빠졌는지 모르면 사용자가 결과를 잘못 읽는다(계획서 §4.5).
  if (request.omitted.tools > 0)
    io.write(
      `⚠ 크기 상한 때문에 툴 ${request.omitted.tools}개를 요청에서 뺐습니다. 그 툴은 baseline 값 그대로 갑니다.\n`,
    );
}

/**
 * AI 없이 표 밖 `format` 툴을 건너뛸 때의 고지. 없으면 빈 문자열이다.
 *
 * **"지원하지 않는다" 로 끝내지 않는다.** 그러면 사용자가 할 수 있는 일이 없다. 해결 수단을
 * 같은 고지 안에 적는다. 이 프로젝트에서 실패 메시지는 곧 제품이다(설계서 §3.4).
 */
export function renderUnknownFormatSkips(skips: readonly UnknownFormatSkip[]): string {
  if (skips.length === 0) return "";
  const lines: string[] = [];
  for (const skip of skips) {
    lines.push(`경고: 툴 '${skip.tool}' 를 건너뜁니다.`);
    // format 이름을 못 읽었으면 필드만 적는다. 없는 이름을 지어내지 않는다.
    lines.push(
      skip.format === ""
        ? `      '${skip.field}' 의 format 은 AI 없이 채울 수 없습니다.`
        : `      format '${skip.format}' 은 AI 없이 채울 수 없습니다.`,
    );
    lines.push("      AI 검토(--baseline-only 없이 실행)를 켜면 생성됩니다.");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * AI 사전보완 결과 요약. 대상이 없으면 빈 문자열이다.
 *
 * **`버림` 은 사유와 대상을 반드시 적는다.** 개수만 적으면 사용자가 무엇을 잃었는지 모른다
 * (이슈 #120 이 `discarded` 가 개수뿐이라고 지적한 것과 같은 계열이다). 버림이 0건이면 그 줄을
 * 아예 찍지 않는다.
 */
export function renderPreFillSummary(options: {
  readonly toolCount: number;
  readonly proposedToolCount: number;
  readonly adopted: number;
  readonly notAdopted: number;
  readonly discarded: readonly PreFillDiscard[];
}): string {
  const { toolCount, proposedToolCount, adopted, notAdopted, discarded } = options;
  if (proposedToolCount === 0 && discarded.length === 0) return "";
  const lines = [
    `AI 사전보완: 툴 ${toolCount}개 중 ${proposedToolCount}개에 값 제안을 받았습니다.`,
    `  채택 ${adopted} (실제 서버에서 baseline 값이 실패하고 제안 값이 통과)`,
    `  미채택 ${notAdopted} (baseline 값이 이미 통과)`,
  ];
  for (const item of discarded)
    lines.push(`  버림 1 (${item.reason}: ${item.caseId}.${item.field})`);
  return `${lines.join("\n")}\n`;
}

/**
 * 케이스 수 고지. 임계 아래면 빈 문자열이다.
 * 생성을 막지 않는다. 이미 존재하는 상한을 사용자에게 보이게 하는 것이 목적이다.
 */
export function renderCaseCountNotice(caseCount: number): string {
  if (caseCount < CASE_COUNT_WARNING_THRESHOLD) return "";
  return (
    `→ 케이스 ${caseCount}개를 만들었습니다. runner 보고서 상한(1MB)에 가까워 test 실행이\n` +
    "  RunnerPayloadLimitError 로 실패할 수 있습니다.\n" +
    "→ 툴을 나눠 여러 명세 파일로 생성하면 피할 수 있습니다.\n"
  );
}

/** 커버리지·건너뜀·케이스 수 고지를 stdout 에 찍는다. 전부 빈 문자열이면 아무것도 안 찍는다. */
function writeCoverageReport(
  deps: GenerateCommandDependencies,
  coverage: CoverageResult | undefined,
  suite: TestSuiteSpec,
  skippedTools: readonly SkippedTool[],
): void {
  if (coverage !== undefined) {
    const text = renderCoverage(coverage);
    if (text !== "") deps.writeStdout(text);
  }
  const skippedText = renderSkippedTools(skippedTools);
  if (skippedText !== "") deps.writeStdout(skippedText);
  const notice = renderCaseCountNotice(suite.cases.length);
  if (notice !== "") deps.writeStdout(notice);
}

/**
 * 커버리지 보고를 저장과 다른 오류 경계에 둔다.
 *
 * 파일을 저장한 **뒤에** 커버리지 계산이나 렌더링이 실패할 수 있다. 그것을 저장 실패로 보고하면
 * 사용자가 저장을 다시 시도하고 이번에는 `OUTPUT_EXISTS` 를 만난다. 저장은 성공했고 부가 정보만
 * 못 만든 것이므로 종료 코드를 바꾸지 않고 경고만 낸다.
 *
 * coverage 를 값이 아니라 thunk 로 받는 이유는 `computeCoverage` 자체가 던지는 경우까지 이 경계
 * 안에 넣기 위해서다.
 */
function reportCoverageSafely(
  deps: GenerateCommandDependencies,
  coverage: () => CoverageResult | undefined,
  suite: TestSuiteSpec,
  skippedTools: readonly SkippedTool[] = [],
): void {
  try {
    writeCoverageReport(deps, coverage(), suite, skippedTools);
  } catch {
    deps.writeStderr(
      "경고 [GENERATE_COVERAGE_UNAVAILABLE]: 명세는 저장했지만 커버리지를 계산하지 못했습니다.\n" +
        "해결: 저장된 명세는 그대로 `mcpeak test` 로 쓸 수 있습니다. 커버리지만 다시 보려면 다른 --out 경로로 generate 를 실행하세요.\n",
    );
  }
}

/** 사전보완 결과. 건너뛴 경우에는 baseline 그대로이고 채택 목록이 비어 있다. */
interface PreFillOutcome {
  readonly suite: TestSuiteSpec;
  readonly preFilledCaseIds: readonly string[];
}

/**
 * AI 사전보완 한 회차. baseline 의 빈틈만 메운다.
 *
 * **자동이다.** 사용자의 자연어 요구를 받는 authoring 층과 목적이 다르므로 검토 메뉴가 아니라
 * 그 앞에서 한 번 돈다(설계서 §4.2). 사용자에게 묻는 것은 전송 승인 하나뿐이다.
 *
 * **provider 가 죽어도 툴을 건너뛰지 않는다.** provider 실패는 사용자 서버의 문제가 아니라
 * 우리 쪽 사정이고, 그것 때문에 케이스를 잃는 손해가 더 크다. baseline 값으로 진행하고
 * 그 사실을 화면에 적는다.
 */
async function runPreFill(
  input: GenerateCommandInput,
  tools: readonly ToolDef[],
  baseline: BaselineGenerationResult,
  deps: GenerateCommandDependencies,
  client: CliConnection["client"],
): Promise<PreFillOutcome> {
  const skip: PreFillOutcome = { suite: baseline.suite, preFilledCaseIds: [] };
  const io = deps.reviewIO;
  const prepare = deps.preparePreFillRequest;
  const preview = deps.previewPreFillRequest;
  const dispatch = deps.dispatchPreFillRequest;
  const providerId = input.provider;
  if (io === undefined || !prepare || !preview || !dispatch || providerId === undefined)
    return skip;
  const model = input.model ?? defaultModel(providerId);
  const provider = deps.preFillProviders?.[providerId]?.(model);
  if (provider === undefined) return skip;

  // 전 필드가 근거 있는 값이면 부르지 않는다. 판정은 결정론적이다(설계서 §4.1).
  const request = prepare({ tools, provenance: baseline.provenance, baseline: baseline.suite });
  if (request === null) return skip;

  let view: PreFillRequestPreview;
  try {
    view = preview({ request, providerId, model });
  } catch {
    // 상한을 넘었다. 자르지 않고 이 회차를 건너뛴다. 무엇을 버릴지 우리가 정하지 않는다.
    io.write("⚠ AI 사전보완 요청이 크기 상한을 넘어 건너뜁니다. baseline 값으로 진행합니다.\n");
    return skip;
  }
  showPreFillRequest(io, view);
  if (!(await io.confirm("이 요청을 전송할까요?"))) return skip;

  const dispatched = await dispatch({
    provider,
    preview: view,
    approval: { approved: true, fingerprint: view.fingerprint },
  });
  if (dispatched.status !== "proposals") {
    io.write(
      `⚠ AI 사전보완을 쓰지 못했습니다 (${dispatched.status}). baseline 값으로 진행합니다.\n`,
    );
    return skip;
  }

  const applied = await applyPreFill({
    client,
    baseline: baseline.suite,
    preFill: dispatched.result,
  });
  io.write(
    renderPreFillSummary({
      toolCount: tools.length,
      proposedToolCount: request.tools.length,
      adopted: applied.adopted,
      notAdopted: applied.notAdopted,
      discarded: dispatched.result.discarded,
    }),
  );
  return {
    suite: applied.suite,
    preFilledCaseIds: applied.cases
      .filter((item) => item.source === "ai")
      .map((item) => item.caseId),
  };
}

export async function runGenerateCommand(
  argv: readonly string[],
  deps: GenerateCommandDependencies,
): Promise<number> {
  let input: GenerateCommandInput;
  try {
    input = parseGenerateCommand(argv[0] === "generate" ? argv.slice(1) : argv);
  } catch (error) {
    const message =
      error instanceof UsageError ? error.message : "generate 입력을 해석할 수 없습니다.";
    deps.writeStderr(`오류 [CLI_USAGE]: ${message}\n해결: ${GENERATE_USAGE_HINT}\n`);
    return 1;
  }
  // 선검사. `--out` 은 파싱 때 이미 아는 값이라 서버에 붙기 전에 끊을 수 있다. 이 뒤로는
  // 후보 검토, provider 승인, 실서버 시험 실행, 입력값 교정이 이어지고 그것을 다 치른 뒤
  // 알려 주면 늦다. 설계 문서 §1·§4. 보장이 아니라 편의이므로 `--force` 면 건너뛴다.
  //
  // `exists` 가 던지는 경우까지 여기서 받는다. 이 함수는 종료 코드를 돌려주는 자리이고,
  // 편의 검사가 명령 전체를 거절(reject)로 끝내면 호출자가 보는 것이 종료 코드가 아니라
  // 예외가 된다.
  try {
    if (!input.force && (await deps.exists(input.outPath))) {
      outputExistsFailure(deps, input.outPath, "start");
      return 1;
    }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const suffix = typeof code === "string" ? ` (${code})` : "";
    deps.writeStderr(
      `오류 [GENERATE_OUTPUT_CHECK_FAILED]: 출력 경로를 확인하지 못해 시작하지 않았습니다. 경로: ${input.outPath}${suffix}\n해결: 그 경로와 상위 디렉터리의 권한을 확인하세요. 다른 \`--out\` 경로를 지정해도 됩니다.\n`,
    );
    return 1;
  }
  if (!input.baselineOnly && !deps.reviewIO?.interactive) {
    deps.writeStderr(
      "오류 [GENERATE_INTERACTIVE_REQUIRED]: AI 검토에는 TTY가 필요합니다.\n해결: `--baseline-only`를 지정하거나 대화형 터미널에서 실행하세요.\n",
    );
    return 1;
  }
  let connection: CliConnection | undefined;
  /**
   * 대화형 검토는 아래 try 밖에서 돌린다. 검토가 던지는 오류를 여기 catch 가 삼키면
   * `GENERATE_FAILED` 로 뭉개지는데, 그 경로는 원래 호출자에게 그대로 올라가야 한다.
   */
  let review:
    | {
        readonly active: CliConnection;
        readonly session: AuthoringSessionView;
        readonly tools: readonly ToolDef[];
        readonly skippedTools: readonly SkippedTool[];
      }
    | undefined;
  try {
    connection = await openConnection(input.target, {
      connectStdio: deps.connect,
      ...(deps.connectHttp === undefined ? {} : { connectHttp: deps.connectHttp }),
      ...(deps.readEnv === undefined ? {} : { readEnv: deps.readEnv }),
    });
    const active = connection;
    const tools = await active.client.listTools();
    // 시험 실행이 검토 메뉴 안쪽에서 일어나므로 대화형 경로는 여기서 닫지 않는다. 검토가 끝난
    // 뒤 finally 에서 닫는다. 설계 문서 §4.1. `--baseline-only` 는 서버를 더 쓰지 않으므로
    // 지금까지와 같이 여기서 닫는다.
    if (input.baselineOnly) {
      await active.close();
      connection = undefined;
    }
    const baseline = deps.createBaselineSuite(tools, {
      suiteId: input.suiteId,
      suiteName: input.name,
    });
    // 사전보완은 검토 세션을 만들기 전에 한 번 돈다. baseline 의 빈틈을 메우는 층이고
    // 사용자의 요구를 받는 authoring 층과 목적이 다르다(설계서 §4.2).
    //
    // `--baseline-only` 는 애초에 provider 를 안 부르기로 한 경로다. 그 경로에서만 표 밖
    // format 툴을 건너뛴다. AI 없이는 그 필드를 채울 방법이 없기 때문이다(설계서 §3.4).
    let sessionSuite = baseline.suite;
    let preFilledCaseIds: readonly string[] = [];
    if (input.baselineOnly) {
      const skips = unknownFormatSkips(tools, baseline.provenance);
      if (skips.length > 0) {
        deps.writeStdout(renderUnknownFormatSkips(skips));
        sessionSuite = dropSkippedTools(baseline.suite, skips);
      }
    } else {
      const outcome = await runPreFill(input, tools, baseline, deps, active.client);
      sessionSuite = outcome.suite;
      preFilledCaseIds = outcome.preFilledCaseIds;
    }
    // baselineFingerprint 는 바꾸지 않는다. 그 값은 "어느 규칙 baseline 에서 나왔나" 이고,
    // 같은 서버 선언을 다시 돌리면 여전히 같은 값이 나온다. suiteFingerprint 는
    // createAuthoringSession 이 suite 로 다시 계산한다.
    const session = deps.createAuthoringSession(
      sessionSuite === baseline.suite ? baseline : { ...baseline, suite: sessionSuite },
      { preFilledCaseIds },
    );
    if (!input.baselineOnly) {
      // 아래 finally 가 닫는 것으로 소유권을 옮긴다. catch 의 forceClose 와 겹치지 않게 한다.
      connection = undefined;
      review = { active, session, tools, skippedTools: baseline.skippedTools };
    } else {
      const final = deps.finalizeAuthoringDraft({
        session,
        approval: { approved: true, fingerprint: session.approvedDraft.suiteFingerprint },
      });
      if (!final.finalized) throw new Error("finalize failed");
      const finalSuite = deps.getAuthoringExecutionSuite(final.snapshot);
      await saveSuite(input, finalSuite, final.snapshot.fingerprint, deps);
      deps.writeStdout(`baseline suite를 저장했습니다: ${input.outPath}\n`);
      // baseline 경로는 저장한 suite 가 baseline 그대로이므로 다시 계산하지 않는다.
      // 저장 뒤이므로 렌더링 실패를 GENERATE_FAILED 로 보고하지 않는다.
      reportCoverageSafely(deps, () => baseline.coverage, finalSuite, baseline.skippedTools);
      return 0;
    }
  } catch (error) {
    if (connection !== undefined) await connection.forceClose().catch(() => undefined);
    // 같은 결함이 비대화형 경로에도 있었다. 여기서도 원인이 뭉개지면 안 된다.
    if (isReviewInputClosed(error)) {
      deps.reviewIO?.close?.();
      deps.writeStdout("입력이 종료되어 검토를 취소했습니다. 저장하지 않았습니다.\n");
      return 0;
    }
    // 연결 전에 멈춘 경우다(원격 미지원 진입점, 빈 환경변수). core 오류가 아니므로 진단이
    // 없고, 고칠 곳도 서버가 아니라 명령줄이다(#137).
    if (error instanceof ConnectTargetError) {
      deps.writeStderr(`오류 [CLI_USAGE]: ${error.message}\n해결: ${GENERATE_USAGE_HINT}\n`);
      return 1;
    }
    if (error instanceof OutputExistsError) outputExistsFailure(deps, error.path);
    else if (error instanceof OutputReplaceError)
      outputReplaceFailure(deps, error.path, error.code);
    else if (error instanceof LinkUnsupportedError)
      linkUnsupportedFailure(deps, error.path, error.code);
    // 주입이 없으면 아래 폴백으로 떨어진다. 기존 동작이 그대로 남는다.
    else if (deps.GenerateTestsError !== undefined && error instanceof deps.GenerateTestsError)
      generateTestsFailure(deps, error);
    else if (isCoreClientError(error)) {
      // 서버가 spawn 직후 죽거나 handshake 에 실패하면 사용자가 볼 근거는 core 가 만든
      // code·message·diagnostics 다. GENERATE_FAILED 로 뭉개면 원인을 알 길이 없다(도그푸딩 실측 —
      // 존재하지 않는 디렉터리 인자, Python 서버의 import 오류가 전부 같은 한 줄로 보였다).
      deps.writeStderr(
        `오류 [GENERATE_CONNECT_FAILED/${error.code}]: ${error.message}\n해결: ${error.hint}\n`,
      );
      const diagnostics = processDiagnostics(error.diagnostics);
      if (diagnostics !== undefined && hasDiagnosticContent(diagnostics)) {
        const block = renderProcessDiagnostics(diagnostics, { maxLines: DRY_RUN_STDERR_LINES });
        if (block !== "") deps.writeStderr(`\n${block}`);
      }
      // 원격 대상의 진단. 연결이 실패한 자리라 상태 코드가 없어도(DNS 실패, 연결 거부)
      // 어느 엔드포인트에 붙으려다 실패했는지가 정보다. `test` 의 같은 경로와 규칙이 같다(#137).
      const remote = httpDiagnostics(error.diagnostics);
      if (remote !== undefined) deps.writeStderr(`\n${renderHttpDiagnostics(remote)}`);
    } else
      deps.writeStderr(
        "오류 [GENERATE_FAILED]: baseline suite를 생성하거나 저장하지 못했습니다.\n해결: MCP 서버와 출력 경로를 확인한 뒤 다시 실행하세요.\n",
      );
    return 1;
  }
  // 검토는 위 catch 밖에서 돈다. 연결은 검토가 끝난 뒤 여기서 닫는다(설계 문서 §4.1).
  try {
    return await runInteractiveReview(
      input,
      review.tools,
      review.session,
      deps,
      review.active,
      review.skippedTools,
    );
  } finally {
    await review.active.close().catch(() => undefined);
  }
}

export const nodeGenerateDependencies = (): Omit<
  GenerateCommandDependencies,
  | "connect"
  | "createBaselineSuite"
  | "createAuthoringSession"
  | "finalizeAuthoringDraft"
  | "getAuthoringExecutionSuite"
  | "validateSuite"
> => ({
  exists: async (path) =>
    access(path)
      .then(() => true)
      .catch(() => false),
  openTemp: (path) => open(path, "wx"),
  readFile,
  link,
  unlink,
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
});

export function nodeReviewIO(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): ReviewIO {
  /**
   * readline은 첫 질문에서 만든다. createInterface는 만드는 즉시 입력 스트림을 참조해
   * 닫기 전까지 이벤트 루프를 붙잡는다. `--baseline-only`처럼 아무것도 묻지 않는 경로에서
   * 미리 만들면 실제 TTY에서 프로세스가 종료되지 않는다(파이프로 돌리면 stdin이 끝나
   * 우연히 종료돼 그동안 드러나지 않았다). 만들지 않으면 닫기를 잊을 여지도 없다.
   */
  let readline: ReturnType<typeof createInterface> | undefined;
  let closed = false;
  let rejectPending: (() => void) | undefined;
  const ensureReadline = (): ReturnType<typeof createInterface> => {
    if (readline !== undefined) return readline;
    const created = createInterface({ input, output });
    created.on("close", () => {
      closed = true;
      rejectPending?.();
    });
    readline = created;
    return created;
  };
  /**
   * EOF에는 두 모양이 있고 둘 다 스택 노출이나 무한 대기로 끝난다. 둘 다 sentinel로 바꾼다.
   * 1) 이미 닫힌 뒤 부르면 Node가 ERR_USE_AFTER_CLOSE를 던진다.
   * 2) 대기 중에 닫히면 question promise가 영영 settle되지 않는다. close 이벤트와 race시킨다.
   */
  const question = async (prompt: string): Promise<string> => {
    if (closed) throw new ReviewInputClosedError();
    const active = ensureReadline();
    const closedSignal = new Promise<never>((_, reject) => {
      rejectPending = () => reject(new ReviewInputClosedError());
    });
    try {
      return await Promise.race([active.question(prompt), closedSignal]);
    } catch (error) {
      if (isReviewInputClosed(error)) throw new ReviewInputClosedError();
      throw error;
    } finally {
      rejectPending = undefined;
    }
  };
  return {
    interactive: Boolean(
      (input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY,
    ),
    input: (message) => question(message),
    choose: async (message, choices) => {
      const value = await question(`${message} [${choices.join("/")}]: `);
      return value.trim();
    },
    confirm: async (message) => (await question(`${message} [y/N] `)).trim().toLowerCase() === "y",
    write: (text) => {
      output.write(text);
    },
    // 만들지 않았으면 닫을 것도 없다.
    close: () => readline?.close(),
  };
}

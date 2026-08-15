import { access, link, open, readFile, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { McpStdioConnection, ToolDef } from "@ohmymcp/core";
import type {
  AuthoringDiffPreview,
  AuthoringExecutionSnapshot,
  AuthoringRequestPreview,
  AuthoringSessionView,
  BaselineGenerationResult,
  CoverageResult,
  PublicProviderFailure,
  SanitizedAuthoringCandidate,
  ToolCoverage,
} from "@ohmymcp/generate";
import type { Cassette } from "@ohmymcp/record";
import type {
  ContractAxisKind,
  SpecFinding,
  SpecFindingCode,
  SuiteCaseApproval,
  SuiteValidationResult,
  TestSuiteSpec,
} from "@ohmymcp/runner";
import { describeSpecFinding, suiteFingerprint } from "@ohmymcp/runner";
import { wireCassette } from "./cassette-wiring.js";
import type { DryRunResult } from "./dry-run.js";
import { runDryRun } from "./dry-run.js";
import { reviewDryRun } from "./dry-run-review.js";
import { GENERATE_USAGE_HINT } from "./help.js";
import type { ProcessDiagnosticsInput } from "./process-diagnostics.js";
import { hasDiagnosticContent, renderProcessDiagnostics } from "./process-diagnostics.js";
import { ResetCommandError, runResetCommand } from "./reset-hook.js";

export { GENERATE_USAGE } from "./help.js";

export interface GenerateCommandInput {
  readonly suiteId: string;
  readonly name: string;
  readonly outPath: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly baselineOnly: boolean;
  readonly provider?: "codex" | "claude";
  readonly model?: string;
  /** 승인 전 시험 실행 여부. 기본은 실행이고 `--no-dry-run` 이 끈다. 설계 문서 §4.3. */
  readonly dryRun: boolean;
  /** `--cassette` 경로. 없으면 서버를 직접 부른다. */
  readonly cassettePath?: string;
  /** `--record`. 카세트 파일이 있어도 새로 녹화한다. */
  readonly forceRecord: boolean;
  /** `--reset-cmd`. 시험 실행 직전 1회 실행한다. */
  readonly resetCmd?: string;
}
export interface GenerateCommandDependencies {
  connect(options: { command: string; args: readonly string[] }): Promise<McpStdioConnection>;
  createBaselineSuite(
    tools: readonly ToolDef[],
    options: { suiteId: string; suiteName: string },
  ): BaselineGenerationResult;
  createAuthoringSession(baseline: BaselineGenerationResult): AuthoringSessionView;
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
  prepareAuthoringRequest?: typeof import("@ohmymcp/generate").prepareAuthoringRequest;
  dispatchAuthoringRequest?: typeof import("@ohmymcp/generate").dispatchAuthoringRequest;
  createAuthoringDiff?: typeof import("@ohmymcp/generate").createAuthoringDiff;
  applyAuthoringChanges?: typeof import("@ohmymcp/generate").applyAuthoringChanges;
  reviewLocalAuthoringCandidate?: typeof import("@ohmymcp/generate").reviewLocalAuthoringCandidate;
  computeCoverage?: typeof import("@ohmymcp/generate").computeCoverage;
  /**
   * 카세트 파일 입출력. 주입점을 여기 하나만 두는 이유는 시험 실행 경로에서 파일시스템을
   * 만지는 곳이 이것뿐이기 때문이다. 나머지(`runDryRun`·`reviewDryRun`)는 주입한 client 와
   * io 만 쓰므로 테스트가 실제 구현을 그대로 돌린다.
   */
  cassetteIo?: {
    load(path: string): Promise<Cassette | null>;
    save(path: string, cassette: Cassette): Promise<void>;
  };
}
export interface ReviewIO {
  input(message: string): Promise<string>;
  choose(message: string, choices: readonly string[]): Promise<string>;
  confirm(message: string): Promise<boolean>;
  write(text: string): void;
  readonly interactive: boolean;
  close?(): void;
}
type TestAuthoringProvider = import("@ohmymcp/generate").TestAuthoringProvider;
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
/** 출력 파일 충돌 안내. 경로는 라벨 뒤에 두어 조사가 변수에 붙지 않게 한다. */
function outputExistsFailure(deps: GenerateCommandDependencies, path: string): void {
  deps.writeStderr(
    `오류 [GENERATE_OUTPUT_EXISTS]: 출력 파일이 이미 있어 저장하지 않았습니다. 경로: ${path}\n해결: 다른 \`--out\` 경로를 지정하거나 기존 파일을 옮긴 뒤 다시 저장하세요.\n`,
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
  "--baseline-only",
  "--provider",
  "--model",
  "--no-dry-run",
  "--cassette",
  "--record",
  "--reset-cmd",
]);
/** 값을 받지 않는 옵션. `=` 를 붙여 쓸 수 없고 두 번 쓸 수 없다. */
const flagNames = new Set(["--baseline-only", "--no-dry-run", "--record"]);
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

export function parseGenerateCommand(argv: readonly string[]): GenerateCommandInput {
  const values = new Map<string, string>();
  const args: string[] = [];
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === undefined) continue;
    const option = item.includes("=") ? item.slice(0, item.indexOf("=")) : item;
    if (!option.startsWith("--"))
      throw new UsageError(`추가 위치 인자 '${item}'는 허용되지 않습니다.`);
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
    if (values.has(option)) throw new UsageError(`\`${option}\`는 한 번만 사용할 수 있습니다.`);
    values.set(option, value);
  }
  for (const option of ["--suite-id", "--name", "--out", "--command"] as const)
    if (values.get(option) === undefined) throw new UsageError(`\`${option}\` 옵션이 필요합니다.`);
  const outPath = values.get("--out") as string;
  if (!outPath.toLowerCase().endsWith(".json"))
    throw new UsageError("`--out`은 .json 파일이어야 합니다.");
  const rawProvider = values.get("--provider");
  if (rawProvider !== undefined && rawProvider !== "codex" && rawProvider !== "claude")
    throw new UsageError("`--provider`는 codex 또는 claude여야 합니다.");
  if (values.has("--model") && rawProvider === undefined)
    throw new UsageError("`--model`은 `--provider`와 함께만 사용할 수 있습니다.");
  const dryRun = !flags.has("--no-dry-run");
  const cassettePath = values.get("--cassette");
  const resetCmd = values.get("--reset-cmd");
  // 시험 실행을 끄면 서버를 접촉하지 않는다. 카세트와 초기화는 접촉을 전제한 옵션이므로 함께
  // 주면 둘 중 하나가 조용히 무시된다. 무시하는 대신 사용 오류로 돌려준다.
  if (!dryRun && cassettePath !== undefined)
    throw new UsageError("`--no-dry-run`과 `--cassette`는 함께 사용할 수 없습니다.");
  if (!dryRun && resetCmd !== undefined)
    throw new UsageError("`--no-dry-run`과 `--reset-cmd`는 함께 사용할 수 없습니다.");
  if (flags.has("--record") && cassettePath === undefined)
    throw new UsageError("`--record`는 `--cassette`와 함께만 사용할 수 있습니다.");
  if (resetCmd !== undefined && resetCmd.trim() === "")
    throw new UsageError("`--reset-cmd` 옵션 값이 필요합니다.");
  return Object.freeze({
    suiteId: values.get("--suite-id") as string,
    name: values.get("--name") as string,
    outPath,
    command: values.get("--command") as string,
    args: Object.freeze(args),
    baselineOnly: flags.has("--baseline-only"),
    provider: rawProvider,
    model: values.get("--model"),
    dryRun,
    cassettePath,
    forceRecord: flags.has("--record"),
    resetCmd,
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
    `.${basename(outPath)}.ohmymcp.${process.pid}.${temporarySequence}.tmp`,
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
  if (await deps.exists(input.outPath)) throw new OutputExistsError(input.outPath);
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
 * finding 이 어느 블록에 들어가는지. `Record<SpecFindingCode, ...>` 라서 `runner` 가 코드를
 * 늘리면 여기서 타입 오류가 난다. 문자열 배열로 두면 새 코드가 어느 블록에도 못 들어간 채
 * 조용히 사라진다. 이 화면에서 누락은 "위반이 없다" 로 읽히므로 가장 나쁜 실패다.
 *
 * `skipped` 는 위반이 아니다. 서버 스키마를 우리가 못 읽은 것이지 명세가 틀린 게 아니다.
 */
type FindingGroup = "inputContract" | "assertionSubstance" | "skipped";
const FINDING_GROUP: Readonly<Record<SpecFindingCode, FindingGroup>> = {
  TOOL_NOT_DECLARED: "inputContract",
  REQUIRED_MISSING: "inputContract",
  UNDECLARED_FIELD: "inputContract",
  TYPE_MISMATCH: "inputContract",
  ENUM_MISMATCH: "inputContract",
  SCHEMA_NOT_ANALYZABLE: "skipped",
  VACUOUS_MIN_LENGTH: "assertionSubstance",
  VACUOUS_MIN_ITEMS: "assertionSubstance",
};

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
  const skipped = grouped("skipped").length;
  // 입력 계약 블록이 먼저다. 명세를 고칠 때 입력이 먼저 맞아야 단언을 볼 수 있다.
  writeFindingBlock(io, diff, "입력 계약 위반", inputContract);
  writeFindingBlock(io, diff, "항상 통과하는 단언", assertionSubstance);
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

/** 시험 실행 고지(§8.1). 카세트와 초기화는 값이 있을 때만 줄이 나간다. */
function writeDryRunNotice(
  io: ReviewIO,
  notice: {
    readonly caseCount: number;
    readonly target: string;
    readonly cassette?: { readonly path: string; readonly fresh: boolean };
    readonly resetCmd?: string;
  },
): void {
  io.write(`시험 실행: 케이스 ${notice.caseCount}개를 실제 서버에 보냅니다.\n`);
  io.write(`  대상: ${notice.target}\n`);
  if (notice.cassette !== undefined)
    io.write(
      `  카세트: ${notice.cassette.path} (${notice.cassette.fresh ? "신규 녹화" : "재생"})\n`,
    );
  if (notice.resetCmd !== undefined) io.write(`  초기화: ${notice.resetCmd}\n`);
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
  diagnostics: ProcessDiagnosticsInput | undefined,
): void {
  const aborted = result.aborted;
  if (aborted === undefined) return;
  io.write(
    aborted.reason === "connectionLost"
      ? `✗ 시험 실행을 마치지 못했습니다. ${result.outcomes.length}/${totalCases} 케이스에서 연결이 끊겼습니다.\n`
      : "✗ 시험 실행을 마치지 못했습니다.\n",
  );
  io.write(`  → ${aborted.detail}\n`);
  if (diagnostics !== undefined && hasDiagnosticContent(diagnostics)) {
    const block = renderProcessDiagnostics(diagnostics, { maxLines: DRY_RUN_STDERR_LINES });
    if (block !== "") io.write(`\n${block}`);
  }
  io.write("\n저장하지 않았습니다. 서버를 고친 뒤 다시 save 를 고르세요.\n");
}

/**
 * 분류가 저장을 막았을 때의 안내(§8.3). 마지막 줄은 카세트 유무로 갈린다. 카세트가 있으면
 * 고친 케이스만 서버에 다시 나가고, 없으면 전량이 다시 나간다.
 */
function writeReviewBlocked(
  io: ReviewIO,
  specErrors: number,
  caseCount: number,
  cassettePath: string | undefined,
): void {
  io.write("\n");
  if (specErrors > 0) {
    io.write(`  명세 오류 ${specErrors}건이 있어 저장할 수 없습니다.\n`);
    io.write("  → 검토 메뉴의 revise 또는 edit 으로 고친 뒤 다시 save 를 고르세요.\n");
  } else {
    // 보류는 고칠 것이 없다. revise·edit 으로 보내면 사용자가 고칠 데를 찾다 만다.
    io.write("  분류하지 않은 케이스가 있어 저장할 수 없습니다.\n");
  }
  io.write(
    cassettePath !== undefined
      ? "  → 고친 케이스만 서버에 다시 나갑니다. 나머지는 카세트에서 재생됩니다.\n"
      : `  → 다시 save 를 고르면 케이스 ${caseCount}개가 모두 서버에 다시 나갑니다.\n    반복 비용이 부담되면 --cassette 를 쓰세요.\n`,
  );
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
  connection: McpStdioConnection,
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
   * 카세트 배선은 검토 세션에 하나뿐이고 `save` 를 여러 번 골라도 같은 것을 쓴다. 시도마다 새로
   * 만들면 저장이 막힌 첫 시도의 녹화가 통째로 버려지고, "고친 케이스만 서버에 다시 나갑니다"
   * (§8.3)가 거짓이 된다. flush 는 저장에 성공한 뒤 한 번만 부른다.
   */
  let cassette: Awaited<ReturnType<typeof wireCassette>> | undefined;
  /** 진단 읽기가 판정을 바꾸면 안 된다. getDiagnostics 가 던지면 삼킨다. */
  const diagnostics = (): ProcessDiagnosticsInput | undefined => {
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
        const fingerprint = session.approvedDraft.suiteFingerprint;
        io.write(`Final fingerprint: ${fingerprint}\n`);
        const dryRunSuite = session.approvedDraft.suite;
        const caseCount = dryRunSuite.cases.length;
        let approvals: readonly SuiteCaseApproval[] = [];
        if (!input.dryRun) {
          // §8.5. 시험 실행을 건너뛰면 approval.cases 가 없는 파일이 되고, 그 사실을 저장 직전에
          // 한 번 더 보여준다.
          io.write(
            `⚠ 시험 실행을 건너뜁니다. 케이스 ${caseCount}건이 실제 서버에서 확인되지 않은 채 저장됩니다.\n` +
              "   저장된 명세에 승인 기록(approval.cases)이 남지 않습니다.\n",
          );
          if (!(await io.confirm("   계속할까요?"))) continue;
        } else {
          const path = input.cassettePath;
          writeDryRunNotice(io, {
            caseCount,
            target: [input.command, ...input.args].join(" "),
            // 고지에 쓰는 모드는 파일 존재로 정한다(§5.2 의 표와 같은 규칙). 두 번째 save 부터는
            // 이미 배선이 있으므로 그 시점의 모드가 아니라 첫 배선의 모드를 그대로 쓴다.
            ...(path === undefined
              ? {}
              : {
                  cassette: {
                    path,
                    fresh:
                      cassette === undefined
                        ? input.forceRecord || !(await deps.exists(path))
                        : false,
                  },
                }),
            resetCmd: input.resetCmd,
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
          if (cassette === undefined)
            cassette = await wireCassette({
              inner: connection.client,
              path: input.cassettePath,
              forceRecord: input.forceRecord,
              io: deps.cassetteIo,
            });
          // 진행 표시는 한 번만 나간다. 중간 갱신에 터미널 제어 문자를 쓰면 파이프로 받은
          // 출력이 깨지고 그 출력을 E2E 가 비교한다.
          io.write(`▸ 시험 실행 중... ${caseCount}/${caseCount}\n`);
          const result = await runDryRun({ client: cassette.client, suite: dryRunSuite });
          for (const warning of cassette.warnings) io.write(`${warning}\n`);
          if (result.aborted !== undefined) {
            writeDryRunAborted(io, result, caseCount, diagnostics());
            continue;
          }
          writeDryRunResult(io, result);
          const review = await reviewDryRun(io, result);
          if (!review.cleared) {
            writeReviewBlocked(io, review.specErrors.length, caseCount, input.cassettePath);
            continue;
          }
          approvals = review.approvals;
        }
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
          // 저장이 끝난 뒤에만 부른다. flush 는 내부에서 inner.close() 까지 부르므로 이보다
          // 앞이면 저장 직전에 연결이 죽는다.
          await cassette?.flush();
          // 최종 suite 는 baseline 과 다르다. 사용자가 케이스를 지웠거나 AI 후보를 적용했을 수
          // 있으므로 저장한 그 suite 로 다시 계산한다.
          //
          // 저장 뒤이므로 커버리지 실패를 저장 실패로 보고하지 않는다. reportCoverageSafely 가
          // 자기 오류 경계를 갖는다.
          reportCoverageSafely(
            deps,
            () => deps.computeCoverage?.({ suite: finalSuite, tools }),
            finalSuite,
          );
          return 0;
        } catch (error) {
          if (error instanceof OutputExistsError) outputExistsFailure(deps, error.path);
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

/** 커버리지와 케이스 수 고지를 stdout 에 찍는다. 둘 다 빈 문자열이면 아무것도 안 찍는다. */
function writeCoverageReport(
  deps: GenerateCommandDependencies,
  coverage: CoverageResult | undefined,
  suite: TestSuiteSpec,
): void {
  if (coverage !== undefined) {
    const text = renderCoverage(coverage);
    if (text !== "") deps.writeStdout(text);
  }
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
): void {
  try {
    writeCoverageReport(deps, coverage(), suite);
  } catch {
    deps.writeStderr(
      "경고 [GENERATE_COVERAGE_UNAVAILABLE]: 명세는 저장했지만 커버리지를 계산하지 못했습니다.\n" +
        "해결: 저장된 명세는 그대로 `ohmymcp test` 로 쓸 수 있습니다. 커버리지만 다시 보려면 다른 --out 경로로 generate 를 실행하세요.\n",
    );
  }
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
  if (!input.baselineOnly && !deps.reviewIO?.interactive) {
    deps.writeStderr(
      "오류 [GENERATE_INTERACTIVE_REQUIRED]: AI 검토에는 TTY가 필요합니다.\n해결: `--baseline-only`를 지정하거나 대화형 터미널에서 실행하세요.\n",
    );
    return 1;
  }
  let connection: McpStdioConnection | undefined;
  /**
   * 대화형 검토는 아래 try 밖에서 돌린다. 검토가 던지는 오류를 여기 catch 가 삼키면
   * `GENERATE_FAILED` 로 뭉개지는데, 그 경로는 원래 호출자에게 그대로 올라가야 한다.
   */
  let review:
    | {
        readonly active: McpStdioConnection;
        readonly session: AuthoringSessionView;
        readonly tools: readonly ToolDef[];
      }
    | undefined;
  try {
    connection = await deps.connect({ command: input.command, args: input.args });
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
    const session = deps.createAuthoringSession(baseline);
    if (!input.baselineOnly) {
      // 아래 finally 가 닫는 것으로 소유권을 옮긴다. catch 의 forceClose 와 겹치지 않게 한다.
      connection = undefined;
      review = { active, session, tools };
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
      reportCoverageSafely(deps, () => baseline.coverage, finalSuite);
      return 0;
    }
  } catch (error) {
    if (connection !== undefined) await connection.forceClose().catch(() => undefined);
    // 같은 결함이 비대화형 경로에도 있었다. 여기서도 원인이 뭉개지면 안 된다.
    if (error instanceof OutputExistsError) outputExistsFailure(deps, error.path);
    else if (error instanceof LinkUnsupportedError)
      linkUnsupportedFailure(deps, error.path, error.code);
    else
      deps.writeStderr(
        "오류 [GENERATE_FAILED]: baseline suite를 생성하거나 저장하지 못했습니다.\n해결: MCP 서버와 출력 경로를 확인한 뒤 다시 실행하세요.\n",
      );
    return 1;
  }
  // 검토는 위 catch 밖에서 돈다. 연결은 검토가 끝난 뒤 여기서 닫는다(설계 문서 §4.1).
  try {
    return await runInteractiveReview(input, review.tools, review.session, deps, review.active);
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

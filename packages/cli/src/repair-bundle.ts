import type {
  CaseApprovalStatus,
  JsonObject,
  JsonValue,
  RunnerReport,
  TestSuiteSpec,
} from "@mcpeak/runner";
import packageMetadata from "../package.json";
import { hasDiagnosticContent, type ProcessDiagnosticsInput } from "./process-diagnostics.js";
import { caseApprovalStatuses, type SpecApprovalState } from "./spec-approval.js";

/**
 * 번들 형식 버전. 형식이 바뀌면 `repair` 가 "이 번들은 버전 N 입니다. 최신 test 로 다시
 * 만드세요" 라고 말할 수 있다. 없으면 낡은 번들에서 키가 빠졌을 때 조용히 반쪽으로 돈다.
 * 설계서 §4.2.
 */
export const REPAIR_BUNDLE_VERSION = 1;

/** 번들에 적는 CLI 식별자. `mcpeak --version` 이 찍는 것과 같은 출처를 쓴다. */
export const REPAIR_BUNDLE_GENERATED_BY = `mcpeak ${packageMetadata.version}`;

export interface RepairBundleDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly expected?: JsonValue;
  readonly actual?: JsonValue;
  /** ADR-0027 이 넣은 서버 응답 본문. AI 에게 가장 유용한 항목이라 반드시 옮긴다. */
  readonly notes?: readonly string[];
}

export interface RepairBundleFailure {
  readonly caseId: string;
  readonly caseName: string;
  readonly status: "failed" | "timedOut" | "cancelled" | "notRun";
  readonly tool?: string;
  readonly input?: JsonObject;
  readonly approvedAs?: CaseApprovalStatus;
  readonly diagnostics: readonly RepairBundleDiagnostic[];
}

export interface RepairBundle {
  readonly bundleVersion: typeof REPAIR_BUNDLE_VERSION;
  readonly generatedBy: string;
  readonly spec: {
    readonly suiteId: string;
    readonly suiteName: string;
    readonly approval: SpecApprovalState;
    readonly fingerprint: string;
    readonly approvedFingerprint?: string;
  };
  readonly failures: readonly RepairBundleFailure[];
  readonly truncated?: { readonly failures: number };
  readonly process?: ProcessDiagnosticsInput;
}

/**
 * 케이스 하나의 진단을 순서대로 모은다.
 *
 * `operation.diagnostic` 이 먼저이고 그다음이 `assertions[].diagnostic` 이다. 첫 번째만 담으면
 * 실제 원인이 두 번째에 있을 때 근거가 사라진다. 설계서 §4.2.
 */
function diagnosticsOf(item: RunnerReport["cases"][number]): readonly RepairBundleDiagnostic[] {
  const sources = [
    item.operation.diagnostic,
    ...item.assertions.map((assertion) => assertion.diagnostic),
  ];
  const collected: RepairBundleDiagnostic[] = [];
  for (const source of sources) {
    if (source === undefined) continue;
    const diagnostic: {
      code: string;
      message: string;
      expected?: JsonValue;
      actual?: JsonValue;
      notes?: readonly string[];
    } = { code: source.code, message: source.message };
    // 값이 없으면 키를 만들지 않는다. `expected`·`actual` 은 null 이 값일 수 있어 키 존재로 본다.
    if ("expected" in source) diagnostic.expected = source.expected as JsonValue;
    if ("actual" in source) diagnostic.actual = source.actual as JsonValue;
    if (source.notes !== undefined) diagnostic.notes = [...source.notes];
    collected.push(diagnostic);
  }
  return collected;
}

/**
 * 실행 결과에서 repair 번들을 만든다.
 *
 * 통과한 케이스는 담지 않는다. 이 파일은 AI 에게 줄 근거 묶음이고 `--json` 보고서와 용도가
 * 다르다. 실패가 하나도 없으면 `undefined` 를 돌려주고, 호출 지점이 파일을 안 만든다.
 * 설계서 §4.2.
 */
export function buildRepairBundle(options: {
  report: RunnerReport;
  suite: TestSuiteSpec;
  specApproval: {
    state: SpecApprovalState;
    fingerprint: string;
    approvedFingerprint?: string;
  };
  processDiagnostics?: ProcessDiagnosticsInput;
  cliVersion?: string;
}): RepairBundle | undefined {
  // timedOut·cancelled·notRun 도 담는다. 타임아웃은 서버 결함의 대표적 증상이다.
  const failed = options.report.cases.filter((item) => item.status !== "passed");
  if (failed.length === 0) return undefined;

  const approvals = caseApprovalStatuses(options.suite);
  const failures = failed.map((item) => {
    const failure: {
      caseId: string;
      caseName: string;
      status: "failed" | "timedOut" | "cancelled" | "notRun";
      tool?: string;
      input?: JsonObject;
      approvedAs?: CaseApprovalStatus;
      diagnostics: readonly RepairBundleDiagnostic[];
    } = {
      caseId: item.spec.id,
      caseName: item.spec.name,
      status: item.status as "failed" | "timedOut" | "cancelled" | "notRun",
      diagnostics: diagnosticsOf(item),
    };
    // listTools 케이스에는 툴도 입력도 없다. 빈 값으로 채우면 AI 가 "입력이 비었다" 로 읽는다.
    if (item.spec.operation.type === "callTool") {
      failure.tool = item.spec.operation.tool;
      failure.input = item.spec.operation.input;
    }
    // 단계 3 게이트에서 사람이 붙인 판정이다. 표시가 없으면 키를 만들지 않는다.
    const approvedAs = approvals.get(item.spec.id);
    if (approvedAs !== undefined) failure.approvedAs = approvedAs;
    return failure;
  });

  const spec: {
    suiteId: string;
    suiteName: string;
    approval: SpecApprovalState;
    fingerprint: string;
    approvedFingerprint?: string;
  } = {
    suiteId: options.report.suite.id,
    suiteName: options.report.suite.name,
    approval: options.specApproval.state,
    fingerprint: options.specApproval.fingerprint,
  };
  if (options.specApproval.approvedFingerprint !== undefined)
    spec.approvedFingerprint = options.specApproval.approvedFingerprint;

  const bundle: {
    bundleVersion: typeof REPAIR_BUNDLE_VERSION;
    generatedBy: string;
    spec: typeof spec;
    failures: readonly RepairBundleFailure[];
    process?: ProcessDiagnosticsInput;
  } = {
    bundleVersion: REPAIR_BUNDLE_VERSION,
    generatedBy: options.cliVersion ?? REPAIR_BUNDLE_GENERATED_BY,
    spec,
    failures,
  };
  /**
   * 내용이 있을 때만 담는다. 판정은 화면이 쓰는 `hasDiagnosticContent` 와 **같은 함수**다.
   * 규칙이 갈라지면 화면에는 안 뜨는 것이 번들에는 들어간다. 설계서 §4.2.
   */
  if (options.processDiagnostics !== undefined && hasDiagnosticContent(options.processDiagnostics))
    bundle.process = options.processDiagnostics;
  return bundle;
}

/**
 * 실패가 없어 번들을 안 만들었을 때 화면에 남기는 한 줄. 조용히 넘어가면 사용자는 파일이
 * 없는 이유를 모른다. 개행으로 끝나고 호출자가 앞에 빈 줄을 붙인다.
 */
export const REPAIR_BUNDLE_EMPTY_LINE =
  "repair 번들: 실패한 케이스가 없어 파일을 만들지 않았습니다.\n";

/** 번들 직렬화의 단일 구현. 파일에 쓰는 쪽과 테스트가 같은 형식을 본다. */
export function serializeRepairBundle(bundle: RepairBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export type RepairBundleInvalidReason =
  | "notJson"
  | "notObject"
  | "versionMismatch"
  | "missingField"
  | "emptyFailures";

export type RepairBundleRead =
  | { readonly status: "ok"; readonly bundle: RepairBundle }
  | { readonly status: "invalid"; readonly reason: RepairBundleInvalidReason };

/**
 * 거절 사유마다 다른 문장을 돌려준다. 무엇이 왜 다른지와 다음에 할 일이 한 줄씩 있어야 한다.
 * "잘못된 파일입니다" 로 뭉치면 사용자는 파일을 다시 만들어야 하는지 경로를 잘못 준 것인지
 * 구분할 수 없다.
 */
export function describeRepairBundleInvalid(reason: RepairBundleInvalidReason): string {
  switch (reason) {
    case "notJson":
      return "번들 파일이 JSON 이 아닙니다. `--repair-bundle` 이 만든 파일이 맞는지, 편집 중에 깨지지 않았는지 확인하세요.";
    case "notObject":
      return "번들 최상위가 JSON 객체가 아닙니다. 배열이나 문자열이 담긴 다른 파일을 가리키고 있지 않은지 경로를 확인하세요.";
    case "versionMismatch":
      return `번들 형식 버전이 이 CLI 가 아는 ${REPAIR_BUNDLE_VERSION} 이 아닙니다. 최신 \`mcpeak test --repair-bundle\` 로 다시 만드세요.`;
    case "missingField":
      return "번들에 필요한 항목이 없거나 값이 형식과 다릅니다. `spec` 의 `suiteId`·`suiteName`·`approval`, 각 실패의 `caseId`·`caseName`·`status`·`diagnostics`, 각 진단의 `code`·`message` 가 있어야 합니다. `mcpeak test --repair-bundle` 로 다시 만드세요.";
    case "emptyFailures":
      return "번들에 실패한 케이스가 없습니다. 진단할 근거가 없으므로 provider 를 부르지 않습니다. 실패가 있는 실행에서 번들을 다시 만드세요.";
  }
}

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 번들 파일 내용을 읽어 검증한다.
 *
 * 모르는 버전은 거절한다. 앞으로 호환을 흉내 내면 낡은 번들에서 키가 빠졌을 때 조용히
 * 반쪽으로 돈다. 설계서 §4.2.
 */
/** 화면과 진단 요청이 실제로 읽는 값들이다. 여기 없는 값은 검사하지 않는다. */
const APPROVAL_STATES = ["matched", "mismatched", "absent"] as const;
const FAILURE_STATUSES = ["failed", "timedOut", "cancelled", "notRun"] as const;
const APPROVED_AS = ["passed", "serverDefect"] as const;

const isOneOf = (value: unknown, allowed: readonly string[]): boolean =>
  typeof value === "string" && allowed.includes(value);

/**
 * 소비하는 필드가 실제로 있고 형식이 맞는지 본다.
 *
 * 얕게 보면 `caseName` 이나 `status` 가 빠진 JSON 도 통과해 그대로 provider 요청까지 나간다.
 * 사용자는 확인 화면에서 빈 값을 보고도 무엇이 잘못됐는지 모른다. 반대로 우리가 안 읽는 값까지
 * 요구하면 다른 버전이 만든 정상 번들을 거절하게 되므로, 기준은 **읽는 값**이다.
 */
function failureShapeValid(failure: unknown): boolean {
  if (!plainObject(failure)) return false;
  if (typeof failure.caseId !== "string" || failure.caseId === "") return false;
  if (typeof failure.caseName !== "string") return false;
  if (!isOneOf(failure.status, FAILURE_STATUSES)) return false;
  if (failure.tool !== undefined && typeof failure.tool !== "string") return false;
  if (failure.approvedAs !== undefined && !isOneOf(failure.approvedAs, APPROVED_AS)) return false;
  if (failure.input !== undefined && !plainObject(failure.input)) return false;
  if (!Array.isArray(failure.diagnostics)) return false;
  for (const diagnostic of failure.diagnostics) {
    if (!plainObject(diagnostic)) return false;
    if (typeof diagnostic.code !== "string") return false;
    if (typeof diagnostic.message !== "string") return false;
    if (diagnostic.notes !== undefined && !Array.isArray(diagnostic.notes)) return false;
  }
  return true;
}

function specShapeValid(spec: unknown): boolean {
  if (!plainObject(spec)) return false;
  if (typeof spec.suiteId !== "string") return false;
  if (typeof spec.suiteName !== "string") return false;
  if (!isOneOf(spec.approval, APPROVAL_STATES)) return false;
  if (typeof spec.fingerprint !== "string") return false;
  return true;
}

export function readRepairBundle(text: string): RepairBundleRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "invalid", reason: "notJson" };
  }
  if (!plainObject(parsed)) return { status: "invalid", reason: "notObject" };
  if (parsed.bundleVersion !== REPAIR_BUNDLE_VERSION)
    return { status: "invalid", reason: "versionMismatch" };
  if (!specShapeValid(parsed.spec)) return { status: "invalid", reason: "missingField" };
  if (!Array.isArray(parsed.failures)) return { status: "invalid", reason: "missingField" };
  for (const failure of parsed.failures) {
    if (!failureShapeValid(failure)) return { status: "invalid", reason: "missingField" };
  }
  // 빈 배열 검사는 항목 검사 뒤다. 항목이 깨진 번들과 실패가 없는 번들은 다음에 할 일이 다르다.
  if (parsed.failures.length === 0) return { status: "invalid", reason: "emptyFailures" };
  return { status: "ok", bundle: parsed as unknown as RepairBundle };
}

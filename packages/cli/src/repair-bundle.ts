import type { ToolDef } from "@mcpeak/core";
import type {
  CaseApprovalStatus,
  JsonObject,
  JsonValue,
  RunnerReport,
  TestSuiteSpec,
} from "@mcpeak/runner";
import packageMetadata from "../package.json";
import { hasDiagnosticContent, type ProcessDiagnosticsInput } from "./process-diagnostics.js";
import { caseApprovalStatuses, type SpecApprovalState, specRunHistory } from "./spec-approval.js";

/**
 * 번들 형식 버전. 형식이 바뀌면 `repair` 가 "이 번들은 버전 N 입니다. 최신 test 로 다시
 * 만드세요" 라고 말할 수 있다. 없으면 낡은 번들에서 키가 빠졌을 때 조용히 반쪽으로 돈다.
 * 설계서 §4.2.
 *
 * 2 는 `spec.runHistory` 를 더하며 올렸다(#385). 선택 필드로 두면 낡은 번들이 오라클 판정만
 * 조용히 달라진 채 통과한다.
 *
 * 3 은 `tools` · `failures[].assertions` · `target` · `process.scope` 를 더하며 올렸다(#393).
 * 선택 필드로 얹지 않는다. 그러면 낡은 번들이 근거 절반만 실은 채 조용히 통과하고 사용자는
 * 진단이 왜 약한지 모른다. 2 를 올릴 때 적은 이유가 그대로 유효하다.
 */
export const REPAIR_BUNDLE_VERSION = 3;

/**
 * 도구 하나의 스키마 직렬화 상한. 넘으면 스키마를 빼고 `schemasOmitted` 로 표시한다.
 *
 * 관측된 실제 MCP 도구 스키마는 대부분 1 KiB 아래다. 8 KiB 를 넘는 것은 $defs 가 수십 개
 * 달린 생성 스키마이고, 그런 것은 통째로 실어도 AI 가 원인을 좁히는 데 못 쓰면서 요청
 * 예산만 먹는다. `MAX_REQUEST_BYTES`(256 KiB)에 걸려 요청 전체가 거절되는 것보다 그 도구만
 * 줄이는 편이 낫다(#393).
 *
 * `maxCases` 기본값이 12 이고 실패 케이스가 부른 도구만 싣는다. 도구 하나가 8 KiB 를 넘지
 * 않으면 12개라도 96 KiB 이고, 나머지(진단·입력·stderr)를 더해도 256 KiB 아래다.
 */
const MAX_TOOL_SCHEMA_BYTES = 8192;

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

/**
 * 케이스 하나가 기대한 단언. 값(기대 스키마 전문 등)은 싣지 않는다. 깨진 것의 값은
 * `diagnostics` 의 `expected`·`actual` 에 이미 있고, 안 깨진 단언의 값까지 실으면 번들이
 * 커지는 만큼 진단이 좋아지지 않는다(#393).
 */
export interface RepairBundleAssertion {
  readonly type: string;
  /**
   * `runner` 의 `AssertionResult.status` 를 그대로 옮긴다. `skipped` 는 앞 단계가 결과를 못 내
   * 검사를 못 한 것이고 `notRun` 은 실행에 도달하지 못한 것이다. 뭉치면 "왜 판정이 없는가" 가
   * 사라진다.
   *
   * 케이스의 `status`(`failed`·`timedOut`·`cancelled`·`notRun`)와 **다른 유니온이다.** 섞지 마라.
   */
  readonly status: "passed" | "failed" | "skipped" | "notRun";
}

/** 실패한 케이스가 부른 도구의 선언. `repair` 는 서버를 안 띄우므로 이것이 유일한 계약 출처다. */
export interface RepairBundleTool {
  readonly name: string;
  readonly inputSchema: JsonObject;
  /** 선언이 없으면 키를 만들지 않는다. 빈 객체는 "빈 스키마" 로 읽힌다. */
  readonly outputSchema?: JsonObject;
  readonly description?: string;
  /** 크기 상한에 걸려 스키마를 뺐으면 true. 없으면 키를 만들지 않는다. */
  readonly schemasOmitted?: true;
}

/**
 * 실행 대상. **transport 하나만 싣는다.**
 *
 * 실행 명령·URL·서버 이름·버전은 싣지 않는다. ADR-0097 의 argv 마스킹(`redactOriginArgs`)이
 * `packages/record` 내부에 있고 공개 진입점으로 안 나와서, `cli` 에 같은 규칙을 다시 쓰면
 * 규칙이 두 벌이 된다. 한쪽만 고쳐지면 녹화본에는 가려진 값이 번들에는 남는다. 반쪽이라도
 * 정직한 쪽을 고른다(설계 §2.3).
 */
export interface RepairBundleTarget {
  /** "stdio" 또는 "http". 실행 방식이 다르면 같은 증상도 원인이 다르다. */
  readonly transport: string;
}

export interface RepairBundleFailure {
  readonly caseId: string;
  readonly caseName: string;
  readonly status: "failed" | "timedOut" | "cancelled" | "notRun";
  readonly tool?: string;
  readonly input?: JsonObject;
  readonly approvedAs?: CaseApprovalStatus;
  readonly assertions: readonly RepairBundleAssertion[];
  readonly diagnostics: readonly RepairBundleDiagnostic[];
}

export interface RepairBundle {
  readonly bundleVersion: typeof REPAIR_BUNDLE_VERSION;
  readonly generatedBy: string;
  readonly spec: {
    readonly suiteId: string;
    readonly suiteName: string;
    readonly approval: SpecApprovalState;
    readonly runHistory: "present" | "absent";
    readonly fingerprint: string;
    readonly approvedFingerprint?: string;
  };
  readonly failures: readonly RepairBundleFailure[];
  /** 실패한 케이스가 부른 도구만. 툴 이름 코드 단위 오름차순. 없으면 빈 배열이다. */
  readonly tools: readonly RepairBundleTool[];
  readonly target: RepairBundleTarget;
  /** 둘 다 없으면 키 자체를 만들지 않는다. */
  readonly truncated?: { readonly failures?: number; readonly toolSchemas?: number };
  /**
   * `scope` 는 이 stderr 가 무엇의 것인지다. 지금은 항상 "suite" 이고 프로세스 전체의 꼬리다.
   * 진단 프롬프트가 그 뜻을 읽는다(#393).
   */
  readonly process?: ProcessDiagnosticsInput & { readonly scope: "suite" };
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
  /** 실행 대상. transport 만 싣는다. */
  target: RepairBundleTarget;
  /**
   * 서버가 선언한 도구 전량. 여기서 실패한 케이스가 부른 것만 골라 싣는다.
   * 선택 인자다. 안 넘기면 빈 배열이라 다른 호출부가 생겨도 컴파일이 깨지지 않는다.
   */
  tools?: readonly ToolDef[];
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
      assertions: readonly RepairBundleAssertion[];
      diagnostics: readonly RepairBundleDiagnostic[];
    } = {
      caseId: item.spec.id,
      caseName: item.spec.name,
      status: item.status as "failed" | "timedOut" | "cancelled" | "notRun",
      // 통과한 단언도 싣는다. "무엇을 기대했는데 어디까지 맞았는가" 가 원인을 좁힌다.
      assertions: item.assertions.map((assertion) => ({
        type: assertion.spec.type,
        status: assertion.status,
      })),
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
    runHistory: "present" | "absent";
    fingerprint: string;
    approvedFingerprint?: string;
  } = {
    suiteId: options.report.suite.id,
    suiteName: options.report.suite.name,
    approval: options.specApproval.state,
    runHistory: specRunHistory(options.suite),
    fingerprint: options.specApproval.fingerprint,
  };
  if (options.specApproval.approvedFingerprint !== undefined)
    spec.approvedFingerprint = options.specApproval.approvedFingerprint;

  // 싣는 기준은 번들의 failures 전량이다. maxCases 로 자르는 것은 repair 쪽이다.
  const called = new Set(failures.map((failure) => failure.tool).filter(Boolean) as string[]);
  let toolSchemasOmitted = 0;
  // 툴 이름 UTF-16 코드 단위 오름차순. 서버가 준 순서를 쓰면 서버가 순서를 바꾸는 것만으로
  // 번들 바이트가 흔들린다. localeCompare 는 로캘·ICU 데이터에 따라 결과가 달라져 안 쓴다.
  const tools = (options.tools ?? [])
    .filter((tool) => called.has(tool.name))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map((tool) => {
      const schemas: { inputSchema?: JsonObject; outputSchema?: JsonObject } = {
        inputSchema: (tool.inputSchema ?? {}) as JsonObject,
      };
      if (tool.outputSchema !== undefined) schemas.outputSchema = tool.outputSchema as JsonObject;
      // 바이트로 센다. json.length 는 UTF-16 코드 단위라 한글·이모지가 든 스키마에서 틀린다.
      const omitted = Buffer.byteLength(JSON.stringify(schemas), "utf8") > MAX_TOOL_SCHEMA_BYTES;
      if (omitted) toolSchemasOmitted++;
      const entry: {
        name: string;
        inputSchema: JsonObject;
        outputSchema?: JsonObject;
        description?: string;
        schemasOmitted?: true;
      } = { name: tool.name, inputSchema: omitted ? {} : (schemas.inputSchema as JsonObject) };
      if (!omitted && schemas.outputSchema !== undefined) entry.outputSchema = schemas.outputSchema;
      if (tool.description !== undefined) entry.description = tool.description;
      // 이름과 description 은 남긴다. 도구가 있었다는 사실까지 지우면 AI 가 계약을 못 찾는다.
      if (omitted) entry.schemasOmitted = true;
      return entry;
    });

  const bundle: {
    bundleVersion: typeof REPAIR_BUNDLE_VERSION;
    generatedBy: string;
    spec: typeof spec;
    failures: readonly RepairBundleFailure[];
    tools: readonly RepairBundleTool[];
    target: RepairBundleTarget;
    truncated?: { failures?: number; toolSchemas?: number };
    process?: ProcessDiagnosticsInput & { scope: "suite" };
  } = {
    bundleVersion: REPAIR_BUNDLE_VERSION,
    generatedBy: options.cliVersion ?? REPAIR_BUNDLE_GENERATED_BY,
    spec,
    failures,
    tools,
    target: { transport: options.target.transport },
  };
  if (toolSchemasOmitted > 0) bundle.truncated = { toolSchemas: toolSchemasOmitted };
  /**
   * 내용이 있을 때만 담는다. 판정은 화면이 쓰는 `hasDiagnosticContent` 와 **같은 함수**다.
   * 규칙이 갈라지면 화면에는 안 뜨는 것이 번들에는 들어간다. 설계서 §4.2.
   */
  if (options.processDiagnostics !== undefined && hasDiagnosticContent(options.processDiagnostics))
    // 범위를 함께 적는다. 값 없이 stderr 만 실으면 AI 가 프로세스 전체의 꼬리를 개별 케이스의
    // 원인으로 읽는다(#393).
    bundle.process = { ...options.processDiagnostics, scope: "suite" };
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
      return "번들에 필요한 항목이 없거나 값이 형식과 다릅니다. `spec` 의 `suiteId`·`suiteName`·`approval`·`runHistory`, 각 실패의 `caseId`·`caseName`·`status`·`assertions`·`diagnostics`, 각 진단의 `code`·`message`, 각 단언의 `type`·`status`, 도구 목록 `tools` 와 각 도구의 `name`·`inputSchema`, 대상 `target` 의 `transport` 가 있어야 합니다. `process` 가 있으면 그 안에 `scope` 도 있어야 합니다. `mcpeak test --repair-bundle` 로 다시 만드세요.";
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
const RUN_HISTORIES = ["present", "absent"] as const;
const FAILURE_STATUSES = ["failed", "timedOut", "cancelled", "notRun"] as const;
const APPROVED_AS = ["passed", "serverDefect"] as const;
/** runner 의 `AssertionResult.status` 와 같은 네 값이다. 케이스 상태와 다른 유니온이다. */
const ASSERTION_STATUSES = ["passed", "failed", "skipped", "notRun"] as const;

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
  if (!Array.isArray(failure.assertions)) return false;
  for (const assertion of failure.assertions) {
    if (!plainObject(assertion)) return false;
    if (typeof assertion.type !== "string") return false;
    if (!isOneOf(assertion.status, ASSERTION_STATUSES)) return false;
  }
  if (!Array.isArray(failure.diagnostics)) return false;
  for (const diagnostic of failure.diagnostics) {
    if (!plainObject(diagnostic)) return false;
    if (typeof diagnostic.code !== "string") return false;
    if (typeof diagnostic.message !== "string") return false;
    if (diagnostic.notes !== undefined && !Array.isArray(diagnostic.notes)) return false;
  }
  return true;
}

function toolShapeValid(tool: unknown): boolean {
  if (!plainObject(tool)) return false;
  if (typeof tool.name !== "string" || tool.name === "") return false;
  if (!plainObject(tool.inputSchema)) return false;
  if (tool.outputSchema !== undefined && !plainObject(tool.outputSchema)) return false;
  if (tool.description !== undefined && typeof tool.description !== "string") return false;
  return true;
}

function specShapeValid(spec: unknown): boolean {
  if (!plainObject(spec)) return false;
  if (typeof spec.suiteId !== "string") return false;
  if (typeof spec.suiteName !== "string") return false;
  if (!isOneOf(spec.approval, APPROVAL_STATES)) return false;
  if (!isOneOf(spec.runHistory, RUN_HISTORIES)) return false;
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
  // 빈 배열은 허용한다. listTools 케이스만 실패한 실행이 그렇다.
  if (!Array.isArray(parsed.tools)) return { status: "invalid", reason: "missingField" };
  for (const tool of parsed.tools) {
    if (!toolShapeValid(tool)) return { status: "invalid", reason: "missingField" };
  }
  if (!plainObject(parsed.target) || typeof parsed.target.transport !== "string")
    return { status: "invalid", reason: "missingField" };
  // process 는 선택이지만, 있으면 범위가 있어야 한다. 범위 없이 읽으면 프로세스 전체의 꼬리를
  // 개별 케이스의 원인으로 읽는다.
  if (parsed.process !== undefined) {
    if (!plainObject(parsed.process)) return { status: "invalid", reason: "missingField" };
    if (parsed.process.scope !== "suite") return { status: "invalid", reason: "missingField" };
  }
  // 빈 배열 검사는 항목 검사 뒤다. 항목이 깨진 번들과 실패가 없는 번들은 다음에 할 일이 다르다.
  if (parsed.failures.length === 0) return { status: "invalid", reason: "emptyFailures" };
  return { status: "ok", bundle: parsed as unknown as RepairBundle };
}

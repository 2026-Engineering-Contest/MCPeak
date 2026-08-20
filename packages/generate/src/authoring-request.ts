import {
  checkAssertionSubstance,
  checkInputContract,
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
  type RunnerRedactionOptions,
  type TestSuiteSpec,
  validateMcpSuite,
} from "@mcpeak/runner";
import { redactSpecFindings, reviewLocalAuthoringCandidate } from "./authoring-session.js";
import type {
  AuthoringSessionView,
  GenerateReviewApproval,
  PublicProviderValidationIssue,
  SanitizedAuthoringCandidate,
} from "./authoring-types.js";
import { deepFreeze, sha256 } from "./canonical.js";
import type {
  AuthoringProviderFailureCode,
  AuthoringProviderFailureReason,
} from "./provider-process.js";
import {
  type RedactionPathGuard,
  redactAuthoringSuite,
  SUITE_CONTRACT_PATHS,
  sanitizeRedactable,
  TOOL_CONTRACT_PATHS,
} from "./redaction.js";

export type AuthoringRequestMode = "initial" | "revise";
export interface McpToolContext {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}
declare const requestBrand: unique symbol;
export interface AuthoringRequestBinding {
  readonly [requestBrand]: true;
}
export interface AuthoringRequest {
  readonly mode: AuthoringRequestMode;
  readonly instruction: string;
  readonly baseline: TestSuiteSpec;
  readonly candidate: TestSuiteSpec;
  readonly tools: readonly McpToolContext[];
}
export interface AuthoringRequestPreview {
  readonly request: AuthoringRequest;
  readonly byteLength: number;
  readonly maxResultBytes: number;
  readonly providerTimeoutMs: number;
  readonly providerId: "codex" | "claude";
  readonly model: string;
  readonly redactionsApplied: true;
  readonly requiresApproval: true;
  readonly fingerprint: string;
  readonly binding: AuthoringRequestBinding;
}
export interface TestAuthoringProvider {
  readonly id: "codex" | "claude";
  /** Factory에 고정된 모델이며 있으면 승인된 request preview와 일치해야 한다. */
  readonly model?: string;
  author(
    request: AuthoringRequest,
    options: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<unknown>;
}
export type AuthoringProviderResult =
  | {
      readonly status: "candidate";
      readonly suite: TestSuiteSpec;
      readonly summary: string;
      /** provider가 보고한 경고 문장. 전송 스키마가 문자열 배열로 규정한다. */
      readonly warnings: readonly string[];
      readonly questions: readonly string[];
    }
  | { readonly status: "questions"; readonly questions: readonly string[] };
export type AuthoringDispatchResult =
  | { readonly status: "notApproved" }
  | { readonly status: "approvalInvalidated" }
  | { readonly status: "providerFailed"; readonly failure: PublicProviderFailure }
  | { readonly status: "resultLimitExceeded" }
  | { readonly status: "invalid"; readonly issues: readonly PublicProviderValidationIssue[] }
  | { readonly status: "questions"; readonly questions: readonly string[] }
  | { readonly status: "preview"; readonly preview: SanitizedAuthoringCandidate };

export const MAX_PROMPT_BYTES = 65_536;
export const MAX_TOOLS_BYTES = 131_072;
export const MAX_REQUEST_BYTES = 262_144;
export const DEFAULT_MAX_RESULT_BYTES = 262_144;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 120_000;
export const MAX_PROVIDER_TIMEOUT_MS = 600_000;

export interface PublicProviderFailure {
  readonly providerId: "codex" | "claude";
  readonly code: AuthoringProviderFailureCode;
  readonly timeoutMs: number;
  readonly exitCode?: number;
  /** 닫힌 enum이며 CLI 안내 분기에만 쓴다. raw stream 문자열은 절대 담기지 않는다. */
  readonly reason?: AuthoringProviderFailureReason;
  readonly stderr?: { readonly captured: boolean; readonly truncated: boolean };
}

type RequestState = {
  request: AuthoringRequest;
  fingerprint: string;
  providerId: "codex" | "claude";
  timeoutMs: number;
  maxResultBytes: number;
  tools: readonly McpToolContext[];
  /**
   * 검사용 원본 도구 목록이다. provider 로 보내는 `tools` 사본은 치환돼 있어 inputSchema 안의
   * enum 값이 바뀔 수 있고, 그것으로 대조하면 정상 입력이 ENUM_MISMATCH 로 뒤집힌다.
   * `TOOL_CONTRACT_PATHS` 가 지켜주는 것은 `[i].name` 뿐이다. payload 에는 넣지 않는다.
   */
  unredactedTools: readonly McpToolContext[];
  redaction?: RunnerRedactionOptions;
};
const requests = new WeakMap<AuthoringRequestPreview, RequestState>();
const candidates = new WeakMap<SanitizedAuthoringCandidate, TestSuiteSpec>();
export const providerFailureCodes = new Set<AuthoringProviderFailureCode>([
  "providerUnavailable",
  "nonZeroExit",
  "timedOut",
  "cancelled",
  "outputLimitExceeded",
  "invalidUtf8",
  "invalidJson",
  "schemaMismatch",
  "internal",
]);
export const providerFailureReasons = new Set<AuthoringProviderFailureReason>([
  "notAuthenticated",
  "unknownModel",
  "rateLimited",
  "badRequest",
  "serverError",
]);
const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function assertJson(value: unknown, path: string, active = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw issue("INVALID_JSON", path);
    return;
  }
  if (!Array.isArray(value) && !plain(value)) throw issue("INVALID_JSON", path);
  if (active.has(value)) throw issue("INVALID_JSON", path);
  active.add(value);
  try {
    if (Array.isArray(value))
      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) throw issue("INVALID_JSON", `${path}[${i}]`);
        assertJson(value[i], `${path}[${i}]`, active);
      }
    else for (const key of Object.keys(value)) assertJson(value[key], `${path}.${key}`, active);
  } finally {
    active.delete(value);
  }
}
function issue(code: string, path: string): Error {
  const error = new TypeError(`JSON으로 표현할 수 없는 inputSchema입니다: ${path}`);
  Object.assign(error, { code, path, hint: "JSON 값만 사용하세요." });
  return error;
}
function byte(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
/** 치환 규칙은 redaction.ts 한 곳에만 둔다. 여기서 두 번째 구현을 만들지 않는다. */
const redacted = (
  value: unknown,
  options?: RunnerRedactionOptions,
  contractPath?: RedactionPathGuard,
): unknown => sanitizeRedactable(value, options, contractPath);
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function redactText(value: string, options?: RunnerRedactionOptions): string {
  let result = value;
  for (const sensitiveValue of options?.sensitiveValues ?? [])
    if (sensitiveValue.length > 0) result = result.split(sensitiveValue).join(REDACTED);
  for (const key of [...DEFAULT_SENSITIVE_KEYS, ...(options?.sensitiveKeys ?? [])]) {
    const expression = new RegExp(`(${escapeRegex(key)}\\s*[=:]\\s*)[^\\s,;]+`, "gi");
    result = result.replace(expression, `$1${REDACTED}`);
  }
  return result;
}
/**
 * provider 오류를 화면에 내보낼 수 있는 닫힌 형태로 접는다.
 *
 * authoring 과 진단이 이 한 곳을 함께 쓴다. 매핑이 두 벌이 되면 닫힌 enum 목록이 한쪽만
 * 늘어나도 아무도 모른다. state 는 두 통로가 공통으로 가진 두 필드만 받는다.
 */
export function publicProviderFailure(
  error: unknown,
  state: { readonly providerId: "codex" | "claude"; readonly timeoutMs: number },
): PublicProviderFailure {
  const source = error as {
    code?: unknown;
    exitCode?: unknown;
    reason?: unknown;
    stderr?: { captured?: unknown; truncated?: unknown };
  };
  const code =
    typeof source?.code === "string" &&
    providerFailureCodes.has(source.code as AuthoringProviderFailureCode)
      ? (source.code as AuthoringProviderFailureCode)
      : "internal";
  const exitCode =
    typeof source?.exitCode === "number" &&
    Number.isInteger(source.exitCode) &&
    source.exitCode >= 0
      ? source.exitCode
      : undefined;
  const stderr =
    typeof source?.stderr?.captured === "boolean" && typeof source.stderr.truncated === "boolean"
      ? { captured: source.stderr.captured, truncated: source.stderr.truncated }
      : undefined;
  // enum 멤버만 통과시킨다. 조작된 오류 객체의 임의 문자열이 UI로 새어 나가지 않게 한다.
  const reason =
    typeof source?.reason === "string" &&
    providerFailureReasons.has(source.reason as AuthoringProviderFailureReason)
      ? (source.reason as AuthoringProviderFailureReason)
      : undefined;
  return {
    providerId: state.providerId,
    code,
    timeoutMs: state.timeoutMs,
    exitCode,
    reason,
    stderr,
  };
}
function safeIssues(input: unknown): readonly PublicProviderValidationIssue[] {
  const result = validateMcpSuite(input);
  if (result.valid) return [];
  return result.issues.slice(0, 100).map(({ code }) => ({
    code,
    path: "suite",
    message: "provider 결과가 suite 계약을 만족하지 않습니다.",
    hint: "지원되는 suite 형식을 사용하세요.",
  }));
}
function frozen<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}
export function prepareAuthoringRequest(options: {
  mode: AuthoringRequestMode;
  instruction: string;
  baseline: TestSuiteSpec;
  candidate: TestSuiteSpec;
  tools: readonly McpToolContext[];
  providerId: "codex" | "claude";
  model: string;
  redaction?: RunnerRedactionOptions;
  maxResultBytes?: number;
  providerTimeoutMs?: number;
}): AuthoringRequestPreview {
  if (options.mode !== "initial" && options.mode !== "revise")
    throw new TypeError("지원하지 않는 authoring request mode입니다.");
  if (
    !Number.isInteger(options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS) ||
    (options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS) < 1 ||
    (options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS) > MAX_PROVIDER_TIMEOUT_MS
  )
    throw new RangeError("provider timeout은 1부터 600000 사이의 정수여야 합니다.");
  if (
    !Number.isInteger(options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES) ||
    (options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES) < 1 ||
    (options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES) > DEFAULT_MAX_RESULT_BYTES
  )
    throw new RangeError("max result bytes가 유효하지 않습니다.");
  for (const tool of options.tools) assertJson(tool.inputSchema, `tools.${tool.name}.inputSchema`);
  if (byte(options.instruction) > MAX_PROMPT_BYTES)
    throw new RangeError("prompt byte limit을 초과했습니다.");
  if (byte(options.tools) > MAX_TOOLS_BYTES)
    throw new RangeError("tools byte limit을 초과했습니다.");
  const baseline = redacted(
    options.baseline,
    options.redaction,
    SUITE_CONTRACT_PATHS,
  ) as TestSuiteSpec;
  const candidate =
    options.mode === "initial"
      ? baseline
      : (redacted(options.candidate, options.redaction, SUITE_CONTRACT_PATHS) as TestSuiteSpec);
  const request = frozen({
    mode: options.mode,
    instruction: redacted(options.instruction, options.redaction) as string,
    baseline,
    candidate,
    tools: redacted(options.tools, options.redaction, TOOL_CONTRACT_PATHS) as McpToolContext[],
  });
  if (byte(request) > MAX_REQUEST_BYTES) throw new RangeError("request byte limit을 초과했습니다.");
  const fingerprint = sha256(request);
  const binding = frozen({} as never);
  const preview = frozen({
    request,
    byteLength: byte(request),
    maxResultBytes: options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
    providerTimeoutMs: options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    providerId: options.providerId,
    model: options.model,
    redactionsApplied: true as const,
    requiresApproval: true as const,
    fingerprint,
    binding,
  });
  requests.set(preview, {
    request,
    fingerprint,
    providerId: options.providerId,
    timeoutMs: preview.providerTimeoutMs,
    maxResultBytes: preview.maxResultBytes,
    tools: request.tools,
    // byte(request) · assertJson 대상 밖이다. 넣으면 MAX_TOOLS_BYTES 판정이 두 배로 세어져
    // 정상 요청이 거부된다.
    //
    // 참조가 아니라 깊은 복사 스냅샷이다. 참조로 들면 요청 준비 뒤 호출자가 배열이나
    // inputSchema 를 바꿨을 때 승인 시점의 검사 결과가 달라진다. 요청 지문은 치환된 request
    // 만 고정하므로 그 변화를 못 잡는다. 결정론성이 이 프로젝트의 핵심 가치다.
    unredactedTools: frozen(options.tools),
    redaction: options.redaction,
  });
  return preview;
}
export function validateAuthoringProviderResult(
  raw: unknown,
  preview: AuthoringRequestPreview,
): AuthoringDispatchResult {
  const state = requests.get(preview);
  if (
    state === undefined ||
    preview.fingerprint !== state.fingerprint ||
    sha256(preview.request) !== state.fingerprint
  )
    return { status: "approvalInvalidated" };
  if (byte(raw) > state.maxResultBytes) return { status: "resultLimitExceeded" };
  if (!plain(raw) || (raw.status !== "candidate" && raw.status !== "questions"))
    return { status: "invalid", issues: safeIssues(raw) };
  if (raw.status === "questions") {
    // questions 응답에 suite/summary/warnings가 딸려오면 candidate를 우회 적용하려는 시도로 본다.
    if ("suite" in raw || "summary" in raw || "warnings" in raw)
      return {
        status: "invalid",
        issues: [
          {
            code: "INVALID_VALUE",
            path: "status",
            message: "questions 응답에 suite 결과가 함께 왔습니다.",
            hint: "질문만 반환하거나 candidate로 반환하세요.",
          },
        ],
      };
    const questions = raw.questions;
    return Array.isArray(questions) &&
      questions.length > 0 &&
      questions.every((v) => typeof v === "string" && /\S/.test(v))
      ? {
          status: "questions",
          questions: frozen(questions.map((item) => redactText(item, state.redaction))),
        }
      : {
          status: "invalid",
          issues: [
            {
              code: "INVALID_VALUE",
              path: "questions",
              message: "질문 결과가 유효하지 않습니다.",
              hint: "비어 있지 않은 질문을 반환하세요.",
            },
          ],
        };
  }
  if (
    !plain(raw.suite) ||
    typeof raw.summary !== "string" ||
    !Array.isArray(raw.questions) ||
    !Array.isArray(raw.warnings)
  )
    return { status: "invalid", issues: safeIssues(raw.suite) };
  const suiteIssues = safeIssues(raw.suite);
  const suite = raw.suite as unknown as TestSuiteSpec;
  const contextIssues: PublicProviderValidationIssue[] = [...suiteIssues];
  if (
    suite.id !== state.request.candidate.id ||
    suite.schemaVersion !== state.request.candidate.schemaVersion
  )
    contextIssues.push({
      code: "INVALID_VALUE",
      path: "suite.id",
      message: "suite identity가 요청과 일치하지 않습니다.",
      hint: "요청의 suite identity를 유지하세요.",
    });
  const names = new Set(state.tools.map((tool) => tool.name));
  // 스키마 위반 suite는 case 모양을 보장하지 않는다. operation에 바로 접근하면 TypeError가 나고
  // dispatch의 catch가 그것을 providerFailed/internal로 뭉개 사용자가 진짜 원인을 못 본다.
  const cases = Array.isArray(suite.cases) ? suite.cases : [];
  cases.forEach((item, index) => {
    const operation = plain(item) ? item.operation : undefined;
    if (!plain(operation)) return;
    if (operation.type === "callTool" && !names.has(operation.tool as string))
      contextIssues.push({
        code: "INVALID_VALUE",
        path: `suite.cases[${index}].operation.tool`,
        message: "허용되지 않은 MCP 도구입니다.",
        hint: "요청에 포함된 도구만 사용하세요.",
      });
  });
  if (contextIssues.length) return { status: "invalid", issues: contextIssues.slice(0, 100) };
  // 검사는 값 치환 이전 suite 로 한다. sanitized.suite 를 쓰면 숫자 필드가 '[REDACTED]' 문자열이
  // 되어 TYPE_MISMATCH 거짓 양성이 난다. 도구 목록도 치환된 state.tools 가 아니라 원본을 쓴다.
  // 이 지점의 suite 는 validateMcpSuite · identity · 도구 allowlist 를 이미 통과했다.
  // 그 앞으로 옮기면 검증 안 된 객체가 검사 안으로 들어가 던진다. 설계 문서 §3.
  // 검사는 치환 이전 suite·도구로 하고, 결과를 싣기 직전에 값 필드만 치환한다. 안 하면
  // 치환해서 감춘 값이 승인 화면의 경고 문장으로 되살아난다. 로컬 경로와 같은 함수를 쓴다.
  const specFindings = frozen({
    inputContract: redactSpecFindings(
      checkInputContract({ suite, tools: state.unredactedTools }),
      state.redaction,
    ),
    assertionSubstance: redactSpecFindings(checkAssertionSubstance(suite), state.redaction),
  });
  const sanitized = redactAuthoringSuite(suite, state.redaction);
  const result: AuthoringProviderResult = {
    status: "candidate",
    suite: frozen(sanitized.suite),
    summary: redactText(raw.summary, state.redaction),
    // provider가 보고한 경고를 사용자에게 전달한다. 문자열만 통과시키고 redaction을 적용하며
    // 개수 상한을 둔다(issues와 같은 100). 검증만 하고 버리면 경고가 사용자에게 닿지 않는다.
    warnings: frozen(
      raw.warnings
        .filter((v): v is string => typeof v === "string" && /\S/.test(v))
        .slice(0, 100)
        .map((item) => redactText(item, state.redaction)),
    ),
    questions: frozen(
      raw.questions
        .filter((v): v is string => typeof v === "string")
        .map((item) => redactText(item, state.redaction)),
    ),
  };
  if (byte(result) > state.maxResultBytes) return { status: "resultLimitExceeded" };
  const candidate = frozen({
    result,
    byteLength: byte(result),
    redactedPaths: frozen(sanitized.redactedPaths),
    executable: sanitized.redactedPaths.length === 0,
    requiresApproval: true as const,
    fingerprint: sha256(result),
    specFindings,
    binding: frozen({} as never),
  });
  candidates.set(candidate, result.suite);
  return { status: "preview", preview: candidate };
}
export async function dispatchAuthoringRequest(options: {
  provider: TestAuthoringProvider;
  preview: AuthoringRequestPreview;
  approval: GenerateReviewApproval;
  signal?: AbortSignal;
  session?: AuthoringSessionView;
}): Promise<AuthoringDispatchResult> {
  const state = requests.get(options.preview);
  if (!options.approval.approved) return { status: "notApproved" };
  if (
    state === undefined ||
    options.approval.fingerprint !== state.fingerprint ||
    options.preview.fingerprint !== state.fingerprint ||
    sha256(options.preview.request) !== state.fingerprint ||
    options.provider.id !== state.providerId ||
    (options.provider.model !== undefined && options.provider.model !== options.preview.model)
  )
    return { status: "approvalInvalidated" };
  try {
    const providerResult = await options.provider.author(state.request, {
      signal: options.signal,
      timeoutMs: state.timeoutMs,
    });
    const result = validateAuthoringProviderResult(providerResult, options.preview);
    if (result.status !== "preview" || options.session === undefined) return result;
    const candidate =
      plain(providerResult) && providerResult.status === "candidate" && plain(providerResult.suite)
        ? (providerResult.suite as unknown as TestSuiteSpec)
        : result.preview.result.suite;
    return reviewLocalAuthoringCandidate({
      session: options.session,
      candidate,
      // 치환 사본이 아니라 원본을 넘긴다. 세션 경로도 안에서 같은 대조를 돌리므로 치환된
      // enum 값으로 대조하면 정상 입력이 ENUM_MISMATCH 로 뒤집힌다. 도구 이름 allowlist 는
      // TOOL_CONTRACT_PATHS 덕분에 두 목록에서 같다.
      tools: state.unredactedTools,
      providerId: state.providerId,
      redaction: state.redaction,
      sensitiveValues: state.redaction?.sensitiveValues,
    });
  } catch (error) {
    return { status: "providerFailed", failure: publicProviderFailure(error, state) };
  }
}

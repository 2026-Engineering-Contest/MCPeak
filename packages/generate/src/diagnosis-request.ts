import type { RunnerRedactionOptions } from "@ohmymcp-hsu/runner";
import {
  DEFAULT_MAX_RESULT_BYTES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  MAX_REQUEST_BYTES,
  type McpToolContext,
  type PublicProviderFailure,
  publicProviderFailure,
} from "./authoring-request.js";
import { deepFreeze, sha256 } from "./canonical.js";
import {
  type DiagnosisCause,
  type DiagnosisDiagnostic,
  type DiagnosisFailure,
  type DiagnosisProcessDiagnostics,
  type DiagnosisRequest,
  type DiagnosisResult,
  MAX_CAUSE_CHARS,
  type ServerDiagnosisProvider,
} from "./diagnosis-schema.js";
import { sanitizeRedactable, TOOL_CONTRACT_PATHS } from "./redaction.js";
import type { JsonValue } from "./schema.js";

/** 한 번에 보낼 실패 개수 기본 상한. 실패 12건의 원인은 보통 1~2개이고, 개수보다 다양성이
 *  중요하다. 10건이면 한 화면에 담기는 답이 나온다. 설계서 §7.3. */
export const DEFAULT_MAX_REPAIR_CASES = 10;

/** 전송할 stderr 바이트 상한. core 기본 maxStderrBytes 는 64KB 이고 그대로 보내면 요청의
 *  대부분이 로그가 된다. 8KB 는 스택트레이스 여러 벌이 들어가는 크기다. 설계서 §7.3. */
export const MAX_REPAIR_STDERR_BYTES = 8192;

declare const diagnosisRequestBrand: unique symbol;
export interface DiagnosisRequestBinding {
  readonly [diagnosisRequestBrand]: true;
}

export interface DiagnosisRequestPreview {
  readonly request: DiagnosisRequest;
  readonly byteLength: number;
  readonly providerId: "codex" | "claude";
  readonly model: string;
  readonly providerTimeoutMs: number;
  readonly maxResultBytes: number;
  readonly redactionsApplied: true;
  readonly requiresApproval: true;
  readonly fingerprint: string;
  /** 상한에 걸려 뺀 것들. 화면이 그대로 표시한다. 설계서 §7.3. */
  readonly omitted: {
    readonly failures: number;
    readonly stderrBytes: number;
  };
  readonly binding: DiagnosisRequestBinding;
}

/**
 * 승인 검사에 쓰는 요청 상태. `authoring-request.ts` 와 같은 방식이지만 맵은 여기 따로 둔다.
 * 두 통로의 상태가 한 맵에 섞이면 한쪽 preview 로 다른 쪽 요청을 보낼 여지가 생긴다.
 */
type DiagnosisState = {
  readonly request: DiagnosisRequest;
  readonly fingerprint: string;
  readonly providerId: "codex" | "claude";
  readonly timeoutMs: number;
  readonly maxResultBytes: number;
};
const diagnosisRequests = new WeakMap<DiagnosisRequestPreview, DiagnosisState>();

function frozen<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function byte(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * stderr 를 뒤에서부터 남긴다. 스택트레이스와 마지막 오류가 꼬리에 있기 때문이다(설계서 §7.3).
 * 바이트 경계에서 자르면 UTF-8 문자 중간이 끊길 수 있으므로, 남긴 조각의 앞머리에 붙은
 * 연속 바이트(0b10xxxxxx)를 문자 시작 바이트가 나올 때까지 걷어낸다.
 */
function tailBytes(
  text: string,
  limit: number,
): { readonly kept: string; readonly omitted: number } {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= limit) return { kept: text, omitted: 0 };
  let start = buffer.byteLength - limit;
  while (start < buffer.byteLength && ((buffer[start] as number) & 0xc0) === 0x80) start += 1;
  return { kept: buffer.subarray(start).toString("utf8"), omitted: start };
}

/** 민감 키·값 치환. 구조화된 부분에만 적용한다. stderr 에는 적용하지 않는다(설계서 §7.2). */
function redacted(value: unknown, options?: RunnerRedactionOptions): unknown {
  return sanitizeRedactable(value, options);
}

/**
 * 실패 하나를 전송 형태로 옮긴다. 선택 필드는 값이 없으면 **키를 만들지 않는다.**
 * `undefined` 로 넣으면 JSON.stringify 결과가 흔들려 요청 바이트가 입력에 따라 달라진다.
 */
function toFailure(failure: DiagnosisFailure, options?: RunnerRedactionOptions): DiagnosisFailure {
  const diagnostics = failure.diagnostics.map((item) => {
    const next: {
      code: string;
      message: string;
      expected?: JsonValue;
      actual?: JsonValue;
      notes?: readonly string[];
    } = { code: item.code, message: item.message };
    if ("expected" in item) next.expected = redacted(item.expected, options) as JsonValue;
    if ("actual" in item) next.actual = redacted(item.actual, options) as JsonValue;
    if (item.notes !== undefined) next.notes = [...item.notes];
    return next satisfies DiagnosisDiagnostic;
  });
  const next: {
    caseId: string;
    caseName: string;
    tool?: string;
    input?: Readonly<Record<string, JsonValue>>;
    approvedAs?: "passed" | "serverDefect";
    diagnostics: readonly DiagnosisDiagnostic[];
  } = { caseId: failure.caseId, caseName: failure.caseName, diagnostics };
  if (failure.tool !== undefined) next.tool = failure.tool;
  if (failure.input !== undefined)
    next.input = redacted(failure.input, options) as Readonly<Record<string, JsonValue>>;
  if (failure.approvedAs !== undefined) next.approvedAs = failure.approvedAs;
  return next satisfies DiagnosisFailure;
}

export function prepareDiagnosisRequest(options: {
  specApproved: boolean;
  suite: { id: string; name: string };
  failures: readonly DiagnosisFailure[];
  processDiagnostics?: DiagnosisProcessDiagnostics;
  tools: readonly McpToolContext[];
  providerId: "codex" | "claude";
  model: string;
  maxCases?: number;
  includeStderr?: boolean;
  redaction?: RunnerRedactionOptions;
  providerTimeoutMs?: number;
  maxResultBytes?: number;
}): DiagnosisRequestPreview {
  const maxCases = options.maxCases ?? DEFAULT_MAX_REPAIR_CASES;
  if (!Number.isInteger(maxCases) || maxCases < 1)
    throw new RangeError("max cases는 1 이상의 정수여야 합니다.");
  const providerTimeoutMs = options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  if (!Number.isInteger(providerTimeoutMs) || providerTimeoutMs < 1)
    throw new RangeError("provider timeout은 1 이상의 정수여야 합니다.");
  const maxResultBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
  if (!Number.isInteger(maxResultBytes) || maxResultBytes < 1)
    throw new RangeError("max result bytes가 유효하지 않습니다.");

  // 실패 개수는 앞에서부터 남긴다. 명세의 cases 순서이자 사용자가 쓴 순서다. 설계서 §7.3.
  const kept = options.failures.slice(0, maxCases);
  const omittedFailures = options.failures.length - kept.length;

  const includeStderr = options.includeStderr ?? true;
  let omittedStderrBytes = 0;
  let processDiagnostics: DiagnosisProcessDiagnostics | undefined;
  if (includeStderr && options.processDiagnostics !== undefined) {
    const source = options.processDiagnostics;
    const tail = tailBytes(source.stderr, MAX_REPAIR_STDERR_BYTES);
    omittedStderrBytes = tail.omitted;
    processDiagnostics = {
      stderr: tail.kept,
      stderrTruncated: source.stderrTruncated || tail.omitted > 0,
      exitCode: source.exitCode,
      signal: source.signal,
    };
  }

  const request = frozen({
    specApproved: options.specApproved,
    suite: { id: options.suite.id, name: options.suite.name },
    failures: kept.map((failure) => toFailure(failure, options.redaction)),
    // includeStderr 가 거짓이면 키 자체를 만들지 않는다. 빈 문자열로 넣으면 프롬프트에
    // "서버 stderr: " 라는 빈 줄이 남아 AI 가 "로그가 있었는데 비었다" 로 읽는다.
    ...(processDiagnostics === undefined ? {} : { processDiagnostics }),
    tools: sanitizeRedactable(
      options.tools,
      options.redaction,
      TOOL_CONTRACT_PATHS,
    ) as McpToolContext[],
  }) as DiagnosisRequest;

  // 요청 전체가 상한을 넘으면 자르지 않고 던진다. 무엇을 버릴지 우리가 임의로 정하면
  // 사용자는 어떤 근거가 빠졌는지 모른다. 설계서 §7.3.
  if (byte(request) > MAX_REQUEST_BYTES) throw new RangeError("request byte limit을 초과했습니다.");

  // sha256 은 canonicalJson 으로 직렬화한 뒤 해시한다(runner canonical.ts). 키 순서에
  // 의존하지 않는 지문이라 같은 입력이면 항상 같은 값이 나온다.
  const fingerprint = sha256(request);
  const preview = frozen({
    request,
    byteLength: byte(request),
    providerId: options.providerId,
    model: options.model,
    providerTimeoutMs,
    maxResultBytes,
    redactionsApplied: true as const,
    requiresApproval: true as const,
    fingerprint,
    omitted: { failures: omittedFailures, stderrBytes: omittedStderrBytes },
    binding: frozen({} as never),
  });
  // 승인 검사가 대조할 것을 여기서 잠근다. preview 를 들고 오는 쪽이 무엇을 바꿔 와도
  // 나가는 것은 이 시점에 고정된 request 다.
  diagnosisRequests.set(preview, {
    request,
    fingerprint,
    providerId: options.providerId,
    timeoutMs: preview.providerTimeoutMs,
    maxResultBytes: preview.maxResultBytes,
  });
  return preview;
}

export type DiagnosisValidation =
  | { readonly status: "ok"; readonly result: DiagnosisResult }
  | { readonly status: "schemaMismatch" };

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 문자열을 앞에서부터 남기고 상한을 넘는 만큼 자른다. 코드 유닛이 아니라 코드 포인트 단위로
 * 세고 자르므로 서로게이트 쌍(이모지 등)의 중간이 끊기지 않는다.
 */
function clamp(text: string, limit: number): string {
  const points = [...text];
  return points.length <= limit ? text : points.slice(0, limit).join("");
}

/** provider 응답의 causes 항목 하나가 스키마 모양을 지키는지 본다. 필드 누락도 여기서 잡는다. */
function isCauseShape(value: unknown): value is DiagnosisCause {
  if (!plain(value)) return false;
  for (const key of ["caseId", "summary", "location", "evidence"])
    if (typeof value[key] !== "string") return false;
  return value.target === "server" || value.target === "spec";
}

/**
 * provider 응답을 검증한다. 설계서 §5.6 의 순서를 그대로 따른다.
 * provider 응답은 신뢰하지 않는다. 여기를 통과한 것만 화면에 나간다.
 */
export function validateDiagnosisResult(
  value: unknown,
  preview: DiagnosisRequestPreview,
): DiagnosisValidation {
  // 1. 스키마 모양이 맞지 않으면 schemaMismatch.
  if (!plain(value)) return { status: "schemaMismatch" };
  if (value.status !== "diagnosis" && value.status !== "unsure")
    return { status: "schemaMismatch" };
  if (!Array.isArray(value.causes)) return { status: "schemaMismatch" };
  if (typeof value.shortfall !== "string") return { status: "schemaMismatch" };
  if (!value.causes.every(isCauseShape)) return { status: "schemaMismatch" };

  const causes = value.causes as readonly DiagnosisCause[];

  // 2-후반. status 가 unsure 면 causes 를 통째로 버린다. 버린 수는 discarded 에 실어
  // 화면이 "무엇인가 왔지만 쓰지 않았다" 를 말할 수 있게 한다.
  if (value.status === "unsure")
    return {
      status: "ok",
      result: frozen({
        status: "unsure" as const,
        // shortfall 은 자르지 않는다. 상한 대상은 §5.6-5 가 정한 셋(summary·location·evidence)뿐이다.
        shortfall: value.shortfall,
        discarded: { unknownCase: 0, specTarget: 0, unsureCauses: causes.length },
      }),
    };

  // 3. 요청에 담아 보낸 실패 목록에 없는 caseId 는 버린다. AI 가 케이스를 지어낸 것이다.
  const known = new Set(preview.request.failures.map((failure) => failure.caseId));
  // 4. specApproved 가 true 면 target: "spec" 항목을 버린다. 명세는 옳다는 전제로 물었고
  //    그 전제를 뒤집는 답은 요청 범위 밖이다. false 면 통과시킨다.
  const specApproved = preview.request.specApproved;
  const discarded = { unknownCase: 0, specTarget: 0, unsureCauses: 0 };
  const kept = causes.filter((cause) => {
    // 한 후보가 두 조건을 모두 어기면 요청 범위 검사를 먼저 적용해 한 사유에만 센다.
    if (!known.has(cause.caseId)) {
      discarded.unknownCase += 1;
      return false;
    }
    if (specApproved && cause.target === "spec") {
      discarded.specTarget += 1;
      return false;
    }
    return true;
  });

  // 항목 순서는 요청의 failures 순서를 따른다. AI 응답 순서는 매번 다를 수 있고, 화면 순서가
  // 흔들리면 같은 실행을 두 번 볼 때 다른 화면이 나온다. 같은 caseId 안에서는 응답의 상대
  // 순서를 유지한다(Array#sort 는 안정 정렬이다).
  const order = new Map(
    preview.request.failures.map((failure, index) => [failure.caseId, index] as const),
  );
  const ordered = [...kept].sort(
    (left, right) => (order.get(left.caseId) ?? 0) - (order.get(right.caseId) ?? 0),
  );

  // 5. 문자열 상한을 넘으면 자른다.
  const clamped = ordered.map((cause) => ({
    caseId: cause.caseId,
    summary: clamp(cause.summary, MAX_CAUSE_CHARS),
    location: clamp(cause.location, MAX_CAUSE_CHARS),
    evidence: clamp(cause.evidence, MAX_CAUSE_CHARS),
    target: cause.target,
  }));

  // 2-전반. 유효 항목이 하나도 없으면 unsure 로 접는다. shortfall 은 빈 문자열이다.
  if (clamped.length === 0)
    return {
      status: "ok",
      result: frozen({ status: "unsure" as const, shortfall: "", discarded }),
    };
  return {
    status: "ok",
    result: frozen({ status: "diagnosis" as const, causes: clamped, discarded }),
  };
}

export type DiagnosisDispatchResult =
  | { readonly status: "notApproved" }
  | { readonly status: "approvalInvalidated" }
  | { readonly status: "providerFailed"; readonly failure: PublicProviderFailure }
  | { readonly status: "invalid" }
  /** 응답이 `maxResultBytes` 를 넘었다. 자르지 않고 거절한다. 잘린 진단은 근거가 잘린 진단이다. */
  | { readonly status: "resultLimitExceeded" }
  | { readonly status: "diagnosis"; readonly result: DiagnosisResult };

/**
 * 승인된 진단 요청을 provider 로 보낸다.
 *
 * 승인 검사는 `dispatchAuthoringRequest` 와 같은 조건이다. **사용자가 본 것과 나가는 것이
 * 같다는 보장이 이 검사다.** 느슨하게 만들지 않는다. 보내는 것은 preview 가 들고 있는 request
 * 가 아니라 준비 시점에 맵에 잠근 `state.request` 다.
 */
export async function dispatchDiagnosisRequest(options: {
  provider: ServerDiagnosisProvider;
  preview: DiagnosisRequestPreview;
  approval: { approved: boolean; fingerprint: string };
  signal?: AbortSignal;
}): Promise<DiagnosisDispatchResult> {
  const state = diagnosisRequests.get(options.preview);
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
    const raw = await options.provider.diagnose(state.request, {
      signal: options.signal,
      timeoutMs: state.timeoutMs,
    });
    // 호출자가 정한 상한을 실제로 강제한다. authoring 경로(`authoring-request.ts:345`)와 같은
    // 자리에서 같은 판정을 한다. 저장만 하고 안 쓰면 옵션이 있는데 아무 일도 안 하는 것이 된다.
    if (byte(raw) > state.maxResultBytes) return { status: "resultLimitExceeded" };
    const validation = validateDiagnosisResult(raw, options.preview);
    if (validation.status !== "ok") return { status: "invalid" };
    return { status: "diagnosis", result: validation.result };
  } catch (error) {
    return { status: "providerFailed", failure: publicProviderFailure(error, state) };
  }
}

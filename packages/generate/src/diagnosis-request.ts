import type { RunnerRedactionOptions } from "@ohmymcp/runner";
import {
  DEFAULT_MAX_RESULT_BYTES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  MAX_REQUEST_BYTES,
  type McpToolContext,
} from "./authoring-request.js";
import { deepFreeze, sha256 } from "./canonical.js";
import type {
  DiagnosisDiagnostic,
  DiagnosisFailure,
  DiagnosisProcessDiagnostics,
  DiagnosisRequest,
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

  return frozen({
    request,
    byteLength: byte(request),
    providerId: options.providerId,
    model: options.model,
    providerTimeoutMs,
    maxResultBytes,
    redactionsApplied: true as const,
    requiresApproval: true as const,
    // sha256 은 canonicalJson 으로 직렬화한 뒤 해시한다(runner canonical.ts). 키 순서에
    // 의존하지 않는 지문이라 같은 입력이면 항상 같은 값이 나온다.
    fingerprint: sha256(request),
    omitted: { failures: omittedFailures, stderrBytes: omittedStderrBytes },
    binding: frozen({} as never),
  });
}

import type { McpClient, ToolDef, ToolResult } from "@mcpeak/core";
import {
  type AssertionResult,
  assertBodyMatchesSchema,
  assertIsError,
  assertToolExists,
} from "./assertions.js";
import { type BodyExtraction, extractResponseBody } from "./body.js";
import { expectedIsError } from "./case-expectation.js";
import { type ConnectionLoss, classifyConnectionLoss } from "./connection-loss.js";
import {
  clampObservedText,
  normalizeThrownValue,
  operationResultUnavailableDiagnostic,
  type RunnerDiagnostic,
} from "./diagnostics.js";
import { bindExecution, monotonicNowMs } from "./execution-binding.js";
import { classifyRejectionBasis, type RejectionBasis } from "./rejection-basis.js";
import {
  byteLength,
  RunnerPayloadLimitError,
  type RunnerPayloadLimits,
  type RunnerRedactionOptions,
  resolvePayloadLimits,
  sanitizeCase,
  sanitizeJsonValue,
} from "./sanitization.js";
import {
  type AssertionSpec,
  type IsErrorAssertionSpec,
  SuiteValidationError,
  type TestCaseSpec,
  type TestSuiteSpec,
  type ToolExistsAssertionSpec,
  validateMcpSuite,
} from "./spec/index.js";
import type { BodyMatchesSchemaAssertionSpec } from "./spec/types.js";

export interface OperationResult {
  status: "completed" | "failed" | "timedOut" | "cancelled" | "notRun";
  timeoutMs?: number;
  diagnostic?: RunnerDiagnostic;
}
export interface TestCaseResult {
  spec: TestCaseSpec;
  status: "passed" | "failed" | "timedOut" | "cancelled" | "notRun";
  operation: OperationResult;
  assertions: AssertionResult[];
  /**
   * 거절 근거를 확인했는가 (#89 · 설계 문서 §4). **판정과 무관하다.** `status` 를 바꾸지 않고
   * 종료 코드에도 안 들어간다. 추가 필드라 기존 소비자는 무시해도 동작한다.
   */
  rejectionBasis: RejectionBasis;
  /**
   * 확인하지 못한 거절의 응답 본문 (#89 · 설계 문서 §5.2). `rejectionBasis` 가 `"unverified"`
   * 이고 본문을 읽었을 때만 **키가 생긴다.** 그 밖에는 없다.
   *
   * 승인 화면이 "이 응답이 정상 거절인지 내부 오류인지" 를 사람에게 보여주려면 본문이 필요한데,
   * 판정만으로는 그 자리를 채울 수 없어서 함께 싣는다. 진단 값과 같은 상한에서 잘리고 같은
   * redaction 을 받는다(`clampObservedText`).
   */
  rejectionBody?: string;
}
export interface RunnerSummary {
  total: number;
  passed: number;
  failed: number;
  timedOut: number;
  cancelled: number;
  notRun: number;
  /** `rejectionBasis` 가 `"unverified"` 인 케이스 수. 0 이면 화면에 아무 줄도 안 찍는다(§5.1). */
  rejectionUnverified: number;
}
export interface RunnerReport {
  schemaVersion: 1;
  suite: { id: string; name: string; defaultTimeoutMs?: number };
  status: "passed" | "failed" | "aborted";
  /**
   * 케이스를 다 돌기 전에 멈춘 사유. 없으면 끝까지 돌았다는 뜻이다.
   *
   * `connectionLost` 는 서버 쪽 연결이 끝나 남은 케이스를 부를 대상이 없어진 경우다(#279).
   * 이때도 `status` 는 `failed` 다 — `aborted` 는 사용자가 요청한 취소의 뜻이고, 종료 코드가
   * 거기 걸려 있다. 서버가 죽은 것은 취소가 아니라 실패다.
   */
  stopReason?:
    | { type: "timeout"; caseId: string }
    | { type: "abortSignal"; caseId?: string }
    | ({ type: "connectionLost"; caseId: string } & ConnectionLoss);
  cases: TestCaseResult[];
  summary: RunnerSummary;
}
type CaseFields = { caseId: string; caseIndex: number };
export type RunnerEvent =
  | {
      type: "suiteStarted";
      sequence: number;
      suite: { id: string; name: string };
      totalCases: number;
    }
  | ({ type: "caseStarted"; sequence: number; case: TestCaseSpec } & CaseFields)
  | ({
      type: "operationStarted";
      sequence: number;
      operation: TestCaseSpec["operation"];
      timeoutMs: number;
    } & CaseFields)
  | ({ type: "operationCompleted"; sequence: number; result: OperationResult } & CaseFields)
  | ({
      type: "assertionCompleted";
      sequence: number;
      assertionIndex: number;
      result: AssertionResult;
    } & CaseFields)
  | ({ type: "caseCompleted"; sequence: number; result: TestCaseResult } & CaseFields)
  | { type: "suiteCompleted"; sequence: number; report: RunnerReport };
export interface RunSuiteOptions {
  client: McpClient;
  suite: TestSuiteSpec;
  onEvent?: (event: RunnerEvent) => void;
  redaction?: RunnerRedactionOptions;
  payloadLimits?: RunnerPayloadLimits;
  signal?: AbortSignal;
  drainTimeoutMs?: number;
}
export interface RunnerExecution {
  readonly report: Promise<RunnerReport>;
  readonly drain: Promise<RunnerDrainResult>;
}
export type RunnerDrainResult =
  | { status: "settled" }
  | { status: "deadlineExceeded"; pendingOperations: 1 };
const unavailable = operationResultUnavailableDiagnostic;
/**
 * 원인 체인을 사람이 읽을 줄로 만든다. 서버가 준 거절 이유(예: `requires task augmentation`)는
 * core 가 cause 에 보존하는데, `actual` 은 JSON 보고서에만 실리고 화면에는 안 찍힌다. 화면이
 * 보는 것은 notes 다(adoption.md §2.5 넷째). message 가 있는 Error 만 문장이 되고, 그 밖의
 * cause 는 actual 의 구조로만 남는다. 상한은 normalizeThrownValue 의 cause 상한과 같다.
 */
const causeNotes = (error: unknown, redaction?: RunnerRedactionOptions): string[] => {
  const notes: string[] = [];
  let current: unknown = error instanceof Error ? error.cause : undefined;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    if (current.message !== "")
      notes.push(`원인: ${clampObservedText(current.message, redaction)}`);
    current = current.cause;
  }
  return notes;
};
const failed = (
  operation: TestCaseSpec["operation"],
  error: unknown,
  redaction?: RunnerRedactionOptions,
): RunnerDiagnostic => {
  const notes = causeNotes(error, redaction);
  return {
    code: "OPERATION_FAILED",
    message:
      operation.type === "listTools"
        ? "MCP 툴 목록 조회 중 오류가 발생했습니다."
        : `툴 '${operation.tool}' 호출 중 오류가 발생했습니다.`,
    actual: sanitizeJsonValue(normalizeThrownValue(error), redaction),
    hint: "MCP 서버 프로세스와 연결 상태를 확인하세요.",
    // 키는 값이 있을 때만 만든다. undefined 로 넣으면 기존 보고서의 JSON 바이트가 흔들린다.
    ...(notes.length > 0 ? { notes } : {}),
  };
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;
const validDrainTimeout = (value: number | undefined): number => {
  const resolved = value ?? DEFAULT_DRAIN_TIMEOUT_MS;
  if (
    !Number.isFinite(resolved) ||
    !Number.isInteger(resolved) ||
    resolved < 1 ||
    resolved > 60_000
  )
    throw new RangeError("drainTimeoutMs는 1..60000의 유한 정수여야 합니다.");
  return resolved;
};
type Controlled<T> =
  | { type: "fulfilled"; value: T }
  | { type: "rejected"; error: unknown }
  | { type: "timedOut" }
  | { type: "cancelled" };
type OperationValue =
  | { type: "listTools"; tools: readonly ToolDef[] }
  | { type: "callTool"; result: ToolResult };
export function runSuite(options: RunSuiteOptions): RunnerExecution {
  const drainTimeoutMs = validDrainTimeout(options.drainTimeoutMs);
  const validated = validateMcpSuite(options.suite);
  if (!validated.valid) throw new SuiteValidationError(validated.issues);
  const limits = resolvePayloadLimits(options.payloadLimits);
  const operational = clone(validated.value);
  const observerCases = operational.cases.map((item) => sanitizeCase(item, options.redaction));
  for (const item of observerCases) {
    const size = byteLength(item);
    if (size > limits.maxCaseBytes) {
      const report = Promise.reject(
        new RunnerPayloadLimitError({
          scope: "case",
          limitBytes: limits.maxCaseBytes,
          actualBytes: size,
          caseId: item.id,
        }),
      );
      const execution: RunnerExecution = {
        report,
        drain: report.then(
          () => ({ status: "settled" as const }),
          () => ({ status: "settled" as const }),
        ),
      };
      bindExecution(execution, options.client);
      return Object.freeze(execution);
    }
  }
  let sequence = 0;
  let pending = false;
  let pendingSettlement: Promise<void> = Promise.resolve();
  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending = true;
    pendingSettlement = promise.then(
      () => {
        pending = false;
      },
      () => {
        pending = false;
      },
    );
    return promise;
  };
  const controlled = <T>(promise: Promise<T>, timeoutMs: number): Promise<Controlled<T>> =>
    new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const signal = options.signal;
      const abort = () => finish({ type: "cancelled" });
      const finish = (result: Controlled<T>) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(result);
      };
      // 취소 여부를 보기 **전에** 붙인다. 이미 취소된 상태로 들어와 여기서 바로 반환하면
      // 이미 떠 있는 요청의 거절을 아무도 받지 않아 unhandled rejection 이 된다. 취소는
      // 곧 client 를 닫는다는 뜻이고, 닫으면 떠 있던 호출이 `Connection closed` 로 거절되므로
      // 드문 경우가 아니다. `finish` 는 먼저 온 것만 채택하므로 붙이는 순서는 판정을 바꾸지
      // 않는다 — then 의 콜백은 마이크로태스크라 아래 동기 호출보다 늦다.
      void promise.then(
        (value) => finish({ type: "fulfilled", value }),
        (error) => finish({ type: "rejected", error }),
      );
      if (signal?.aborted) {
        finish({ type: "cancelled" });
        return;
      }
      timer = setTimeout(
        () => finish(signal?.aborted ? { type: "cancelled" } : { type: "timedOut" }),
        timeoutMs,
      );
      signal?.addEventListener("abort", abort, { once: true });
    });
  const drainResult = (): Promise<RunnerDrainResult> => {
    if (!pending) return Promise.resolve({ status: "settled" });
    const deadline = monotonicNowMs() + drainTimeoutMs;
    return new Promise((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: RunnerDrainResult) => {
        if (!done) {
          done = true;
          if (timer !== undefined) clearTimeout(timer);
          resolve(result);
        }
      };
      const expire = () => {
        const rest = deadline - monotonicNowMs();
        if (rest > 0) {
          timer = setTimeout(expire, rest);
        } else finish({ status: "deadlineExceeded", pendingOperations: 1 });
      };
      timer = setTimeout(expire, drainTimeoutMs);
      void pendingSettlement.then(() =>
        finish(
          monotonicNowMs() >= deadline
            ? { status: "deadlineExceeded", pendingOperations: 1 }
            : { status: "settled" },
        ),
      );
    });
  };
  const emit = (event: Record<string, unknown>) =>
    options.onEvent?.(clone({ ...event, sequence: sequence++ } as RunnerEvent));
  const report = (async (): Promise<RunnerReport> => {
    emit({
      type: "suiteStarted",
      suite: { id: operational.id, name: operational.name },
      totalCases: operational.cases.length,
    });
    const cases: TestCaseResult[] = [];
    let stop: RunnerReport["stopReason"];
    for (const [index, spec] of operational.cases.entries()) {
      const observed = observerCases[index];
      if (observed === undefined) throw new Error("Observer snapshot is missing.");
      if (options.signal?.aborted) {
        stop = { type: "abortSignal" };
        break;
      }
      const fields = { caseId: spec.id, caseIndex: index };
      const timeoutMs = spec.timeoutMs ?? operational.defaultTimeoutMs ?? 10_000;
      emit({ type: "caseStarted", ...fields, case: observed });
      emit({ type: "operationStarted", ...fields, operation: observed.operation, timeoutMs });
      let result: OperationValue | undefined;
      let operation: OperationResult;
      /** 이 케이스의 실패가 연결이 끝난 것이었는지. 그렇다면 뒤는 부를 대상이 없다(#279). */
      let loss: ConnectionLoss | undefined;
      const request: Promise<OperationValue> =
        spec.operation.type === "listTools"
          ? track(options.client.listTools()).then((tools) => ({ type: "listTools", tools }))
          : track(options.client.callTool(spec.operation.tool, spec.operation.input)).then(
              (toolResult) => ({ type: "callTool", result: toolResult }),
            );
      const outcome = await controlled(request, timeoutMs);
      if (outcome.type === "fulfilled") {
        result = outcome.value;
        operation = { status: "completed", timeoutMs };
      } else if (outcome.type === "rejected") {
        loss = classifyConnectionLoss(outcome.error);
        operation = {
          status: "failed",
          timeoutMs,
          diagnostic: failed(spec.operation, outcome.error, options.redaction),
        };
      } else if (outcome.type === "timedOut")
        operation = {
          status: "timedOut",
          timeoutMs,
          diagnostic: {
            code: "CASE_TIMEOUT",
            message: `테스트 '${spec.name}'가 제한 시간 ${timeoutMs}ms 안에 완료되지 않았습니다.`,
            hint: "서버 응답 지연과 테스트의 timeoutMs 설정을 확인하세요.",
          },
        };
      else
        operation = {
          status: "cancelled",
          timeoutMs,
          diagnostic: {
            code: "RUN_ABORTED",
            message: `테스트 '${spec.name}' 실행이 외부 요청으로 취소되었습니다.`,
            hint: "취소 신호를 발생시킨 호출자 상태를 확인한 뒤 다시 실행하세요.",
          },
        };
      emit({ type: "operationCompleted", ...fields, result: operation });
      // 추출은 케이스당 한 번만 한다. 같은 케이스의 단언들이 결과를 공유한다.
      // 실제로 필요할 때까지 미룬다. isError 는 실패했을 때만 본문을 보고(ADR-0027),
      // 통과한 케이스에서 응답을 읽지 않는 지금 동작을 그대로 지켜야 하기 때문이다.
      let bodyRead = false;
      let bodyValue: BodyExtraction | undefined;
      const readBody = (): BodyExtraction | undefined => {
        if (!bodyRead) {
          bodyRead = true;
          bodyValue =
            result !== undefined && result.type === "callTool"
              ? extractResponseBody(result.result)
              : undefined;
        }
        return bodyValue;
      };
      const assertions: AssertionResult[] = spec.assertions.map((assertion, assertionIndex) => {
        const outcome =
          result === undefined
            ? {
                spec: clone(assertion) as AssertionSpec,
                status: "skipped" as const,
                diagnostic: unavailable(),
              }
            : result.type === "listTools"
              ? assertToolExists(result.tools, assertion as ToolExistsAssertionSpec)
              : assertion.type === "isError"
                ? assertIsError(result.result, assertion as IsErrorAssertionSpec, readBody, {
                    redaction: options.redaction,
                  })
                : assertBodyMatchesSchema(readBody(), assertion as BodyMatchesSchemaAssertionSpec, {
                    redaction: options.redaction,
                  });
        emit({ type: "assertionCompleted", ...fields, assertionIndex, result: outcome });
        return outcome;
      });
      // 거절 근거 확인 (#89 · 설계 문서 §4.2). 단언 평가가 끝난 뒤 케이스당 한 번 계산한다.
      // 판정에는 들어가지 않는다. 아래 status 식은 이 값을 보지 않는다.
      //
      // `readBody()` 를 여기서 부르는 것이 호출 조건을 넓히는 자리다. 지금까지는 실패한
      // 케이스에서만 본문을 읽었는데, 거절을 기대한 케이스는 **통과했을 때도** 본문이 필요하다.
      // 넓히는 범위를 `expectsRejection` 으로 못 박는다. 거절을 기대하지 않는 케이스에서는
      // 여전히 안 읽는다. 조건을 더 넓히면 모든 통과 케이스가 응답을 읽게 되고, 그것은
      // ADR-0027 이 정한 배선을 바꾸는 것이라 이 설계의 비범위다.
      const expectsRejection = expectedIsError(spec) === true;
      const extraction = expectsRejection ? readBody() : undefined;
      // 문자열로 읽힌 본문만 **지문 대조** 대상이다. 지문 셋이 전부 문장 접두어라 JSON 으로
      // 파싱된 본문에는 대조할 것이 없다(관찰 80건이 전부 text 한 블록이다).
      const bodyText =
        extraction?.ok === true && typeof extraction.body === "string" ? extraction.body : null;
      const rejectionBasis = classifyRejectionBasis({
        expectsRejection,
        toolName: spec.operation.type === "callTool" ? spec.operation.tool : null,
        bodyText,
      });
      // **표시용 본문은 대조용과 다른 목적이라 판정이 다르다.** JSON 오류 본문은 사람이 거절과
      // 크래시를 가늠하기에 오히려 좋은 재료다. 대조에서 뺐다고 표시에서까지 빼면 서버가 분명히
      // 보낸 본문이 승인 화면에 "(본문 없음)" 으로 찍혀 사용자에게 거짓을 말하게 된다.
      const displayBody =
        extraction?.ok !== true
          ? null
          : typeof extraction.body === "string"
            ? extraction.body
            : (JSON.stringify(extraction.body) ?? null);
      const caseResult: TestCaseResult = {
        spec: observed,
        status:
          operation.status === "timedOut"
            ? "timedOut"
            : operation.status === "cancelled"
              ? "cancelled"
              : operation.status === "failed" || assertions.some((item) => item.status === "failed")
                ? "failed"
                : "passed",
        operation,
        assertions,
        rejectionBasis,
        // 확인 못 한 케이스만 본문을 싣는다. `verified` 는 사람이 다시 볼 이유가 없고,
        // 전량을 실으면 통과한 모든 케이스의 응답이 보고서에 들어간다. 키는 값이 있을 때만
        // 만든다 — `undefined` 로 넣으면 기존 보고서의 JSON 바이트가 흔들린다.
        ...(rejectionBasis === "unverified" && displayBody !== null
          ? { rejectionBody: clampObservedText(displayBody, options.redaction) }
          : {}),
      };
      cases.push(caseResult);
      emit({ type: "caseCompleted", ...fields, result: caseResult });
      if (operation.status === "timedOut") {
        stop = { type: "timeout", caseId: spec.id };
        break;
      }
      if (operation.status === "cancelled") {
        stop = { type: "abortSignal", caseId: spec.id };
        break;
      }
      // 타임아웃·취소 다음이다. 그 둘은 우리가 정한 중단이고 이것은 서버 쪽 사정이라,
      // 같은 케이스에서 겹치면 우리가 정한 쪽을 사유로 남긴다.
      if (loss !== undefined) {
        stop = { type: "connectionLost", caseId: spec.id, ...loss };
        break;
      }
    }
    while (cases.length < operational.cases.length) {
      const index = cases.length;
      const spec = observerCases[index];
      if (spec === undefined) throw new Error("Observer snapshot is missing.");
      cases.push({
        spec,
        status: "notRun",
        operation: { status: "notRun" },
        assertions: spec.assertions.map((assertion) => ({
          spec: clone(assertion),
          status: "notRun",
        })),
        // 안 돈 케이스는 판정 대상이 아니다. 본문이 없으니 "unverified" 로 볼 수도 있으나,
        // 그러면 중단된 실행에서 안 돈 케이스 전부가 §5.1 의 "확인하지 못했습니다" 에 실린다.
        // 안 돈 케이스는 초록으로 찍히지 않아 크래시가 숨을 자리가 없다. 소음만 남는다(ADR-0015).
        rejectionBasis: "notApplicable",
      });
    }
    const summary: RunnerSummary = {
      total: cases.length,
      passed: cases.filter((item) => item.status === "passed").length,
      failed: cases.filter((item) => item.status === "failed").length,
      timedOut: cases.filter((item) => item.status === "timedOut").length,
      cancelled: cases.filter((item) => item.status === "cancelled").length,
      notRun: cases.filter((item) => item.status === "notRun").length,
      rejectionUnverified: cases.filter((item) => item.rejectionBasis === "unverified").length,
    };
    const report: RunnerReport = {
      schemaVersion: 1,
      suite: {
        id: operational.id,
        name: operational.name,
        ...(operational.defaultTimeoutMs === undefined
          ? {}
          : { defaultTimeoutMs: operational.defaultTimeoutMs }),
      },
      status:
        stop?.type === "abortSignal"
          ? "aborted"
          : summary.failed || summary.timedOut
            ? "failed"
            : "passed",
      ...(stop === undefined ? {} : { stopReason: stop }),
      cases,
      summary,
    };
    const size = byteLength(report);
    if (size > limits.maxReportBytes)
      throw new RunnerPayloadLimitError({
        scope: "report",
        limitBytes: limits.maxReportBytes,
        actualBytes: size,
      });
    emit({ type: "suiteCompleted", report });
    return report;
  })();
  const execution: RunnerExecution = {
    report,
    drain: report.then(drainResult, drainResult),
  };
  bindExecution(execution, options.client);
  return Object.freeze(execution);
}

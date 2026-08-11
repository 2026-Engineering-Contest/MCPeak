import type { McpClient, ToolResult } from "@ohmymcp/core";
import { type AssertionResult, assertIsError, assertToolExists } from "./assertions.js";
import { normalizeThrownValue, type RunnerDiagnostic } from "./diagnostics.js";
import { bindExecution, monotonicNowMs } from "./execution-binding.js";
import {
  byteLength,
  RunnerPayloadLimitError,
  type RunnerPayloadLimits,
  type RunnerRedactionOptions,
  resolvePayloadLimits,
  sanitizeCase,
} from "./sanitization.js";
import {
  type AssertionSpec,
  SuiteValidationError,
  type TestCaseSpec,
  type TestSuiteSpec,
  validateMcpSuite,
} from "./spec/index.js";

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
}
export interface RunnerSummary {
  total: number;
  passed: number;
  failed: number;
  timedOut: number;
  cancelled: number;
  notRun: number;
}
export interface RunnerReport {
  schemaVersion: 1;
  suite: { id: string; name: string; defaultTimeoutMs?: number };
  status: "passed" | "failed" | "aborted";
  stopReason?: { type: "timeout"; caseId: string } | { type: "abortSignal"; caseId?: string };
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
const unavailable = (): RunnerDiagnostic => ({
  code: "OPERATION_RESULT_UNAVAILABLE",
  message: "MCP 작업 결과가 없어 assertion을 검사할 수 없습니다.",
  hint: "먼저 MCP 작업 실패 원인을 해결하세요.",
});
const failed = (operation: TestCaseSpec["operation"], error: unknown): RunnerDiagnostic => ({
  code: "OPERATION_FAILED",
  message:
    operation.type === "listTools"
      ? "MCP 툴 목록 조회 중 오류가 발생했습니다."
      : `툴 '${operation.tool}' 호출 중 오류가 발생했습니다.`,
  actual: normalizeThrownValue(error),
  hint: "MCP 서버 프로세스와 연결 상태를 확인하세요.",
});
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
      if (signal?.aborted) {
        finish({ type: "cancelled" });
        return;
      }
      timer = setTimeout(
        () => finish(signal?.aborted ? { type: "cancelled" } : { type: "timedOut" }),
        timeoutMs,
      );
      signal?.addEventListener("abort", abort, { once: true });
      void promise.then(
        (value) => finish({ type: "fulfilled", value }),
        (error) => finish({ type: "rejected", error }),
      );
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
      let result: ToolResult | undefined;
      let operation: OperationResult;
      const request =
        spec.operation.type === "listTools"
          ? track(options.client.listTools()).then((tools) => ({ tools }) as unknown as ToolResult)
          : track(options.client.callTool(spec.operation.tool, spec.operation.input));
      const outcome = await controlled(request, timeoutMs);
      if (outcome.type === "fulfilled") {
        result = outcome.value;
        operation = { status: "completed", timeoutMs };
      } else if (outcome.type === "rejected")
        operation = {
          status: "failed",
          timeoutMs,
          diagnostic: failed(spec.operation, outcome.error),
        };
      else if (outcome.type === "timedOut")
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
      const assertions: AssertionResult[] = spec.assertions.map((assertion, assertionIndex) => {
        const outcome =
          result === undefined
            ? {
                spec: clone(assertion) as AssertionSpec,
                status: "skipped" as const,
                diagnostic: unavailable(),
              }
            : spec.operation.type === "listTools"
              ? assertToolExists(
                  (result as unknown as { tools: Parameters<typeof assertToolExists>[0] }).tools,
                  assertion as never,
                )
              : assertIsError(result, assertion as never);
        emit({ type: "assertionCompleted", ...fields, assertionIndex, result: outcome });
        return outcome;
      });
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
      });
    }
    const summary: RunnerSummary = {
      total: cases.length,
      passed: cases.filter((item) => item.status === "passed").length,
      failed: cases.filter((item) => item.status === "failed").length,
      timedOut: cases.filter((item) => item.status === "timedOut").length,
      cancelled: cases.filter((item) => item.status === "cancelled").length,
      notRun: cases.filter((item) => item.status === "notRun").length,
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

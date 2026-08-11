import type { McpClient, ToolResult } from "@ohmymcp/core";
import { type AssertionResult, assertIsError, assertToolExists } from "./assertions.js";
import { normalizeThrownValue, type RunnerDiagnostic } from "./diagnostics.js";
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
}
export interface RunnerExecution {
  readonly report: Promise<RunnerReport>;
  readonly drain: Promise<RunnerDrainResult>;
}
export type RunnerDrainResult = { status: "settled" };
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
export function runSuite(options: RunSuiteOptions): RunnerExecution {
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
      return {
        report,
        drain: report.then(
          () => ({ status: "settled" as const }),
          () => ({ status: "settled" as const }),
        ),
      };
    }
  }
  let sequence = 0;
  const emit = (event: Record<string, unknown>) =>
    options.onEvent?.(clone({ ...event, sequence: sequence++ } as RunnerEvent));
  const report = (async (): Promise<RunnerReport> => {
    emit({
      type: "suiteStarted",
      suite: { id: operational.id, name: operational.name },
      totalCases: operational.cases.length,
    });
    const cases: TestCaseResult[] = [];
    for (const [index, spec] of operational.cases.entries()) {
      const observed = observerCases[index];
      if (observed === undefined) throw new Error("Observer snapshot is missing.");
      const fields = { caseId: spec.id, caseIndex: index };
      const timeoutMs = spec.timeoutMs ?? operational.defaultTimeoutMs ?? 10_000;
      emit({ type: "caseStarted", ...fields, case: observed });
      emit({ type: "operationStarted", ...fields, operation: observed.operation, timeoutMs });
      let result: ToolResult | undefined;
      let operation: OperationResult;
      try {
        result =
          spec.operation.type === "listTools"
            ? await options.client.listTools().then((tools) => ({ tools }) as unknown as ToolResult)
            : await options.client.callTool(spec.operation.tool, spec.operation.input);
        operation = { status: "completed", timeoutMs };
      } catch (error) {
        operation = { status: "failed", timeoutMs, diagnostic: failed(spec.operation, error) };
      }
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
          operation.status === "failed" || assertions.some((item) => item.status === "failed")
            ? "failed"
            : "passed",
        operation,
        assertions,
      };
      cases.push(caseResult);
      emit({ type: "caseCompleted", ...fields, result: caseResult });
    }
    const summary: RunnerSummary = {
      total: cases.length,
      passed: cases.filter((item) => item.status === "passed").length,
      failed: cases.filter((item) => item.status === "failed").length,
      timedOut: 0,
      cancelled: 0,
      notRun: 0,
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
      status: summary.failed ? "failed" : "passed",
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
  return {
    report,
    drain: report.then(
      () => ({ status: "settled" as const }),
      () => ({ status: "settled" as const }),
    ),
  };
}

import type { McpClient } from "@mcpeak/core";
import { boundClient, monotonicNowMs } from "./execution-binding.js";
import type { RunnerExecution, RunnerReport } from "./executor.js";

export type RunnerForceCloseReason =
  | "drainDeadlineExceeded"
  | "drainFailed"
  | "gracefulCloseDeadlineExceeded"
  | "gracefulCloseFailed";
export interface McpClientShutdownController {
  client: McpClient;
  close(): Promise<void>;
  forceClose(reason: RunnerForceCloseReason): Promise<void>;
}
export interface FinalizeRunnerExecutionOptions {
  execution: RunnerExecution;
  shutdown: McpClientShutdownController;
  closeTimeoutMs?: number;
  forceCloseTimeoutMs?: number;
}
export class RunnerShutdownTimeoutError extends Error {
  override readonly name = "RunnerShutdownTimeoutError";
  readonly phase = "forceClose";
  constructor(readonly limitMs: number) {
    super(`MCP 강제 종료가 제한 시간 ${limitMs}ms 안에 완료되지 않았습니다.`);
  }
}
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
type Bounded<T> = { deadline: true } | { deadline: false; outcome: Outcome<T> };
const lifecycles = new WeakMap<
  RunnerExecution,
  { controller: McpClientShutdownController; promise: Promise<RunnerReport> }
>();
const settle = <T>(promise: Promise<T>): Promise<Outcome<T>> =>
  promise.then(
    (value) => ({ ok: true, value }) as Outcome<T>,
    (error) => ({ ok: false, error }) as Outcome<T>,
  );
const validLimit = (value: number | undefined): number => {
  const resolved = value ?? 2_000;
  if (
    !Number.isFinite(resolved) ||
    !Number.isInteger(resolved) ||
    resolved < 1 ||
    resolved > 10_000
  )
    throw new RangeError("shutdown timeout은 1..10000의 유한 정수여야 합니다.");
  return resolved;
};
function bounded<T>(promise: Promise<T>, limitMs: number): Promise<Bounded<T>> {
  const observed: Promise<Outcome<T>> = promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  const deadline = monotonicNowMs() + limitMs;
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: Bounded<T>) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };
    const expire = () => {
      const remaining = deadline - monotonicNowMs();
      if (remaining > 0) {
        timer = setTimeout(expire, remaining);
        return;
      }
      finish({ deadline: true });
    };
    timer = setTimeout(expire, limitMs);
    void observed.then((outcome) =>
      finish(monotonicNowMs() >= deadline ? { deadline: true } : { deadline: false, outcome }),
    );
  });
}
const throwFailures = (errors: unknown[]): void => {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Runner execution finalization failed.");
};
export function finalizeRunnerExecution(
  options: FinalizeRunnerExecutionOptions,
): Promise<RunnerReport> {
  const closeTimeoutMs = validLimit(options.closeTimeoutMs);
  const forceCloseTimeoutMs = validLimit(options.forceCloseTimeoutMs);
  const client = boundClient(options.execution);
  if (client === undefined || client !== options.shutdown.client)
    throw new TypeError("execution과 shutdown controller의 client가 일치하지 않습니다.");
  const existing = lifecycles.get(options.execution);
  if (existing !== undefined) {
    if (existing.controller !== options.shutdown)
      throw new TypeError("execution shutdown lifecycle이 이미 시작되었습니다.");
    return existing.promise;
  }
  const promise = (async () => {
    const errors: unknown[] = [];
    let report: RunnerReport | undefined;
    const reportOutcome = await settle(options.execution.report);
    if (reportOutcome.ok) report = reportOutcome.value;
    else errors.push(reportOutcome.error);
    let reason: RunnerForceCloseReason | undefined;
    const drainOutcome = await settle(options.execution.drain);
    if (!drainOutcome.ok) {
      errors.push(drainOutcome.error);
      reason = "drainFailed";
    } else if (drainOutcome.value.status === "deadlineExceeded") reason = "drainDeadlineExceeded";
    else {
      const close = await bounded(options.shutdown.close(), closeTimeoutMs);
      if (close.deadline) reason = "gracefulCloseDeadlineExceeded";
      else if (!close.outcome.ok) {
        errors.push(close.outcome.error);
        reason = "gracefulCloseFailed";
      }
    }
    if (reason !== undefined) {
      const force = await bounded(options.shutdown.forceClose(reason), forceCloseTimeoutMs);
      if (force.deadline) errors.push(new RunnerShutdownTimeoutError(forceCloseTimeoutMs));
      else if (!force.outcome.ok) errors.push(force.outcome.error);
    }
    throwFailures(errors);
    return report as RunnerReport;
  })();
  lifecycles.set(options.execution, { controller: options.shutdown, promise });
  return promise;
}

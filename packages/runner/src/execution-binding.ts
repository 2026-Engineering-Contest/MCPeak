import type { McpClient } from "@ohmymcp-hsu/core";
import type { RunnerExecution } from "./executor.js";

const bindings = new WeakMap<RunnerExecution, McpClient>();

/** Fake timers control this monotonic clock without exposing it publicly. */
export const monotonicNowMs = (): number => performance.now();

export function bindExecution(execution: RunnerExecution, client: McpClient): void {
  bindings.set(execution, client);
}

export function boundClient(execution: RunnerExecution): McpClient | undefined {
  return bindings.get(execution);
}

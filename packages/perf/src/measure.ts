import type { McpClient } from "@mcpeak/core";
import type { PerfMeasurement, PerfPlan } from "./types.js";

/**
 * 호출을 실행하고 측정값을 만든다. client·now·sleep 은 주입받는다.
 * sleep 은 두 용도다. 호출 간격은 signal 없이 부르고, 타임아웃 경쟁은 signal 을 넘기고 승자가 정해지면 abort 한다.
 * abort 된 sleep 은 resolve 도 reject 도 하지 않고 타이머만 해제해도 된다. T2 가 구현한다.
 */
export function measure(_options: {
  readonly client: Pick<McpClient, "callTool">;
  readonly availableTools: ReadonlySet<string>;
  readonly plan: PerfPlan;
  readonly now: () => number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly onProgress?: (done: number, total: number) => void;
}): Promise<readonly PerfMeasurement[]> {
  throw new Error("not implemented");
}

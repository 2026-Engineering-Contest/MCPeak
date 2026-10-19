import type { PerfMeasurement, PerfPlan, PerfReport, TraceEntry } from "./types.js";

/** 순수 함수. 병합·배정·규칙·집계를 조립한다. T3 가 구현한다. */
export function analyze(_input: {
  readonly plan: PerfPlan;
  readonly measurements: readonly PerfMeasurement[];
  readonly trace: readonly TraceEntry[];
  readonly coldStart: { readonly connectMs: number; readonly listToolsMs: number };
  readonly server: { readonly command: string; readonly toolCount: number };
  readonly generatorVersion: string;
}): PerfReport {
  throw new Error("not implemented");
}

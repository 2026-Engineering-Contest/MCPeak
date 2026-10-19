import type {
  CaseResult,
  ObservedRequest,
  PerfFinding,
  PerfMeasurement,
  PerfPlan,
} from "./types.js";

/** §6.2 진단 규칙. T3 가 구현한다. */
export function runRules(_input: {
  readonly plan: PerfPlan;
  readonly measurements: readonly PerfMeasurement[];
  readonly assigned: ReadonlyMap<PerfMeasurement, readonly ObservedRequest[]>;
}): {
  readonly findings: readonly PerfFinding[];
  readonly undecidedCases: number;
  readonly dependency: ReadonlyMap<string, CaseResult["dependency"]>;
} {
  throw new Error("not implemented");
}

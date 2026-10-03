import { FAULTS, type FaultId } from "./faults.ts";
import type { RepairVerdict } from "./judge.ts";

export type Condition = "defect" | "plain" | "diagnosed";
export interface RunRecord {
  readonly faultId: FaultId;
  readonly condition: Condition;
  readonly attempt: number;
  readonly verdict: RepairVerdict;
  readonly passCount: number;
  readonly regressed: readonly string[];
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number | null;
}
export interface Row {
  readonly faultId: FaultId;
  readonly condition: Condition;
  readonly runs: number;
  readonly successes: number;
  readonly meanPassCount: number;
}
type Tally = { successes: number; runs: number };
const CONDITIONS: readonly Condition[] = ["defect", "plain", "diagnosed"];
const emptyTallies = (): Record<Condition, Tally> => ({
  defect: { successes: 0, runs: 0 },
  plain: { successes: 0, runs: 0 },
  diagnosed: { successes: 0, runs: 0 },
});

export function aggregate(records: readonly RunRecord[]) {
  const rows: Row[] = [];
  const tool = emptyTallies();
  const control = emptyTallies();
  for (const fault of FAULTS) {
    for (const condition of CONDITIONS) {
      const group = records.filter((r) => r.faultId === fault.id && r.condition === condition);
      if (group.length === 0) continue;
      const successes = group.filter((r) => r.verdict === "success").length;
      const meanPassCount = group.reduce((sum, r) => sum + r.passCount, 0) / group.length;
      rows.push({ faultId: fault.id, condition, runs: group.length, successes, meanPassCount });
      const bucket = fault.area === "tool" ? tool : control;
      bucket[condition].successes += successes;
      bucket[condition].runs += group.length;
    }
  }
  return { rows, tool, control };
}

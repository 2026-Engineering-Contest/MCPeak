import type { ScenarioTable } from "./scenario-score.ts";

export type RepairVerdict = "success" | "targetStillFailing" | "regressed" | "serverDown";

/**
 * 수리 성공은 목표 시나리오 통과 그리고 S 의 나머지가 하나도 깨지지 않은 것이다.
 * 회귀가 있으면 목표 통과 여부와 무관하게 regressed 다. 다른 곳을 망가뜨린 수리를
 * 성공으로 세면 "고쳤다"는 숫자가 부풀려진다. 표에 없는 시나리오는 실패로 센다.
 */
export function judgeRepair(input: {
  baselinePassing: readonly string[];
  target: string;
  table: ScenarioTable | null;
}): { verdict: RepairVerdict; regressed: string[]; passCount: number } {
  const { baselinePassing, target, table } = input;
  if (table === null) return { verdict: "serverDown", regressed: [], passCount: 0 };
  const passed = (s: string) => table[s] === "pass";
  const regressed = baselinePassing.filter((s) => s !== target && !passed(s)).sort();
  const passCount = baselinePassing.filter(passed).length;
  if (regressed.length > 0) return { verdict: "regressed", regressed, passCount };
  if (!passed(target)) return { verdict: "targetStillFailing", regressed, passCount };
  return { verdict: "success", regressed, passCount };
}

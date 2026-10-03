import type { Finding, RawTool, RuleInfo } from "../types.js";

export const FLOW_RULES: readonly RuleInfo[] = [] as const;

export function runFlowRules(_tools: readonly RawTool[]): Finding[] {
  throw new Error("not implemented");
}

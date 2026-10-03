import type { Finding, RuleInfo } from "../types.js";

export const RESULT_RULES: readonly RuleInfo[] = [] as const;

export function runResultRules(
  _results: readonly {
    toolIndex: number;
    toolName: string;
    raw: unknown;
    outcome: "ok" | "timeout" | "error";
  }[],
  _maxMessageBytes: number,
): Finding[] {
  throw new Error("not implemented");
}

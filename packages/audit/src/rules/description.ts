import type { CollectedString, Finding, RuleInfo } from "../types.js";

export const DESC_RULES: readonly RuleInfo[] = [] as const;

export function runDescRules(
  _strings: readonly CollectedString[],
  _context: { serverName: string },
): Finding[] {
  throw new Error("not implemented");
}

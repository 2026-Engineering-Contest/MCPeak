import type { CollectedString, Finding, RuleInfo } from "../types.js";

export const SECRET_RULES: readonly RuleInfo[] = [] as const;

export interface CanaryPlan {
  readonly env: Readonly<Record<string, string>>;
  readonly names: readonly string[];
}

export function planCanaries(
  _forwardedEnvNames: readonly string[],
  _random: () => string,
): CanaryPlan {
  throw new Error("not implemented");
}

export function runSecretRules(
  _strings: readonly CollectedString[],
  _plan: CanaryPlan,
  _forwarded: Readonly<Record<string, string>>,
): Finding[] {
  throw new Error("not implemented");
}

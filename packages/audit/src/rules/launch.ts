import type { AuditBaseline, AuditTarget, Finding, RuleInfo } from "../types.js";

export const LAUNCH_RULES: readonly RuleInfo[] = [] as const;

export function runLaunchRules(_target: AuditTarget): Finding[] {
  throw new Error("not implemented");
}

export function parseLaunchPackage(_target: AuditTarget): AuditBaseline["launch"] {
  throw new Error("not implemented");
}

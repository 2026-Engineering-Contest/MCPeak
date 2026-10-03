import type { Finding, RawTool, RuleInfo } from "../types.js";

export const SCHEMA_RULES: readonly RuleInfo[] = [] as const;

export function runSchemaRules(_tools: readonly RawTool[]): Finding[] {
  throw new Error("not implemented");
}

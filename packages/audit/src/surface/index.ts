import type { AuditBaseline, BaselineTool, Finding, RawTool, RuleInfo } from "../types.js";

export const SURFACE_RULES: readonly RuleInfo[] = [] as const;

export function computeSurface(
  _tools: readonly RawTool[],
  _server: { name: string; version: string },
): { readonly tools: readonly BaselineTool[]; readonly surfaceHash: string } {
  throw new Error("not implemented");
}

/** 실패 시 AuditError("BASELINE_UNREADABLE") */
export function parseBaseline(_text: string): AuditBaseline {
  throw new Error("not implemented");
}

export function compareBaseline(
  _baseline: AuditBaseline,
  _current: ReturnType<typeof computeSurface>,
  _tools: readonly RawTool[],
): Finding[] {
  throw new Error("not implemented");
}

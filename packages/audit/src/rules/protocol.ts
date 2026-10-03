import type { ServerMessage } from "@mcpeak/core";
import type { AuditTarget, Finding, RuleInfo } from "../types.js";

export const PROTOCOL_RULES: readonly RuleInfo[] = [] as const;

export interface ProtocolContext {
  readonly target: AuditTarget;
  readonly fetch: typeof globalThis.fetch;
  readonly serverMessages: readonly ServerMessage[];
  readonly listChanged: {
    readonly notified: boolean;
    readonly surfaceHashBefore: string;
    readonly surfaceHashAfter: string;
  };
}

export async function runProtocolRules(_context: ProtocolContext): Promise<Finding[]> {
  throw new Error("not implemented");
}

import type { CollectedString, RawTool } from "./types.js";

export function collectStrings(_input: {
  tools: readonly RawTool[];
  prompts: readonly Record<string, unknown>[];
  resources: readonly Record<string, unknown>[];
  instructions: string | undefined;
}): CollectedString[] {
  throw new Error("not implemented");
}

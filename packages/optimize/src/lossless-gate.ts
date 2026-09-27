import type { ToolDef } from "@mcpeak/core";
import type { OptimizedTool } from "./types.js";

/** 게이트 A. 통과하면 반환값 없음, 실패하면 OptimizeError(LOSSLESS_VIOLATION). */
export function assertLossless(
  original: readonly ToolDef[],
  optimized: readonly OptimizedTool[],
): void {
  throw new Error("not implemented");
}

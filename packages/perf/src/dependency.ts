import type { ObservedRequest } from "./types.js";

/** §6.1 의존 판정. T3 가 구현한다. */
export function judge(
  _later: ObservedRequest,
  _earlier: ObservedRequest,
  _input: Readonly<Record<string, unknown>>,
): "dependent" | "independent" | "unknown" {
  throw new Error("not implemented");
}

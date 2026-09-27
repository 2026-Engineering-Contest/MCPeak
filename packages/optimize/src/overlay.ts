import type { OptimizeOverlay } from "./types.js";

/** 오버레이 JSON 을 읽어 형식을 검사한다. 실패하면 OptimizeError(OVERLAY_INVALID). */
export function parseOverlay(raw: unknown, sourceLabel: string): OptimizeOverlay {
  throw new Error("not implemented");
}

import type { ConnectOptions } from "@mcpeak/core";
import type { OptimizeOverlay } from "./types.js";

export interface ProxyOptions {
  readonly overlay: OptimizeOverlay;
  readonly upstream: ConnectOptions;
  /** 상류 도구 목록이 오버레이와 다를 때. 기본 "fail". */
  readonly onMismatch?: "fail";
}

/** 오버레이를 tools/list 로 내보내고 tools/call 을 상류로 전달하는 stdio 서버를 띄운다. 계획서 §6. */
export async function serveProxy(options: ProxyOptions): Promise<void> {
  throw new Error("not implemented");
}

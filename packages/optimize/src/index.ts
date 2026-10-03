// re-export 전용이다. 함수 본문은 각 모듈에 두고, 이 파일은 T0 이후 아무도 고치지 않는다
// (계획서 §9.1). W1 의 세 태스크가 같은 파일을 동시에 고쳐 충돌하지 않게 하기 위해서다.
export { assertLossless } from "./lossless-gate.js";
export { optimize } from "./optimize.js";
export { parseOverlay } from "./overlay.js";
export { type ProxyOptions, serveProxy } from "./proxy.js";
export { renderReport } from "./report.js";
export type {
  OptimizedTool,
  OptimizeErrorCode,
  OptimizeInput,
  OptimizeOverlay,
  ToolChange,
} from "./types.js";
export { OptimizeError, OVERLAY_SCHEMA_VERSION } from "./types.js";

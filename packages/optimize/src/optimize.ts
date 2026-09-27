import type { OptimizeInput, OptimizeOverlay } from "./types.js";

/** 순수 함수. 같은 입력에 같은 출력. 내부에서 assertLossless 를 통과시킨 뒤 반환한다. */
export function optimize(input: OptimizeInput, generatorVersion: string): OptimizeOverlay {
  throw new Error("not implemented");
}

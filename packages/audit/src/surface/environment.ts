import type { Finding } from "../types.js";
import type { computeSurface } from "./index.js";

/** 격리 안과 밖의 표면을 비교한다. 같으면 `[]`. 본문은 T5 가 채운다. */
export function compareEnvironmentSurface(
  inside: ReturnType<typeof computeSurface>,
  outside: ReturnType<typeof computeSurface>,
): Finding[] {
  throw new Error("not implemented");
}

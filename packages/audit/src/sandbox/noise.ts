import type { Observation } from "../types.js";

/** 런타임 잡음을 뺀 새 Observation 을 돌려준다. 잡음 표는 이 파일 하나가 정본이다. 본문은 T4 가 채운다. */
export function filterNoise(
  observation: Observation,
  context: { readonly mountRoot: string; readonly command: string },
): Observation {
  throw new Error("not implemented");
}

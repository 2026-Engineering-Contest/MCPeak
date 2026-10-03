import type { HomePlan } from "../types.js";

/** 격리 홈의 계획. 같은 random 열이면 같은 결과다. 본문은 T4 가 채운다. */
export function planHome(random: () => string): HomePlan {
  throw new Error("not implemented");
}

import type { CanaryValue, Finding, Observation, RuleInfo, SandboxNetworkMode } from "../types.js";

/** `network` 가족의 규칙 목록. 본문은 T3 가 채운다. */
export const NETWORK_RULES: readonly RuleInfo[] = [];

export interface NetworkContext {
  readonly observation: Observation;
  readonly declaredHosts: readonly string[];
  readonly canaries: readonly CanaryValue[];
  readonly mode: SandboxNetworkMode;
}

export function runNetworkRules(context: NetworkContext): Finding[] {
  throw new Error("not implemented");
}

/** 호출 단계에서 나가는 요청에 실린 카나리. runNetworkRules 와 같은 판정을 쓴다. audit() 이 behavior 에 넘긴다. */
export function exfiltratedCanaries(context: NetworkContext): ReadonlyArray<{
  readonly toolIndex: number;
  readonly name: string;
  readonly origin: "env" | "file";
}> {
  throw new Error("not implemented");
}

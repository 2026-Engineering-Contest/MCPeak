import type {
  CollectedString,
  Finding,
  HomePlan,
  Observation,
  RawTool,
  RuleInfo,
} from "../types.js";

/** `behavior` 가족의 규칙 목록. 본문은 T4 가 채운다. */
export const BEHAVIOR_RULES: readonly RuleInfo[] = [];

export interface BehaviorContext {
  /** `filterNoise` 를 거친 것. */
  readonly observation: Observation;
  /** annotations 를 읽는다(readOnlyHint). */
  readonly tools: readonly RawTool[];
  readonly calls: ReadonlyArray<{
    readonly toolIndex: number;
    readonly toolName: string;
    readonly callId: string;
    readonly outcome: "ok" | "timeout" | "error";
  }>;
  /** 호출 응답에서 모은 문자열(collectResultStrings). 파일 카나리가 응답에 나왔는지 본다. */
  readonly resultStrings: readonly CollectedString[];
  /** 같은 도구에서 나가는 요청에 실린 파일 카나리. 그 파일의 읽기 발견은 내지 않는다. */
  readonly exfiltrated: ReadonlyArray<{ readonly toolIndex: number; readonly name: string }>;
  readonly home: HomePlan;
  readonly mountRoot: string;
}

export function runBehaviorRules(context: BehaviorContext): Finding[] {
  throw new Error("not implemented");
}

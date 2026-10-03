import type { PlannedCall, RawTool } from "../types.js";

/**
 * 격리 안에서 도구 하나에 보낼 호출 열. 첫 호출의 callId 는 "placeholder" 이고 args 는
 * probeArguments 결과다. 인자를 만들 수 없으면 calls 는 [] 이고 skipped 에 probeArguments 의
 * reason 이 온다. 페이로드 호출이 상한(8)을 넘으면 calls 는 앞 9개(자리값 포함)이고 skipped 가
 * 상한 문장이다. 본문은 T4 가 채운다.
 */
export function planCalls(tool: RawTool): {
  readonly calls: readonly PlannedCall[];
  readonly skipped?: string;
} {
  throw new Error("not implemented");
}

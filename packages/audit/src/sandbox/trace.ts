import type { SandboxPhase, SyscallEvent } from "../types.js";

/**
 * strace 출력 줄들을 사건으로 바꾼다. 해석 못 한 줄은 버리지 않고 센다.
 * cwd 는 서버의 작업 디렉터리다. 상대 경로를 여기에 이어 붙여 절대 경로로 만든다.
 */
export type TraceParser = (
  lines: readonly string[],
  phase: SandboxPhase,
  cwd: string,
) => {
  readonly events: readonly SyscallEvent[];
  readonly unparsed: number;
};

/** 본문은 T4 가 채운다. */
export const parseTrace: TraceParser = () => {
  throw new Error("not implemented");
};

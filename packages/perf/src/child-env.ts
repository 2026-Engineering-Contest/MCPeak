/** 자식에게 추적 기록 디렉터리를 알리는 환경 변수 이름. */
export const PERF_TRACE_DIR_ENV = "MCPEAK_PERF_TRACE_DIR";

/** §4.1. 자식 프로세스에 덧붙일 환경 변수. T1 이 구현한다. */
export function childEnvironment(_options: {
  readonly traceDir: string;
  readonly existingNodeOptions?: string | undefined;
}): Readonly<Record<string, string>> {
  throw new Error("not implemented");
}

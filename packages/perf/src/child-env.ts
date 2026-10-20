/** 자식에게 추적 기록 디렉터리를 알리는 환경 변수 이름. */
export const PERF_TRACE_DIR_ENV = "MCPEAK_PERF_TRACE_DIR";

/**
 * 자식에게 넘길 환경 변수 두 개(설계 §4.1). `openConnection` 의 `env` 로 그대로 간다.
 *
 * `NODE_OPTIONS` 는 `existingNodeOptions` 가 비어 있지 않으면 그 뒤에 공백 하나와
 * `--import=<preload URL>` 을 덧붙이고, 없으면 import 하나다. preload URL 은
 * `new URL("./child/preload.mjs", import.meta.url).href` 라 dist 레이아웃이 그 상대 경로를
 * 지켜야 한다(`tsdown.config.mjs` 가 `child/preload` entry 로 못 박는다). `href` 는 공백 같은
 * 문자를 퍼센트 인코딩하므로 `NODE_OPTIONS` 의 공백 분리와 충돌하지 않는다.
 */
export function childEnvironment(options: {
  readonly traceDir: string;
  readonly existingNodeOptions?: string | undefined;
}): Readonly<Record<string, string>> {
  const preloadUrl = new URL("./child/preload.mjs", import.meta.url).href;
  const importFlag = `--import=${preloadUrl}`;
  const existing = options.existingNodeOptions;
  const nodeOptions =
    existing !== undefined && existing !== "" ? `${existing} ${importFlag}` : importFlag;
  return { NODE_OPTIONS: nodeOptions, [PERF_TRACE_DIR_ENV]: options.traceDir };
}

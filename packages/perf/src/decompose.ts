import type { ObservedRequest, Percentiles, PerfMeasurement, TraceEntry } from "./types.js";

/** 호출 하나의 분해 결과. §5.1·§5.3 의 정의 그대로. */
export interface CallTiming {
  /** 배정된 요청 중 t0 ≤ c.t1 인 것들의 [t0, min(requestEnd, c.t1)] 합집합 길이. */
  readonly external: number;
  /** max(0, (c.t1 − c.t0) − external). */
  readonly inside: number;
  /** 배정된 요청 수. afterResponse 를 포함한다. */
  readonly requests: number;
  /** t0 ≤ c.t1 인 요청들의 [t0, min(requestEnd, c.t1)] 가 동시에 열린 최대 수. 같은 시각의 끝은 시작보다 먼저 처리한다. */
  readonly maxConcurrency: number;
  /** t0 ≤ c.t1 인 요청 중 tEnd 가 없는 것이 하나라도 있으면 true. */
  readonly externalLowerBound: boolean;
  /** 배정된 요청 중 t0 > c.t1 인 것의 수. */
  readonly afterResponse: number;
}

/** §5.1·§5.2 병합·중복 제거. T2 가 구현한다. */
export function mergeTrace(_entries: readonly TraceEntry[]): readonly ObservedRequest[] {
  throw new Error("not implemented");
}

/** §5.1 호출 배정. T2 가 구현한다. */
export function assignRequests(
  _requests: readonly ObservedRequest[],
  _measurements: readonly PerfMeasurement[],
): ReadonlyMap<PerfMeasurement, readonly ObservedRequest[]> {
  throw new Error("not implemented");
}

/** §5.3 백분위. T2 가 구현한다. */
export function percentiles(_values: readonly number[]): Percentiles {
  throw new Error("not implemented");
}

/** §5.1 의 end(e): tEnd, 없으면 tHeaders, 둘 다 없으면 measurement.t1. T2 가 구현한다. */
export function requestEnd(_request: ObservedRequest, _measurement: PerfMeasurement): number {
  throw new Error("not implemented");
}

/** requests 는 assignRequests 가 그 측정에 배정한 목록이다. T2 가 구현한다. */
export function callTiming(
  _measurement: PerfMeasurement,
  _requests: readonly ObservedRequest[],
): CallTiming {
  throw new Error("not implemented");
}

import type { ObservedRequest, Percentiles, PerfMeasurement, TraceEntry } from "./types.js";

/** 호출 하나의 분해 결과. §5.1·§5.3 의 정의 그대로. */
export interface CallTiming {
  /** 배정된 요청 중 t0 ≤ c.t1 인 것들의 [max(t0, c.t0), min(requestEnd, c.t1)] 합집합 길이. 호출 시작 전에 끝난 요청은 뺀다. */
  readonly external: number;
  /** max(0, (c.t1 − c.t0) − external). */
  readonly inside: number;
  /** 배정된 요청 수. afterResponse 를 포함한다. */
  readonly requests: number;
  /** t0 ≤ c.t1 인 요청들의 [max(t0, c.t0), min(requestEnd, c.t1)] 가 동시에 열린 최대 수. 같은 시각의 끝은 시작보다 먼저 처리한다. 호출 시작 전에 끝난 요청은 뺀다. */
  readonly maxConcurrency: number;
  /** t0 ≤ c.t1 인 요청 중 tEnd 가 없는 것이 하나라도 있으면 true. */
  readonly externalLowerBound: boolean;
  /** 배정된 요청 중 t0 > c.t1 인 것의 수. */
  readonly afterResponse: number;
}

/** 설계 §2.1: 프로세스 간 시계 정렬 오차(1ms 미만)를 덮는 배정 창의 여유. */
const ASSIGN_SLACK_MS = 2;

type StartEntry = Extract<TraceEntry, { kind: "start" }>;
type EndEntry = Extract<TraceEntry, { kind: "end" }>;

function requestKey(pid: number, seq: number): string {
  return `${pid}:${seq}`;
}

/**
 * §5.1·§5.2 병합·중복 제거. start 와 end 를 (pid, seq) 로 합치고 짝 없는 end 는 버린다.
 * parentFetch 가 있는 undici 요청은 fetch 래퍼 안에서 생긴 중복이라 지운다. 결과는 (pid, seq) 오름차순.
 * 같은 (pid, seq) 의 줄이 여러 번 오면 처음 것을 쓴다.
 */
export function mergeTrace(entries: readonly TraceEntry[]): readonly ObservedRequest[] {
  const starts = new Map<string, StartEntry>();
  const ends = new Map<string, EndEntry>();
  for (const entry of entries) {
    if (entry.kind === "hello") continue;
    const key = requestKey(entry.pid, entry.seq);
    if (entry.kind === "start") {
      if (!starts.has(key)) starts.set(key, entry);
    } else if (!ends.has(key)) {
      ends.set(key, entry);
    }
  }

  const merged: ObservedRequest[] = [];
  for (const [key, startEntry] of starts) {
    if (startEntry.parentFetch !== undefined) continue;
    const { kind: _startKind, ...startFields } = startEntry;
    const endEntry = ends.get(key);
    if (endEntry === undefined) {
      merged.push(startFields);
      continue;
    }
    const { kind: _endKind, pid: _pid, seq: _seq, ...endFields } = endEntry;
    merged.push({ ...startFields, ...endFields });
  }
  return merged.sort((a, b) => a.pid - b.pid || a.seq - b.seq);
}

/** 서버를 부른 측정인가. skipped·missingTool 은 부르지 않은 점(t0 === t1)이라 요청을 낼 수 없다(§5.1, 계획 E34). */
function callsServer(measurement: PerfMeasurement): boolean {
  return measurement.outcome !== "skipped" && measurement.outcome !== "missingTool";
}

/**
 * §5.1 호출 배정. 요청 e 의 후보는 m.t0 − 2 ≤ e.t0 ≤ m.t1 + 2 인 측정(여유 창)이고, 점 측정(skipped·missingTool)은
 * 후보가 아니다. 그 측정도 Map 의 키로는 남고 값은 빈 배열이다. 후보 중 measurements
 * 배열 순서가 가장 늦은 측정 하나에 배정한다. 측정은 직렬이라 배열에서 늦을수록 시작도 늦다. 서버는 호출을 받은
 * 뒤에야 그 호출의 요청을 내므로 경계 근처의 요청은 나중 호출의 것일 가능성이 크다. 자식 시계 오차로 다음 호출
 * 첫 요청이 그 호출 t0 보다 앞에 찍혀도 앞 호출의 afterResponse 로 밀리지 않게 하려는 규칙이다. 엄밀 구간에 든
 * 측정은 그 뒤 측정의 여유 창보다 늦을 수 없으므로 따로 먼저 볼 필요가 없다. 후보가 없는 요청은 버린다.
 * 반환 Map 은 measurements 의 모든 원소를 배열 순서대로 키로 갖고, 각 값은 t0 오름차순, 같으면 seq,
 * 그래도 같으면 pid 오름차순이다.
 */
export function assignRequests(
  requests: readonly ObservedRequest[],
  measurements: readonly PerfMeasurement[],
): ReadonlyMap<PerfMeasurement, readonly ObservedRequest[]> {
  const assigned = new Map<PerfMeasurement, ObservedRequest[]>();
  for (const measurement of measurements) assigned.set(measurement, []);

  for (const request of requests) {
    // lib 이 ES2022 라 findLast 를 쓰지 않고 뒤에서부터 찾는다.
    for (let i = measurements.length - 1; i >= 0; i -= 1) {
      const m = measurements[i] as PerfMeasurement;
      if (!callsServer(m)) continue;
      if (request.t0 >= m.t0 - ASSIGN_SLACK_MS && request.t0 <= m.t1 + ASSIGN_SLACK_MS) {
        assigned.get(m)?.push(request);
        break;
      }
    }
  }

  for (const list of assigned.values()) {
    list.sort((a, b) => a.t0 - b.t0 || a.seq - b.seq || a.pid - b.pid);
  }
  return assigned;
}

/** nearest-rank 의 순위. 정수 백분율로 계산해 0.95 × n 같은 부동소수 오차를 피한다. */
function rank(percent: number, n: number): number {
  return Math.ceil((percent * n) / 100) - 1;
}

/** §5.3 백분위. nearest-rank: 오름차순 s 에서 s[ceil(p × n) − 1]. 빈 배열은 RangeError. */
export function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) {
    throw new RangeError(
      "percentiles 에 빈 배열이 들어왔습니다. ok 반복이 0 인 케이스는 통계를 만들지 않습니다.",
    );
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (index: number): number => sorted[index] as number;
  return {
    p50: at(rank(50, sorted.length)),
    p95: at(rank(95, sorted.length)),
    min: at(0),
    max: at(sorted.length - 1),
  };
}

/** §5.1 의 end(e): tEnd, 없으면 tHeaders, 둘 다 없으면 measurement.t1. */
export function requestEnd(request: ObservedRequest, measurement: PerfMeasurement): number {
  return request.tEnd ?? request.tHeaders ?? measurement.t1;
}

/** [시작, 끝] 구간들의 합집합 길이. */
function unionLength(intervals: readonly (readonly [number, number])[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let currentStart = Number.NaN;
  let currentEnd = Number.NaN;
  for (const [s, e] of sorted) {
    if (Number.isNaN(currentStart) || s > currentEnd) {
      if (!Number.isNaN(currentStart)) total += currentEnd - currentStart;
      currentStart = s;
      currentEnd = e;
    } else if (e > currentEnd) {
      currentEnd = e;
    }
  }
  if (!Number.isNaN(currentStart)) total += currentEnd - currentStart;
  return total;
}

/**
 * 동시에 열린 구간 수의 최대. 구간 i 가 시작하는 순간 열려 있는 구간(자기 포함)을 센다.
 * j 가 열려 있다는 것은 s_j ≤ s_i < e_j 다. 끝이 시작과 같은 시각이면 끝을 먼저 처리한 것과 같아 세지 않는다.
 * 길이 0 인 구간도 자기 자신은 센다.
 */
function maxOpen(intervals: readonly (readonly [number, number])[]): number {
  let max = 0;
  for (let i = 0; i < intervals.length; i += 1) {
    const [si] = intervals[i] as readonly [number, number];
    let open = 1;
    for (let j = 0; j < intervals.length; j += 1) {
      if (j === i) continue;
      const [sj, ej] = intervals[j] as readonly [number, number];
      if (sj <= si && si < ej) open += 1;
    }
    if (open > max) max = open;
  }
  return max;
}

/** requests 는 assignRequests 가 그 측정에 배정한 목록이다. */
export function callTiming(
  measurement: PerfMeasurement,
  requests: readonly ObservedRequest[],
): CallTiming {
  const intervals: [number, number][] = [];
  let externalLowerBound = false;
  let afterResponse = 0;
  for (const request of requests) {
    if (request.t0 > measurement.t1) {
      afterResponse += 1;
      continue;
    }
    if (request.tEnd === undefined) externalLowerBound = true;
    // 시작은 호출 t0 에서 자른다. 여유 창으로 배정된, t0 보다 앞에 찍힌 요청이 호출 밖 시간을 더하지 않게 한다(§5.3).
    const begin = Math.max(request.t0, measurement.t0);
    const end = Math.min(requestEnd(request, measurement), measurement.t1);
    // 호출 시작 전에 이미 끝난 요청은 [c.t0, c.t0] 로 남기면 c.t0 에 시작한 요청과 동시로 세므로 구간에서 뺀다.
    // 요청 수에는 남는다. 호출 안에서 시작한 요청의 길이 0 구간(시계 역행 등)은 지금처럼 자기 자신을 센다.
    if (request.t0 < measurement.t0 && end <= measurement.t0) continue;
    intervals.push([begin, Math.max(begin, end)]);
  }
  const external = unionLength(intervals);
  return {
    external,
    inside: Math.max(0, measurement.t1 - measurement.t0 - external),
    requests: requests.length,
    maxConcurrency: maxOpen(intervals),
    externalLowerBound,
    afterResponse,
  };
}

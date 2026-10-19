import { describe, expect, it } from "vitest";
import {
  assignRequests,
  callTiming,
  mergeTrace,
  percentiles,
  requestEnd,
} from "../src/decompose.js";
import type { ObservedRequest, PerfMeasurement, TraceEntry, TraceVia } from "../src/types.js";

/** 설계 §10.1: 시각은 이 기준의 오프셋으로 적는다. */
const T = 1_700_000_000_000;

function call(t0: number, t1: number, iteration = 0, caseId = "c"): PerfMeasurement {
  return { caseId, tool: "t", iteration, t0: T + t0, t1: T + t1, outcome: "ok" };
}

function start(
  seq: number,
  t0: number,
  extra: { via?: TraceVia; parentFetch?: number; pid?: number } = {},
): TraceEntry {
  return {
    kind: "start",
    pid: extra.pid ?? 100,
    seq,
    via: extra.via ?? "fetch",
    method: "GET",
    url: `https://h.example/r${seq}`,
    ...(extra.parentFetch === undefined ? {} : { parentFetch: extra.parentFetch }),
    t0: T + t0,
  };
}

function end(seq: number, tEnd: number, pid = 100): TraceEntry {
  return { kind: "end", pid, seq, status: 200, tHeaders: T + tEnd, tEnd: T + tEnd, bodyEnd: true };
}

/** start·end 한 쌍. */
function req(
  seq: number,
  t0: number,
  tEnd: number,
  extra: { via?: TraceVia; parentFetch?: number } = {},
) {
  return [start(seq, t0, extra), end(seq, tEnd)];
}

function timingOf(
  entries: readonly TraceEntry[],
  measurements: readonly PerfMeasurement[],
  target: PerfMeasurement,
) {
  const assigned = assignRequests(mergeTrace(entries), measurements);
  const requests = assigned.get(target);
  if (requests === undefined) throw new Error("측정이 Map 의 키가 아니다");
  return callTiming(target, requests);
}

describe("mergeTrace", () => {
  it("start 와 end 를 pid·seq 로 합친다", () => {
    const entries: TraceEntry[] = [
      { kind: "hello", pid: 100, ppid: 1, node: "v22.18.0", t: T },
      start(1, 1000),
      end(1, 1200),
      end(9, 1300),
    ];
    const merged = mergeTrace(entries);
    expect(merged).toEqual([
      {
        pid: 100,
        seq: 1,
        via: "fetch",
        method: "GET",
        url: "https://h.example/r1",
        t0: T + 1000,
        status: 200,
        tHeaders: T + 1200,
        tEnd: T + 1200,
        bodyEnd: true,
      },
    ]);
  });

  it("end 가 없는 start 는 끝 필드 없이 남는다", () => {
    const merged = mergeTrace([start(1, 1000)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.tEnd).toBeUndefined();
    expect(merged[0]?.tHeaders).toBeUndefined();
  });

  it("결과는 pid·seq 오름차순이다", () => {
    const merged = mergeTrace([
      start(2, 1000, { pid: 200 }),
      start(2, 1000, { pid: 100 }),
      start(1, 1000, { pid: 200 }),
      start(1, 1000, { pid: 100 }),
    ]);
    expect(merged.map((r) => [r.pid, r.seq])).toEqual([
      [100, 1],
      [100, 2],
      [200, 1],
      [200, 2],
    ]);
  });

  it("parentFetch 가 있는 undici 요청은 지운다", () => {
    const c = call(990, 1500);
    const entries = [
      ...req(1, 1000, 1300),
      ...req(2, 1001, 1100, { via: "undici", parentFetch: 1 }),
      ...req(3, 1101, 1299, { via: "undici", parentFetch: 1 }),
    ];
    expect(mergeTrace(entries).map((r) => r.seq)).toEqual([1]);
    expect(timingOf(entries, [c], c).requests).toBe(1);
  });

  it("parentFetch 없는 undici 는 남는다", () => {
    const c = call(990, 1500);
    const entries = [
      ...req(1, 1000, 1300),
      ...req(2, 1001, 1100, { via: "undici", parentFetch: 1 }),
      ...req(3, 1400, 1450, { via: "undici" }),
    ];
    const timing = timingOf(entries, [c], c);
    expect(timing.requests).toBe(2);
    expect(timing.external).toBe(350);
  });
});

describe("assignRequests", () => {
  it("요청은 후보 중 가장 앞선 호출 하나에만 배정된다", () => {
    const first = call(1000, 1500, 0);
    const second = call(1501, 1900, 1);
    const entries = [start(1, 1500.5), end(1, 1600)];
    const assigned = assignRequests(mergeTrace(entries), [first, second]);
    expect(assigned.get(first)?.map((r) => r.seq)).toEqual([1]);
    expect(assigned.get(second)).toEqual([]);
    const timing = callTiming(first, assigned.get(first) ?? []);
    expect(timing.afterResponse).toBe(1);
    expect(callTiming(second, assigned.get(second) ?? []).requests).toBe(0);
  });

  it("후보 판정 순서는 measurements 배열 순서다", () => {
    const later = call(1501, 1900, 1);
    const earlier = call(1000, 1500, 0);
    const entries = [start(1, 1500.5), end(1, 1600)];
    const assigned = assignRequests(mergeTrace(entries), [later, earlier]);
    expect(assigned.get(later)?.map((r) => r.seq)).toEqual([1]);
    expect(assigned.get(earlier)).toEqual([]);
  });

  it("창은 앞뒤로 2ms 여유를 둔다", () => {
    const c = call(1000, 1500);
    const entries = [
      ...req(1, 998, 1100),
      ...req(2, 1502, 1600),
      ...req(3, 997.9, 1100),
      ...req(4, 1502.1, 1600),
    ];
    const assigned = assignRequests(mergeTrace(entries), [c]);
    expect(assigned.get(c)?.map((r) => r.seq)).toEqual([1, 2]);
  });

  it("후보 호출이 없는 요청은 버린다", () => {
    const c = call(1000, 1500);
    const entries = [...req(1, 500, 600), ...req(2, 1010, 1100)];
    const assigned = assignRequests(mergeTrace(entries), [c]);
    expect(assigned.get(c)?.map((r) => r.seq)).toEqual([2]);
    expect(callTiming(c, assigned.get(c) ?? []).requests).toBe(1);
  });

  it("skipped 측정도 Map 의 키다", () => {
    const ok = call(1000, 1500);
    const skipped: PerfMeasurement = {
      caseId: "c",
      tool: "t",
      iteration: 1,
      t0: T + 1600,
      t1: T + 1600,
      outcome: "skipped",
    };
    const assigned = assignRequests(mergeTrace(req(1, 1010, 1100)), [ok, skipped]);
    expect([...assigned.keys()]).toEqual([ok, skipped]);
    expect(assigned.get(skipped)).toEqual([]);
  });

  it("배열 안 요청은 t0 오름차순, 같으면 seq 오름차순이다", () => {
    const c = call(1000, 1500);
    const entries = [...req(1, 1200, 1300), ...req(3, 1100, 1150), ...req(2, 1100, 1150)];
    const assigned = assignRequests(mergeTrace(entries), [c]);
    expect(assigned.get(c)?.map((r) => r.seq)).toEqual([2, 3, 1]);
  });
});

describe("callTiming", () => {
  it("응답 뒤 요청은 외부 대기에 넣지 않는다", () => {
    const c = call(1000, 1500);
    const timing = timingOf([...req(1, 1010, 1200), ...req(2, 1501, 1700)], [c], c);
    expect(timing.external).toBe(190);
    expect(timing.afterResponse).toBe(1);
    expect(timing.requests).toBe(2);
    expect(timing.inside).toBe(310);
  });

  it("겹친 요청은 합집합으로 센다", () => {
    const c = call(990, 1500);
    const timing = timingOf([...req(1, 1000, 1300), ...req(2, 1100, 1400)], [c], c);
    expect(timing.external).toBe(400);
    expect(timing.maxConcurrency).toBe(2);
    expect(timing.externalLowerBound).toBe(false);
  });

  it("끝과 시작이 같은 시각이면 동시가 아니다", () => {
    const c = call(990, 1500);
    const timing = timingOf([...req(1, 1000, 1100), ...req(2, 1100, 1200)], [c], c);
    expect(timing.maxConcurrency).toBe(1);
    expect(timing.external).toBe(200);
  });

  it("요청 끝은 호출 끝에서 자른다", () => {
    const c = call(1000, 1500);
    const timing = timingOf(req(1, 1400, 1800), [c], c);
    expect(timing.external).toBe(100);
    expect(timing.inside).toBe(400);
  });

  it("끝 줄이 없는 요청은 tHeaders, 그것도 없으면 호출 끝으로 끝내고 하한을 표시한다", () => {
    const c = call(1000, 1500);
    const headersOnly: ObservedRequest = {
      pid: 100,
      seq: 1,
      via: "node:http",
      method: "GET",
      url: "https://h.example/a",
      t0: T + 1100,
      tHeaders: T + 1200,
    };
    const nothing: ObservedRequest = {
      pid: 100,
      seq: 2,
      via: "fetch",
      method: "GET",
      url: "https://h.example/b",
      t0: T + 1300,
    };
    expect(requestEnd(headersOnly, c)).toBe(T + 1200);
    expect(requestEnd(nothing, c)).toBe(T + 1500);

    const withHeaders = callTiming(c, assignRequests([headersOnly], [c]).get(c) ?? []);
    expect(withHeaders.external).toBe(100);
    expect(withHeaders.externalLowerBound).toBe(true);

    const withoutEnd = callTiming(c, assignRequests([nothing], [c]).get(c) ?? []);
    expect(withoutEnd.external).toBe(200);
    expect(withoutEnd.externalLowerBound).toBe(true);
  });

  it("tEnd 가 있으면 requestEnd 는 tEnd 다", () => {
    const c = call(1000, 1500);
    const [r] = mergeTrace([
      start(1, 1010),
      { kind: "end", pid: 100, seq: 1, tHeaders: T + 1050, tEnd: T + 1090, bodyEnd: true },
    ]);
    if (r === undefined) throw new Error("요청이 없다");
    expect(requestEnd(r, c)).toBe(T + 1090);
  });

  it("응답 뒤 요청은 끝이 없어도 하한을 표시하지 않는다", () => {
    const c = call(1000, 1500);
    const timing = timingOf([start(1, 1501)], [c], c);
    expect(timing.externalLowerBound).toBe(false);
    expect(timing.afterResponse).toBe(1);
    expect(timing.external).toBe(0);
  });

  it("요청이 없으면 전부 0 이고 서버 안 시간은 응답 시간이다", () => {
    const c = call(1000, 1500);
    expect(callTiming(c, [])).toEqual({
      external: 0,
      inside: 500,
      requests: 0,
      maxConcurrency: 0,
      externalLowerBound: false,
      afterResponse: 0,
    });
  });

  it("외부 대기가 응답 시간보다 길면 서버 안 시간은 0 이다", () => {
    const c = call(1000, 1500);
    const timing = timingOf(req(1, 998, 1500), [c], c);
    expect(timing.external).toBe(502);
    expect(timing.inside).toBe(0);
  });
});

describe("percentiles", () => {
  it("nearest-rank 백분위", () => {
    expect(percentiles([5, 1, 4, 2, 3])).toEqual({ p50: 3, p95: 5, min: 1, max: 5 });
    expect(percentiles([1, 2])).toEqual({ p50: 1, p95: 2, min: 1, max: 2 });
  });

  it("입력 배열을 바꾸지 않는다", () => {
    const values = [3, 1, 2];
    percentiles(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it("n=20 의 p95 는 19번째 값이고 n=100 은 95번째 값이다", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentiles(twenty).p95).toBe(19);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentiles(hundred).p95).toBe(95);
    expect(percentiles(hundred).p50).toBe(50);
  });

  it("빈 배열은 RangeError 를 던진다", () => {
    expect(() => percentiles([])).toThrow(RangeError);
  });
});

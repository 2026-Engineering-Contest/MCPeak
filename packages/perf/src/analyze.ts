import {
  assignRequests,
  type CallTiming,
  callTiming,
  mergeTrace,
  percentiles,
  requestEnd,
} from "./decompose.js";
import { runRules } from "./rules.js";
import {
  type CallOutcome,
  type CaseResult,
  type ObservedRequest,
  PERF_SCHEMA_VERSION,
  type PerfCall,
  type PerfMeasurement,
  type PerfPlan,
  type PerfReport,
  type RequestSummary,
  type TraceEntry,
} from "./types.js";
import { displayUrl } from "./url.js";

const NO_DEPENDENCY: CaseResult["dependency"] = { dependent: 0, independent: 0, unknown: 0 };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 여섯 키 전부, §5.4 표 순서. */
function countOutcomes(measurements: readonly PerfMeasurement[]): CaseResult["outcomes"] {
  const counts: Record<CallOutcome, number> = {
    ok: 0,
    isError: 0,
    empty: 0,
    threw: 0,
    skipped: 0,
    missingTool: 0,
  };
  for (const m of measurements) counts[m.outcome] += 1;
  return counts;
}

/** ok 반복에 배정된 요청을 `{METHOD} {displayUrl}` 로 묶는다. display 사전순. */
function summarize(
  okRuns: readonly PerfMeasurement[],
  assigned: ReadonlyMap<PerfMeasurement, readonly ObservedRequest[]>,
): RequestSummary[] {
  const groups = new Map<string, { via: ObservedRequest["via"]; durations: number[] }>();
  for (const measurement of okRuns) {
    for (const request of assigned.get(measurement) ?? []) {
      const display = `${request.method} ${displayUrl(request.url)}`;
      const duration = requestEnd(request, measurement) - request.t0;
      const group = groups.get(display);
      if (group === undefined) groups.set(display, { via: request.via, durations: [duration] });
      else group.durations.push(duration);
    }
  }
  return [...groups]
    .sort(([a], [b]) => compareText(a, b))
    .map(([display, group]) => ({
      display,
      via: group.via,
      count: group.durations.length,
      durationP50: percentiles(group.durations).p50,
    }));
}

/** 케이스 하나의 결과. 키 순서는 설계 §8.1 의 선언 순서다(JSON 바이트 결정론). */
function caseResult(
  call: PerfCall,
  measurements: readonly PerfMeasurement[],
  observed: boolean,
  assigned: ReadonlyMap<PerfMeasurement, readonly ObservedRequest[]>,
  dependency: CaseResult["dependency"],
): CaseResult {
  const own = measurements.filter((m) => m.caseId === call.caseId);
  const okRuns = own.filter((m) => m.outcome === "ok");
  const firstError = own.find((m) => m.outcome === "threw")?.detail;
  const n = okRuns.length;

  const stats: Partial<CaseResult> = {};
  if (n > 0) {
    Object.assign(stats, { total: percentiles(okRuns.map((m) => m.t1 - m.t0)) });
    if (observed) {
      const timings: CallTiming[] = okRuns.map((m) => callTiming(m, assigned.get(m) ?? []));
      Object.assign(stats, {
        external: percentiles(timings.map((t) => t.external)),
        inside: percentiles(timings.map((t) => t.inside)),
        requests: percentiles(timings.map((t) => t.requests)),
        maxConcurrency: Math.max(...timings.map((t) => t.maxConcurrency)),
        externalLowerBound: timings.some((t) => t.externalLowerBound),
        afterResponse: timings.reduce((sum, t) => sum + t.afterResponse, 0),
      });
    }
  }

  return {
    id: call.caseId,
    tool: call.tool,
    n,
    outcomes: countOutcomes(own),
    ...(firstError === undefined ? {} : { firstError }),
    ...stats,
    dependency,
    requestSummaries: observed ? summarize(okRuns, assigned) : [],
  };
}

/**
 * 순수 함수. 추적 병합 → 호출 배정 → 측정별 분해 → 진단 규칙을 조립해 리포트를 만든다.
 * 추적에 hello 줄이 없으면 관측이 없는 것으로 보고 분해·진단을 하지 않는다(§4.4).
 * exitCode 는 0 이고 baseline 은 없다. 기준선 비교는 compareBaseline 이 한다.
 */
export function analyze(input: {
  readonly plan: PerfPlan;
  readonly measurements: readonly PerfMeasurement[];
  readonly trace: readonly TraceEntry[];
  readonly coldStart: { readonly connectMs: number; readonly listToolsMs: number };
  readonly server: { readonly command: string; readonly toolCount: number };
  readonly generatorVersion: string;
}): PerfReport {
  const { plan, measurements } = input;
  const observed = input.trace.some((entry) => entry.kind === "hello");
  const assigned = observed
    ? assignRequests(mergeTrace(input.trace), measurements)
    : new Map<PerfMeasurement, readonly ObservedRequest[]>();
  const rules = observed
    ? runRules({ plan, measurements, assigned })
    : { findings: [], undecidedCases: 0, dependency: new Map<string, CaseResult["dependency"]>() };

  const timedOut = measurements.find((m) => m.timedOut === true);
  const abortedCall =
    timedOut === undefined ? undefined : plan.calls.find((c) => c.caseId === timedOut.caseId);

  return {
    schemaVersion: PERF_SCHEMA_VERSION,
    generator: { name: "@mcpeak/perf", version: input.generatorVersion },
    server: { command: input.server.command, toolCount: input.server.toolCount },
    settings: {
      repeat: plan.repeat,
      intervalMs: plan.intervalMs,
      caseCount: plan.calls.length,
      observation: observed ? "preload" : "none",
    },
    coldStart: { connectMs: input.coldStart.connectMs, listToolsMs: input.coldStart.listToolsMs },
    cases: plan.calls.map((call) =>
      caseResult(
        call,
        measurements,
        observed,
        assigned,
        rules.dependency.get(call.caseId) ?? NO_DEPENDENCY,
      ),
    ),
    findings: rules.findings,
    undecidedCases: rules.undecidedCases,
    aborted:
      timedOut === undefined
        ? null
        : { caseId: timedOut.caseId, timeoutMs: abortedCall?.timeoutMs ?? 0 },
    exitCode: 0,
  };
}

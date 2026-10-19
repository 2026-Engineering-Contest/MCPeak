import { createHash } from "node:crypto";
import { callTiming, percentiles, requestEnd } from "./decompose.js";
import { judge } from "./dependency.js";
import type {
  CaseResult,
  ObservedRequest,
  PerfCall,
  PerfFinding,
  PerfMeasurement,
  PerfPlan,
} from "./types.js";
import { displayUrl } from "./url.js";

type Verdict = "dependent" | "independent" | "unknown";
type DependencyCounts = CaseResult["dependency"];

/** 문장 첫 줄에 적는 독립 순차 요청 표기의 종류 수 상한(§6.2). */
const MAX_LISTED_REQUESTS = 3;

/** 순차 판정과 pred 의 여유. 끝과 시작이 1ms 안이면 "끝난 뒤" 로 본다(§6.2). */
const SEQUENTIAL_SLACK_MS = 1;

/** 시각·로캘과 무관한 문자열 순서. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function display(request: ObservedRequest): string {
  return `${request.method} ${displayUrl(request.url)}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function p50(values: readonly number[]): number {
  return percentiles(values).p50;
}

function isMajority(m: number, n: number): boolean {
  return m > n / 2;
}

/** 케이스 하나의 ok 반복. 배정 요청은 assignRequests 의 순서(t0, seq) 그대로다. */
interface OkRun {
  readonly measurement: PerfMeasurement;
  readonly requests: readonly ObservedRequest[];
}

interface CaseRuns {
  readonly call: PerfCall;
  readonly runs: readonly OkRun[];
}

/** 반복 하나의 순차 요청 분석. */
interface SequentialRun {
  readonly counts: DependencyCounts;
  /** 독립 순차 요청. 외부 대기 순서. */
  readonly independent: readonly ObservedRequest[];
  /** §6.2 의 saving(c). 외부 대기 − 임계 경로. */
  readonly saving: number;
}

/**
 * §6.2 순차 독립 요청의 반복 하나. 외부 대기에 들어간 요청(t0 ≤ c.t1)을 순서대로 보며 순차 여부와 판정,
 * 의존 그래프의 임계 경로를 함께 구한다. unknown 은 pred 에서 의존으로 본다(단축을 작게 잡는 쪽).
 */
function sequentialRun(run: OkRun, input: Readonly<Record<string, unknown>>): SequentialRun {
  const { measurement } = run;
  const external = run.requests.filter((request) => request.t0 <= measurement.t1);
  const ends = external.map((request) => requestEnd(request, measurement));
  const finish: number[] = [];
  const independent: ObservedRequest[] = [];
  let dependent = 0;
  let unknown = 0;
  let latestEnd = Number.NEGATIVE_INFINITY;

  external.forEach((later, i) => {
    const sequential = i >= 1 && later.t0 >= latestEnd - SEQUENTIAL_SLACK_MS;
    let anyDependent = false;
    let anyUnknown = false;
    let longestPred = 0;
    for (let j = 0; j < i; j += 1) {
      const endedBefore = later.t0 >= (ends[j] as number) - SEQUENTIAL_SLACK_MS;
      // 순차가 아니고 j 가 먼저 끝나지도 않았으면 이 쌍의 판정은 어디에도 쓰이지 않는다.
      if (!sequential && !endedBefore) continue;
      const verdict: Verdict = judge(later, external[j] as ObservedRequest, input);
      if (verdict === "dependent") anyDependent = true;
      if (verdict === "unknown") anyUnknown = true;
      if (endedBefore && verdict !== "independent") {
        longestPred = Math.max(longestPred, finish[j] as number);
      }
    }
    if (sequential) {
      if (anyDependent) dependent += 1;
      else if (anyUnknown) unknown += 1;
      else independent.push(later);
    }
    const length = Math.max(0, Math.min(ends[i] as number, measurement.t1) - later.t0);
    finish.push(length + longestPred);
    latestEnd = Math.max(latestEnd, ends[i] as number);
  });

  const criticalPath = finish.length === 0 ? 0 : Math.max(...finish);
  return {
    counts: { dependent, independent: independent.length, unknown },
    independent,
    saving: callTiming(measurement, run.requests).external - criticalPath,
  };
}

/** 정렬용 내부 키를 단 진단. tieBreak 은 원문 URL 을 담을 수 있어 출력하지 않는다. */
interface Ranked {
  readonly finding: PerfFinding;
  readonly tieBreak: string;
}

/**
 * 독립 순차 요청 표기. 같은 표기는 첫 등장 순서로 한 번만 두고, 나타난 반복에서의 반복 안 횟수 p50 이
 * 1 보다 크면 `×{횟수}` 를 붙인다.
 */
function independentPieces(fired: readonly SequentialRun[]): string[] {
  const perRun = new Map<string, number[]>();
  for (const run of fired) {
    const counts = new Map<string, number>();
    for (const request of run.independent) {
      const key = display(request);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      const list = perRun.get(key);
      if (list === undefined) perRun.set(key, [count]);
      else list.push(count);
    }
  }
  return [...perRun].map(([key, counts]) => {
    const times = p50(counts);
    return times === 1 ? key : `${key} ×${times}`;
  });
}

function sequentialFinding(
  entry: CaseRuns,
  sequential: readonly SequentialRun[],
): PerfFinding | undefined {
  const fired = sequential.filter((run) => run.independent.length >= 1);
  const n = sequential.length;
  if (!isMajority(fired.length, n)) return undefined;

  const pieces = independentPieces(fired);
  const listed =
    pieces.length > MAX_LISTED_REQUESTS
      ? `${pieces.slice(0, MAX_LISTED_REQUESTS).join(", ")} 외 ${pieces.length - MAX_LISTED_REQUESTS}종`
      : pieces.join(", ");
  const k = p50(fired.map((run) => run.independent.length));
  const saving = p50(fired.map((run) => run.saving));
  const { tool, caseId } = entry.call;
  return {
    ruleId: "perf/sequential-independent",
    caseIds: [caseId],
    tools: [tool],
    lines: [
      `'${tool}' 호출 안에서 독립 요청 ${k}건이 순차로 나갑니다 (${n}회 중 ${fired.length}회): ${listed}`,
      `병렬로 보내면 최대 약 ${Math.round(saving)}ms 줄일 수 있습니다 (p50 기준 상한).`,
      "Promise.all 로 한 번에 보내고, 상대 API 의 동시 요청 한도와 429 백오프를 함께 두세요.",
    ],
    evidence: { observed: fired.length, of: n, requests: pieces, savingUpperBoundMs: saving },
  };
}

/** §6.2 요청 키. 본문을 못 본 요청은 키가 없다. */
function requestKey(request: ObservedRequest): string | undefined {
  if (request.requestBodyUnknown === true) return undefined;
  return `${request.method} ${request.url} ${sha256(request.requestBody ?? "")}`;
}

/** §6.2 응답 지문. 응답 본문이 보이고 잘리지 않았을 때만 있다. */
function fingerprint(request: ObservedRequest): string | undefined {
  if (request.responseBody === undefined || request.responseBodyTruncated === true) {
    return undefined;
  }
  return `${request.status}:${sha256(request.responseBody)}`;
}

function isSuccess(status: number | undefined): boolean {
  return status !== undefined && status >= 200 && status < 300;
}

/** (a) 호출 안 중복. 키마다 진단 하나. */
function duplicateFindings(entry: CaseRuns): Ranked[] {
  const n = entry.runs.length;
  /** 키 → 성립한 반복의 횟수들. 키 순서는 첫 관측 순서. */
  const satisfied = new Map<string, { readonly display: string; readonly counts: number[] }>();
  for (const run of entry.runs) {
    const groups = new Map<string, ObservedRequest[]>();
    for (const request of run.requests) {
      const key = requestKey(request);
      if (key === undefined) continue;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [request]);
      else group.push(request);
    }
    for (const [key, group] of groups) {
      const first = group[0] as ObservedRequest;
      if (group.length < 2 || !isSuccess(first.status)) continue;
      const slot = satisfied.get(key);
      if (slot === undefined)
        satisfied.set(key, { display: display(first), counts: [group.length] });
      else slot.counts.push(group.length);
    }
  }

  const { tool, caseId } = entry.call;
  const ranked: Ranked[] = [];
  for (const [key, slot] of satisfied) {
    const m = slot.counts.length;
    if (!isMajority(m, n)) continue;
    ranked.push({
      tieBreak: key,
      finding: {
        ruleId: "perf/repeated-request",
        caseIds: [caseId],
        tools: [tool],
        lines: [
          `'${tool}' 호출 한 번에 같은 요청을 ${p50(slot.counts)}번 보냅니다 (${n}회 중 ${m}회): ${slot.display}`,
          "첫 응답을 호출 안에서 재사용하세요.",
        ],
        evidence: { observed: m, of: n, requests: [slot.display] },
      },
    });
  }
  return ranked;
}

/** (b) 케이스 간 반복. 서로 다른 케이스 2개 이상에서 같은 키가 같은 지문으로 나타난다. */
function crossCaseFindings(entries: readonly CaseRuns[]): Ranked[] {
  interface Seen {
    readonly display: string;
    readonly cases: Set<CaseRuns>;
    readonly runs: Set<PerfMeasurement>;
    readonly durations: number[];
    readonly fingerprints: Set<string | undefined>;
  }
  const byKey = new Map<string, Seen>();
  for (const entry of entries) {
    for (const run of entry.runs) {
      for (const request of run.requests) {
        const key = requestKey(request);
        if (key === undefined) continue;
        let seen = byKey.get(key);
        if (seen === undefined) {
          seen = {
            display: display(request),
            cases: new Set(),
            runs: new Set(),
            durations: [],
            fingerprints: new Set(),
          };
          byKey.set(key, seen);
        }
        seen.cases.add(entry);
        seen.runs.add(run.measurement);
        seen.durations.push(requestEnd(request, run.measurement) - request.t0);
        seen.fingerprints.add(fingerprint(request));
      }
    }
  }

  const ranked: Ranked[] = [];
  for (const [key, seen] of byKey) {
    if (seen.cases.size < 2) continue;
    if (seen.fingerprints.size !== 1 || seen.fingerprints.has(undefined)) continue;
    const cases = [...seen.cases];
    const caseIds = cases.map((entry) => entry.call.caseId).sort(compareText);
    const tools = [...new Set(cases.map((entry) => entry.call.tool))].sort(compareText);
    const of = cases.reduce((sum, entry) => sum + entry.runs.length, 0);
    const m = seen.runs.size;
    ranked.push({
      tieBreak: key,
      finding: {
        ruleId: "perf/repeated-request",
        caseIds,
        tools,
        lines: [
          `'${tools.join("', '")}' 가 입력이 달라도 매 호출 같은 요청에 같은 응답을 받습니다 (케이스 ${cases.length}개, 호출 ${m}회, p50 ${Math.round(p50(seen.durations))}ms): ${seen.display}`,
          "프로세스 안에서 캐시하거나 시작할 때 한 번만 받으세요.",
        ],
        evidence: { observed: m, of, requests: [seen.display] },
      },
    });
  }
  return ranked;
}

/** §6.3: 규칙 id, 첫 케이스 id, 첫 요청 표기 사전순. 그래도 같으면 내부 요청 키 순(출력하지 않는다). */
function compareRanked(a: Ranked, b: Ranked): number {
  return (
    compareText(a.finding.ruleId, b.finding.ruleId) ||
    compareText(a.finding.caseIds[0] ?? "", b.finding.caseIds[0] ?? "") ||
    compareText(a.finding.evidence.requests[0] ?? "", b.finding.evidence.requests[0] ?? "") ||
    compareText(a.tieBreak, b.tieBreak)
  );
}

/**
 * §6.2 진단 규칙과 §6.3 순서. 통계처럼 ok 반복만 본다. 종료 코드는 바꾸지 않는다.
 * dependency 는 plan 의 모든 케이스 id 를 키로 갖고, ok 반복의 순차 요청 판정 수를 더한 것이다.
 */
export function runRules(input: {
  readonly plan: PerfPlan;
  readonly measurements: readonly PerfMeasurement[];
  readonly assigned: ReadonlyMap<PerfMeasurement, readonly ObservedRequest[]>;
}): {
  readonly findings: readonly PerfFinding[];
  readonly undecidedCases: number;
  readonly dependency: ReadonlyMap<string, CaseResult["dependency"]>;
} {
  const entries: CaseRuns[] = [];
  const seenIds = new Set<string>();
  for (const call of input.plan.calls) {
    if (seenIds.has(call.caseId)) continue;
    seenIds.add(call.caseId);
    const runs = input.measurements
      .filter((m) => m.caseId === call.caseId && m.outcome === "ok")
      .map((measurement) => ({ measurement, requests: input.assigned.get(measurement) ?? [] }));
    entries.push({ call, runs });
  }

  const ranked: Ranked[] = [];
  const dependency = new Map<string, DependencyCounts>();
  let undecidedCases = 0;
  for (const entry of entries) {
    const sequential = entry.runs.map((run) => sequentialRun(run, entry.call.input));
    dependency.set(
      entry.call.caseId,
      sequential.reduce(
        (sum, run) => ({
          dependent: sum.dependent + run.counts.dependent,
          independent: sum.independent + run.counts.independent,
          unknown: sum.unknown + run.counts.unknown,
        }),
        { dependent: 0, independent: 0, unknown: 0 },
      ),
    );

    const finding = sequentialFinding(entry, sequential);
    if (finding !== undefined) {
      ranked.push({ finding, tieBreak: "" });
    } else {
      const undecided = sequential.filter((run) => run.counts.unknown >= 1).length;
      if (isMajority(undecided, sequential.length)) undecidedCases += 1;
    }
    ranked.push(...duplicateFindings(entry));
  }
  ranked.push(...crossCaseFindings(entries));

  return {
    findings: ranked.sort(compareRanked).map((item) => item.finding),
    undecidedCases,
    dependency,
  };
}

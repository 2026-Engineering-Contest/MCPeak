import { PerfError } from "./errors.js";
import { failureReason } from "./report.js";
import { PERF_SCHEMA_VERSION, type PerfBaseline, type PerfReport } from "./types.js";

type BaselineCase = PerfBaseline["cases"][number];

/** 사전순은 코드 유닛 비교다. 로캘에 따라 결과가 달라지지 않게 localeCompare 를 쓰지 않는다. */
function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** §7.3 의 `{factor}`: 50 → `1.5`, 0 → `1`, 125 → `2.25`. */
function factor(thresholdPct: number): string {
  return String(Math.round((1 + thresholdPct / 100) * 100) / 100);
}

/** baseline 과 exitCode 를 채운 새 리포트. 입력은 바꾸지 않는다(§7.2·§7.3). */
export function compareBaseline(
  report: PerfReport,
  baseline: PerfBaseline,
  options: { readonly path: string; readonly thresholdPct: number; readonly thresholdMs: number },
): PerfReport {
  if (report.settings.observation === "none") {
    throw new Error("observation 이 none 인 리포트는 기준선과 비교할 수 없습니다");
  }

  const current = new Map(report.cases.map((c) => [c.id, c]));
  const known = new Set(baseline.cases.map((c) => c.id));
  const regressions: string[] = [];
  const regressedIds = new Set<string>();
  const notices: { readonly id: string; readonly line: string }[] = [];

  // 회귀 줄: 케이스 id 사전순, 같은 케이스는 서버 안 → 요청 수 → 측정 불가.
  for (const base of [...baseline.cases].sort(byId)) {
    const now = current.get(base.id);
    if (now === undefined) {
      notices.push({ id: base.id, line: `'${base.id}' 는 기준에 있지만 이번 명세에 없습니다.` });
      continue;
    }
    if (now.n === 0) {
      regressions.push(
        `'${base.id}' 는 기준에 있지만 이번에는 성공한 호출이 없습니다 (${failureReason(now.outcomes)})`,
      );
      regressedIds.add(base.id);
      continue;
    }
    if (now.inside !== undefined) {
      const limit = base.insideP50 * (1 + options.thresholdPct / 100) + options.thresholdMs;
      if (now.inside.p50 > limit) {
        regressions.push(
          `'${base.id}' 서버 안 p50 ${Math.round(now.inside.p50)}ms, 기준 ${Math.round(base.insideP50)}ms (허용 ${Math.round(limit)}ms 초과)`,
        );
        regressedIds.add(base.id);
      }
    }
    if (now.requests !== undefined && now.requests.p50 > base.requestsP50) {
      regressions.push(
        `'${base.id}' 호출당 외부 요청 ${Math.round(now.requests.p50)}건, 기준 ${Math.round(base.requestsP50)}건`,
      );
      regressedIds.add(base.id);
    }
  }

  for (const c of report.cases) {
    if (!known.has(c.id)) {
      notices.push({
        id: c.id,
        line: `'${c.id}' 는 기준에 없습니다. --update-baseline 으로 기준을 갱신하세요.`,
      });
    }
  }

  const settingsMismatch =
    baseline.settings.repeat !== report.settings.repeat ||
    baseline.settings.intervalMs !== report.settings.intervalMs;

  const lines = [
    ...regressions,
    regressions.length === 0
      ? `회귀 없음. 서버 안 p50 은 기준의 ${factor(options.thresholdPct)}배+${options.thresholdMs}ms 안이고 외부 요청 수는 기준 이하입니다.`
      : "이 변경이 의도된 것이라면 --update-baseline 으로 기준을 갱신하세요.",
    ...(settingsMismatch
      ? [
          `기준은 반복 ${baseline.settings.repeat}회·간격 ${baseline.settings.intervalMs}ms 로 쟀고 이번은 반복 ${report.settings.repeat}회·간격 ${report.settings.intervalMs}ms 입니다. 조건이 달라 비교가 느슨합니다.`,
        ]
      : []),
    ...notices.sort(byId).map((notice) => notice.line),
  ];

  return {
    ...report,
    baseline: {
      path: options.path,
      settingsMismatch,
      lines,
      regressedCaseIds: [...regressedIds].sort(),
    },
    exitCode: regressions.length === 0 ? 0 : 2,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** §7.1 기준 파일 내용. ok 반복이 0 인 케이스는 빼고 id 사전순, 수치는 소수 첫째 자리. */
export function toBaseline(report: PerfReport): PerfBaseline {
  if (report.settings.observation === "none") {
    throw new Error("observation 이 none 인 리포트로는 기준 파일을 만들 수 없습니다");
  }
  const cases: BaselineCase[] = [];
  for (const c of report.cases) {
    if (c.n === 0) continue;
    if (c.total === undefined || c.inside === undefined || c.external === undefined) continue;
    if (c.requests === undefined) continue;
    cases.push({
      id: c.id,
      tool: c.tool,
      n: c.n,
      insideP50: round1(c.inside.p50),
      externalP50: round1(c.external.p50),
      totalP50: round1(c.total.p50),
      requestsP50: round1(c.requests.p50),
    });
  }
  return {
    schemaVersion: PERF_SCHEMA_VERSION,
    generator: { name: report.generator.name, version: report.generator.version },
    settings: { repeat: report.settings.repeat, intervalMs: report.settings.intervalMs },
    cases: cases.sort(byId),
  };
}

function invalid(path: string): PerfError {
  return new PerfError("BASELINE_INVALID", `${path} 가 없거나 형식이 틀렸습니다`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(path);
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(path);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") throw invalid(path);
  return value;
}

/**
 * 형식이 틀리면 PerfError("BASELINE_INVALID", 사유 한 줄). 검사 순서는 JSON, schemaVersion,
 * 그리고 §7.1 의 필드 선언 순서다. 사유는 처음 틀린 필드 하나만 말한다.
 */
export function parseBaseline(text: string): PerfBaseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PerfError("BASELINE_INVALID", "JSON 이 아닙니다");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== PERF_SCHEMA_VERSION) {
    throw new PerfError("BASELINE_INVALID", `schemaVersion 이 ${PERF_SCHEMA_VERSION} 이 아닙니다`);
  }

  const generator = requireRecord(parsed.generator, "generator");
  if (generator.name !== "@mcpeak/perf") throw invalid("generator.name");
  const version = requireString(generator.version, "generator.version");

  const settings = requireRecord(parsed.settings, "settings");
  const repeat = requireNumber(settings.repeat, "settings.repeat");
  const intervalMs = requireNumber(settings.intervalMs, "settings.intervalMs");

  if (!Array.isArray(parsed.cases)) throw invalid("cases");
  const cases = parsed.cases.map((entry: unknown, index): BaselineCase => {
    const at = `cases[${index}]`;
    const record = requireRecord(entry, at);
    return {
      id: requireString(record.id, `${at}.id`),
      tool: requireString(record.tool, `${at}.tool`),
      n: requireNumber(record.n, `${at}.n`),
      insideP50: requireNumber(record.insideP50, `${at}.insideP50`),
      externalP50: requireNumber(record.externalP50, `${at}.externalP50`),
      totalP50: requireNumber(record.totalP50, `${at}.totalP50`),
      requestsP50: requireNumber(record.requestsP50, `${at}.requestsP50`),
    };
  });

  return {
    schemaVersion: PERF_SCHEMA_VERSION,
    generator: { name: "@mcpeak/perf", version },
    settings: { repeat, intervalMs },
    cases,
  };
}

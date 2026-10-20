import type { CallOutcome, CaseResult, PerfReport } from "@mcpeak/perf";
import { renderReport } from "@mcpeak/perf";
import { describe, expect, it } from "vitest";
import {
  caseColumns,
  failureReason,
  observationLabel,
  performanceCounts,
  unmeasuredReason,
} from "../src/analyze/performance-view.js";

/**
 * 화면의 문장·숫자가 CLI 리포트(`renderReport`)와 글자가 같은지 대조한다. 테스트에서는 `@mcpeak/perf` 를
 * 값으로 import 할 수 있다. 화면 코드는 하지 않는다.
 */

const OUTCOMES: Record<CallOutcome, number> = {
  ok: 0,
  isError: 0,
  empty: 0,
  threw: 0,
  skipped: 0,
  missingTool: 0,
};

function measured(id: string, p50: number, extra: Partial<CaseResult> = {}): CaseResult {
  return {
    id,
    tool: id,
    n: 5,
    outcomes: { ...OUTCOMES, ok: 5 },
    total: { p50, p95: p50 + 10.6, min: p50, max: p50 + 20 },
    external: { p50: p50 / 2, p95: p50, min: 0, max: p50 },
    inside: { p50: p50 / 3, p95: p50, min: 0, max: p50 },
    requests: { p50: 1.5, p95: 2, min: 1, max: 2 },
    dependency: { dependent: 0, independent: 0, unknown: 0 },
    requestSummaries: [],
    ...extra,
  };
}

function unmeasured(
  id: string,
  outcomes: Partial<Record<CallOutcome, number>>,
  firstError?: string,
): CaseResult {
  return {
    id,
    tool: id,
    n: 0,
    outcomes: { ...OUTCOMES, ...outcomes },
    ...(firstError === undefined ? {} : { firstError }),
    dependency: { dependent: 0, independent: 0, unknown: 0 },
    requestSummaries: [],
  };
}

function report(cases: readonly CaseResult[], observation: "preload" | "none"): PerfReport {
  return {
    schemaVersion: 1,
    generator: { name: "@mcpeak/perf", version: "0.0.0" },
    server: { command: "node s.mjs", toolCount: 3 },
    settings: { repeat: 5, intervalMs: 0, caseCount: cases.length, observation },
    coldStart: { connectMs: 80, listToolsMs: 3 },
    cases,
    findings: [],
    undecidedCases: 0,
    aborted: null,
    exitCode: 0,
  };
}

/** CLI 리포트에서 케이스 id 로 시작하는 표의 줄. */
function rowOf(rendered: string, id: string): string {
  const line = rendered.split("\n").find((candidate) => candidate.startsWith(`${id} `));
  if (line === undefined) throw new Error(`표에 ${id} 행이 없습니다`);
  return line;
}

const CASES = [
  measured("fast", 412.4, { externalLowerBound: true }),
  measured("slow", 600.6),
  unmeasured("broken", { threw: 3, isError: 2 }, "ECONNREFUSED"),
  unmeasured("missing", { missingTool: 5 }),
];

describe("performance-view", () => {
  it("측정하지 않은 케이스의 사유는 CLI 표의 비고와 글자가 같다", () => {
    const rendered = renderReport(report(CASES, "preload"));
    for (const entry of CASES.filter((item) => item.n === 0)) {
      expect(rowOf(rendered, entry.id).endsWith(`  ${unmeasuredReason(entry)}`)).toBe(true);
    }
    expect(unmeasuredReason(CASES[2] as CaseResult)).toBe(
      "측정 안 됨: isError 2회, threw 3회. 첫 오류: ECONNREFUSED",
    );
    expect(failureReason({ ...OUTCOMES, ok: 5 })).toBe("");
  });

  it("케이스 표의 칸 값은 CLI 표와 같은 순서·같은 글자다", () => {
    for (const observation of ["preload", "none"] as const) {
      const perfReport = report(CASES, observation);
      const rendered = renderReport(perfReport);
      const columns = caseColumns(perfReport);
      for (const entry of CASES.filter((item) => item.n > 0)) {
        const cells = columns.map((column) => column.value(entry)).filter((cell) => cell !== "");
        expect(rowOf(rendered, entry.id).trim().split(/\s+/)).toEqual(cells);
      }
    }
  });

  it("관측 안 함이면 외부·서버 안·요청 열을 뺀다", () => {
    expect(caseColumns(report(CASES, "preload")).map((column) => column.header)).toEqual([
      "케이스",
      "n",
      "응답 p50",
      "p95",
      "외부 대기 p50",
      "서버 안 p50",
      "외부 요청/호출",
    ]);
    expect(caseColumns(report(CASES, "none")).map((column) => column.header)).toEqual([
      "케이스",
      "n",
      "응답 p50",
      "p95",
    ]);
  });

  it("집계는 측정·미측정 케이스와 진단을 센다", () => {
    expect(performanceCounts(report(CASES, "preload"))).toEqual({
      measured: 2,
      unmeasured: 2,
      findings: 0,
    });
    expect(observationLabel(report(CASES, "none"))).toBe("관측 안 함");
    expect(observationLabel(report(CASES, "preload"))).toBe("Node 프리로드");
  });
});

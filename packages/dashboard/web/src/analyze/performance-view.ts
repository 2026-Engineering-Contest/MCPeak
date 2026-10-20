/**
 * 측정 응답 → 성능 상세의 구획. 숫자와 문장은 CLI `packages/perf/src/report.ts` 와 같은 규칙으로 만든다.
 * web 은 `@mcpeak/perf` 를 값으로 import 하지 않으므로(번들에 서버 코드가 섞인다) 규칙을 옮겨 적고,
 * `tests/performance-view.test.ts` 가 같은 입력으로 `renderReport` 의 글자와 대조한다.
 */

// 타입만. 값으로 import 하면 번들에 서버 코드가 섞인다.
import type { CallOutcome, CaseResult, PerfReport, PerfRuleId } from "@mcpeak/perf";
import { millis } from "./format.js";

/** report.ts 의 OUTCOME_ORDER 와 같다. 사유 문장의 나열 순서다. */
const OUTCOME_ORDER: readonly CallOutcome[] = [
  "ok",
  "isError",
  "empty",
  "threw",
  "skipped",
  "missingTool",
];

/** report.ts 의 `failureReason` 과 같다. ok 가 아닌 outcome 을 0 이 아닌 것만 `threw 5회` 처럼 잇는다. */
export function failureReason(outcomes: CaseResult["outcomes"]): string {
  return OUTCOME_ORDER.filter((outcome) => outcome !== "ok" && outcomes[outcome] !== 0)
    .map((outcome) => `${outcome} ${outcomes[outcome]}회`)
    .join(", ");
}

/** report.ts `remark` 의 n 이 0 인 갈래와 같다. 측정하지 않은 케이스의 사유 문장이다. */
export function unmeasuredReason(entry: CaseResult): string {
  const head = `측정 안 됨: ${failureReason(entry.outcomes)}`;
  return entry.firstError === undefined ? head : `${head}. 첫 오류: ${entry.firstError}`;
}

/** report.ts `ms` 와 같다. 값이 없으면 빈 칸이다. */
function ms(value: number | undefined): string {
  return value === undefined ? "" : String(millis(value));
}

/** 케이스 표의 칸 하나. 열 머리와 값은 report.ts 의 CASE_COLUMNS·OBSERVED_COLUMNS 와 같다. */
export interface CaseColumn {
  readonly header: string;
  readonly align: "left" | "right";
  readonly value: (entry: CaseResult) => string;
}

const CASE_COLUMNS: readonly CaseColumn[] = [
  { header: "케이스", align: "left", value: (entry) => entry.id },
  { header: "n", align: "right", value: (entry) => String(entry.n) },
  { header: "응답 p50", align: "right", value: (entry) => ms(entry.total?.p50) },
  { header: "p95", align: "right", value: (entry) => ms(entry.total?.p95) },
];

const OBSERVED_COLUMNS: readonly CaseColumn[] = [
  {
    header: "외부 대기 p50",
    align: "right",
    value: (entry) =>
      entry.external === undefined
        ? ""
        : `${entry.externalLowerBound ? "≥" : ""}${ms(entry.external.p50)}`,
  },
  { header: "서버 안 p50", align: "right", value: (entry) => ms(entry.inside?.p50) },
  { header: "외부 요청/호출", align: "right", value: (entry) => ms(entry.requests?.p50) },
];

/** 관측 안 함이면 외부·서버 안·요청 열을 뺀다(report.ts 와 같다). */
export function caseColumns(report: PerfReport): readonly CaseColumn[] {
  return report.settings.observation === "preload"
    ? [...CASE_COLUMNS, ...OBSERVED_COLUMNS]
    : CASE_COLUMNS;
}

/** 진단 규칙의 배지 글자. */
export const RULE_LABEL: Readonly<Record<PerfRuleId, string>> = {
  "perf/sequential-independent": "병렬화",
  "perf/repeated-request": "응답 재사용",
};

/** 판정 줄의 집계. 호출 실패는 performanceSummary 와 같은 기준(threw + isError)이다. */
export function performanceCounts(report: PerfReport): {
  readonly findings: number;
  readonly failedCalls: number;
  readonly unmeasured: number;
} {
  return {
    findings: report.findings.length,
    failedCalls: report.cases.reduce(
      (sum, entry) => sum + entry.outcomes.threw + entry.outcomes.isError,
      0,
    ),
    unmeasured: report.cases.filter((entry) => entry.n === 0).length,
  };
}

/** 요약 그리드의 관측 칸. */
export function observationLabel(report: PerfReport): string {
  return report.settings.observation === "preload" ? "Node 프리로드" : "관측 안 함";
}

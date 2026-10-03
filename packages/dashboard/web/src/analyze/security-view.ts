/**
 * 점검 응답 → 화면의 구획(보안 탭 계획서 §5.6). 묶음 함수는 다시 정렬하지 않고 `filter` 로만 나눈다.
 * 구획 안의 순서는 `report.findings` 의 순서, 즉 CLI 가 정한 순서다(§6).
 */

// 타입만. 값으로 import 하면 번들에 서버 코드가 섞인다.
import type { Finding, Severity } from "@mcpeak/audit";
import type {
  AnalyzeSecurityRequest,
  AnalyzeSecurityResponse,
  SecurityFindingView,
} from "../../../src/api-types.js";

export interface FindingRow {
  /** `report.findings` 안의 자리. React key 이자 순서의 근거다. */
  readonly index: number;
  readonly finding: Finding;
  readonly view: SecurityFindingView;
}

/** CLI `report.ts` 의 SEVERITY_ORDER·SEVERITY_LABEL 과 같은 값. */
export const SEVERITIES: readonly { readonly severity: Severity; readonly label: string }[] = [
  { severity: "high", label: "심각" },
  { severity: "medium", label: "주의" },
  { severity: "low", label: "낮음" },
  { severity: "info", label: "정보" },
];

/** flow 는 결함이 아니라 경고다. 한 목록에 섞지 않는다(검사 목록 보강 검토 §6). */
export function splitFindings(response: AnalyzeSecurityResponse): {
  readonly defects: readonly FindingRow[];
  readonly flows: readonly FindingRow[];
} {
  const rows = response.report.findings.map((finding, index) => ({
    index,
    finding,
    view: response.views[index] as SecurityFindingView,
  }));
  return {
    defects: rows.filter((row) => !row.finding.ruleId.startsWith("flow/")),
    flows: rows.filter((row) => row.finding.ruleId.startsWith("flow/")),
  };
}

/** 심각도 순의 구획. 빈 구획은 내지 않는다. 구획 안은 rows 의 순서 그대로다(다시 정렬하지 않는다). */
export function bySeverity(rows: readonly FindingRow[]) {
  return SEVERITIES.map(({ severity, label }) => ({
    severity,
    label,
    rows: rows.filter((row) => row.finding.severity === severity),
  })).filter((group) => group.rows.length > 0);
}

/** 도구 순의 구획. toolIndex 오름차순이고 -1(도구에 걸리지 않은 것)이 맨 앞이다. 구획 안은 rows 의 순서 그대로다. */
export function byTool(rows: readonly FindingRow[]) {
  const keys = [...new Set(rows.map((row) => row.view.toolIndex))].sort((a, b) => a - b);
  return keys.map((toolIndex) => {
    const group = rows.filter((row) => row.view.toolIndex === toolIndex);
    return {
      toolIndex,
      title:
        toolIndex === -1
          ? "서버 전체 (실행 명령·프로토콜·도구 표면)"
          : `도구 '${group[0]?.view.tool ?? ""}'`,
      rows: group,
    };
  });
}

/** 기준 파일 상태 한 줄. 경로를 보내지 않았으면 null 이다(그때는 "검사하지 않은 것" 구획이 이유를 말한다). */
export function baselineStatus(
  request: AnalyzeSecurityRequest,
  response: AnalyzeSecurityResponse,
): string | null {
  const path = request.baselinePath;
  if (path === undefined) return null;
  const ids = response.report.findings.map((finding) => finding.ruleId);
  if (ids.includes("surface/baseline-created")) return `기준 파일을 새로 썼습니다: ${path}`;
  const changed = ids.filter((id) => id === "surface/changed").length;
  return changed === 0
    ? `기준 파일과 같습니다: ${path}`
    : `기준 파일과 다릅니다: ${path} (변경 ${changed}건)`;
}

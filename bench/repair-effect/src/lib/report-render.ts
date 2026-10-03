import { aggregate, type Condition, type RunRecord } from "./aggregate.ts";
import { FAULTS, type FaultId } from "./faults.ts";
import type { RepairVerdict } from "./judge.ts";

export interface DetectionEntry {
  readonly detected: boolean;
  readonly evidence: string | null;
  readonly bundleFailures: number;
}

export interface ReportInput {
  readonly records: readonly RunRecord[];
  readonly detection: Readonly<Record<FaultId, DetectionEntry>>;
  readonly baselinePassingCount: number;
  /** 설계 문서 8절 다섯 항목을 그대로 옮긴 것. report.ts 가 하드코딩해 넘긴다. */
  readonly premises: readonly string[];
  readonly fixed: {
    readonly conformanceCommit: string;
    readonly conformanceVersion: string;
    readonly sdkVersion: string;
    readonly model: string;
  };
}

const VERDICTS: readonly RepairVerdict[] = ["success", "targetStillFailing", "regressed", "serverDown"];
const CONDITIONS: readonly Condition[] = ["defect", "plain", "diagnosed"];
const CONDITION_LABEL: Record<Condition, string> = { defect: "①", plain: "②", diagnosed: "③" };

function cell(
  rows: ReturnType<typeof aggregate>["rows"],
  faultId: FaultId,
  condition: Condition,
  s: number,
): string {
  const row = rows.find((r) => r.faultId === faultId && r.condition === condition);
  if (!row) return "데이터 없음";
  return `${row.successes}/${row.runs} (${row.meanPassCount.toFixed(1)}/${s})`;
}

function renderVariantTable(input: ReportInput): string {
  const { rows } = aggregate(input.records);
  const s = input.baselinePassingCount;
  const header = "| 변형 | ① 결함(수리 전) | ② 단순 수리 | ③ 진단 수리 |\n|---|---|---|---|";
  const lines = FAULTS.map((fault) => {
    return `| ${fault.id} | ${cell(rows, fault.id, "defect", s)} | ${cell(rows, fault.id, "plain", s)} | ${cell(rows, fault.id, "diagnosed", s)} |`;
  });
  return [header, ...lines].join("\n");
}

function renderControlTable(input: ReportInput): string {
  const { rows } = aggregate(input.records);
  const s = input.baselinePassingCount;
  const header = "| 대조 결함 | ② 단순 수리 | ③ 진단 수리 |\n|---|---|---|";
  const lines = (["C1", "C2"] as const).map((faultId) => {
    const plainRow = rows.find((r) => r.faultId === faultId && r.condition === "plain");
    const diagnosedRow = rows.find((r) => r.faultId === faultId && r.condition === "diagnosed");
    const plainCell = plainRow ? `${plainRow.successes}/${plainRow.runs}` : "데이터 없음";
    const diagnosedCell = diagnosedRow ? `${diagnosedRow.successes}/${diagnosedRow.runs}` : "데이터 없음";
    return `| ${faultId} | ${plainCell} | ${diagnosedCell} |`;
  });
  void s;
  return [header, ...lines].join("\n");
}

function renderVerdictTable(records: readonly RunRecord[]): string {
  const header = `| 조건 | ${VERDICTS.join(" | ")} |\n|---|${VERDICTS.map(() => "---").join("|")}|`;
  const lines = CONDITIONS.map((condition) => {
    const group = records.filter((r) => r.condition === condition);
    const counts = VERDICTS.map((verdict) => group.filter((r) => r.verdict === verdict).length);
    return `| ${CONDITION_LABEL[condition]} ${condition} | ${counts.join(" | ")} |`;
  });
  return [header, ...lines].join("\n");
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function renderCostTable(records: readonly RunRecord[]): string {
  const header = "| 조건 | 평균 입력 토큰 | 평균 출력 토큰 | 평균 소요 시간 |\n|---|---|---|---|";
  const lines = (["plain", "diagnosed"] as const).map((condition) => {
    const group = records.filter((r) => r.condition === condition);
    const inputTokens = mean(group.map((r) => r.inputTokens).filter((v): v is number => v !== null));
    const outputTokens = mean(group.map((r) => r.outputTokens).filter((v): v is number => v !== null));
    const durationMs = mean(group.map((r) => r.durationMs).filter((v): v is number => v !== null));
    const inputCell = inputTokens === null ? "데이터 없음" : inputTokens.toFixed(1);
    const outputCell = outputTokens === null ? "데이터 없음" : outputTokens.toFixed(1);
    const durationCell = durationMs === null ? "데이터 없음" : `${(durationMs / 1000).toFixed(1)}초`;
    return `| ${CONDITION_LABEL[condition]} ${condition} | ${inputCell} | ${outputCell} | ${durationCell} |`;
  });
  return [header, ...lines].join("\n");
}

function toolFaultIds(): readonly FaultId[] {
  return FAULTS.filter((f) => f.area === "tool").map((f) => f.id);
}

export function renderReport(input: ReportInput): string {
  const { rows: _rows, tool } = aggregate(input.records);
  const toolIds = toolFaultIds();
  const detectedCount = toolIds.filter((id) => input.detection[id]?.detected).length;

  const overloadedIds = (Object.keys(input.detection) as FaultId[])
    .filter((id) => (input.detection[id]?.bundleFailures ?? 0) >= 10)
    .sort();

  const sections: string[] = [];

  sections.push(
    [
      "## 1. 헤드라인",
      "",
      `도구 결함 수리 성공: 단순 수리 ${tool.plain.successes}/${tool.plain.runs} → 진단 수리 ${tool.diagnosed.successes}/${tool.diagnosed.runs}`,
    ].join("\n"),
  );

  sections.push(
    [
      "## 2. 탐지율",
      "",
      `처음 보는 결함 서버에서 도구 결함 ${toolIds.length}개 중 ${detectedCount}개 탐지`,
      "",
      ...toolIds.map((id) => {
        const entry = input.detection[id];
        if (!entry) return `- ${id}: 탐지 결과 없음`;
        const mark = entry.detected ? "탐지" : "미탐지";
        const evidence = entry.evidence ? ` (근거: "${entry.evidence}")` : "";
        return `- ${id}: ${mark}${evidence}`;
      }),
    ].join("\n"),
  );

  sections.push(["## 3. 변형별 표", "", renderVariantTable(input)].join("\n"));

  sections.push(
    [
      "## 4. 대조 결함",
      "",
      renderControlTable(input),
      "",
      "대조 결함은 mcpeak 이 볼 수 없는 영역이라 ②와 ③의 차이가 없어야 정상이다",
    ].join("\n"),
  );

  sections.push(["## 5. 판정 분포", "", renderVerdictTable(input.records)].join("\n"));

  sections.push(["## 6. 비용", "", renderCostTable(input.records)].join("\n"));

  const premiseLines = input.premises.map((p) => `- ${p}`);
  const limitLines = [...premiseLines];
  if (overloadedIds.length > 0) {
    limitLines.push(
      `- 파일럿에서 번들 실패가 10건 이상인 변형이 있었다(${overloadedIds.join(", ")}). 진단 상한 10건에 걸려 일부 실패가 진단에서 빠졌을 수 있다.`,
    );
  }
  sections.push(["## 7. 전제와 한계", "", ...limitLines].join("\n"));

  sections.push(
    [
      "## 8. 재현 방법",
      "",
      "```bash",
      "pnpm baseline",
      "pnpm verify-variants",
      "pnpm pilot",
      "pnpm repair-runs",
      "pnpm score",
      "pnpm report",
      "```",
      "",
      `conformance 커밋: ${input.fixed.conformanceCommit}`,
      `conformance 버전: ${input.fixed.conformanceVersion}`,
      `@modelcontextprotocol/sdk 버전: ${input.fixed.sdkVersion}`,
      `수리 모델: ${input.fixed.model}`,
    ].join("\n"),
  );

  return `${sections.join("\n\n")}\n`;
}

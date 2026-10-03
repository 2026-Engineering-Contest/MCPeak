/**
 * 결과 맨 위 "먼저 할 일" 의 줄들(계획서 §5.4). 문장은 발견의 `fix` 그대로다. 대시보드가 결론 문장을
 * 만들지 않는다(ADR-0110, ADR-0111). 심각을 먼저, 그다음 주의. 각 안에서는 `report.findings` 의 순서다.
 * 같은 심각도의 같은 문장은 한 줄로 접고 건수를 센다. flow 는 결함이 아니라서 뺀다.
 */

// 타입만. 값으로 import 하면 번들에 서버 코드가 섞인다.
import type { Finding } from "@mcpeak/audit";

export interface FixLine {
  readonly severity: "high" | "medium";
  readonly fix: string;
  readonly count: number;
}

export function fixSummary(findings: readonly Finding[]): readonly FixLine[] {
  const lines: { severity: "high" | "medium"; fix: string; count: number }[] = [];
  for (const severity of ["high", "medium"] as const) {
    for (const finding of findings) {
      if (finding.severity !== severity || finding.ruleId.startsWith("flow/")) continue;
      const existing = lines.find((line) => line.severity === severity && line.fix === finding.fix);
      if (existing === undefined) lines.push({ severity, fix: finding.fix, count: 1 });
      else existing.count += 1;
    }
  }
  return lines;
}

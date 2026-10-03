import type { Finding, Severity } from "@mcpeak/audit";
import { describe, expect, it } from "vitest";
import { fixSummary } from "../src/precheck/fix-summary.js";

/** 손으로 만든 발견. 요약이 읽는 것은 `ruleId`, `severity`, `fix` 셋이다. */
function finding(
  severity: Severity,
  fix: string,
  ruleId: Finding["ruleId"] = "desc/hidden-unicode",
): Finding {
  return {
    ruleId,
    severity,
    location: { kind: "server", path: "" },
    message: "메시지",
    fix,
    evidence: [],
  };
}

describe("fixSummary", () => {
  it("심각을 먼저, 그다음 주의를 낸다", () => {
    expect(fixSummary([finding("medium", "주의 문장"), finding("high", "심각 문장")])).toEqual([
      { severity: "high", fix: "심각 문장", count: 1 },
      { severity: "medium", fix: "주의 문장", count: 1 },
    ]);
  });

  it("같은 심각도의 같은 문장은 한 줄로 접고 건수를 센다", () => {
    expect(
      fixSummary([
        finding("high", "같은 문장"),
        finding("high", "같은 문장"),
        finding("high", "같은 문장"),
      ]),
    ).toEqual([{ severity: "high", fix: "같은 문장", count: 3 }]);
  });

  it("심각도가 다르면 같은 문장도 따로 낸다", () => {
    expect(fixSummary([finding("high", "같은 문장"), finding("medium", "같은 문장")])).toEqual([
      { severity: "high", fix: "같은 문장", count: 1 },
      { severity: "medium", fix: "같은 문장", count: 1 },
    ]);
  });

  it("낮음과 정보는 내지 않는다", () => {
    expect(fixSummary([finding("low", "낮음 문장"), finding("info", "정보 문장")])).toEqual([]);
  });

  it("flow 발견은 내지 않는다", () => {
    expect(fixSummary([finding("high", "권한을 나누세요.", "flow/toxic-combination")])).toEqual([]);
  });

  it("각 심각도 안에서는 발견 순서다", () => {
    expect(fixSummary([finding("high", "A"), finding("high", "B")])).toEqual([
      { severity: "high", fix: "A", count: 1 },
      { severity: "high", fix: "B", count: 1 },
    ]);
  });

  it("입력을 바꾸지 않는다", () => {
    const findings = Object.freeze([
      Object.freeze(finding("high", "A")),
      Object.freeze(finding("high", "A")),
    ]);

    expect(() => fixSummary(findings)).not.toThrow();
    expect(findings).toHaveLength(2);
  });

  it("같은 입력은 같은 결과다", () => {
    const findings = [finding("medium", "B"), finding("high", "A"), finding("high", "A")];

    expect(JSON.stringify(fixSummary(findings))).toBe(JSON.stringify(fixSummary(findings)));
  });
});

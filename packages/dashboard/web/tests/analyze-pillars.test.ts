// @vitest-environment node
import type { AuditReport, Finding } from "@mcpeak/audit";
import { describe, expect, it } from "vitest";
import type {
  AnalyzeSecurityRequest,
  AnalyzeSecurityResponse,
  AnalyzeTokensResponse,
} from "../../src/api-types.js";
import { firstLine } from "../src/analyze/pillar-state.js";
import { PILLARS, securitySummary, tokensSummary } from "../src/analyze/pillars.js";
import { analyzeResponse } from "./analyze-fixture-data.js";

function finding(ruleId: string): Finding {
  // severity·location·message 는 요약 함수가 읽지 않는다. 형식만 맞춘다.
  return {
    ruleId,
    severity: "high",
    location: { kind: "tool", toolIndex: 0, toolName: "a", path: "name" },
    message: ruleId,
    evidence: [],
    fix: "",
  } as Finding;
}
const HIGH_ONLY = finding("desc/hidden-unicode");
const LOW_A = finding("result/oversized");
const LOW_B = finding("result/oversized");
const CHANGED = finding("surface/changed");
const FLOW = finding("flow/toxic-combination");

/** 요약 함수가 읽는 report 필드만 바꾼다. 나머지는 고정이다. */
function securityResponse(
  overrides: {
    readonly counts?: AuditReport["counts"];
    readonly exitCode?: number;
    readonly findings?: readonly Finding[];
    readonly probedTools?: readonly string[];
  } = {},
): AnalyzeSecurityResponse {
  const findings = overrides.findings ?? [HIGH_ONLY];
  const counts = overrides.counts ?? { high: 1, medium: 0, low: 0, info: 0 };
  const exitCode = overrides.exitCode ?? 2;
  const report = {
    schemaVersion: 1,
    generator: { name: "@mcpeak/audit", version: "0.0.0" },
    server: {
      name: "sample",
      version: "1.0.0",
      toolCount: 2,
      promptCount: 0,
      resourceCount: 0,
      hasInstructions: false,
      capabilityKeys: ["tools"],
    },
    probe: "readonly",
    probedTools: overrides.probedTools ?? ["add"],
    findings,
    skipped: [],
    counts,
    exitCode,
  } as AuditReport;
  return {
    report,
    reportText: "",
    rendered: "",
    views: findings.map(() => ({ where: "서버", tool: null, toolIndex: -1 })),
    sandboxLine: null,
    limits: [],
    exitCode,
    cleanupError: "",
  } as AnalyzeSecurityResponse;
}

interface ToolBytes {
  readonly name: string;
  readonly before: number;
  readonly after: number;
}

/** `{ name, before, after }` 를 overlay 도구 모양으로. 나머지 필드는 첫 도구의 것을 복사한다. */
function withTools(
  response: AnalyzeTokensResponse,
  tools: readonly ToolBytes[],
): AnalyzeTokensResponse {
  const first = response.overlay.tools[0];
  if (first === undefined) throw new Error("analyzeResponse 의 도구가 비었다");
  return {
    ...response,
    overlay: {
      ...response.overlay,
      tools: tools.map(({ name, before, after }) => ({
        ...first,
        name,
        bytes: { before, after },
      })),
    },
  };
}

/** totals 를 바꾼다. `bytesAfter` 는 `bytesAfterWithInstructions` 와 같은 값으로 둔다. */
function withTotals(
  response: AnalyzeTokensResponse,
  totals: { readonly bytesBefore: number; readonly bytesAfterWithInstructions: number },
  tools?: readonly ToolBytes[],
): AnalyzeTokensResponse {
  const base = tools === undefined ? response : withTools(response, tools);
  return {
    ...base,
    overlay: {
      ...base.overlay,
      totals: {
        ...base.overlay.totals,
        bytesBefore: totals.bytesBefore,
        bytesAfter: totals.bytesAfterWithInstructions,
        bytesAfterWithInstructions: totals.bytesAfterWithInstructions,
      },
    },
  };
}

describe("securitySummary", () => {
  const request: AnalyzeSecurityRequest = { argv: ["--command", "node"] };

  it("exitCode 2 면 조치 필요 failed 다", () => {
    const s = securitySummary(
      request,
      securityResponse({
        counts: { high: 1, medium: 0, low: 0, info: 0 },
        exitCode: 2,
        findings: [HIGH_ONLY],
      }),
    );
    expect(s.verdict).toEqual({ label: "조치 필요", tone: "failed" });
    expect(s.headline).toBe("1");
    expect(s.headlineNote).toBe("건 발견 · 도구 2개 점검");
  });

  it("exitCode 1 이어도 심각·주의가 있으면 조치 필요다", () => {
    const s = securitySummary(
      request,
      securityResponse({ counts: { high: 1, medium: 1, low: 0, info: 0 }, exitCode: 1 }),
    );
    expect(s.verdict).toEqual({ label: "조치 필요", tone: "failed" });
  });

  it("exitCode 0 이고 낮음만 있으면 낮음·정보만 running 이다", () => {
    const s = securitySummary(
      request,
      securityResponse({
        counts: { high: 0, medium: 0, low: 2, info: 0 },
        exitCode: 0,
        findings: [LOW_A, LOW_B],
      }),
    );
    expect(s.verdict).toEqual({ label: "낮음·정보만", tone: "running" });
  });

  it("발견 0 이면 발견 없음 done 이고 막대가 비고 칩은 다섯 개가 0 이다", () => {
    const s = securitySummary(
      request,
      securityResponse({
        counts: { high: 0, medium: 0, low: 0, info: 0 },
        exitCode: 0,
        findings: [],
      }),
    );
    expect(s.verdict).toEqual({ label: "발견 없음", tone: "done" });
    expect(s.bar).toEqual([]);
    expect(s.chips.map((c) => c.count)).toEqual([0, 0, 0, 0, 0]);
    expect(s.chips.map((c) => c.label)).toEqual(["심각", "주의", "낮음", "정보", "흐름 경고"]);
  });

  it("흐름 경고는 결함 수에 들지 않고 칩에만 세며 판정은 흐름 경고만 이다", () => {
    const s = securitySummary(
      request,
      securityResponse({
        counts: { high: 0, medium: 0, low: 0, info: 0 },
        exitCode: 0,
        findings: [FLOW],
      }),
    );
    expect(s.headline).toBe("0");
    expect(s.chips[4]).toEqual({ label: "흐름 경고", count: 1, tone: "waiting" });
    expect(s.verdict).toEqual({ label: "흐름 경고만", tone: "waiting" });
  });

  it("막대 비율은 심각도 수 / 결함 수 이고 0 인 칸은 없다", () => {
    const s = securitySummary(
      request,
      securityResponse({ counts: { high: 1, medium: 3, low: 0, info: 0 }, exitCode: 2 }),
    );
    expect(s.bar.map((b) => b.ratio)).toEqual([0.25, 0.75]);
    expect(s.bar.map((b) => b.label)).toEqual(["심각", "주의"]);
    expect(s.bar.map((b) => b.tone)).toEqual(["failed", "waiting"]);
  });

  it("기준 파일을 보냈으면 요약 줄이 baselineStatus 문장이다", () => {
    const s = securitySummary(
      { argv: [], baselinePath: "b.json" },
      securityResponse({ findings: [CHANGED, CHANGED] }),
    );
    expect(s.foot).toBe("기준 파일과 다릅니다: b.json (변경 2건)");
  });

  it("기준 파일이 없으면 요약 줄이 호출 수와 정책이다", () => {
    const s = securitySummary(request, securityResponse({ probedTools: ["a", "b"] }));
    expect(s.foot).toBe("도구 2개 호출 (probe readonly)");
  });

  it("같은 응답이면 같은 요약이다", () => {
    const response = securityResponse();
    expect(JSON.stringify(securitySummary(request, response))).toBe(
      JSON.stringify(securitySummary(request, response)),
    );
  });
});

describe("tokensSummary", () => {
  it("감소가 있으면 백분율 판정이고 큰 숫자에 빼기 기호가 붙는다", () => {
    const s = tokensSummary(analyzeResponse()); // before 1000, after 760
    expect(s.verdict).toEqual({ label: "24.0% 줄일 수 있음", tone: "waiting" });
    expect(s.headline).toBe("−24.0%");
    expect(s.headlineNote).toBe("~250 → ~190 토큰");
    expect(s.chips).toEqual([
      { label: "도구", count: 2, tone: "info" },
      { label: "공통 파라미터 승격", count: 2, tone: "info" },
    ]);
  });

  it("감소가 0 이면 줄일 것 없음 done 이고 큰 숫자가 0% 다", () => {
    const s = tokensSummary(
      withTotals(analyzeResponse(), { bytesBefore: 1000, bytesAfterWithInstructions: 1000 }, [
        { name: "a", before: 600, after: 600 },
      ]),
    );
    expect(s.verdict).toEqual({ label: "줄일 것 없음", tone: "done" });
    expect(s.headline).toBe("0%");
    expect(s.foot).toBe("줄어든 도구 없음");
  });

  it("요약 줄은 감소 바이트 1위 도구이고 같으면 원본 순서다", () => {
    const s = tokensSummary(
      withTools(analyzeResponse(), [
        { name: "a", before: 100, after: 50 },
        { name: "b", before: 100, after: 50 },
        { name: "c", before: 100, after: 90 },
      ]),
    );
    expect(s.foot).toBe("가장 큰 감소: a −50.0%");
  });

  it("기본 픽스처의 1위는 a 이고 백분율은 그 도구 기준이다", () => {
    expect(tokensSummary(analyzeResponse()).foot).toBe("가장 큰 감소: a −33.3%"); // 600→400
  });

  it("막대는 압축 칸 하나이고 비율은 after/before 다", () => {
    const s = tokensSummary(
      withTotals(analyzeResponse(), { bytesBefore: 200, bytesAfterWithInstructions: 50 }),
    );
    expect(s.bar).toEqual([{ ratio: 0.25, tone: "accent", label: "압축" }]);
  });

  it("before 가 0 이면 막대가 비고 줄일 것 없음이다", () => {
    const s = tokensSummary(
      withTotals(analyzeResponse(), { bytesBefore: 0, bytesAfterWithInstructions: 0 }),
    );
    expect(s.bar).toEqual([]);
    expect(s.verdict.label).toBe("줄일 것 없음");
  });

  it("같은 응답이면 같은 요약이다", () => {
    const response = analyzeResponse();
    expect(JSON.stringify(tokensSummary(response))).toBe(JSON.stringify(tokensSummary(response)));
  });
});

describe("firstLine", () => {
  it("첫 줄만 돌려주고 CR 은 지운다", () => {
    expect(firstLine("첫 줄\r\n둘째 줄")).toBe("첫 줄");
    expect(firstLine("한 줄")).toBe("한 줄");
    expect(firstLine("")).toBe("");
  });
});

describe("PILLARS", () => {
  it("순서가 보안, 비용 최적화, 성능 효율성이고 성능만 비활성이다", () => {
    expect(PILLARS.map((p) => p.id)).toEqual(["security", "tokens", "performance"]);
    expect(PILLARS.map((p) => p.available)).toEqual([true, true, false]);
    expect(PILLARS.map((p) => p.name)).toEqual(["보안", "비용 최적화", "성능 효율성"]);
  });
});

// @vitest-environment node
import type { AuditReport, Finding } from "@mcpeak/audit";
import type { CallOutcome, CaseResult, PerfFinding, PerfReport } from "@mcpeak/perf";
import { describe, expect, it } from "vitest";
import type {
  AnalyzePerfResponse,
  AnalyzeSecurityRequest,
  AnalyzeSecurityResponse,
  AnalyzeTokensResponse,
  PassedRule,
} from "../../src/api-types.js";
import { firstLine } from "../src/analyze/pillar-state.js";
import {
  PILLARS,
  performanceSummary,
  securitySummary,
  tokensSummary,
} from "../src/analyze/pillars.js";
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
    readonly passedRules?: readonly PassedRule[];
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
    sandboxFallbackReason: null,
    limits: [],
    exitCode,
    cleanupError: "",
    passedRules: overrides.passedRules ?? [],
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

  it("exitCode 0 이고 낮음만 있으면 조치 불필요(참고 N건) running 이고 N 은 낮음 + 정보다", () => {
    const s = securitySummary(
      request,
      securityResponse({
        counts: { high: 0, medium: 0, low: 2, info: 0 },
        exitCode: 0,
        findings: [LOW_A, LOW_B],
      }),
    );
    expect(s.verdict).toEqual({ label: "조치 불필요(참고 2건)", tone: "running" });
    const mixed = securitySummary(
      request,
      securityResponse({ counts: { high: 0, medium: 0, low: 1, info: 2 }, exitCode: 0 }),
    );
    expect(mixed.verdict.label).toBe("조치 불필요(참고 3건)");
  });

  it("발견 0 이면 발견 없음 done 이고 막대가 비고 칩은 여섯 개가 0 이다", () => {
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
    expect(s.chips.map((c) => c.count)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(s.chips.map((c) => c.label)).toEqual([
      "심각",
      "주의",
      "낮음",
      "정보",
      "흐름 경고",
      "안전",
    ]);
  });

  it("안전 칩은 다섯 칩 뒤에 오고 passedRules 수를 done 톤으로 센다", () => {
    const passedRules: readonly PassedRule[] = [
      { id: "desc/injection", family: "desc", summary: "a" },
      { id: "result/oversized", family: "result", summary: "b" },
    ];
    const s = securitySummary(request, securityResponse({ passedRules }));
    expect(s.chips).toHaveLength(6);
    expect(s.chips[5]).toEqual({ label: "안전", count: 2, tone: "done" });
    // 판정은 counts·exitCode 만 본다. 안전 칩은 판정을 바꾸지 않는다.
    expect(s.verdict).toEqual({ label: "조치 필요", tone: "failed" });
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

  it("기준 파일을 보냈으면 요약 줄이 실행 방식 뒤에 baselineStatus 문장이다", () => {
    const s = securitySummary(
      { argv: [], baselinePath: "b.json" },
      securityResponse({ findings: [CHANGED, CHANGED] }),
    );
    expect(s.foot).toBe(
      "로컬 실행(readonly): 격리할 수 없는 대상입니다 · 기준 파일과 다릅니다: b.json (변경 2건)",
    );
  });

  it("기준 파일이 없으면 요약 줄이 실행 방식 뒤에 호출 수와 정책이다", () => {
    const s = securitySummary(request, securityResponse({ probedTools: ["a", "b"] }));
    expect(s.foot).toBe(
      "로컬 실행(readonly): 격리할 수 없는 대상입니다 · 도구 2개 호출 (probe readonly)",
    );
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
  it("순서가 보안, 비용 최적화, 성능 효율성이고 세 축 모두 활성이다", () => {
    expect(PILLARS.map((p) => p.id)).toEqual(["security", "tokens", "performance"]);
    expect(PILLARS.map((p) => p.available)).toEqual([true, true, true]);
    expect(PILLARS.map((p) => p.name)).toEqual(["보안", "비용 최적화", "성능 효율성"]);
  });
});

function perfCase(
  id: string,
  tool: string,
  p50: number | undefined,
  outcomes: Partial<Record<CallOutcome, number>> = {},
): CaseResult {
  return {
    id,
    tool,
    n: p50 === undefined ? 0 : 5,
    outcomes: { ok: 5, isError: 0, empty: 0, threw: 0, skipped: 0, missingTool: 0, ...outcomes },
    ...(p50 === undefined ? {} : { total: { p50, p95: p50, min: p50, max: p50 } }),
    dependency: { dependent: 0, independent: 0, unknown: 0 },
    requestSummaries: [],
  };
}

function sequential(tool: string, saving: number): PerfFinding {
  return {
    ruleId: "perf/sequential-independent",
    caseIds: [tool],
    tools: [tool],
    lines: [],
    evidence: { observed: 5, of: 5, requests: [], savingUpperBoundMs: saving },
  };
}

const REPEATED: PerfFinding = {
  ruleId: "perf/repeated-request",
  caseIds: ["a"],
  tools: ["get_forecast"],
  lines: [],
  evidence: { observed: 5, of: 5, requests: [] },
};

function perfResponse(overrides: Partial<PerfReport> = {}): AnalyzePerfResponse {
  const report: PerfReport = {
    schemaVersion: 1,
    generator: { name: "@mcpeak/perf", version: "0.0.0" },
    server: { command: "node s.mjs", toolCount: 6 },
    settings: { repeat: 5, intervalMs: 0, caseCount: 3, observation: "preload" },
    coldStart: { connectMs: 80, listToolsMs: 3 },
    cases: [
      perfCase("a", "get_forecast", 412.4),
      perfCase("b", "compare_cities", 600.6),
      perfCase("c", "lookup_country", undefined),
    ],
    findings: [sequential("compare_cities", 299.5), sequential("get_forecast", 120.4), REPEATED],
    undecidedCases: 0,
    aborted: null,
    exitCode: 0,
    ...overrides,
  };
  return { report, rendered: "", exitCode: report.exitCode };
}

const BASELINE = { path: "b.json", settingsMismatch: false, lines: [], regressedCaseIds: ["a"] };

describe("performanceSummary", () => {
  // current = round(412.4) + round(600.6) = 412 + 601 = 1013
  // saving = round(299.5) + round(120.4) = 300 + 120 = 420, after = 593
  it("performanceSummary 는 병렬화 단축 합계를 헤드라인에 둔다", () => {
    const summary = performanceSummary(perfResponse());
    expect(summary.headline).toBe("−420 ms");
    expect(summary.headlineNote).toBe("~1013 → ~593 ms");
    expect(summary.baseLabel).toBe("현재");
    expect(summary.bar).toEqual([{ ratio: 593 / 1013, tone: "accent", label: "개선 후" }]);
    expect(summary.chips).toEqual([
      { label: "도구", count: 6, tone: "info" },
      { label: "진단", count: 3, tone: "info" },
    ]);
    expect(summary.foot).toBe("가장 큰 단축: compare_cities −300ms");
    expect(summary.verdict).toEqual({ label: "진단 3건", tone: "waiting" });
  });

  it("performanceSummary 는 단축이 없으면 0 ms 와 줄일 곳 없음", () => {
    const summary = performanceSummary(perfResponse({ findings: [] }));
    expect(summary.headline).toBe("0 ms");
    expect(summary.headlineNote).toBe("~1013 → ~1013 ms");
    expect(summary.bar).toEqual([{ ratio: 1, tone: "accent", label: "개선 후" }]);
    expect(summary.foot).toBe("병렬화로 줄일 곳 없음");
    expect(summary.verdict).toEqual({ label: "진단 0건(기준선 없음)", tone: "done" });
  });

  it("performanceSummary 는 반복 진단만 있으면 진단 수만 센다", () => {
    const summary = performanceSummary(perfResponse({ findings: [REPEATED] }));
    expect(summary.headline).toBe("0 ms");
    expect(summary.verdict.label).toBe("진단 1건");
  });

  it("performanceSummary 는 관측 안 함을 가장 먼저 본다", () => {
    const summary = performanceSummary(
      perfResponse({
        settings: { repeat: 5, intervalMs: 0, caseCount: 3, observation: "none" },
        findings: [],
        aborted: { caseId: "a", timeoutMs: 10000 },
      }),
    );
    expect(summary.verdict).toEqual({ label: "관측 안 함", tone: "info" });
  });

  it("performanceSummary 는 측정 중단을 호출 실패보다 먼저 본다", () => {
    const summary = performanceSummary(
      perfResponse({
        aborted: { caseId: "a", timeoutMs: 10000 },
        cases: [
          perfCase("a", "get_forecast", 412.4, { threw: 1 }),
          perfCase("b", "compare_cities", 600.6),
          perfCase("c", "lookup_country", undefined),
        ],
      }),
    );
    expect(summary.verdict).toEqual({ label: "측정 중단", tone: "failed" });
  });

  it("performanceSummary 는 threw 와 isError 를 호출 실패로 센다", () => {
    const summary = performanceSummary(
      perfResponse({
        cases: [
          perfCase("a", "get_forecast", 412.4, { threw: 1 }),
          perfCase("b", "compare_cities", 600.6, { isError: 2 }),
          perfCase("c", "lookup_country", undefined),
        ],
      }),
    );
    expect(summary.verdict.label).toBe("호출 실패 3건");
  });

  it("performanceSummary 는 기준선이 있을 때만 회귀를 낸다", () => {
    expect(
      performanceSummary(perfResponse({ baseline: BASELINE, exitCode: 2 })).verdict.label,
    ).toBe("회귀");
    expect(
      performanceSummary(perfResponse({ baseline: BASELINE, exitCode: 0, findings: [] })).verdict
        .label,
    ).toBe("진단 0건");
    // 기준선 없이 exitCode 2 는 있을 수 없는 조합이다. 회귀로 읽지 않는다.
    expect(performanceSummary(perfResponse({ exitCode: 2, findings: [] })).verdict.label).toBe(
      "진단 0건(기준선 없음)",
    );
  });

  it("performanceSummary 는 단축이 같으면 리포트 순서가 앞인 도구를 고른다", () => {
    const summary = performanceSummary(
      perfResponse({ findings: [sequential("b_tool", 300), sequential("a_tool", 300)] }),
    );
    expect(summary.foot).toBe("가장 큰 단축: b_tool −300ms");
  });

  it("performanceSummary 는 측정한 케이스가 없으면 막대를 비운다", () => {
    const summary = performanceSummary(
      perfResponse({ cases: [perfCase("c", "lookup_country", undefined)], findings: [] }),
    );
    expect(summary.bar).toEqual([]);
    expect(summary.headlineNote).toBe("~0 → ~0 ms");
  });

  it("performanceSummary 는 같은 응답이면 같은 요약이다", () => {
    expect(JSON.stringify(performanceSummary(perfResponse()))).toBe(
      JSON.stringify(performanceSummary(perfResponse())),
    );
  });
});

describe("PILLARS 성능 축", () => {
  it("PILLARS 의 성능 축은 처리량을 말하지 않는다", () => {
    const description = PILLARS.find((pillar) => pillar.id === "performance")?.description;
    expect(description).toBe(
      "도구 호출의 응답 시간을 외부 대기와 서버 안 시간으로 나누고, 병렬화·재사용으로 줄일 지점을 찾습니다.",
    );
    expect(description).not.toContain("처리량");
  });
});

import type { AuditReport, Finding } from "@mcpeak/audit";
import { describe, expect, it } from "vitest";
import type { AnalyzeSecurityResponse, SecurityFindingView } from "../../src/api-types.js";
import { baselineStatus, bySeverity, byTool, splitFindings } from "../src/analyze/security-view.js";

/** 숨은 문자가 든 도구 이름. 파일에는 이스케이프로만 적는다. */
const HIDDEN_NAME = "get" + "\u200B" + "time";
/** 서버가 `escapeInvisible` 로 만든 표시용 글자. 웹은 이 글자를 만들지 않고 받기만 한다. */
const SHOWN_NAME = "get<U+200B>time";

/**
 * 서버 테스트(§7.3)의 SAMPLE 과 같은 발견 셋에 high 하나, info 하나를 더한 다섯 건.
 * 순서는 일부러 심각도·도구 순이 아니다. 묶음 함수가 다시 정렬하지 않는다는 것을 본다.
 */
const FINDINGS: readonly Finding[] = [
  {
    ruleId: "desc/hidden-unicode",
    severity: "high",
    location: { kind: "tool", toolIndex: 1, toolName: HIDDEN_NAME, path: "name" },
    message: "보이지 않는 문자가 들어 있습니다.",
    fix: "보이지 않는 문자를 지우세요.",
    evidence: ["U+200B"],
  },
  {
    ruleId: "protocol/plaintext",
    severity: "medium",
    location: { kind: "protocol", path: "" },
    message: "평문 HTTP 로 붙었습니다.",
    fix: "https 를 쓰세요.",
    evidence: [],
  },
  {
    ruleId: "schema/loose-object",
    severity: "info",
    location: { kind: "tool", toolIndex: 0, toolName: "add", path: "inputSchema" },
    message: "스키마가 느슨합니다.",
    fix: "additionalProperties 를 닫으세요.",
    evidence: [],
  },
  {
    ruleId: "launch/shell-wrapper",
    severity: "high",
    location: { kind: "launch", path: "command" },
    message: "셸을 거쳐 실행합니다.",
    fix: "실행 파일을 직접 부르세요.",
    evidence: ["sh -c"],
  },
  {
    ruleId: "flow/toxic-combination",
    severity: "info",
    location: { kind: "server", path: "" },
    message: "읽기와 보내기 도구가 함께 있습니다.",
    fix: "권한을 나누세요.",
    evidence: ["add", "send"],
  },
];

const VIEWS: readonly SecurityFindingView[] = [
  { where: `도구 '${SHOWN_NAME}' 의 name`, tool: SHOWN_NAME, toolIndex: 1 },
  { where: "프로토콜", tool: null, toolIndex: -1 },
  { where: "도구 'add' 의 inputSchema", tool: "add", toolIndex: 0 },
  { where: "실행 명령", tool: null, toolIndex: -1 },
  { where: "서버", tool: null, toolIndex: -1 },
];

function sample(
  findings: readonly Finding[] = FINDINGS,
  views: readonly SecurityFindingView[] = VIEWS,
): AnalyzeSecurityResponse {
  const report: AuditReport = {
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
    probedTools: [],
    findings,
    skipped: [
      {
        family: "surface",
        reason: "--baseline 을 주지 않아 도구 표면 변경을 비교하지 않았습니다.",
      },
    ],
    counts: { high: 2, medium: 1, low: 0, info: 1 },
    exitCode: 2,
  };
  return {
    report,
    reportText: `${JSON.stringify(report, null, 2)}\n`,
    rendered: "RENDERED\n",
    views,
    sandboxLine: null,
    limits: [],
    exitCode: 2,
    cleanupError: "",
  };
}

/** 기준 파일 발견 하나. 규칙 id 만 다르게 만든다. */
function surfaceFinding(ruleId: Finding["ruleId"]): Finding {
  return {
    ruleId,
    severity: "medium",
    location: { kind: "surface", path: "" },
    message: "m",
    fix: "f",
    evidence: [],
  };
}

const SURFACE_VIEW: SecurityFindingView = { where: "도구 표면", tool: null, toolIndex: -1 };

function withSurface(...ruleIds: readonly Finding["ruleId"][]): AnalyzeSecurityResponse {
  return sample(
    ruleIds.map(surfaceFinding),
    ruleIds.map(() => SURFACE_VIEW),
  );
}

const REQUEST = { argv: ["--command", "node"], baselinePath: "b.json" };

describe("security-view", () => {
  it("flow 발견은 결함 목록에 없고 flows 에만 있다", () => {
    const { defects, flows } = splitFindings(sample());

    expect(defects.map((row) => row.finding.ruleId)).toEqual([
      "desc/hidden-unicode",
      "protocol/plaintext",
      "schema/loose-object",
      "launch/shell-wrapper",
    ]);
    expect(flows.map((row) => row.finding.ruleId)).toEqual(["flow/toxic-combination"]);
    // 발견과 표시용 글자는 같은 자리의 것이 짝이다.
    expect(flows[0]?.index).toBe(4);
    expect(flows[0]?.view).toBe(VIEWS[4]);
  });

  it("bySeverity 는 심각·주의·낮음·정보 순이고 빈 구획을 내지 않는다", () => {
    const groups = bySeverity(splitFindings(sample()).defects);

    expect(groups.map((group) => [group.severity, group.label, group.rows.length])).toEqual([
      ["high", "심각", 2],
      ["medium", "주의", 1],
      ["info", "정보", 1],
    ]);
  });

  it("구획 안의 순서는 report.findings 의 순서다", () => {
    const { defects } = splitFindings(sample());
    const indexes = [...bySeverity(defects), ...byTool(defects)].map((group) =>
      group.rows.map((row) => row.index),
    );

    expect(indexes).toEqual([[0, 3], [1], [2], [1, 3], [2], [0]]);
    for (const group of indexes) {
      expect(group).toEqual([...group].sort((a, b) => a - b));
    }
  });

  it("byTool 은 -1 구획이 맨 앞이고 그 뒤는 toolIndex 오름차순이다", () => {
    const groups = byTool(splitFindings(sample()).defects);

    expect(groups.map((group) => group.toolIndex)).toEqual([-1, 0, 1]);
    expect(groups[0]?.title).toBe("서버 전체 (실행 명령·프로토콜·도구 표면)");
  });

  it("byTool 의 도구 제목은 view.tool 을 쓴다", () => {
    const groups = byTool(splitFindings(sample()).defects);

    expect(groups.map((group) => group.title).slice(1)).toEqual([
      "도구 'add'",
      "도구 'get<U+200B>time'",
    ]);
    // 원래 이름(숨은 문자가 든 것)으로 만들지 않는다.
    expect(groups[2]?.title.includes(HIDDEN_NAME)).toBe(false);
  });

  it("baselineStatus: 경로를 보내지 않았으면 null", () => {
    expect(
      baselineStatus({ argv: ["--command", "node"] }, withSurface("surface/baseline-created")),
    ).toBeNull();
  });

  it("baselineStatus: baseline-created 가 있으면 새로 썼다고 말한다", () => {
    expect(baselineStatus(REQUEST, withSurface("surface/baseline-created"))).toBe(
      "기준 파일을 새로 썼습니다: b.json",
    );
  });

  it("baselineStatus: surface/changed 가 둘이면 변경 2건", () => {
    expect(baselineStatus(REQUEST, withSurface("surface/changed", "surface/changed"))).toBe(
      "기준 파일과 다릅니다: b.json (변경 2건)",
    );
  });

  it("baselineStatus: 둘 다 없으면 같다고 말한다", () => {
    expect(baselineStatus(REQUEST, sample())).toBe("기준 파일과 같습니다: b.json");
  });
});

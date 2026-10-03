import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderReport } from "../src/report.js";
import type { AuditReport, Finding, Severity } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const expectedDir = join(here, "fixtures", "expected");

function loadSample(): AuditReport {
  return JSON.parse(readFileSync(join(expectedDir, "report.sample.json"), "utf8")) as AuditReport;
}

function report(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    schemaVersion: 1,
    generator: { name: "@mcpeak/audit", version: "0.1.0" },
    server: {
      name: "demo",
      version: "1.0.0",
      toolCount: 3,
      promptCount: 0,
      resourceCount: 0,
      hasInstructions: false,
      capabilityKeys: ["tools"],
    },
    probe: "readonly",
    probedTools: [],
    findings: [],
    skipped: [],
    counts: { high: 0, medium: 0, low: 0, info: 0 },
    exitCode: 0,
    ...overrides,
  };
}

function toolFinding(
  ruleId: Finding["ruleId"],
  severity: Severity,
  toolIndex: number,
  toolName: string,
  path: string,
): Finding {
  return {
    ruleId,
    severity,
    location: { kind: "tool", toolIndex, toolName, path },
    message: `${ruleId} 메시지`,
    fix: `${ruleId} 해결`,
    evidence: [path],
  };
}

/** 발견 머리 줄(`[...] ruleId · 위치`)만 순서대로 뽑는다. */
function headLines(text: string): string[] {
  return text.split("\n").filter((line) => line.startsWith("["));
}

const FLOW: Finding = {
  ruleId: "flow/toxic-combination",
  severity: "low",
  location: { kind: "server", path: "" },
  message:
    "이 서버는 외부 입력을 읽고(get_issue), 비공개 데이터에 닿고(get_file), 밖으로 쓸 수 있습니다(create_pr).",
  fix: "세 역할을 한 세션에서 함께 켜지 마세요. 외부 입력을 읽는 도구만 따로 붙이거나 쓰기 도구를 끄세요.",
  evidence: ["get_issue", "get_file", "create_pr"],
};

describe("renderReport", () => {
  it("fixtures/expected/report.sample.json 의 리포트가 report.sample.txt 와 글자 단위로 같다", () => {
    const expected = readFileSync(join(expectedDir, "report.sample.txt"), "utf8");
    expect(renderReport(loadSample())).toBe(expected);
  });

  it("심각도 내림차순, 같은 심각도 안에서는 toolIndex·ruleId·path 순이다", () => {
    const findings: Finding[] = [
      toolFinding("schema/over-broad", "medium", 1, "b", "inputSchema"),
      toolFinding("desc/injection", "high", 2, "c", "description"),
      toolFinding("desc/sensitive-path", "low", 0, "a", "description"),
      toolFinding("desc/injection", "high", 0, "a", "title"),
      toolFinding("desc/injection", "high", 0, "a", "description"),
      toolFinding("desc/encoded-blob", "info", 0, "a", "description"),
      toolFinding("desc/hidden-unicode", "high", 0, "a", "name"),
      {
        ruleId: "result/injection",
        severity: "high",
        location: { kind: "result", toolIndex: 2, toolName: "c", path: "content[0].text" },
        message: "m",
        fix: "f",
        evidence: [],
      },
      {
        ruleId: "protocol/plaintext",
        severity: "high",
        location: { kind: "protocol", path: "" },
        message: "m",
        fix: "f",
        evidence: [],
      },
    ];
    expect(headLines(renderReport(report({ findings })))).toEqual([
      "[심각] protocol/plaintext · 프로토콜",
      "[심각] desc/hidden-unicode · 도구 'a' 의 name",
      "[심각] desc/injection · 도구 'a' 의 description",
      "[심각] desc/injection · 도구 'a' 의 title",
      "[심각] desc/injection · 도구 'c' 의 description",
      "[심각] result/injection · 도구 'c' 호출 응답의 content[0].text",
      "[주의] schema/over-broad · 도구 'b' 의 inputSchema",
      "[낮음] desc/sensitive-path · 도구 'a' 의 description",
      "[정보] desc/encoded-blob · 도구 'a' 의 description",
    ]);
  });

  it("같은 도구·같은 규칙 4곳 이상이면 3개 + '같은 도구에서 n곳 더' 다", () => {
    const paths = ["p0", "p1", "p2", "p3"];
    const four = paths.map((p) => toolFinding("desc/hidden-unicode", "medium", 0, "a", p));
    const other = toolFinding("desc/hidden-unicode", "medium", 1, "b", "description");
    const text = renderReport(report({ findings: [...four, other] }));

    expect(headLines(text)).toEqual([
      "[주의] desc/hidden-unicode · 도구 'a' 의 p0",
      "[주의] desc/hidden-unicode · 도구 'a' 의 p1",
      "[주의] desc/hidden-unicode · 도구 'a' 의 p2",
      "[주의] desc/hidden-unicode · 도구 'b' 의 description",
    ]);
    const lines = text.split("\n");
    const more = lines.indexOf("  → 같은 도구에서 1곳 더");
    expect(more).toBeGreaterThan(lines.indexOf("[주의] desc/hidden-unicode · 도구 'a' 의 p2"));
    expect(more).toBeLessThan(
      lines.indexOf("[주의] desc/hidden-unicode · 도구 'b' 의 description"),
    );

    // 3곳이면 접지 않는다.
    const three = renderReport(report({ findings: four.slice(0, 3) }));
    expect(three).not.toContain("곳 더");
    expect(headLines(three)).toHaveLength(3);
  });

  it("flow 는 심각도 목록에 없고 마지막 구획에 있다", () => {
    const text = renderReport(
      report({
        findings: [FLOW, toolFinding("desc/sensitive-path", "low", 0, "a", "description")],
        skipped: [{ family: "surface", reason: "이유" }],
      }),
    );
    const lines = text.split("\n");
    expect(headLines(text)).toEqual(["[낮음] desc/sensitive-path · 도구 'a' 의 description"]);
    const flowAt = lines.indexOf("권한 조합 경고 (결함이 아닙니다)");
    expect(flowAt).toBeGreaterThan(
      lines.indexOf("[낮음] desc/sensitive-path · 도구 'a' 의 description"),
    );
    expect(lines.slice(flowAt, flowAt + 4)).toEqual([
      "권한 조합 경고 (결함이 아닙니다)",
      `  → ${FLOW.message}`,
      "  → 외부 입력에 숨은 지시가 있으면 비공개 데이터가 밖으로 나갈 수 있습니다. GitHub MCP 2025-05 사고가 이 모양입니다.",
      "  해결: 세 역할을 한 세션에서 함께 켜지 마세요. 외부 입력을 읽는 도구만 따로 붙이거나 쓰기 도구를 끄세요.",
    ]);
    expect(lines.indexOf("검사하지 않은 것")).toBeGreaterThan(flowAt);

    expect(renderReport(report())).not.toContain("권한 조합 경고");
  });

  it("skipped 가 있으면 '검사하지 않은 것' 절이 있다", () => {
    const reason = "--baseline 을 주지 않아 도구 표면 변경을 비교하지 않았습니다.";
    const lines = renderReport(report({ skipped: [{ family: "surface", reason }] })).split("\n");
    const at = lines.indexOf("검사하지 않은 것");
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe(`  - surface: ${reason}`);

    expect(renderReport(report())).not.toContain("검사하지 않은 것");
  });

  it("마지막 두 줄이 고정 문장이다", () => {
    const tail = [
      "이 검사는 설명문의 문형과 프로토콜 표면만 봅니다. 바꿔 말한 지시와 서버 코드의 실제 행위는 보지 못합니다.",
      "행위 관측(Docker 격리)은 mcpeak audit --sandbox 로 켭니다. (단계 2에서 제공)",
    ];
    for (const r of [report(), loadSample()]) {
      const text = renderReport(r);
      expect(text.endsWith("\n")).toBe(true);
      expect(text.trimEnd().split("\n").slice(-2)).toEqual(tail);
    }
  });

  it("위치 줄의 이름에 든 보이지 않는 문자·제어 문자를 <U+XXXX> 로 드러낸다", () => {
    const zwsp = String.fromCodePoint(0x200b);
    const esc = String.fromCodePoint(0x1b);
    const text = renderReport(
      report({
        findings: [
          toolFinding("desc/hidden-unicode", "high", 0, `get${zwsp}time`, "name"),
          {
            ...toolFinding("desc/injection", "high", 1, "x", "description"),
            location: { kind: "resource", uri: `file:///a${esc}[8m.txt`, path: "uri" },
          },
        ],
        counts: { high: 2, medium: 0, low: 0, info: 0 },
      }),
    );
    // 리소스 위치는 toolIndex 가 없어(-1) §3.0 정렬에서 도구보다 앞선다.
    expect(headLines(text)).toEqual([
      "[심각] desc/injection · 리소스 file:///a<U+001B>[8m.txt 의 uri",
      "[심각] desc/hidden-unicode · 도구 'get<U+200B>time' 의 name",
    ]);
    expect(text).not.toContain(zwsp);
    expect(text).not.toContain(esc);
  });

  it("probe all 이면 머리에 경고 괄호가 붙는다", () => {
    const all = renderReport(report({ probe: "all", probedTools: ["a", "b"] })).split("\n");
    expect(all[2]).toBe("호출 정책 all · 호출한 도구 2개 (상태를 바꾸는 도구도 호출했습니다)");

    const readonly = renderReport(report({ probe: "readonly", probedTools: ["a"] })).split("\n");
    expect(readonly[2]).toBe("호출 정책 readonly · 호출한 도구 1개");
  });
});

import { escapeInvisible } from "./rules/description.js";
import type { AuditReport, Finding, Location, Severity } from "./types.js";

const SEVERITY_ORDER: readonly Severity[] = ["high", "medium", "low", "info"];

const SEVERITY_LABEL: Record<Severity, string> = {
  high: "심각",
  medium: "주의",
  low: "낮음",
  info: "정보",
};

/** 같은 도구·같은 규칙이 이 수를 넘으면 나머지를 한 줄로 접는다(§6.1). */
const MAX_PER_TOOL_RULE = 3;

const FLOW_TITLE = "권한 조합 경고 (결함이 아닙니다)";
const FLOW_RISK =
  "외부 입력에 숨은 지시가 있으면 비공개 데이터가 밖으로 나갈 수 있습니다. GitHub MCP 2025-05 사고가 이 모양입니다.";
const FLOW_FIX =
  "세 역할을 한 세션에서 함께 켜지 마세요. 외부 입력을 읽는 도구만 따로 붙이거나 쓰기 도구를 끄세요.";

const FOOTER = [
  "이 검사는 설명문의 문형과 프로토콜 표면만 봅니다. 바꿔 말한 지시와 서버 코드의 실제 행위는 보지 못합니다.",
  "행위 관측(Docker 격리)은 mcpeak audit --sandbox 로 켭니다. (단계 2에서 제공)",
];

/** §6.1 의 사람용 리포트. 색을 쓰지 않고, 같은 입력에는 같은 문자열을 낸다. */
export function renderReport(report: AuditReport): string {
  const { server, counts } = report;
  const lines: string[] = [
    "mcpeak audit 결과",
    `서버 ${server.name} ${server.version} · 도구 ${server.toolCount}개 · 프롬프트 ${server.promptCount}개 · 리소스 ${server.resourceCount}개 · instructions ${server.hasInstructions ? "있음" : "없음"}`,
    `호출 정책 ${report.probe} · 호출한 도구 ${report.probedTools.length}개${report.probe === "all" ? " (상태를 바꾸는 도구도 호출했습니다)" : ""}`,
    "",
    `판정: 심각 ${counts.high}건, 주의 ${counts.medium}건, 낮음 ${counts.low}건, 정보 ${counts.info}건`,
  ];

  const flows = report.findings.filter(isFlow);
  const defects = report.findings.filter((f) => !isFlow(f));

  for (const severity of SEVERITY_ORDER) {
    const group = defects.filter((f) => f.severity === severity).sort(compareFindings);
    const totals = new Map<string, number>();
    for (const f of group) {
      const key = foldKey(f);
      if (key !== undefined) totals.set(key, (totals.get(key) ?? 0) + 1);
    }

    const shown = new Map<string, number>();
    for (const f of group) {
      const key = foldKey(f);
      const n = key === undefined ? 1 : (shown.get(key) ?? 0) + 1;
      if (key !== undefined) shown.set(key, n);
      if (n > MAX_PER_TOOL_RULE) continue;
      lines.push(
        "",
        `[${SEVERITY_LABEL[severity]}] ${f.ruleId} · ${describeLocation(f.location)}`,
        `  → ${f.message}`,
        `  해결: ${f.fix}`,
      );
      const total = key === undefined ? 0 : (totals.get(key) ?? 0);
      if (n === MAX_PER_TOOL_RULE && total > MAX_PER_TOOL_RULE) {
        lines.push(`  → 같은 도구에서 ${total - MAX_PER_TOOL_RULE}곳 더`);
      }
    }
  }

  if (flows.length > 0) {
    lines.push("", FLOW_TITLE);
    for (const f of [...flows].sort(compareFindings)) {
      lines.push(`  → ${f.message}`, `  → ${FLOW_RISK}`, `  해결: ${FLOW_FIX}`);
    }
  }

  if (report.skipped.length > 0) {
    lines.push("", "검사하지 않은 것");
    for (const s of report.skipped) lines.push(`  - ${s.family}: ${s.reason}`);
  }

  lines.push("", ...FOOTER);
  return `${lines.join("\n")}\n`;
}

function isFlow(f: Finding): boolean {
  return f.ruleId.startsWith("flow/");
}

function toolIndexOf(location: Location): number {
  return "toolIndex" in location ? location.toolIndex : -1;
}

/** 같은 도구·같은 규칙 묶음의 키. 도구에 걸리지 않은 위치(instructions·launch 등)는 접지 않는다. */
function foldKey(f: Finding): string | undefined {
  const index = toolIndexOf(f.location);
  return index < 0 ? undefined : `${f.ruleId}\u0000${index}`;
}

/** §3.0 정렬: (toolIndex ?? -1, ruleId, path, evidence 첫 값). 로캘에 기대지 않고 코드 단위로 비교한다. */
function compareFindings(a: Finding, b: Finding): number {
  return (
    toolIndexOf(a.location) - toolIndexOf(b.location) ||
    compareText(a.ruleId, b.ruleId) ||
    compareText(a.location.path, b.location.path) ||
    compareText(a.evidence[0] ?? "", b.evidence[0] ?? "")
  );
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * §6.1 의 위치 한 줄. path 가 비면 " 의 <path>" 를 생략한다.
 *
 * 이름·uri·path 는 서버가 보낸 글자라 `escapeInvisible` 로 보이지 않는 문자와 제어 문자를 `<U+XXXX>` 로
 * 드러낸다. 그대로 쓰면 hidden-unicode 발견의 위치 줄이 정작 그 문자를 숨기고(`get<U+200B>time` 이
 * `gettime` 으로 보인다), ESC 가 들어 있으면 터미널을 조작한다(근거 조각의 evidenceFragment 와 같은 규약).
 */
function describeLocation(location: Location): string {
  const path = escapeInvisible(location.path);
  const at = (subject: string, joiner = " 의 "): string =>
    path === "" ? subject : `${subject}${joiner}${path}`;
  switch (location.kind) {
    case "tool":
      return at(`도구 '${escapeInvisible(location.toolName)}'`);
    case "prompt":
      return at(`프롬프트 '${escapeInvisible(location.name)}'`);
    case "resource":
      return at(`리소스 ${escapeInvisible(location.uri)}`);
    case "instructions":
      return "서버 instructions";
    case "launch":
      return path === "" ? "실행 명령" : `실행 명령 ${path}`;
    case "protocol":
      return "프로토콜";
    case "surface":
      return "도구 표면";
    case "result":
      // §6.1 이 이 위치만 "응답의" 로 붙여 쓴다.
      return at(`도구 '${escapeInvisible(location.toolName)}' 호출 응답`, "의 ");
    case "server":
      return "서버 전체";
  }
}

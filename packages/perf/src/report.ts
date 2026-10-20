import type { CallOutcome, CaseResult, PerfReport } from "./types.js";

/** §5.4 표 순서. 사유 문장과 비고의 나열 순서다. */
const OUTCOME_ORDER: readonly CallOutcome[] = [
  "ok",
  "isError",
  "empty",
  "threw",
  "skipped",
  "missingTool",
];

const OBSERVED_FOOTNOTE: readonly string[] = [
  "외부 대기는 서버 프로세스 안에서 관측한 HTTP 요청(fetch·node:http·http2·undici)의 시작부터 응답 본문 끝까지의 합집합입니다.",
  "서버 안 시간은 응답 시간에서 그것을 뺀 나머지이고, 처리뿐 아니라 레이트리미터·타이머 대기, 첫 연결의 TLS, stdio 전송이 들어 있습니다.",
];
const UNOBSERVED_FOOTNOTE: readonly string[] = [
  "분해와 진단은 Node 서버에 프리로드가 실릴 때만 합니다.",
];
const COMMON_FOOTNOTE =
  "수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.";

/**
 * ok 가 아닌 outcome 을 `threw 5회` 처럼 0 이 아닌 것만 §5.4 순서로 `, ` 로 잇는다(§7.3).
 * n 이 0 인 케이스의 "측정 안 됨" 사유와 기준선의 "측정 불가" 사유, 실패 비고가 함께 쓴다.
 */
export function failureReason(outcomes: CaseResult["outcomes"]): string {
  return OUTCOME_ORDER.filter((outcome) => outcome !== "ok" && outcomes[outcome] !== 0)
    .map((outcome) => `${outcome} ${outcomes[outcome]}회`)
    .join(", ");
}

/** 열 너비의 "문자 수" 는 코드 포인트 수다(계획 §6.2). */
function width(text: string): number {
  return [...text].length;
}

function padLeft(text: string, target: number): string {
  return " ".repeat(Math.max(0, target - width(text))) + text;
}

function padRight(text: string, target: number): string {
  return text + " ".repeat(Math.max(0, target - width(text)));
}

interface Column {
  readonly header: string;
  readonly align: "left" | "right";
  readonly value: (c: CaseResult) => string;
}

function ms(value: number | undefined): string {
  return value === undefined ? "" : String(Math.round(value));
}

const CASE_COLUMNS: readonly Column[] = [
  { header: "케이스", align: "left", value: (c) => c.id },
  { header: "n", align: "right", value: (c) => String(c.n) },
  { header: "응답 p50", align: "right", value: (c) => ms(c.total?.p50) },
  { header: "p95", align: "right", value: (c) => ms(c.total?.p95) },
];

const OBSERVED_COLUMNS: readonly Column[] = [
  {
    header: "외부 대기 p50",
    align: "right",
    value: (c) =>
      c.external === undefined ? "" : `${c.externalLowerBound ? "≥" : ""}${ms(c.external.p50)}`,
  },
  { header: "서버 안 p50", align: "right", value: (c) => ms(c.inside?.p50) },
  { header: "외부 요청/호출", align: "right", value: (c) => ms(c.requests?.p50) },
];

/** 행 끝 비고. n 이 0 이면 측정 안 됨, 실패가 있으면 실패 횟수, 아니면 없음. */
function remark(c: CaseResult): string | undefined {
  if (c.n === 0) {
    const head = `측정 안 됨: ${failureReason(c.outcomes)}`;
    return c.firstError === undefined ? head : `${head}. 첫 오류: ${c.firstError}`;
  }
  const failures = OUTCOME_ORDER.filter((outcome) => outcome !== "ok").reduce(
    (sum, outcome) => sum + c.outcomes[outcome],
    0,
  );
  return failures === 0 ? undefined : `실패 ${failures}회(${failureReason(c.outcomes)})`;
}

function renderTable(cases: readonly CaseResult[], observed: boolean): string[] {
  const columns = observed ? [...CASE_COLUMNS, ...OBSERVED_COLUMNS] : CASE_COLUMNS;
  const cells = cases.map((c) => columns.map((column) => column.value(c)));
  const widths = columns.map((column, index) =>
    Math.max(width(column.header), ...cells.map((row) => width(row[index] ?? ""))),
  );
  const pad = (text: string, index: number) =>
    columns[index]?.align === "left"
      ? padRight(text, widths[index] ?? 0)
      : padLeft(text, widths[index] ?? 0);
  const header = columns.map((column, index) => pad(column.header, index)).join("  ");
  const rows = cells.map((row, rowIndex) => {
    const line = row.map((text, index) => pad(text, index)).join("  ");
    const note = remark(cases[rowIndex] as CaseResult);
    return note === undefined ? line : `${line}  ${note}`;
  });
  return [header, ...rows];
}

function renderDiagnostics(report: PerfReport): string[] {
  const lines = [
    report.findings.length === 0
      ? "진단 없음"
      : `진단 ${report.findings.length}건 (종료 코드에 영향 없음)`,
  ];
  for (const finding of report.findings) {
    for (const line of finding.lines) lines.push(`→ ${line}`);
  }
  if (report.undecidedCases !== 0) {
    lines.push(
      `판정 불가: ${report.undecidedCases}개 케이스는 응답이나 요청 본문을 못 보는 경로(node:http·http2·undici, 스트림 본문)라 독립 여부를 가리지 못했습니다.`,
    );
  }
  return lines;
}

/** §8.3 사람용 리포트. 색을 쓰지 않고 같은 리포트에 같은 문자열을 낸다. */
export function renderReport(report: PerfReport): string {
  const observed = report.settings.observation === "preload";
  const lines: string[] = [];

  // 1. 머리 네 줄과 빈 줄.
  lines.push(
    "mcpeak perf 결과",
    `서버 ${report.server.command} · 도구 ${report.server.toolCount}개 · ${
      observed
        ? "관측 Node 프리로드(fetch, node:http, http2, undici)"
        : "관측 안 함(Node 프리로드가 실리지 않음)"
    }`,
    `설정 반복 ${report.settings.repeat}회 · 호출 간격 ${report.settings.intervalMs}ms · 케이스 ${report.settings.caseCount}개 (callTool 중 거절 기대 제외)`,
    `콜드 스타트 기동+핸드셰이크 ${report.coldStart.connectMs}ms · tools/list ${report.coldStart.listToolsMs}ms`,
    "",
  );

  // 2. 표, 빈 줄, 중단 문장.
  lines.push(...renderTable(report.cases, observed), "");
  if (report.aborted !== null) {
    lines.push(
      `측정 중단: '${report.aborted.caseId}' 호출이 ${report.aborted.timeoutMs}ms 안에 끝나지 않아 남은 호출을 하지 않았습니다. 케이스의 timeoutMs 를 올리거나 --tool 로 케이스를 나누세요.`,
      "",
    );
  }

  // 3. 진단 절.
  if (observed) {
    lines.push(...renderDiagnostics(report), "");
  } else {
    lines.push(
      "진단 없음: 외부 호출을 관측하지 못해 분해와 진단을 하지 않았습니다. Node 서버가 아니거나 NODE_OPTIONS 가 전달되지 않았습니다.",
      "",
    );
  }

  // 4. 기준선 절.
  if (report.baseline !== undefined) {
    lines.push(`기준선 비교 (${report.baseline.path})`);
    for (const line of report.baseline.lines) lines.push(`→ ${line}`);
    lines.push("");
  }

  // 5. 각주.
  lines.push(...(observed ? OBSERVED_FOOTNOTE : UNOBSERVED_FOOTNOTE), COMMON_FOOTNOTE);

  // 6. 끝 개행 하나.
  return `${lines.join("\n")}\n`;
}

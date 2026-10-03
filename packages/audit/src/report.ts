import { escapeInvisible } from "./rules/description.js";
import type {
  AuditReport,
  Finding,
  Location,
  SandboxNetworkMode,
  SandboxReport,
  SandboxUnavailable,
  Severity,
} from "./types.js";

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
  "행위 관측(Docker 격리)은 mcpeak audit --sandbox 로 켭니다.",
];

type SandboxRan = Extract<SandboxReport, { status: "ran" }>;

const NETWORK_LABEL: Record<SandboxNetworkMode, string> = {
  live: "가로채기",
  record: "가로채기(녹화)",
  // 재생에서도 게이트웨이는 bridge 에 붙는다. 서버 쪽에서 본 사실로 읽는다(상류에 닿지 않는다).
  replay: "재생(네트워크 없음)",
};

/**
 * 격리 이미지가 실행하는 명령. `SandboxBackend.commands` 를 `, ` 로 이은 것과 같아야 한다. 리포트에는
 * 백엔드의 목록이 실려 오지 않아(`SandboxReport` 의 unavailable 갈래에 자리가 없다) 여기 적어 둔다.
 */
const SANDBOX_COMMANDS = "node, npx, npm";

const RAN_FOOTER_FIRST =
  "격리 실행은 한 번의 관측입니다. 호출 횟수나 시간이 지나야 달라지는 행동은 보지 못합니다.";
const RAN_FOOTER_TRACES = {
  compared:
    "컨테이너라는 흔적(/.dockerenv, cgroup)은 지우지 못했습니다. 안팎의 도구 표면은 비교했지만 호출 뒤의 행동까지 같다는 뜻은 아닙니다.",
  notCompared:
    "컨테이너라는 흔적(/.dockerenv, cgroup)은 지우지 못했습니다. 격리를 알아채고 얌전히 구는 서버는 --compare-host 로 안팎의 도구 표면을 비교해 보세요.",
} as const;
const RAN_FOOTER_REST = [
  "HTTP 가 아닌 접속은 목적지 주소와 포트만 기록했고 내용은 보지 못했습니다.",
  "관측되지 않았다는 것은 없다는 증명이 아닙니다. 암호화하거나 요약해서 내보낸 값은 이 검사가 알아보지 못합니다.",
  "사전 점검은 피해를 0 으로 만들지 않습니다. 조용히 몇 달 갈 일을 첫 시도에서 드러내는 것이 목적입니다. 등록한 뒤에는 --baseline 비교를 이어 가세요.",
];

const UNOBSERVED = "서버는 격리 없이 이 머신에서 실행됐습니다.";

/**
 * 격리가 켜지지 않은 실행의 둘째 줄. 사용자는 `--sandbox` 를 주었으므로 격리됐다고 믿고 있다. 그래서
 * 다섯 문장 모두 서버가 어디서 돌았는지를 말한다. `detail` 은 docker 가 낸 글자라 표기로 바꿔 싣는다.
 */
function describeUnavailable(reason: SandboxUnavailable): string {
  const detail = escapeInvisible(reason.detail);
  switch (reason.code) {
    case "docker-missing":
      return `행위 관측 안 함: Docker 를 찾을 수 없습니다. ${UNOBSERVED} (설치: https://docs.docker.com/get-docker/)`;
    case "daemon-down":
      return `행위 관측 안 함: Docker 데몬이 응답하지 않습니다. ${UNOBSERVED} (Docker Desktop 을 켜거나 dockerd 를 시작한 뒤 다시 실행하세요)`;
    case "unsupported-command":
      return `행위 관측 안 함: 격리 이미지가 실행할 수 없습니다: '${detail}'. 격리 이미지는 ${SANDBOX_COMMANDS} 만 실행합니다. ${UNOBSERVED}`;
    case "image-build-failed":
      return `행위 관측 안 함: 격리 이미지를 만들지 못했습니다: ${detail}. ${UNOBSERVED} (docker build 가 되는지, 네트워크가 되는지 확인하세요)`;
    case "start-failed":
      return `행위 관측 안 함: 격리 컨테이너를 띄우지 못했습니다: ${detail}. ${UNOBSERVED}`;
  }
}

function describeRan(sandbox: SandboxRan): string {
  return `격리 실행: Docker 컨테이너 안에서 서버를 띄웠습니다 · 네트워크 ${NETWORK_LABEL[sandbox.network]} · 이미지 ${escapeInvisible(sandbox.image)}`;
}

/** 호출 정책 줄의 꼬리. 격리가 켜졌을 때만 다르다(§6.1). */
function probeTail(report: AuditReport, ran: SandboxRan | undefined): string {
  if (report.probe !== "all") return "";
  return ran === undefined
    ? " (상태를 바꾸는 도구도 호출했습니다)"
    : ` (격리 안이라 상태를 바꾸는 도구도 호출했습니다. 호출 ${ran.callCount}회)`;
}

/** §6.1 의 사람용 리포트. 색을 쓰지 않고, 같은 입력에는 같은 문자열을 낸다. */
export function renderReport(report: AuditReport): string {
  const { server, counts, sandbox } = report;
  const ran = sandbox?.status === "ran" ? sandbox : undefined;
  const lines: string[] = ["mcpeak audit 결과"];
  if (sandbox !== undefined)
    lines.push(
      sandbox.status === "ran" ? describeRan(sandbox) : describeUnavailable(sandbox.reason),
    );
  lines.push(
    `서버 ${server.name} ${server.version} · 도구 ${server.toolCount}개 · 프롬프트 ${server.promptCount}개 · 리소스 ${server.resourceCount}개 · instructions ${server.hasInstructions ? "있음" : "없음"}`,
  );
  // 선언은 서버가 스스로 쓸 수 있는 것이라, 무엇을 선언으로 보았는지를 사용자가 보게 한다.
  if (ran !== undefined)
    lines.push(
      `선언된 목적지 ${ran.declaredHosts.length}곳: ${ran.declaredHosts.map(escapeInvisible).join(", ")} (도구 설명·README·package.json·--allow-host 에서 읽음)`,
    );
  lines.push(
    `호출 정책 ${report.probe} · 호출한 도구 ${report.probedTools.length}개${probeTail(report, ran)}`,
    "",
    `판정: 심각 ${counts.high}건, 주의 ${counts.medium}건, 낮음 ${counts.low}건, 정보 ${counts.info}건`,
  );

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

  lines.push(
    "",
    ...(ran === undefined
      ? FOOTER
      : [
          RAN_FOOTER_FIRST,
          ran.compareHost ? RAN_FOOTER_TRACES.compared : RAN_FOOTER_TRACES.notCompared,
          ...RAN_FOOTER_REST,
        ]),
  );
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
    case "call":
      return `도구 '${escapeInvisible(location.toolName)}' 호출(${escapeInvisible(location.callId)}) 중`;
    case "server":
      return "서버 전체";
  }
}

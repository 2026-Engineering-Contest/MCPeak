import type {
  AnalyzePerfResponse,
  AnalyzeSecurityRequest,
  AnalyzeSecurityResponse,
  AnalyzeTokensResponse,
} from "../../../src/api-types.js";
import { millis, percent, tokens } from "./format.js";
import { securityExecution } from "./security-execution.js";
import { baselineStatus, splitFindings } from "./security-view.js";
import type { AnalyzePillarId } from "./types.js";

/** 판정 배지와 카드 톤. 값은 theme.css 의 상태 토큰 쌍 이름이다(SEVERITY_TONE 과 같은 어휘). */
export type PillarTone = "failed" | "waiting" | "running" | "done" | "info" | "accent";

export interface PillarVerdict {
  readonly label: string;
  readonly tone: PillarTone;
}

/** 카드의 집계 칩 하나. 라벨 글자는 항상 있다(색만으로 뜻을 전하지 않는다). */
export interface PillarChip {
  readonly label: string;
  readonly count: number;
  readonly tone: PillarTone;
}

/** 분포 막대의 칸 하나. `ratio` 는 0 이상 1 이하이고 칸의 합이 1 을 넘지 않는다. */
export interface PillarBarSegment {
  readonly ratio: number;
  readonly tone: PillarTone;
  readonly label: string;
}

/** 카드가 `done` 일 때 그리는 것 전부. 응답에서 순수 함수로만 만든다. */
export interface PillarSummary {
  readonly verdict: PillarVerdict;
  /** 큰 숫자. 문자열이다(`−38.4%` 처럼 부호·단위가 붙는다). */
  readonly headline: string;
  /** 큰 숫자 옆 단위·보조 문장. */
  readonly headlineNote: string;
  /** 막대 첫 줄(100% 기준 줄)의 라벨. 없으면 "원본" 이다. 둘째 줄 라벨은 `bar[0].label` 이다. */
  readonly baseLabel?: string;
  readonly bar: readonly PillarBarSegment[];
  readonly chips: readonly PillarChip[];
  /** 요약 줄. 한 문장. */
  readonly foot: string;
}

/** 카드의 고정 글자. 축마다 하나이고 순서가 곧 화면 순서다. */
export interface PillarDescriptor {
  readonly id: AnalyzePillarId;
  /** 눈썹. 영문 대문자. */
  readonly eyebrow: string;
  readonly name: string;
  readonly description: string;
  /** false 면 카드가 비활성이고 상세로 가는 링크가 없다. */
  readonly available: boolean;
}

export const PILLARS: readonly PillarDescriptor[] = [
  {
    id: "security",
    eyebrow: "SECURITY",
    name: "보안",
    description: "도구 설명·결과·네트워크·비밀값을 점검해 공격 표면과 유출 경로를 찾습니다.",
    available: true,
  },
  {
    id: "tokens",
    eyebrow: "COST OPTIMIZATION",
    name: "비용 최적화",
    description:
      "도구 정의가 매 호출마다 컨텍스트에 실리는 토큰을 재고, 압축 오버레이로 얼마나 줄어드는지 봅니다.",
    available: true,
  },
  {
    id: "performance",
    eyebrow: "PERFORMANCE EFFICIENCY",
    name: "성능 효율성",
    description:
      "도구 호출의 응답 시간을 외부 대기와 서버 안 시간으로 나누고, 병렬화·재사용으로 줄일 지점을 찾습니다.",
    available: true,
  },
];

/**
 * 보안 카드 요약(설계 §6.1). 숫자는 audit 리포트의 `counts`·`exitCode`·`server.toolCount` 를 그대로
 * 읽는다. 화면이 세거나 새 임계값을 두지 않는다.
 */
export function securitySummary(
  request: AnalyzeSecurityRequest,
  response: AnalyzeSecurityResponse,
): PillarSummary {
  const { report } = response;
  const { high, medium, low, info } = report.counts; // flow 는 세지 않는다(audit 계약)
  const defects = high + medium + low + info;
  const flows = splitFindings(response).flows.length;

  // 판정은 CLI 의 exitCode 를 따른다. 화면이 새 임계값을 두지 않는다.
  // audit.ts: exitCode = high + medium > 0 ? 2 : 0
  // 라벨은 칩과 모순되면 안 된다. 낮음·정보 칩이 0 인데 "조치 불필요(참고 N건)" 이라 쓰면 사용자가 칩을 못 믿는다.
  // 낮음·정보만 있을 때의 라벨은 "조치 불필요(참고 N건)" 이고 N 은 낮음 + 정보다(사용자 결정 2026-10-19).
  // exitCode 2 의 식은 audit.ts 의 high + medium > 0 이다. exitCode 1(격리 정리 실패)이어도 counts 는 그대로이므로
  // 같은 식을 함께 본다. 그렇지 않으면 칩 "심각 1" 옆에 "조치 불필요" 가 뜬다.
  const verdict: PillarVerdict =
    report.exitCode === 2 || high + medium > 0
      ? { label: "조치 필요", tone: "failed" }
      : defects > 0
        ? { label: `조치 불필요(참고 ${low + info}건)`, tone: "running" }
        : flows > 0
          ? { label: "흐름 경고만", tone: "waiting" }
          : { label: "발견 없음", tone: "done" };

  const segments: readonly PillarBarSegment[] = [
    { ratio: high / defects, tone: "failed", label: "심각" },
    { ratio: medium / defects, tone: "waiting", label: "주의" },
    { ratio: low / defects, tone: "running", label: "낮음" },
    { ratio: info / defects, tone: "info", label: "정보" },
  ];
  const bar = defects === 0 ? [] : segments.filter((segment) => segment.ratio > 0);

  const chips: readonly PillarChip[] = [
    { label: "심각", count: high, tone: "failed" },
    { label: "주의", count: medium, tone: "waiting" },
    { label: "낮음", count: low, tone: "running" },
    { label: "정보", count: info, tone: "info" },
    { label: "흐름 경고", count: flows, tone: "waiting" },
    // 발견 없이 통과한 규칙 수(ADR-0117). 서버가 센 목록의 길이다. 판정에는 쓰지 않는다.
    { label: "안전", count: response.passedRules.length, tone: "done" },
  ]; // 0 이어도 빼지 않는다. 자리가 흔들리면 읽기 어렵다

  return {
    verdict,
    headline: String(defects),
    headlineNote: `건 발견 · 도구 ${report.server.toolCount}개 점검`,
    bar,
    chips,
    // 실행 방식이 앞이다. 격리 여부에 따라 관측 범위가 달라 같은 서버의 결과도 다를 수 있다(ADR-0117).
    foot: `${securityExecution(response)} · ${
      baselineStatus(request, response) ??
      `도구 ${report.probedTools.length}개 호출 (probe ${report.probe})`
    }`,
  };
}

/** 비용 최적화 카드 요약(설계 §6.2). 숫자의 식은 `format.ts` 의 `percent`·`tokens` 만 쓴다. */
export function tokensSummary(response: AnalyzeTokensResponse): PillarSummary {
  const { source, totals, tools } = response.overlay;
  const before = totals.bytesBefore;
  const after = totals.bytesAfterWithInstructions;
  const reduced = before - after;
  const pct = percent(reduced, before); // format.ts, 소수 첫째 자리 문자열

  const verdict: PillarVerdict =
    reduced > 0
      ? { label: `${pct}% 줄일 수 있음`, tone: "waiting" }
      : { label: "줄일 것 없음", tone: "done" };

  // 도구별 감소 1위. TokensResult 의 sortedTools 와 같은 비교(감소 바이트 내림차순, 같으면 원본 순서).
  const top = tools
    .map((tool, index) => ({ tool, index, reduced: tool.bytes.before - tool.bytes.after }))
    .sort((x, y) => y.reduced - x.reduced || x.index - y.index)[0];

  return {
    verdict,
    headline: reduced > 0 ? `−${pct}%` : "0%",
    headlineNote: `~${tokens(before)} → ~${tokens(after)} 토큰`,
    bar: before === 0 ? [] : [{ ratio: after / before, tone: "accent", label: "압축" }],
    chips: [
      { label: "도구", count: source.toolCount, tone: "info" },
      { label: "공통 파라미터 승격", count: totals.promotedParameters, tone: "info" },
    ],
    foot:
      top !== undefined && top.reduced > 0
        ? `가장 큰 감소: ${top.tool.name} −${percent(top.reduced, top.tool.bytes.before)}%`
        : "줄어든 도구 없음",
  };
}

/**
 * 성능 카드 요약(ADR-0119). 숫자는 perf 리포트를 그대로 읽고 CLI 와 같은 반올림만 한다. 배지는 리포트가 가진
 * 값으로만 가르고, 위에서 처음 맞는 하나다. 관측하지 못한 상태가 다른 판정을 가리지 않도록 "관측 안 함" 이 맨 앞이다.
 */
export function performanceSummary(response: AnalyzePerfResponse): PillarSummary {
  const { report } = response;
  // 측정한 케이스의 응답 시간 중앙값 합계. 케이스마다 CLI 처럼 반올림한 뒤 더한다.
  const current = report.cases.reduce(
    (sum, entry) => sum + (entry.total === undefined ? 0 : millis(entry.total.p50)),
    0,
  );
  // 단축 시간을 숫자로 내는 진단은 병렬화(sequential-independent) 하나다. 리포트 순서 그대로다.
  const savings = report.findings.flatMap((finding) =>
    finding.ruleId === "perf/sequential-independent" &&
    finding.evidence.savingUpperBoundMs !== undefined
      ? [{ tool: finding.tools[0] ?? "", ms: millis(finding.evidence.savingUpperBoundMs) }]
      : [],
  );
  const saving = savings.reduce((sum, item) => sum + item.ms, 0);
  const after = Math.max(0, current - saving);
  const findings = report.findings.length;
  // 측정은 ok 반복이 하나라도 있는 케이스(n > 0), 미측정은 하나도 없는 케이스다. 미측정은 판정을 바꾸지 않고
  // 칩으로만 센다. 실패 반복을 판정 글자로 세면 서버 장애처럼 읽힌다(사용자 확인 루프 수정 3).
  const measuredCases = report.cases.filter((entry) => entry.n > 0).length;
  const unmeasuredCases = report.cases.length - measuredCases;

  const verdict: PillarVerdict =
    report.settings.observation === "none"
      ? { label: "관측 안 함", tone: "info" }
      : report.aborted !== null
        ? { label: "측정 중단", tone: "failed" }
        : report.baseline !== undefined && report.exitCode === 2
          ? { label: "회귀", tone: "failed" }
          : findings > 0
            ? { label: `진단 ${findings}건`, tone: "waiting" }
            : report.baseline === undefined
              ? { label: "진단 0건(기준선 없음)", tone: "done" }
              : { label: "진단 0건", tone: "done" };

  // 단축 1위. 같으면 리포트 순서가 앞인 것(정렬이 안정적이고 리포트 순서가 §6.3 으로 고정돼 있다).
  const top = [...savings].sort((x, y) => y.ms - x.ms)[0];

  return {
    verdict,
    headline: saving > 0 ? `−${saving} ms` : "0 ms",
    headlineNote: `~${current} → ~${after} ms`,
    baseLabel: "현재",
    bar: current === 0 ? [] : [{ ratio: after / current, tone: "accent", label: "개선 후" }],
    chips: [
      { label: "측정", count: measuredCases, tone: "done" },
      { label: "미측정", count: unmeasuredCases, tone: "info" },
      { label: "진단", count: findings, tone: "info" },
    ],
    foot:
      top !== undefined && top.ms > 0
        ? `가장 큰 단축: ${top.tool} −${top.ms}ms`
        : "병렬화로 줄일 곳 없음",
  };
}

import type {
  AnalyzeSecurityRequest,
  AnalyzeSecurityResponse,
  AnalyzeTokensResponse,
} from "../../../src/api-types.js";
import { percent, tokens } from "./format.js";
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
      "도구 호출 지연·처리량·동시성 한계를 재고, 부하 변화에 맞게 조정할 지점을 찾습니다.",
    available: false,
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
  // 라벨은 칩과 모순되면 안 된다. 낮음·정보 칩이 0 인데 "낮음·정보만" 이라 쓰면 사용자가 칩을 못 믿는다.
  // exitCode 2 의 식은 audit.ts 의 high + medium > 0 이다. exitCode 1(격리 정리 실패)이어도 counts 는 그대로이므로
  // 같은 식을 함께 본다. 그렇지 않으면 칩 "심각 1" 옆에 "낮음·정보만" 이 뜬다.
  const verdict: PillarVerdict =
    report.exitCode === 2 || high + medium > 0
      ? { label: "조치 필요", tone: "failed" }
      : defects > 0
        ? { label: "낮음·정보만", tone: "running" }
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
  ]; // 0 이어도 빼지 않는다. 자리가 흔들리면 읽기 어렵다

  return {
    verdict,
    headline: String(defects),
    headlineNote: `건 발견 · 도구 ${report.server.toolCount}개 점검`,
    bar,
    chips,
    foot:
      baselineStatus(request, response) ??
      `도구 ${report.probedTools.length}개 호출 (probe ${report.probe})`,
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

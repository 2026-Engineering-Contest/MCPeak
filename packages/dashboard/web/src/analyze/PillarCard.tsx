import type { JSX } from "react";
import { FOCUS_RING } from "../components/focus-ring.js";
import { PillarBadge, TONE_STYLE } from "./PillarBadge.js";
import { firstLine, type PillarState } from "./pillar-state.js";
import type { PillarDescriptor, PillarSummary } from "./pillars.js";

const CARD_CLASS =
  "relative grid content-start gap-3 rounded-lg border bg-surface p-4 text-left shadow-card";
const KPI_CLASS = "flex items-baseline gap-2";
const BIG_CLASS = "text-3xl font-semibold tabular-nums tracking-tight text-ink";
const UNIT_CLASS = "text-xs text-ink-muted";
const FOOT_CLASS =
  "flex items-start justify-between gap-2 border-t border-line-subtle pt-2.5 text-xs text-ink-muted";
/** 성능 카드의 빗금 배경. 기존 토큰만 쓴다. */
const DISABLED_BACKGROUND =
  "repeating-linear-gradient(135deg, var(--line-subtle) 0 6px, transparent 6px 12px)";

/**
 * 카드 머리. 접근 가능한 이름이 축 이름으로 **시작**하게 이름 요소를 DOM 맨 앞에 두고, 눈썹은 `aria-hidden`
 * 으로 CSS `order` 로만 위에 그린다. 제목 요소(h1~h6)를 쓰지 않는다. 상세 안의 h3 단언과 섞인다.
 */
function CardTop({
  descriptor,
  badge,
}: {
  readonly descriptor: PillarDescriptor;
  readonly badge: JSX.Element | null;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="order-2 text-base font-semibold text-ink">{descriptor.name}</span>
        <span
          aria-hidden="true"
          className="order-first text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
        >
          {descriptor.eyebrow}
        </span>
      </div>
      {badge}
    </div>
  );
}

/** 분포 막대. 보안은 심각도 칸 나열, 비용은 원본 100% 줄 + 압축 줄. 글자가 없으므로 읽기 도구에는 숨긴다. */
function SummaryBar({
  id,
  summary,
}: {
  readonly id: PillarDescriptor["id"];
  readonly summary: PillarSummary;
}): JSX.Element {
  if (id === "tokens") {
    const after = summary.bar[0];
    return (
      <div aria-hidden="true" className="grid gap-1 text-[11px] text-ink-muted">
        <div className="grid grid-cols-[32px_1fr] items-center gap-2">
          <span>원본</span>
          <div className="h-2 overflow-hidden rounded-sm bg-line-subtle">
            <i
              className="block h-full rounded-sm opacity-45"
              style={{ width: "100%", background: "var(--ink-muted)" }}
            />
          </div>
        </div>
        <div className="grid grid-cols-[32px_1fr] items-center gap-2">
          <span>압축</span>
          <div className="h-2 overflow-hidden rounded-sm bg-line-subtle">
            <i
              className="block h-full rounded-sm"
              style={{
                width: `${after === undefined ? 0 : (after.ratio * 100).toFixed(1)}%`,
                background: TONE_STYLE[after?.tone ?? "accent"].fg,
              }}
            />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-1.5 gap-0.5 overflow-hidden rounded-sm bg-line-subtle"
    >
      {summary.bar.map((segment) => (
        <i
          key={segment.label}
          className="block h-full"
          style={{
            width: `${(segment.ratio * 100).toFixed(1)}%`,
            background: TONE_STYLE[segment.tone].fg,
          }}
        />
      ))}
    </div>
  );
}

/**
 * 축 카드 한 장(설계 §3.3). 활성 카드는 `<a role="tab">` 라 주소가 상태다. 상태별 글자는 구현계획 §4.4 가
 * 정한 것 그대로다. 요약 줄은 한 요소의 한 문자열이다. 조각을 나누면 상세의 같은 문장과 둘 걸린다.
 */
export function PillarCard({
  descriptor,
  selected,
  state,
  summary,
  analyzedTarget,
}: {
  readonly descriptor: PillarDescriptor;
  readonly selected: boolean;
  /** available 이 false 면 무시된다. */
  readonly state: PillarState<unknown>;
  /** state.kind === "done" 일 때만 있다. */
  readonly summary: PillarSummary | null;
  /** 요약 줄 앞에 붙는 "분석한 대상: <이름>". done 일 때만. */
  readonly analyzedTarget: string | null;
}): JSX.Element {
  const { id } = descriptor;

  if (!descriptor.available) {
    return (
      <div
        role="tab"
        id={`pillar-${id}`}
        aria-disabled="true"
        aria-selected="false"
        tabIndex={-1}
        className={`${CARD_CLASS} cursor-not-allowed border-line opacity-75`}
        style={{ backgroundImage: DISABLED_BACKGROUND }}
      >
        <CardTop descriptor={descriptor} badge={<PillarBadge label="준비 중" tone="accent" />} />
        <p className="min-h-[3em] text-xs text-ink-muted">{descriptor.description}</p>
        <div className={KPI_CLASS}>
          <span className={`${BIG_CLASS} text-ink-muted`}>—</span>
          <span className={UNIT_CLASS}>아직 연결되지 않았습니다</span>
        </div>
        <div aria-hidden="true" className="h-1.5 rounded-sm bg-line-subtle" />
        <div className={FOOT_CLASS}>
          <p>패키지 개발 중</p>
          <span>연결 예정</span>
        </div>
      </div>
    );
  }

  const runningLabel = id === "security" ? "점검 중…" : "분석 중…";
  const badge =
    state.kind === "done" && summary !== null ? (
      <PillarBadge label={summary.verdict.label} tone={summary.verdict.tone} />
    ) : state.kind === "running" ? (
      <PillarBadge label={runningLabel} tone="running" />
    ) : state.kind === "failed" ? (
      <PillarBadge label="실패" tone="failed" />
    ) : null;

  const prefix = analyzedTarget === null ? "" : `분석한 대상: ${analyzedTarget} · `;

  return (
    <a
      role="tab"
      id={`pillar-${id}`}
      href={`#/analyze/${id}`}
      aria-selected={selected}
      aria-controls={`panel-${id}`}
      className={`${CARD_CLASS} ${FOCUS_RING} transition-colors duration-150 ${
        selected ? "border-accent ring-1 ring-accent" : "border-line hover:border-accent-border"
      }`}
    >
      <CardTop descriptor={descriptor} badge={badge} />
      <p className="min-h-[3em] text-xs text-ink-muted">{descriptor.description}</p>

      {state.kind === "idle" && <p className="text-sm text-ink-muted">아직 분석하지 않았습니다</p>}
      {state.kind === "running" && <p className="text-sm text-ink-muted">진행은 상세에서 봅니다</p>}
      {state.kind === "failed" && (
        <p className="break-all font-mono text-sm text-ink">{firstLine(state.error)}</p>
      )}
      {state.kind === "done" && summary !== null && (
        <>
          <div className={KPI_CLASS}>
            <span className={BIG_CLASS}>{summary.headline}</span>
            <span className={UNIT_CLASS}>{summary.headlineNote}</span>
          </div>
          <SummaryBar id={id} summary={summary} />
          <div className="flex flex-wrap gap-1.5">
            {summary.chips.map((chip) => (
              <span
                key={chip.label}
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ color: TONE_STYLE[chip.tone].fg, background: TONE_STYLE[chip.tone].bg }}
              >
                {/* 계획 §4.4 의 <b> 대신 <strong>. 보안 상세 테스트가 서버 글자의 HTML 미해석을 querySelector("b") 로 단언한다. */}
                {chip.label} <strong className="font-bold">{chip.count}</strong>
              </span>
            ))}
          </div>
        </>
      )}

      <div className={FOOT_CLASS}>
        {state.kind === "done" && summary !== null ? (
          <p>{prefix + summary.foot}</p>
        ) : state.kind === "failed" ? (
          <p>전문은 상세에서 봅니다</p>
        ) : (
          <p />
        )}
        <span className="shrink-0 font-semibold text-accent">상세 →</span>
      </div>
    </a>
  );
}

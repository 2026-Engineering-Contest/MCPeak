import type { JSX } from "react";
import { TokensPanel } from "../analyze/TokensPanel.js";
import type { AnalyzeTab } from "../analyze/types.js";
import { Card } from "../components/Card.js";
import { EmptyState } from "../components/EmptyState.js";
import { FOCUS_RING_INSET } from "../components/focus-ring.js";
import { PageHeader } from "../components/PageHeader.js";

const TABS: readonly { readonly id: AnalyzeTab; readonly label: string }[] = [
  { id: "tokens", label: "토큰" },
  { id: "security", label: "보안" },
];

/**
 * Analyze(계획서 §5.6). 탭은 링크다. 고른 탭이 해시(`#/analyze/<tab>`)에 남아야 새로 고침·뒤로
 * 가기·공유한 주소가 같은 탭을 연다. 눌린 탭의 모양은 `SegmentedControl` 의 눌린 쪽과 같다.
 */
export function AnalyzeView({ tab }: { readonly tab: AnalyzeTab }): JSX.Element {
  return (
    <section className="mx-auto max-w-[800px] space-y-6">
      <PageHeader
        title="분석"
        description="서버에 한 번 붙어 도구 정의를 읽고, 토큰 낭비와 보안 위험을 봅니다."
      />

      <div
        role="tablist"
        aria-label="분석 종류"
        className="inline-flex overflow-hidden rounded-md border border-line"
      >
        {TABS.map((item) => (
          <a
            key={item.id}
            role="tab"
            href={`#/analyze/${item.id}`}
            aria-selected={tab === item.id}
            className={`px-3 py-1.5 text-sm ${FOCUS_RING_INSET} ${
              tab === item.id
                ? "bg-accent-soft font-semibold text-accent"
                : "text-ink-muted hover:bg-line-subtle"
            }`}
          >
            {item.label}
          </a>
        ))}
      </div>

      {tab === "tokens" ? (
        <TokensPanel />
      ) : (
        <Card>
          <EmptyState
            message="보안 탭은 준비 중입니다."
            hint="mcpeak audit 의 결과(심각도별 발견 목록, 드리프트 기준 파일 상태)를 이 자리에 보여 줄 예정입니다."
            action={{ href: "#/analyze/tokens", label: "토큰 탭으로" }}
          />
        </Card>
      )}
    </section>
  );
}

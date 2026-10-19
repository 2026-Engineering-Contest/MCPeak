import type { JSX } from "react";
import { useRef, useState } from "react";
import { buildAnalyzeRequests, describeTarget } from "../analyze/build-analyze-requests.js";
import { INITIAL_SECURITY_FORM, type SecurityForm } from "../analyze/build-security-request.js";
import { ErrorAlert } from "../analyze/ErrorAlert.js";
import { PillarBadge, PillarCard } from "../analyze/PillarCard.js";
import { PILLARS, securitySummary, tokensSummary } from "../analyze/pillars.js";
import { SecurityProgressView } from "../analyze/SecurityProgress.js";
import { SecurityResult } from "../analyze/SecurityResult.js";
import { TargetBar } from "../analyze/TargetBar.js";
import { TokensResult } from "../analyze/TokensResult.js";
import type { AnalyzePillar } from "../analyze/types.js";
import { useAnalyzeTarget } from "../analyze/use-analyze-target.js";
import { type SecurityAnalysis, useSecurityAnalysis } from "../analyze/use-security-analysis.js";
import { type TokensAnalysis, useTokensAnalysis } from "../analyze/use-tokens-analysis.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { PageHeader } from "../components/PageHeader.js";

const PILLAR_NAME: Readonly<Record<AnalyzePillar, string>> = {
  security: "보안",
  tokens: "비용 최적화",
};

/** 상세 머리의 배지. 글자는 카드와 같다. idle 이면 없다. */
function detailBadge(
  pillar: AnalyzePillar,
  tokens: TokensAnalysis,
  security: SecurityAnalysis,
): JSX.Element | null {
  if (pillar === "security") {
    const { state, sent } = security;
    if (state.kind === "done" && sent !== null) {
      const { verdict } = securitySummary(sent, state.result);
      return <PillarBadge label={verdict.label} tone={verdict.tone} />;
    }
    if (state.kind === "running") return <PillarBadge label="점검 중…" tone="running" />;
    if (state.kind === "failed") return <PillarBadge label="실패" tone="failed" />;
    return null;
  }
  const { state } = tokens;
  if (state.kind === "done") {
    const { verdict } = tokensSummary(state.result);
    return <PillarBadge label={verdict.label} tone={verdict.tone} />;
  }
  if (state.kind === "running") return <PillarBadge label="분석 중…" tone="running" />;
  if (state.kind === "failed") return <PillarBadge label="실패" tone="failed" />;
  return null;
}

const IDLE_DETAIL = "아직 분석하지 않았습니다. 위에서 서버를 고르고 한 번에 분석을 누르세요.";

/** 보안 상세의 본문(설계 §3.4). 구독은 훅이 가지므로 여기서는 받은 events 를 그리기만 한다. */
function SecurityDetail({ security }: { readonly security: SecurityAnalysis }): JSX.Element {
  const { state, sent } = security;
  if (state.kind === "idle") {
    return <p className="text-sm text-ink-muted">{IDLE_DETAIL}</p>;
  }
  if (state.kind === "running") {
    return (
      <>
        <SecurityProgressView events={security.events} error={security.progressError} />
        {/* 취소 API 가 없다. 화면만 돌아가도 서버의 run 은 끝까지 돈다. */}
        <p className="text-xs text-ink-muted">점검은 중단되지 않고 끝까지 돕니다.</p>
      </>
    );
  }
  if (state.kind === "failed") {
    return <ErrorAlert message={state.error} />;
  }
  return (
    <>
      {/* 다시 점검의 시작 실패는 결과 위에 보인다. 앞 결과는 그대로 둔다. */}
      {security.startError !== null && <ErrorAlert message={security.startError} />}
      {sent !== null && (
        <>
          <SecurityResult key={state.serial} response={state.result} request={sent} />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={security.state.kind === "running"}
              onClick={() => void security.start(sent)}
            >
              다시 점검
            </Button>
          </div>
        </>
      )}
    </>
  );
}

/** 비용 최적화 상세의 본문(설계 §3.4). 옛 토큰 패널의 결과 단계와 같은 배치다. */
function TokensDetail({ tokens }: { readonly tokens: TokensAnalysis }): JSX.Element {
  const { state } = tokens;
  if (state.kind === "idle") {
    return <p className="text-sm text-ink-muted">{IDLE_DETAIL}</p>;
  }
  if (state.kind === "running") {
    return (
      <p role="status" className="text-sm text-ink-muted">
        분석 중…
      </p>
    );
  }
  if (state.kind === "failed") {
    return <ErrorAlert message={state.error} />;
  }
  return (
    <>
      {/* 다시 분석의 실패는 결과 위에 보인다. 이전 결과는 그대로 둔다. */}
      {tokens.reanalyzeError !== null && <ErrorAlert message={tokens.reanalyzeError} />}
      {tokens.reanalyzing && (
        <p role="status" className="text-sm text-ink-muted">
          분석 중…
        </p>
      )}
      <TokensResult
        key={state.serial}
        result={state.result}
        argv={tokens.analyzed?.argv ?? []}
        onReanalyze={() => void tokens.reanalyze()}
      />
    </>
  );
}

/**
 * Analyze(설계 2026-10-18 개정 1). 대상 영역 → 축 카드 셋 → 고른 축의 상세. 카드는 링크라 고른 축이
 * 해시(`#/analyze/<pillar>`)에 남고, 이 컴포넌트는 `pillar` prop 만 본다. 축 상태는 두 훅이 독립으로 들고,
 * 접속 상태·보안 옵션·대상 영역 펼침은 여기 한 번만 둔다. 라우트가 `#/analyze*` 안에서 바뀌어도 같은
 * 인스턴스라 상태가 남는다.
 */
export function AnalyzeView({ pillar }: { readonly pillar: AnalyzePillar | null }): JSX.Element {
  const target = useAnalyzeTarget();
  const [securityForm, setSecurityForm] = useState<SecurityForm>(INITIAL_SECURITY_FORM);
  const [targetOpen, setTargetOpen] = useState(true);
  const tokens = useTokensAnalysis();
  const security = useSecurityAnalysis();
  /** 한 번에 분석 한 번당 접기·`rememberCommand` 를 한 번만 하는 가드. */
  const collapsed = useRef(false);

  function patchForm(partial: Partial<SecurityForm>): void {
    setSecurityForm((previous) => ({ ...previous, ...partial }));
  }

  // 한 번에 분석(설계 §7). 버튼 비활성 판정·사유·제출이 같은 값을 쓴다. 돌고 있는 동안의 사유가 입력 오류보다 앞선다.
  const built = buildAnalyzeRequests(target, securityForm);
  const running = tokens.state.kind === "running" || security.state.kind === "running";
  const disabledReason = running ? "분석이 돌고 있습니다" : "error" in built ? built.error : null;

  /** 두 요청 중 하나라도 시작에 성공하면 한 번만. */
  function collapseOnce(): void {
    if (collapsed.current) return;
    collapsed.current = true;
    setTargetOpen(false);
    target.rememberCommand();
  }

  function runAll(): void {
    if (!("tokens" in built) || running) return;
    collapsed.current = false;
    // 같은 틱에 둘 다 보낸다. await 로 잇지 않는다. 토큰 먼저, 보안 다음(설계 §1.3 이 이 순서를 단언한다).
    const tokensDone = tokens.start(built.tokens);
    const securityDone = security.start(built.security);
    // Promise.all 로 묶지 않는다. 토큰은 응답이 와야 끝나므로, 보안이 먼저 시작되면 그 즉시 접힌다(설계 §7.4).
    void tokensDone.then((ok) => {
      if (ok) collapseOnce();
    });
    void securityDone.then((ok) => {
      if (ok) collapseOnce();
    });
  }

  // §3.3 의 전이상 done 이면 analyzed·sent 가 항상 있다. 가드는 타입을 위한 것이다.
  const tokensCard =
    tokens.state.kind === "done" && tokens.analyzed !== null
      ? {
          summary: tokensSummary(tokens.state.result),
          analyzedTarget: describeTarget(target.candidates, tokens.analyzed),
        }
      : { summary: null, analyzedTarget: null };
  const securityCard =
    security.state.kind === "done" && security.sent !== null
      ? {
          summary: securitySummary(security.sent, security.state.result),
          analyzedTarget: describeTarget(target.candidates, security.sent),
        }
      : { summary: null, analyzedTarget: null };

  return (
    <section className="mx-auto max-w-[1040px] space-y-6">
      <PageHeader
        title="분석"
        description="서버에 한 번 붙어 도구 정의를 읽고, 세 축으로 나눠 봅니다. 축을 고르면 상세가 아래에 펼쳐집니다."
      />

      <TargetBar
        target={target}
        form={securityForm}
        onFormChange={patchForm}
        open={targetOpen}
        onOpen={() => setTargetOpen(true)}
        onRunAll={runAll}
        disabledReason={disabledReason}
        running={running}
      />

      {/* Tailwind 의 md 는 768px 이다. 설계의 760px 와 8px 다르지만 토큰을 새로 만들지 않는다. */}
      <div role="tablist" aria-label="분석 축" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {PILLARS.map((descriptor) => {
          const card =
            descriptor.id === "tokens"
              ? { state: tokens.state, ...tokensCard }
              : descriptor.id === "security"
                ? { state: security.state, ...securityCard }
                : { state: { kind: "idle" as const }, summary: null, analyzedTarget: null };
          return (
            <PillarCard
              key={descriptor.id}
              descriptor={descriptor}
              selected={pillar === descriptor.id}
              state={card.state}
              summary={card.summary}
              analyzedTarget={card.analyzedTarget}
            />
          );
        })}
      </div>

      {pillar !== null && (
        <section role="tabpanel" id={`panel-${pillar}`} aria-labelledby={`pillar-${pillar}`}>
          <Card className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-title font-semibold text-ink">{PILLAR_NAME[pillar]} 상세</h2>
              {detailBadge(pillar, tokens, security)}
            </div>
            {pillar === "security" ? (
              <SecurityDetail security={security} />
            ) : (
              <TokensDetail tokens={tokens} />
            )}
          </Card>
        </section>
      )}
    </section>
  );
}

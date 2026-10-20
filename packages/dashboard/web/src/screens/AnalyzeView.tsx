import type { JSX } from "react";
import { useRef, useState } from "react";
import { buildAnalyzeRequests, describeTarget } from "../analyze/build-analyze-requests.js";
import {
  INITIAL_PERF_FORM,
  type PerfForm,
  performanceUnavailable,
} from "../analyze/build-perf-request.js";
import { ErrorAlert } from "../analyze/ErrorAlert.js";
import { PassedChecks } from "../analyze/PassedChecks.js";
import { PERFORMANCE_IDLE_NOTE, PerformanceDetail } from "../analyze/PerformanceResult.js";
import { PillarBadge } from "../analyze/PillarBadge.js";
import { PillarCard } from "../analyze/PillarCard.js";
import { PILLARS, performanceSummary, securitySummary, tokensSummary } from "../analyze/pillars.js";
import { SecurityProgressView } from "../analyze/SecurityProgress.js";
import { SecurityResult } from "../analyze/SecurityResult.js";
import { SANDBOX_WRITE_NOTICE } from "../analyze/sandbox-hint.js";
import { securityExecution } from "../analyze/security-execution.js";
import { TargetBar } from "../analyze/TargetBar.js";
import { TokensResult } from "../analyze/TokensResult.js";
import type { AnalyzePillar } from "../analyze/types.js";
import { useAnalyzeTarget } from "../analyze/use-analyze-target.js";
import {
  type PerformanceAnalysis,
  usePerformanceAnalysis,
} from "../analyze/use-performance-analysis.js";
import { type SecurityAnalysis, useSecurityAnalysis } from "../analyze/use-security-analysis.js";
import { type TokensAnalysis, useTokensAnalysis } from "../analyze/use-tokens-analysis.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { PageHeader } from "../components/PageHeader.js";

const PILLAR_NAME: Readonly<Record<AnalyzePillar, string>> = {
  security: "보안",
  tokens: "비용 최적화",
  performance: "성능 효율성",
};

/** 상세 머리의 배지. 글자는 카드와 같다. idle 이면 없다. */
function detailBadge(
  pillar: AnalyzePillar,
  tokens: TokensAnalysis,
  security: SecurityAnalysis,
  performance: PerformanceAnalysis,
): JSX.Element | null {
  if (pillar === "performance") {
    const { state } = performance;
    if (state.kind === "done") {
      const { verdict } = performanceSummary(state.result);
      return <PillarBadge label={verdict.label} tone={verdict.tone} />;
    }
    if (state.kind === "running") return <PillarBadge label="측정 중…" tone="running" />;
    if (state.kind === "failed") return <PillarBadge label="실패" tone="failed" />;
    return null;
  }
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

/**
 * 결과 단계에서 한 축만 idle 일 때의 안내. 두 요청은 같은 틱에 나가므로 지금 흐름에서는 보이지 않는다.
 * 상태 타입이 idle 을 갖고 있어 갈래를 남겨 둔다.
 */
const IDLE_DETAIL = "아직 분석하지 않았습니다. 위에서 서버를 고르고 분석하기를 누르세요.";

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
          <SecurityResult
            key={state.serial}
            response={state.result}
            request={sent}
            // 발견 없이 통과한 검사(ADR-0117). 발견 목록 바로 다음에 온다. 서버가 센 목록을 그리기만 한다.
            passedChecks={<PassedChecks rules={state.result.passedRules} />}
          />
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
 * Analyze(ADR-0117). 두 단계다. 서버 선택 단계는 대상 영역(접속 폼·분석하기)뿐이고, 분석하기를 한 번
 * 누르면 결과 단계로 넘어가 대상 영역 아래에 축 카드 셋이 붙는다. 카드는 링크라 고른 축이 해시
 * (`#/analyze/<pillar>`)에 남고, 그 축의 상세는 카드 아래에 펼쳐진다. 이 컴포넌트는 `pillar` prop 만 본다.
 * 서버 선택 단계에서는 `pillar` 가 있어도 상세를 그리지 않는다(아직 결과가 없다). 해시는 건드리지 않는다.
 * 축 상태는 두 훅이 독립으로 들고, 접속 상태·대상 영역 펼침은 여기 한 번만 둔다. 점검 옵션은 없다.
 * 격리는 고르지 않고 늘 시도한다. 쓸 수 없으면 격리 없이(readonly) 돌고, 어느 쪽으로 돌았는지를 카드와
 * 상세 머리가 보인다. 기준 파일·호출 정책은 CLI `mcpeak audit` 에서만 고른다. 라우트가 `#/analyze*` 안에서
 * 바뀌어도 같은 인스턴스라 상태가 남는다.
 */
export function AnalyzeView({ pillar }: { readonly pillar: AnalyzePillar | null }): JSX.Element {
  const target = useAnalyzeTarget();
  const [targetOpen, setTargetOpen] = useState(true);
  const tokens = useTokensAnalysis();
  const security = useSecurityAnalysis();
  const performance = usePerformanceAnalysis();
  /** 성능 상세의 폼. 상세를 오가도 남도록 여기 둔다. */
  const [perfForm, setPerfForm] = useState<PerfForm>(INITIAL_PERF_FORM);
  /** 분석하기 한 번당 접기·`rememberCommand` 를 한 번만 하는 가드. */
  const collapsed = useRef(false);

  // 분석하기(설계 §7). 버튼 비활성 판정·사유·제출이 같은 값을 쓴다. 돌고 있는 동안의 사유가 입력 오류보다 앞선다.
  const built = buildAnalyzeRequests(target);
  const otherRunning = tokens.state.kind === "running" || security.state.kind === "running";
  // 성능이 도는 동안에도 분석하기를 막는다. 측정이 다른 축의 부하를 함께 재지 않게 한다(ADR-0119).
  const running = otherRunning || performance.state.kind === "running";
  const disabledReason = running ? "분석이 돌고 있습니다" : "error" in built ? built.error : null;
  // 결과 단계는 축 상태에서 바로 읽는다. 어느 축이든 idle 을 벗어나면 결과 단계다. 두 훅 모두 idle 로
  // 돌아가는 전이가 없으므로 한 번 넘어가면 서버 선택 단계로 돌아가지 않는다. 둘 다 시작에 실패해도
  // failed 라 결과 단계이고, 카드가 실패를 보인다. 성능은 결과 단계에서만 시작하므로 여기서 보지 않는다.
  const hasResults = tokens.state.kind !== "idle" || security.state.kind !== "idle";

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
  const performanceCard =
    performance.state.kind === "done" && performance.sent !== null
      ? {
          summary: performanceSummary(performance.state.result),
          analyzedTarget: describeTarget(target.candidates, performance.sent),
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
        open={targetOpen}
        onOpen={() => setTargetOpen(true)}
        onRunAll={runAll}
        disabledReason={disabledReason}
        // 격리를 시도하는 대상이면 외부 쓰기 부작용을 미리 알린다(ADR-0117).
        notice={
          "security" in built && built.security.sandbox !== undefined ? SANDBOX_WRITE_NOTICE : null
        }
        running={running}
      />

      {hasResults && (
        <>
          {/* Tailwind 의 md 는 768px 이다. 설계의 760px 와 8px 다르지만 토큰을 새로 만들지 않는다. */}
          <div
            role="tablist"
            aria-label="분석 축"
            className="grid grid-cols-1 gap-3 md:grid-cols-3"
          >
            {PILLARS.map((descriptor) => {
              const card =
                descriptor.id === "tokens"
                  ? { state: tokens.state, ...tokensCard }
                  : descriptor.id === "security"
                    ? { state: security.state, ...securityCard }
                    : { state: performance.state, ...performanceCard };
              return (
                <PillarCard
                  key={descriptor.id}
                  descriptor={descriptor}
                  selected={pillar === descriptor.id}
                  state={card.state}
                  summary={card.summary}
                  analyzedTarget={card.analyzedTarget}
                  {...(descriptor.id === "performance"
                    ? {
                        idleNote:
                          performanceUnavailable(target.state.transport) ?? PERFORMANCE_IDLE_NOTE,
                      }
                    : {})}
                />
              );
            })}
          </div>

          {pillar !== null && (
            <section role="tabpanel" id={`panel-${pillar}`} aria-labelledby={`pillar-${pillar}`}>
              <Card className="space-y-4 p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-title font-semibold text-ink">{PILLAR_NAME[pillar]} 상세</h2>
                  {detailBadge(pillar, tokens, security, performance)}
                  {/* 보안 점검이 어디서 돌았는가(ADR-0117). 응답에서 순수 함수로 구한다. */}
                  {pillar === "security" && security.state.kind === "done" && (
                    <p className="break-words text-sm text-ink-muted">
                      {securityExecution(security.state.result)}
                    </p>
                  )}
                </div>
                {pillar === "security" ? (
                  <SecurityDetail security={security} />
                ) : pillar === "performance" ? (
                  <PerformanceDetail
                    performance={performance}
                    form={perfForm}
                    onFormChange={setPerfForm}
                    argv={target.argv}
                    serverId={target.serverId}
                    transport={target.state.transport}
                    root={target.root}
                    otherRunning={otherRunning}
                  />
                ) : (
                  <TokensDetail tokens={tokens} />
                )}
              </Card>
            </section>
          )}
        </>
      )}
    </section>
  );
}

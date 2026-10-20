import type { PerfFinding } from "@mcpeak/perf";
import type { JSX } from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { AnalyzePerfResponse, FileContent, FileEntry } from "../../../src/api-types.js";
import { apiGet } from "../api.js";
import type { Transport } from "../build-test-argv.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Field, INPUT_CLASS } from "../components/Field.js";
import { FOCUS_RING } from "../components/focus-ring.js";
import { LogPanel } from "../components/LogPanel.js";
import { matchSuites } from "../home/match-suites.js";
import {
  buildPerfRequest,
  type PerfForm,
  performanceUnavailable,
  perfStartNotice,
} from "./build-perf-request.js";
import { ErrorAlert } from "./ErrorAlert.js";
import {
  caseColumns,
  observationLabel,
  performanceCounts,
  RULE_LABEL,
  unmeasuredReason,
} from "./performance-view.js";
import type { PerformanceAnalysis } from "./use-performance-analysis.js";

/** 다른 축이 도는 동안의 시작 비활성 사유(구현계획 §5.2 R11). 측정이 다른 축의 부하를 함께 재지 않게 한다. */
export const OTHER_RUNNING_REASON = "다른 분석이 끝난 뒤 측정할 수 있습니다.";

/** 성능 카드의 idle 문장(R1). 다른 축처럼 분석하기를 기다린다고 읽히지 않게 한다. */
export const PERFORMANCE_IDLE_NOTE = "상세에서 명세를 골라 측정합니다";

/** 고른 서버에 딸린 명세가 없을 때의 안내. 생성 화면 링크가 뒤따른다. */
export const NO_MATCHED_SUITE =
  "이 서버용 테스트 명세가 없습니다. 성능 측정은 명세의 케이스를 그대로 호출하므로 먼저 명세를 만드세요.";

/** argv 의 `--arg` 값들. 홈 마법사가 `matchSuites` 에 넘기는 서버 인자와 같은 값이다(직접 입력이면 스크립트 경로가 선두). */
function serverArgs(argv: readonly string[]): readonly string[] {
  return argv.flatMap((value, index) => (index > 0 && argv[index - 1] === "--arg" ? [value] : []));
}

/** 고른 명세의 내용 읽기. 승인 여부는 명세 JSON 에 `approval` 키가 있는지다(runner reporter 와 같은 기준). */
type SuiteRead =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly approved: boolean }
  | { readonly kind: "failed"; readonly error: string };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 내용이 JSON 객체이고 `approval` 키가 있으면 승인. 읽지 못하면 미승인으로 본다(고지가 하나 더 보이는 쪽이 안전하다). */
function hasApproval(content: string): boolean {
  try {
    const spec: unknown = JSON.parse(content);
    return typeof spec === "object" && spec !== null && !Array.isArray(spec) && "approval" in spec;
  } catch {
    return false;
  }
}

/**
 * 성능 상세(ADR-0119, 구현계획 §5). 명세를 고르고 반복 횟수를 정해 시작하면 `POST /api/analyze/perf` 가 나간다.
 * 분석하기는 이 요청을 보내지 않는다. 비활성 판정·사유·제출이 같은 `buildPerfRequest` 를 부른다. 사유는 원격 대상이
 * 가장 앞이다(대상을 바꾸지 않으면 풀리지 않는다). 그다음이 다른 축의 실행, 그다음이 폼 오류다.
 * 결과는 PerformanceResult 가 구획으로 그린다. rendered 원문은 보이지 않는다. 취소는 없다.
 */
export function PerformanceDetail({
  performance,
  form,
  onFormChange,
  argv,
  serverId,
  transport,
  otherRunning,
}: {
  readonly performance: PerformanceAnalysis;
  readonly form: PerfForm;
  readonly onFormChange: (form: PerfForm) => void;
  /** 대상 영역의 argv 결과. 분석하기와 같은 값이다. */
  readonly argv: { readonly argv: readonly string[] } | { readonly error: string };
  readonly serverId: string | undefined;
  readonly transport: Transport;
  /** 토큰 또는 보안이 running 이다. */
  readonly otherRunning: boolean;
}): JSX.Element {
  /** null 이면 아직 목록을 받지 못했다. */
  const [suites, setSuites] = useState<readonly FileEntry[] | null>(null);
  const [suitesError, setSuitesError] = useState<string | null>(null);
  const [suiteRead, setSuiteRead] = useState<SuiteRead | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);
  /** done 에서 명세 바꾸기를 눌렀다. 폼을 다시 보인다. 결과는 다음 측정이 시작될 때 내린다(훅). */
  const [choosing, setChoosing] = useState(false);
  /** 딸린 명세가 하나뿐일 때 미리 고르는 것은 목록을 받은 뒤 한 번만이다. 사용자가 바꾼 선택을 되돌리지 않는다. */
  const preselected = useRef(false);
  const { state } = performance;
  const running = state.kind === "running";

  useEffect(() => {
    apiGet<FileEntry[]>("/api/suites")
      .then((list) => setSuites(list))
      .catch((err: unknown) => {
        setSuites([]);
        setSuitesError(messageOf(err));
      });
  }, []);

  // 홈 마법사와 같은 규칙으로 고른 서버에 딸린 명세만 위에 편다. 나머지는 접는다.
  const { matched, others } = matchSuites(
    "argv" in argv ? serverArgs(argv.argv) : [],
    suites ?? [],
  );
  const onlyMatch = matched.length === 1 ? matched[0]?.path : undefined;
  // 고른 명세가 접힌 쪽에 있으면 펴 둔다. 고른 것이 안 보이면 무엇을 측정하는지 모른다.
  const showOthers = othersOpen || others.some((suite) => suite.path === form.suitePath);

  useEffect(() => {
    if (suites === null || preselected.current) return;
    preselected.current = true;
    if (onlyMatch !== undefined && form.suitePath === "") {
      onFormChange({ ...form, suitePath: onlyMatch });
    }
  }, [suites, onlyMatch, form, onFormChange]);

  useEffect(() => {
    if (form.suitePath === "") {
      setSuiteRead(null);
      return;
    }
    // 앞 명세의 응답이 늦게 오면 버린다. 안 그러면 B 를 골랐는데 A 의 승인 여부가 보인다.
    let current = true;
    setSuiteRead({ kind: "loading" });
    apiGet<FileContent>(`/api/suites/${encodeURIComponent(form.suitePath)}`)
      .then((file) => {
        if (current) setSuiteRead({ kind: "ready", approved: hasApproval(file.content) });
      })
      .catch((err: unknown) => {
        if (current) setSuiteRead({ kind: "failed", error: messageOf(err) });
      });
    return () => {
      current = false;
    };
  }, [form.suitePath]);

  let built: { readonly request: ReturnType<typeof buildPerfRequest> } | { readonly error: string };
  try {
    if (!("argv" in argv)) throw new Error(argv.error);
    built = { request: buildPerfRequest(argv.argv, serverId, transport, form) };
  } catch (err) {
    built = { error: messageOf(err) };
  }
  const reason =
    performanceUnavailable(transport) ??
    (otherRunning ? OTHER_RUNNING_REASON : "error" in built ? built.error : null);
  // 내용을 아직 못 읽었으면 미승인으로 본다.
  const approved = suiteRead?.kind === "ready" && suiteRead.approved;

  function suiteRow(suite: FileEntry): JSX.Element {
    return (
      <label key={suite.path} className="flex min-w-0 items-center gap-2 text-sm text-ink">
        <input
          type="radio"
          name="perf-suite"
          value={suite.path}
          checked={form.suitePath === suite.path}
          onChange={() => onFormChange({ ...form, suitePath: suite.path })}
        />
        <span className="break-all font-mono text-xs">{suite.path}</span>
      </label>
    );
  }

  function start(): void {
    if (reason !== null || running || !("request" in built)) return;
    void performance.start(built.request).then((ok) => {
      // 새 측정이 시작되면 앞 결과는 내려가고(훅) 폼도 닫는다. 실패하면 폼에 남아 문장을 본다.
      if (ok) setChoosing(false);
    });
  }

  if (running) {
    return (
      <>
        <PerformanceProgressView events={performance.events} error={performance.progressError} />
        {/* 취소 API 가 없다. 화면만 돌아가도 서버의 run 은 끝까지 돈다. */}
        <p className="text-xs text-ink-muted">측정은 중단되지 않고 끝까지 돕니다.</p>
      </>
    );
  }

  const { sent } = performance;
  // 다시 측정은 보낸 요청을 그대로 다시 보내지만, 지금 대상이 원격이면 막는다. 화면이 원격 대상을 보이는데
  // 측정이 다시 나가면 사용자는 원격을 잰 것으로 읽는다(G6). 원격 사유가 다른 축 실행보다 앞선다.
  const rerunReason =
    performanceUnavailable(transport) ?? (otherRunning ? OTHER_RUNNING_REASON : null);
  if (state.kind === "done" && sent !== null && !choosing) {
    return (
      <>
        {/* 다시 측정의 시작 실패는 결과 위에 보인다. 앞 결과는 그대로 둔다. */}
        {performance.startError !== null && <ErrorAlert message={performance.startError} />}
        <PerformanceResult key={state.serial} response={state.result} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={rerunReason !== null} onClick={() => void performance.start(sent)}>
            다시 측정
          </Button>
          <Button onClick={() => setChoosing(true)}>명세 바꾸기</Button>
        </div>
        {rerunReason !== null && <p className="text-xs text-ink-muted">{rerunReason}</p>}
      </>
    );
  }

  return (
    <div className="space-y-5">
      {/* 첫 측정의 실패는 폼 위에 전문으로 보인다. 폼이 남아 있어 명세를 바꿔 다시 시작할 수 있다. */}
      {state.kind === "failed" && <ErrorAlert message={state.error} />}
      {/* 명세 바꾸기 뒤 시작이 실패하면 결과(done)는 그대로이고 문장만 여기 보인다. */}
      {state.kind === "done" && performance.startError !== null && (
        <ErrorAlert message={performance.startError} />
      )}
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 text-sm font-medium text-ink">명세</legend>
        {suitesError !== null && <ErrorAlert message={suitesError} />}
        {suites !== null && matched.length === 0 && (
          <div className="space-y-2 rounded-md border border-line bg-line-subtle px-3 py-2 text-sm text-ink-muted">
            <p>{NO_MATCHED_SUITE}</p>
            <a href="#/generate" className={`font-semibold text-accent ${FOCUS_RING}`}>
              명세 만들기
            </a>
          </div>
        )}
        {matched.map(suiteRow)}
        {others.length > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              aria-expanded={showOthers}
              className={`text-sm text-ink-muted hover:text-ink ${FOCUS_RING}`}
              onClick={() => setOthersOpen((previous) => !previous)}
            >
              {showOthers ? "▾" : "▸"} 다른 명세 보기 ({others.length})
            </button>
            {showOthers && others.map(suiteRow)}
          </div>
        )}
      </fieldset>

      <div className="max-w-[160px]">
        <Field label="반복 횟수" htmlFor="perf-repeat">
          <input
            id="perf-repeat"
            className={INPUT_CLASS}
            inputMode="numeric"
            value={form.repeat}
            onChange={(event) => onFormChange({ ...form, repeat: event.target.value })}
          />
        </Field>
      </div>

      {suiteRead?.kind === "failed" && <ErrorAlert message={suiteRead.error} />}

      <div className="space-y-2 border-t border-line pt-5">
        {"request" in built && (
          <div className="space-y-1 text-xs text-ink-muted">
            {/* 요청이 만들어졌으면 반복 횟수는 이미 검사를 통과한 정수다. */}
            {perfStartNotice(Number(form.repeat.trim()), approved).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        <Button variant="primary" disabled={reason !== null} onClick={start}>
          측정 시작
        </Button>
        {reason !== null && <p className="text-xs text-ink-muted">{reason}</p>}
      </div>
    </div>
  );
}

/** 진행 패널. 보안 `SecurityProgressView` 와 같은 모양이고 격리 안내만 없다. 구독은 훅이 가진다. */
function PerformanceProgressView({
  events,
  error,
}: {
  readonly events: PerformanceAnalysis["events"];
  readonly error: string | null;
}): JSX.Element {
  return (
    <>
      {/* LogPanel 은 부모의 남는 높이를 채우는 모양이다. 높이를 묶어 주지 않으면 화면이 로그만큼 길어진다. */}
      <div className="flex h-[440px] flex-col">
        <LogPanel title="진행" events={events} />
      </div>
      {error !== null && <ErrorAlert message={error} />}
    </>
  );
}

/* 아래 클래스·톤은 SecurityResult.tsx 의 것을 복제했다. 보안 파일을 고치지 않고 같은 모양을 내기 위해서다. */

/** 구획 제목. */
const SECTION_TITLE_CLASS = "text-sm font-semibold";
/** 진단의 규칙 배지. 둥글고 굵다. */
const BADGE_CLASS = "inline-block rounded-full px-2 py-0.5 text-xs font-semibold";
/** 판정 줄의 집계 칩. 같은 모양이고 숫자만 굵다. */
const COUNT_CHIP_CLASS = "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium";

interface Tone {
  readonly fg: string;
  readonly bg: string;
}
const DONE_TONE: Tone = { fg: "var(--status-done-fg)", bg: "var(--status-done-bg)" };
const WAITING_TONE: Tone = { fg: "var(--status-waiting-fg)", bg: "var(--status-waiting-bg)" };
const FAILED_TONE: Tone = { fg: "var(--status-failed-fg)", bg: "var(--status-failed-bg)" };
/** 0 인 칩의 흐린 톤. 보안의 정보 톤과 같다. */
const MUTED_TONE: Tone = { fg: "var(--ink-muted)", bg: "var(--line-subtle)" };

interface CountChip {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly unit: string;
  readonly tone: Tone;
}

/** 진단 하나. 보안 FindingItem 과 같은 모양이다. 머리는 첫 줄, 나머지는 "→" 줄이다. 글자는 perf 가 만든 그대로다. */
function FindingItem({ finding }: { readonly finding: PerfFinding }): JSX.Element {
  const [head, ...rest] = finding.lines;
  return (
    <li className="space-y-1.5 border-l-4 px-4 py-3" style={{ borderLeftColor: WAITING_TONE.fg }}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={BADGE_CLASS}
          style={{ color: WAITING_TONE.fg, background: WAITING_TONE.bg }}
        >
          {RULE_LABEL[finding.ruleId]}
        </span>
        <span className="break-all font-mono text-sm font-semibold text-ink">
          {finding.tools.join(", ")}
        </span>
      </p>
      {head !== undefined && <p className="break-words text-sm font-medium text-ink">{head}</p>}
      {rest.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 진단 줄은 perf 가 보낸 순서 그대로이고 같은 글자가 겹칠 수 있다
        <p key={index} className="break-words text-sm text-ink">{`→ ${line}`}</p>
      ))}
    </li>
  );
}

/**
 * 성능 측정 결과(ADR-0119). 보안 결과(`SecurityResult`)와 같은 구조다. 판정 카드, 중단 띠, 개선 지점, 케이스별
 * 응답 시간, 미측정 케이스, 이 측정의 한계 순이다. 숫자와 문장은 perf 리포트에서 오고, 표의 칸과 사유는
 * CLI 와 같은 규칙(`performance-view.ts`)으로 만든다. CLI 리포트 원문은 보이지 않는다.
 */
export function PerformanceResult({
  response,
}: {
  readonly response: AnalyzePerfResponse;
}): JSX.Element {
  const { report } = response;
  const counts = performanceCounts(report);
  const observed = report.settings.observation === "preload";
  const columns = caseColumns(report);
  const measured = report.cases.filter((entry) => entry.n > 0);
  const unmeasured = report.cases.filter((entry) => entry.n === 0);

  // 카드 칩(performanceSummary)과 같은 셋, 같은 순서다. 미측정은 카드처럼 info 톤이라 0 이 아니어도 흐리다.
  const chips: readonly CountChip[] = [
    { key: "measured", label: "측정", count: counts.measured, unit: "개", tone: DONE_TONE },
    { key: "unmeasured", label: "미측정", count: counts.unmeasured, unit: "개", tone: MUTED_TONE },
    { key: "findings", label: "진단", count: counts.findings, unit: "건", tone: WAITING_TONE },
  ];
  const summary: readonly (readonly [string, string])[] = [
    ["서버", report.server.command],
    ["도구", `${report.server.toolCount}개`],
    ["설정", `반복 ${report.settings.repeat}회 · 케이스 ${report.settings.caseCount}개`],
    ["관측", observationLabel(report)],
    // CLI 머리 줄과 같은 값이다(반올림하지 않는다).
    [
      "콜드 스타트",
      `기동 ${report.coldStart.connectMs}ms · tools/list ${report.coldStart.listToolsMs}ms`,
    ],
  ];

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-4">
        {/* 쉼표와 공백은 텍스트 노드로 둔다. flex 로 짜면 그 공백이 사라진다. */}
        <p className="text-sm font-medium leading-8 text-ink">
          {"판정: "}
          {chips.map((chip, index) => {
            // 0 인 칩은 흐리게 둔다. 눈이 수가 있는 칩으로 먼저 간다.
            const tone = chip.count === 0 ? MUTED_TONE : chip.tone;
            return (
              <Fragment key={chip.key}>
                {index > 0 && ", "}
                <span
                  data-count={chip.key}
                  className={COUNT_CHIP_CLASS}
                  style={{ color: tone.fg, background: tone.bg }}
                >
                  {`${chip.label} `}
                  <span className="font-bold tabular-nums">{chip.count}</span>
                  {chip.unit}
                </span>
              </Fragment>
            );
          })}
        </p>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {summary.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-caption font-medium text-ink-muted">{label}</dt>
              <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {response.abortedLine !== null && (
        <p
          role="alert"
          className="break-words rounded-md border-l-4 px-4 py-3 text-sm font-medium"
          style={{
            color: FAILED_TONE.fg,
            background: FAILED_TONE.bg,
            borderLeftColor: FAILED_TONE.fg,
          }}
        >
          {response.abortedLine}
        </p>
      )}

      <section className="space-y-2">
        <h3
          className={`${SECTION_TITLE_CLASS} text-ink`}
        >{`개선 지점 ${report.findings.length}건`}</h3>
        {!observed ? (
          <p className="text-sm text-ink-muted">
            서버 안을 관측하지 못해 개선 지점을 찾지 않았습니다.
          </p>
        ) : report.findings.length === 0 ? (
          <p className="text-sm font-medium" style={{ color: DONE_TONE.fg }}>
            개선 지점이 없습니다.
          </p>
        ) : (
          // 왼쪽 띠가 카드의 둥근 모서리 밖으로 나가지 않게 자른다.
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line-subtle">
              {report.findings.map((finding, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 진단은 리포트 순서 그대로이고 목록은 응답마다 통째로 온다
                <FindingItem key={index} finding={finding} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      {measured.length > 0 && (
        <section className="space-y-2">
          <h3 className={`${SECTION_TITLE_CLASS} text-ink`}>케이스별 응답 시간</h3>
          {/* 좁은 폭에서는 표만 가로로 스크롤한다. 화면 전체가 넘치지 않게 한다. */}
          <Card className="overflow-x-auto">
            <table aria-label="케이스별 응답 시간" className="w-full text-left text-sm">
              <thead className="border-b border-line text-caption font-medium text-ink-muted">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.header}
                      className={`whitespace-nowrap px-4 py-2 font-medium${
                        column.align === "right" ? " text-right" : ""
                      }`}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {measured.map((entry) => (
                  <tr key={entry.id}>
                    {columns.map((column) => (
                      <td
                        key={column.header}
                        className={
                          column.align === "right"
                            ? "px-4 py-2 text-right tabular-nums text-ink"
                            : "break-all px-4 py-2 font-mono text-xs text-ink"
                        }
                      >
                        {column.value(entry)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      {unmeasured.length > 0 && (
        <details className="rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-ink">
            {`미측정 케이스 ${unmeasured.length}개`}
          </summary>
          <ul className="list-disc space-y-1 border-t border-line py-3 pr-4 pl-9 text-sm text-ink-muted">
            {unmeasured.map((entry) => (
              <li key={entry.id} className="break-words">
                <span className="font-mono text-xs font-semibold text-ink">{entry.id}</span>
                {`: ${unmeasuredReason(entry)}`}
              </li>
            ))}
          </ul>
        </details>
      )}

      <section className="space-y-2">
        <h3 className={`${SECTION_TITLE_CLASS} text-ink`}>이 측정의 한계</h3>
        {/* 경고가 아니라 주석이다. 경고 색을 쓰지 않고 옅은 바탕의 상자에 둔다. */}
        <div className="rounded-md bg-line-subtle px-4 py-3">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {response.limits.map((limit, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 한계 문장은 서버가 보낸 줄 그대로라 값만으로 유일하다는 보장이 없다
              <li key={index} className="break-words">
                {limit}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

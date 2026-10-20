import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type { FileContent, FileEntry } from "../../../src/api-types.js";
import { apiGet } from "../api.js";
import type { Transport } from "../build-test-argv.js";
import { Button } from "../components/Button.js";
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
 * 결과는 perf 리포트의 `rendered` 를 그대로 보인다. 취소는 없다.
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
    void performance.start(built.request);
  }

  return (
    <div className="space-y-5">
      <fieldset className="min-w-0 space-y-2" disabled={running}>
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
            disabled={running}
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
        <Button variant="primary" disabled={reason !== null || running} onClick={start}>
          {running ? "측정 중…" : "측정 시작"}
        </Button>
        {reason !== null && !running && <p className="text-xs text-ink-muted">{reason}</p>}
      </div>

      {running && (
        <>
          {/* LogPanel 은 부모의 남는 높이를 채우는 모양이다. 높이를 묶어 주지 않으면 화면이 로그만큼 길어진다. */}
          <div className="flex h-[440px] flex-col">
            <LogPanel title="진행" events={performance.events} />
          </div>
          {performance.progressError !== null && <ErrorAlert message={performance.progressError} />}
        </>
      )}
      {state.kind === "failed" && <ErrorAlert message={state.error} />}
      {state.kind === "done" && (
        <>
          {/* 다시 측정의 시작 실패는 결과 위에 보인다. 앞 결과는 그대로 둔다. */}
          {performance.startError !== null && <ErrorAlert message={performance.startError} />}
          <pre
            key={state.serial}
            className="max-h-[600px] overflow-auto rounded-md border border-line bg-line-subtle p-4 font-mono text-xs text-ink"
          >
            {state.result.rendered}
          </pre>
        </>
      )}
    </div>
  );
}

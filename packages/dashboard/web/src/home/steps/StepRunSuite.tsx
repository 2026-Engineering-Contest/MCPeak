import type { JSX } from "react";
import { useRef, useState } from "react";
import type { FileContent, FileEntry } from "../../../../src/api-types.js";
import { apiGet } from "../../api.js";
import type { SuiteSummary } from "../../suite-summary.js";
import { summarizeSuite } from "../../suite-summary.js";
import { matchSuites } from "../match-suites.js";

type SpecState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly summary: SuiteSummary }
  | { readonly kind: "error"; readonly reason: string };

function SpecView(props: { state: SpecState }): JSX.Element {
  if (props.state.kind === "loading") {
    return <p className="text-xs text-ink-muted">명세를 읽는 중...</p>;
  }
  if (props.state.kind === "error") {
    return (
      <p className="text-xs" style={{ color: "var(--status-failed-fg)" }}>
        명세를 읽지 못했습니다: {props.state.reason}
      </p>
    );
  }
  const { summary } = props.state;
  return (
    <div className="rounded border border-line bg-canvas px-3 py-2">
      <p className="text-xs font-medium text-ink">
        {summary.name} (id {summary.id}) · 케이스 {summary.caseCount}건
      </p>
      <pre className="mt-1 overflow-x-auto whitespace-pre font-mono text-xs text-ink">
        {summary.lines.join("\n")}
      </pre>
    </div>
  );
}

function SuiteRow(props: {
  suite: FileEntry;
  checked: boolean;
  spec: SpecState | null;
  onSelect: () => void;
  onToggleSpec: () => void;
}): JSX.Element {
  return (
    <li className="space-y-2">
      <div
        className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
          props.checked ? "border-accent bg-accent-soft" : "border-line bg-surface"
        }`}
      >
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
          <input
            type="radio"
            name="home-run-suite"
            checked={props.checked}
            onChange={props.onSelect}
          />
          <span className="min-w-0 break-all font-mono text-xs text-ink">{props.suite.path}</span>
        </label>
        <button
          type="button"
          aria-expanded={props.spec !== null}
          className="shrink-0 rounded border border-line px-3 py-1 text-xs text-ink-muted"
          onClick={props.onToggleSpec}
        >
          {props.spec !== null ? "명세 닫기" : "명세 확인"}
        </button>
      </div>
      {props.spec !== null && <SpecView state={props.spec} />}
    </li>
  );
}

/**
 * 2단계 — 테스트할 스위트. 고른 서버의 스크립트 이름에서 파생된 스위트를 위에 펴고,
 * 나머지는 접어 둔다(`matchSuites`).
 *
 * **접어 두는 것이지 감추는 것이 아니다.** 매칭 규칙이 못 맞히는 이름(스크립트를 옮겼거나
 * 스위트를 손으로 만든 경우)이 있는데 목록에서 빼 버리면 그 사용자는 실행할 방법이 없다.
 * 매칭이 0건이면 접힘은 처음부터 펼쳐진 채로 시작한다.
 */
export function StepRunSuite(props: {
  suites: readonly FileEntry[] | null;
  /** 고른 서버의 유효 인자. 여기서 스크립트 접두사를 뽑는다. */
  args: readonly string[];
  /** 탐색 루트(`GET /api/meta`). 못 받았으면 null 이고 안내에서 경로만 빠진다. */
  root: string | null;
  selected: string | null;
  onSelect: (suitePath: string) => void;
}): JSX.Element {
  /** 「명세 확인」이 열린 행과 그 내용. 한 번에 한 행이다. */
  const [specFor, setSpecFor] = useState<string | null>(null);
  const [spec, setSpec] = useState<SpecState | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);
  /** 마지막으로 연 명세의 경로. 늦게 온 응답을 버리는 기준이다. */
  const latestSpecRequest = useRef<string | null>(null);

  const { matched, others } = matchSuites(props.args, props.suites ?? []);
  // 매칭이 0건이면 접힌 목록만 남아 화면이 비어 보인다. 그때는 처음부터 펴 둔다.
  const showOthers = othersOpen || matched.length === 0;

  /**
   * 파일을 그때 읽는다. 목록을 만들 때 전부 읽어 두면 스위트가 수십 개인 프로젝트에서
   * 첫 화면이 느려지고, 그 사이 파일이 바뀌면 낡은 것을 보여준다.
   */
  function openSpec(suitePath: string): void {
    setSpecFor(suitePath);
    setSpec({ kind: "loading" });
    /**
     * 응답이 돌아왔을 때 **아직 그 행이 열려 있는지** 본다. A 를 누르고 곧바로 B 를 누르면
     * A 의 응답이 늦게 도착해 B 행 자리에 A 의 명세가 그려진다. 늦은 응답은 버린다.
     */
    latestSpecRequest.current = suitePath;
    const settle = (next: SpecState): void => {
      if (latestSpecRequest.current === suitePath) {
        setSpec(next);
      }
    };
    apiGet<FileContent>(`/api/suites/${encodeURIComponent(suitePath)}`)
      .then((file) => {
        const result = summarizeSuite(file.content);
        settle(
          result.ok
            ? { kind: "ready", summary: result.summary }
            : { kind: "error", reason: result.reason },
        );
      })
      .catch((err: unknown) =>
        settle({ kind: "error", reason: err instanceof Error ? err.message : String(err) }),
      );
  }

  function toggleSpec(suitePath: string): void {
    if (specFor === suitePath) {
      // 닫은 뒤에 도착하는 응답도 버린다. 안 그러면 닫아 둔 행이 저절로 다시 열린다.
      latestSpecRequest.current = null;
      setSpecFor(null);
      setSpec(null);
      return;
    }
    openSpec(suitePath);
  }

  const row = (suite: FileEntry): JSX.Element => (
    <SuiteRow
      key={suite.path}
      suite={suite}
      checked={props.selected === suite.path}
      spec={specFor === suite.path ? spec : null}
      onSelect={() => props.onSelect(suite.path)}
      onToggleSpec={() => toggleSpec(suite.path)}
    />
  );

  if (props.suites === null) {
    return <p className="text-sm text-ink-muted">불러오는 중...</p>;
  }

  if (props.suites.length === 0) {
    return (
      <div className="space-y-1 rounded-md border border-line bg-line-subtle px-3 py-2 text-sm text-ink-muted">
        <p>
          이 디렉터리 아래에서 스위트를 찾지 못했습니다{props.root ? ": " : "."}
          {props.root ? <span className="font-mono text-xs text-ink">{props.root}</span> : null}
        </p>
        <p>
          → 스위트가 있는 디렉터리에서 mcpeak-dashboard 를 다시 띄우거나, 왼쪽 Generate 로 새로
          만드세요.
        </p>
        <p className="text-xs">
          목록에는 스위트 형식을 통과한 .json 만 담습니다. node_modules · .git · dist 아래는 보지
          않습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">이 서버의 스위트 ({matched.length})</p>
        {matched.length === 0 ? (
          <p className="text-xs text-ink-muted">
            고른 서버의 스크립트 이름과 맞는 스위트가 없습니다. 아래 목록에서 고르세요.
          </p>
        ) : (
          <ul className="space-y-2">{matched.map(row)}</ul>
        )}
      </div>

      {others.length > 0 && (
        <div className="space-y-2">
          {matched.length > 0 && (
            <button
              type="button"
              aria-expanded={showOthers}
              className="text-sm text-ink-muted hover:text-ink"
              onClick={() => setOthersOpen((previous) => !previous)}
            >
              {showOthers ? "▾" : "▸"} 다른 스위트 보기 ({others.length})
            </button>
          )}
          {showOthers && <ul className="space-y-2">{others.map(row)}</ul>}
        </div>
      )}
    </div>
  );
}

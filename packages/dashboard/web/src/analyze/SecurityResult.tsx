import type { JSX } from "react";
import { useState } from "react";
import type { AnalyzeSecurityRequest, AnalyzeSecurityResponse } from "../../../src/api-types.js";
import { Card } from "../components/Card.js";
import { SegmentedControl } from "../components/SegmentedControl.js";
import {
  baselineStatus,
  bySeverity,
  byTool,
  type FindingRow,
  SEVERITIES,
  splitFindings,
} from "./security-view.js";

/** 결함 목록을 묶는 기준. */
type Grouping = "severity" | "tool";

const GROUPING_OPTIONS: readonly { readonly value: Grouping; readonly label: string }[] = [
  { value: "severity", label: "심각도별" },
  { value: "tool", label: "도구별" },
];

const SECTION_TITLE_CLASS = "text-sm font-medium text-ink";

function severityLabel(row: FindingRow): string {
  return SEVERITIES.find((entry) => entry.severity === row.finding.severity)?.label ?? "";
}

/**
 * 발견 하나. CLI 리포트의 한 항목과 같은 세 줄이다. 근거가 있으면 넷째 줄이 붙는다. 서버가 보낸
 * 글자는 전부 텍스트 노드다.
 */
function FindingItem({ row }: { readonly row: FindingRow }): JSX.Element {
  const { finding, view } = row;
  return (
    <li className="space-y-1 px-4 py-3">
      <p className="break-words text-sm font-medium text-ink">
        {`[${severityLabel(row)}] ${finding.ruleId} · ${view.where}`}
      </p>
      <p className="break-words text-sm text-ink">{`→ ${finding.message}`}</p>
      <p className="break-words text-sm text-ink-muted">{`해결: ${finding.fix}`}</p>
      {finding.evidence.length > 0 && (
        <p className="break-words font-mono text-xs text-ink-muted">
          {`근거: ${finding.evidence.join(" · ")}`}
        </p>
      )}
    </li>
  );
}

/** 결함 구획 하나. 제목과 그 아래 발견 목록이다. 발견의 순서는 받은 그대로다. */
function FindingSection({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: readonly FindingRow[];
}): JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className={SECTION_TITLE_CLASS}>{title}</h3>
      <Card>
        <ul className="divide-y divide-line-subtle">
          {rows.map((row) => (
            <FindingItem key={row.index} row={row} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

/**
 * 보안 점검 결과(보안 탭 계획서 §5.7). 판정·위치·격리 문장은 전부 응답에서 온 글자다. 이 화면은
 * 규칙을 다시 돌리지 않고, 위치 문장이나 숨은 문자 표를 만들지 않는다. 구획 안의 순서는
 * `report.findings` 의 순서 그대로다.
 */
export function SecurityResult({
  response,
  request,
}: {
  readonly response: AnalyzeSecurityResponse;
  readonly request: AnalyzeSecurityRequest;
}): JSX.Element {
  const [grouping, setGrouping] = useState<Grouping>("severity");
  const { report } = response;
  const { counts, server, sandbox } = report;
  const { defects, flows } = splitFindings(response);
  const baseline = baselineStatus(request, response);

  const summary: readonly (readonly [string, string])[] = [
    ["서버", `${server.name} ${server.version}`],
    ["도구", `${server.toolCount}개`],
    ["호출 정책", `${report.probe} (호출한 도구 ${report.probedTools.length}개)`],
  ];

  const groups =
    grouping === "severity"
      ? bySeverity(defects).map((group) => ({
          key: group.severity,
          title: `${group.label} ${group.rows.length}건`,
          rows: group.rows,
        }))
      : byTool(defects).map((group) => ({
          key: String(group.toolIndex),
          title: `${group.title} · ${group.rows.length}건`,
          rows: group.rows,
        }));

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <p className="text-sm font-medium text-ink">
          {`판정: 심각 ${counts.high}건, 주의 ${counts.medium}건, 낮음 ${counts.low}건, 정보 ${counts.info}건`}
        </p>
        <dl className="grid grid-cols-3 gap-4">
          {summary.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-caption font-medium text-ink-muted">{label}</dt>
              <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {response.sandboxLine !== null &&
        (sandbox?.status === "unavailable" ? (
          <p role="alert" className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
            {response.sandboxLine}
          </p>
        ) : (
          <p role="status" className="text-sm text-ink">
            {response.sandboxLine}
          </p>
        ))}

      {response.cleanupError !== "" && (
        <pre
          role="alert"
          className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-4 py-3 font-mono text-xs"
          style={{ color: "var(--status-failed-fg)" }}
        >
          {response.cleanupError}
        </pre>
      )}

      {baseline !== null && <p className="text-sm text-ink">{baseline}</p>}

      {defects.length === 0 ? (
        <p className="text-sm text-ink">결함 발견이 없습니다.</p>
      ) : (
        <>
          <SegmentedControl options={GROUPING_OPTIONS} value={grouping} onChange={setGrouping} />
          {groups.map((group) => (
            <FindingSection key={group.key} title={group.title} rows={group.rows} />
          ))}
        </>
      )}

      {flows.length > 0 && (
        <section className="space-y-2">
          <h3 className={SECTION_TITLE_CLASS}>권한 조합 경고 (결함이 아닙니다)</h3>
          <Card>
            <ul className="divide-y divide-line-subtle">
              {flows.map((row) => (
                <li key={row.index} className="space-y-1 px-4 py-3">
                  <p className="break-words text-sm text-ink">{`→ ${row.finding.message}`}</p>
                  <p className="break-words text-sm text-ink-muted">{`해결: ${row.finding.fix}`}</p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {report.skipped.length > 0 && (
        <section className="space-y-2">
          <h3 className={SECTION_TITLE_CLASS}>검사하지 않은 것</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {report.skipped.map((skipped, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 같은 가족이 사유만 달리 여러 번 올 수 있어 값만으로는 유일 키가 없고, 목록은 응답마다 통째로 온다
              <li key={index} className="break-words">{`${skipped.family}: ${skipped.reason}`}</li>
            ))}
          </ul>
        </section>
      )}

      {sandbox?.status === "ran" && (
        <section className="space-y-2">
          <h3 className={SECTION_TITLE_CLASS}>격리 안에서 관측한 것</h3>
          <p className="text-sm text-ink">
            {`호출 ${sandbox.callCount}회 · 선언된 목적지 ${sandbox.declaredHosts.length}곳`}
          </p>
          <ul className="list-disc space-y-1 pl-5 font-mono text-xs text-ink-muted">
            {sandbox.declaredHosts.map((host) => (
              <li key={host} className="break-words">
                {host}
              </li>
            ))}
          </ul>
          {sandbox.requests.length > 0 && (
            <Card className="overflow-x-auto">
              <table aria-label="격리 안에서 나간 요청" className="w-full text-left text-sm">
                <thead className="border-b border-line text-caption font-medium text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">호스트</th>
                    <th className="px-4 py-2 text-right font-medium">포트</th>
                    <th className="px-4 py-2 font-medium">메서드</th>
                    <th className="px-4 py-2 font-medium">경로</th>
                    <th className="px-4 py-2 text-right font-medium">횟수</th>
                    <th className="px-4 py-2 font-medium">선언</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {sandbox.requests.map((entry, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 행 순서는 응답의 requests 그대로이고 다시 정렬하지 않는다. 목록은 응답마다 통째로 온다
                    <tr key={index}>
                      <td className="break-all px-4 py-2 font-mono text-xs text-ink">
                        {entry.host}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">{entry.port}</td>
                      <td className="px-4 py-2 font-mono text-xs text-ink">{entry.method}</td>
                      <td className="break-all px-4 py-2 font-mono text-xs text-ink">
                        {entry.path}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">{entry.count}</td>
                      <td className="px-4 py-2 text-ink">
                        {entry.declared ? "선언됨" : "선언 없음"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h3 className={SECTION_TITLE_CLASS}>이 점검의 한계</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          {response.limits.map((limit, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 한계 문장은 서버가 보낸 줄 그대로라 값만으로 유일하다는 보장이 없고, 목록은 응답마다 통째로 온다
            <li key={index} className="break-words">
              {limit}
            </li>
          ))}
        </ul>
      </section>

      <details className="rounded-lg border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-ink">
          CLI 리포트 원문
        </summary>
        <pre className="overflow-x-auto whitespace-pre border-t border-line px-4 py-3 font-mono text-xs text-ink">
          {response.rendered}
        </pre>
      </details>
    </div>
  );
}

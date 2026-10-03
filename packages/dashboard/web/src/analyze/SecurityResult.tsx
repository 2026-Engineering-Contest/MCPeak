import type { Severity } from "@mcpeak/audit";
import type { JSX } from "react";
import { Fragment, useState } from "react";
import type { AnalyzeSecurityRequest, AnalyzeSecurityResponse } from "../../../src/api-types.js";
import { Card } from "../components/Card.js";
import { SegmentedControl } from "../components/SegmentedControl.js";
import { riskOf } from "./risk-text.js";
import {
  baselineStatus,
  bySeverity,
  byTool,
  type FindingRow,
  SEVERITIES,
  SEVERITY_TONE,
  splitFindings,
} from "./security-view.js";

/**
 * 누가 읽는가(ADR-0111). 개발자는 자기 MCP 를 고치는 사람이라 발견마다 "해결" 줄을 본다. 사용자는
 * 남의 MCP 를 등록할지 가리는 사람이라 고칠 것이 없다. "해결" 줄 대신 "왜 위험한가" 줄을 보고,
 * 해결 문장이 든 CLI 리포트 원문도 보지 않는다.
 */
export type Audience = "developer" | "user";

/** 결함 목록을 묶는 기준. */
type Grouping = "severity" | "tool";

const GROUPING_OPTIONS: readonly { readonly value: Grouping; readonly label: string }[] = [
  { value: "severity", label: "심각도별" },
  { value: "tool", label: "도구별" },
];

/** 구획 제목. 색은 호출부가 정한다(심각도별 보기는 심각도 색, 그 밖은 ink). */
const SECTION_TITLE_CLASS = "text-sm font-semibold";
/** 발견의 심각도 배지. 둥글고 굵다. */
const BADGE_CLASS = "inline-block rounded-full px-2 py-0.5 text-xs font-semibold";
/** 판정 줄의 집계 칩. 같은 모양이고 숫자만 굵다. */
const COUNT_CHIP_CLASS = "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium";
/** 줄 앞의 작은 라벨("해결", "근거"). */
const LINE_LABEL_CLASS = "text-xs font-semibold";

/** 격리 상태 줄과 경고 구획이 쓰는 톤. 심각도 톤과 같은 토큰 쌍이다. */
const DONE_TONE = { fg: "var(--status-done-fg)", bg: "var(--status-done-bg)" };
const WARNING_TONE = SEVERITY_TONE.medium;
const FAILED_TONE = SEVERITY_TONE.high;

function severityLabel(severity: Severity): string {
  return SEVERITIES.find((entry) => entry.severity === severity)?.label ?? "";
}

/** "해결: ..." 한 줄. 라벨만 색을 주고 문장은 본문 색이다. 글자는 `해결: ` 뒤에 fix 그대로다. */
function FixLine({ fix }: { readonly fix: string }): JSX.Element {
  return (
    <p className="break-words text-sm text-ink">
      <span className={LINE_LABEL_CLASS} style={{ color: DONE_TONE.fg }}>
        해결
      </span>
      {`: ${fix}`}
    </p>
  );
}

/**
 * "왜 위험한가: ..." 한 줄. 사용자에게 보인다. 문장은 규칙 id 로 정해진다(`risk-text.ts`). 모르는
 * 규칙이면 줄이 없다.
 */
function RiskLine({ ruleId }: { readonly ruleId: string }): JSX.Element | null {
  const risk = riskOf(ruleId);
  if (risk === null) {
    return null;
  }
  return (
    <p className="break-words text-sm text-ink">
      <span className={LINE_LABEL_CLASS} style={{ color: FAILED_TONE.fg }}>
        왜 위험한가
      </span>
      {`: ${risk}`}
    </p>
  );
}

/** 발견의 설명 줄. 개발자에게는 해결, 사용자에게는 위험 설명이다. */
function DetailLine({
  audience,
  ruleId,
  fix,
}: {
  readonly audience: Audience;
  readonly ruleId: string;
  readonly fix: string;
}): JSX.Element | null {
  return audience === "user" ? <RiskLine ruleId={ruleId} /> : <FixLine fix={fix} />;
}

/**
 * 발견 하나. 위에서 아래로 심각도 배지·규칙·위치, 메시지, 해결(사용자에게는 위험 설명), 근거다. 가장 먼저 읽혀야 하는 것은
 * 메시지 줄이다. 서버가 보낸 글자는 전부 텍스트 노드다.
 */
function FindingItem({
  row,
  audience,
}: {
  readonly row: FindingRow;
  readonly audience: Audience;
}): JSX.Element {
  const { finding, view } = row;
  const tone = SEVERITY_TONE[finding.severity];
  return (
    <li className="space-y-1.5 border-l-4 px-4 py-3" style={{ borderLeftColor: tone.fg }}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={BADGE_CLASS} style={{ color: tone.fg, background: tone.bg }}>
          {severityLabel(finding.severity)}
        </span>
        <span className="break-all font-mono text-sm font-semibold text-ink">{finding.ruleId}</span>
        <span className="break-words text-sm text-ink-muted">{view.where}</span>
      </p>
      <p className="break-words text-sm font-medium text-ink">{`→ ${finding.message}`}</p>
      <DetailLine audience={audience} ruleId={finding.ruleId} fix={finding.fix} />
      {finding.evidence.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className={`${LINE_LABEL_CLASS} text-ink-muted`}>근거</span>
          {finding.evidence.map((piece, index) => (
            <code
              // biome-ignore lint/suspicious/noArrayIndexKey: 근거 조각은 같은 값이 겹칠 수 있어 값만으로는 유일 키가 없고, 목록은 응답마다 통째로 온다
              key={index}
              className="break-all rounded bg-line-subtle px-1.5 py-0.5 font-mono text-xs text-ink"
            >
              {piece}
            </code>
          ))}
        </p>
      )}
    </li>
  );
}

/** 결함 구획 하나. 제목과 그 아래 발견 목록이다. 발견의 순서는 받은 그대로다. */
function FindingSection({
  title,
  titleColor,
  rows,
  audience,
}: {
  readonly title: string;
  /** 심각도별 보기에서만 준다. 없으면 ink 색이다. */
  readonly titleColor?: string;
  readonly rows: readonly FindingRow[];
  readonly audience: Audience;
}): JSX.Element {
  return (
    <section className="space-y-2">
      <h3
        className={`${SECTION_TITLE_CLASS}${titleColor === undefined ? " text-ink" : ""}`}
        style={titleColor === undefined ? undefined : { color: titleColor }}
      >
        {title}
      </h3>
      {/* 왼쪽 띠가 카드의 둥근 모서리 밖으로 나가지 않게 자른다. */}
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line-subtle">
          {rows.map((row) => (
            <FindingItem key={row.index} row={row} audience={audience} />
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
 *
 * 색과 굵기는 읽는 순서를 만드는 데만 쓴다. 색만으로 뜻을 전하지 않는다. 심각도는 라벨 글자가,
 * 선언 여부는 "선언됨"·"선언 없음" 글자가 함께 말한다.
 */
export function SecurityResult({
  response,
  request,
  audience = "developer",
}: {
  readonly response: AnalyzeSecurityResponse;
  readonly request: AnalyzeSecurityRequest;
  /** 주지 않으면 개발자다. 보안 탭은 주지 않는다. */
  readonly audience?: Audience;
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
          titleColor: SEVERITY_TONE[group.severity].fg as string | undefined,
          rows: group.rows,
        }))
      : byTool(defects).map((group) => ({
          key: String(group.toolIndex),
          title: `${group.title} · ${group.rows.length}건`,
          titleColor: undefined,
          rows: group.rows,
        }));

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-4">
        {/* 글자 전체는 CLI 판정 줄과 같다. 쉼표와 공백은 텍스트 노드로 둔다. flex 로 짜면 그 공백이 사라진다. */}
        <p className="text-sm font-medium leading-8 text-ink">
          {"판정: "}
          {SEVERITIES.map(({ severity, label }, index) => {
            const count = counts[severity];
            // 0건인 칩은 정보 톤으로 흐리게 둔다. 눈이 건수가 있는 칩으로 먼저 간다.
            const tone = count === 0 ? SEVERITY_TONE.info : SEVERITY_TONE[severity];
            return (
              <Fragment key={severity}>
                {index > 0 && ", "}
                <span
                  data-severity={severity}
                  className={COUNT_CHIP_CLASS}
                  style={{ color: tone.fg, background: tone.bg }}
                >
                  {`${label} `}
                  <span className="font-bold tabular-nums">{count}</span>건
                </span>
              </Fragment>
            );
          })}
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
          <p
            role="alert"
            className="break-words rounded-md border-l-4 px-4 py-3 text-sm font-medium"
            style={{
              color: FAILED_TONE.fg,
              background: FAILED_TONE.bg,
              borderLeftColor: FAILED_TONE.fg,
            }}
          >
            {response.sandboxLine}
          </p>
        ) : (
          <p
            role="status"
            className="break-words rounded-md border-l-4 px-4 py-3 text-sm text-ink"
            style={{ background: DONE_TONE.bg, borderLeftColor: DONE_TONE.fg }}
          >
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
        <p className="text-sm font-medium" style={{ color: DONE_TONE.fg }}>
          결함 발견이 없습니다.
        </p>
      ) : (
        <>
          <SegmentedControl options={GROUPING_OPTIONS} value={grouping} onChange={setGrouping} />
          {groups.map((group) => (
            <FindingSection
              key={group.key}
              title={group.title}
              titleColor={group.titleColor}
              rows={group.rows}
              audience={audience}
            />
          ))}
        </>
      )}

      {flows.length > 0 && (
        <section className="space-y-2">
          <h3 className={SECTION_TITLE_CLASS} style={{ color: WARNING_TONE.fg }}>
            권한 조합 경고 (결함이 아닙니다)
          </h3>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line-subtle">
              {flows.map((row) => (
                <li
                  key={row.index}
                  className="space-y-1.5 border-l-4 px-4 py-3"
                  style={{ borderLeftColor: WARNING_TONE.fg }}
                >
                  <p className="break-words text-sm font-medium text-ink">
                    {`→ ${row.finding.message}`}
                  </p>
                  <DetailLine
                    audience={audience}
                    ruleId={row.finding.ruleId}
                    fix={row.finding.fix}
                  />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {report.skipped.length > 0 && (
        <section className="space-y-2">
          <h3 className={`${SECTION_TITLE_CLASS} text-ink`}>검사하지 않은 것</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {report.skipped.map((skipped, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 같은 가족이 사유만 달리 여러 번 올 수 있어 값만으로는 유일 키가 없고, 목록은 응답마다 통째로 온다
              <li key={index} className="break-words">
                <span className="font-mono text-xs font-semibold text-ink">{skipped.family}</span>
                {`: ${skipped.reason}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sandbox?.status === "ran" && (
        <section className="space-y-2">
          <h3 className={`${SECTION_TITLE_CLASS} text-ink`}>격리 안에서 관측한 것</h3>
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
                      {entry.declared ? (
                        <td className="px-4 py-2 text-ink-muted">선언됨</td>
                      ) : (
                        <td className="px-4 py-2 font-semibold" style={{ color: FAILED_TONE.fg }}>
                          선언 없음
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h3 className={`${SECTION_TITLE_CLASS} text-ink`}>이 점검의 한계</h3>
        {/* 경고가 아니라 주석이다. 경고 색을 쓰지 않고 옅은 바탕의 상자에 둔다. */}
        <div className="rounded-md bg-line-subtle px-4 py-3">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {response.limits.map((limit, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 한계 문장은 서버가 보낸 줄 그대로라 값만으로 유일하다는 보장이 없고, 목록은 응답마다 통째로 온다
              <li key={index} className="break-words">
                {limit}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 원문에는 발견마다 "해결:" 줄이 있다. 사용자에게는 보이지 않는다. */}
      {audience === "developer" && (
        <details className="rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-ink">
            CLI 리포트 원문
          </summary>
          <pre className="overflow-x-auto whitespace-pre border-t border-line px-4 py-3 font-mono text-xs text-ink">
            {response.rendered}
          </pre>
        </details>
      )}
    </div>
  );
}

import type { JSX } from "react";
import type { RunTally } from "../run-tally.js";

/**
 * 통과 · 실패 · 미실행 세 칸 (#459).
 *
 * **진행률은 그리지 않는다.** `mcpeak test` 는 출력을 모았다가 끝에 한 번 쓰므로 실행 중에는
 * 몇 건째인지 알 수 없다. 숫자는 runner 요약 줄이 온 뒤에만 채우고(ADR-0096), 그 전에는 `—` 다.
 * 모르는 숫자를 0 으로 그리면 "0건 통과" 라는 거짓이 된다.
 *
 * **작게 둔다.** 실행 화면의 주인공은 터미널이다. 이 칸들은 한 줄을 따로 차지하지 않고 화면 머리
 * 오른쪽에 얹혀, 그 높이를 터미널에 돌려준다.
 */
export interface RunCountsProps {
  readonly tally: RunTally | null;
}

export function RunCounts({ tally }: RunCountsProps): JSX.Element {
  return (
    <dl className="flex shrink-0 gap-2">
      <CountTile label="통과" value={tally?.passed} icon={<PassedIcon />} />
      <CountTile
        label="실패"
        value={tally === null ? undefined : tally.failed + tally.timedOut}
        icon={<FailedIcon />}
      />
      <CountTile
        label="미실행"
        value={tally === null ? undefined : tally.cancelled + tally.notRun}
        icon={<NotRunIcon />}
      />
    </dl>
  );
}

function CountTile({
  label,
  value,
  icon,
}: {
  readonly label: string;
  readonly value: number | undefined;
  readonly icon: JSX.Element;
}): JSX.Element {
  return (
    <div className="min-w-[92px] rounded-lg border border-line bg-surface px-3 py-2">
      <dt className="flex items-center gap-1.5 text-caption font-medium text-ink-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-display font-semibold tabular-nums text-ink">
        {value === undefined ? (
          <span className="text-ink-muted" title="실행이 끝나고 요약이 나오면 채워집니다">
            —
          </span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

const ICON_SIZE = { width: 16, height: 16, viewBox: "0 0 24 24", "aria-hidden": true } as const;

function PassedIcon(): JSX.Element {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
    <svg {...ICON_SIZE}>
      <circle cx="12" cy="12" r="11" fill="var(--status-done-fg)" />
      <polyline
        points="7 12.5 10.5 16 17 9"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FailedIcon(): JSX.Element {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
    <svg {...ICON_SIZE}>
      <circle cx="12" cy="12" r="11" fill="var(--status-failed-fg)" />
      <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function NotRunIcon(): JSX.Element {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
    <svg {...ICON_SIZE} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9.5" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

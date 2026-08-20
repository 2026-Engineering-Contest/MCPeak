import type { JSX } from "react";
import type { RunStatus } from "../../../src/api-types.js";

/**
 * 상태 뱃지: 점 + 라벨 필(UI 설계 §4). 라벨은 RunStatus 4값과 1:1이고,
 * done/failed는 exit 코드를 문구에 포함한다(구현계획 §4-5).
 * 상태 색은 Tailwind 유틸리티가 아니라 --status-* 토큰을 style로 직접 쓴다
 * (구현계획 §4-1 하단 방침).
 */
const TOKEN_KEYS: Record<RunStatus, string> = {
  running: "running",
  "waiting-input": "waiting",
  done: "done",
  failed: "failed",
};

function label(status: RunStatus, exitCode: number | null): string {
  switch (status) {
    case "running":
      return "실행 중";
    case "waiting-input":
      return "입력 대기";
    case "done":
      return `완료 · exit ${exitCode ?? 0}`;
    case "failed":
      return `실패 · exit ${exitCode ?? "?"}`;
  }
}

export function StatusBadge(props: { status: RunStatus; exitCode: number | null }): JSX.Element {
  const key = TOKEN_KEYS[props.status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        color: `var(--status-${key}-fg)`,
        background: `var(--status-${key}-bg)`,
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: `var(--status-${key}-fg)` }}
      />
      {label(props.status, props.exitCode)}
    </span>
  );
}

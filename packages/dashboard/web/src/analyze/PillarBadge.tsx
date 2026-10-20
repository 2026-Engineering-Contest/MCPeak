import type { JSX } from "react";
import type { PillarTone } from "./pillars.js";

/** 톤 → theme.css 토큰 쌍. `SEVERITY_TONE` 과 같은 어휘다. 새 색을 만들지 않는다. 카드의 칩·막대도 쓴다. */
export const TONE_STYLE: Readonly<
  Record<PillarTone, { readonly fg: string; readonly bg: string }>
> = {
  failed: { fg: "var(--status-failed-fg)", bg: "var(--status-failed-bg)" },
  waiting: { fg: "var(--status-waiting-fg)", bg: "var(--status-waiting-bg)" },
  running: { fg: "var(--status-running-fg)", bg: "var(--status-running-bg)" },
  done: { fg: "var(--status-done-fg)", bg: "var(--status-done-bg)" },
  info: { fg: "var(--ink-muted)", bg: "var(--line-subtle)" },
  accent: { fg: "var(--accent)", bg: "var(--accent-soft)" },
};

/** 판정 배지. 카드·상세 머리·안전 구획이 같은 것을 쓴다. 글자가 항상 있어 색만으로 뜻을 전하지 않는다. */
export function PillarBadge({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: PillarTone;
}): JSX.Element {
  const style = TONE_STYLE[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ color: style.fg, background: style.bg }}
    >
      <i
        aria-hidden="true"
        className="h-2 w-2 rounded-full"
        style={{ background: "currentColor" }}
      />
      {label}
    </span>
  );
}

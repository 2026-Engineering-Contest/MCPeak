import type { JSX } from "react";

/**
 * 스텝 인디케이터(Generate 전용, UI 설계 §4). 원형 번호 + 라벨 + 연결선.
 * current 이전 = 체크 아이콘, current = accent 채움 강조, 이후 = 테두리만 번호.
 * current는 0-기반이다(구현계획 §4-5).
 */
export function Stepper(props: { steps: readonly string[]; current: number }): JSX.Element {
  return (
    <ol className="flex items-center gap-2">
      {props.steps.map((step, index) => {
        const state = index < props.current ? "done" : index === props.current ? "current" : "todo";
        return (
          <li key={step} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            {index > 0 && <span aria-hidden className="h-px w-6 bg-line" />}
            <span
              data-step-state={state}
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                state === "current"
                  ? "bg-accent text-white"
                  : state === "done"
                    ? "border border-accent-border text-accent"
                    : "border border-line text-ink-muted"
              }`}
            >
              {state === "done" ? (
                <svg
                  width={12}
                  height={12}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="완료"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <span
              className={`text-sm ${
                state === "current" ? "font-semibold text-ink" : "text-ink-muted"
              }`}
            >
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

import type { JSX } from "react";

/**
 * 비어 있는 목록·화면 자리 (#459).
 *
 * 예전 빈 상태는 **말만 했다.** "→ Test 에서 External 세션을 … 나타납니다." 처럼 누를 컨트롤
 * 이름까지 정확히 적어 두고 링크는 주지 않았다. 여기서는 안내 문장 옆에 **다음 행동 링크**를
 * 붙인다. 해시 라우팅이라 `<a href>` 하나로 끝나고 의존성이 늘지 않는다.
 *
 * 링크는 여럿일 수 있다(없는 run: "목록으로" 와 "새 실행"). 첫째가 주된 행동이다.
 */
export interface EmptyStateAction {
  readonly href: string;
  readonly label: string;
}

export interface EmptyStateProps {
  /** 무엇이 비었는가. 한 줄. */
  readonly message: string;
  /** 왜 비었고 어떻게 채우는가. 줄바꿈을 살린다 — 서버가 만든 두 줄 안내를 그대로 받는다. */
  readonly hint?: string;
  readonly action?: EmptyStateAction;
  readonly secondaryAction?: EmptyStateAction;
}

const LINK_BASE =
  "inline-flex items-center gap-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export function EmptyState({
  message,
  hint,
  action,
  secondaryAction,
}: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-3 px-6 py-8">
      <div className="space-y-1">
        <p className="text-body font-medium text-ink">{message}</p>
        {hint !== undefined && (
          <p className="whitespace-pre-line text-body text-ink-muted">{hint}</p>
        )}
      </div>
      {(action !== undefined || secondaryAction !== undefined) && (
        <p className="flex flex-wrap gap-2">
          {action !== undefined && (
            <a
              className={`${LINK_BASE} bg-accent text-white hover:bg-accent-hover`}
              href={action.href}
            >
              {action.label}
              <span aria-hidden="true">→</span>
            </a>
          )}
          {secondaryAction !== undefined && (
            <a
              className={`${LINK_BASE} border border-line text-ink-muted hover:bg-line-subtle hover:text-ink`}
              href={secondaryAction.href}
            >
              {secondaryAction.label}
            </a>
          )}
        </p>
      )}
    </div>
  );
}

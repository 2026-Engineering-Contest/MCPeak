import type { JSX } from "react";
import type { RunEvent } from "../../../src/api-types.js";

/**
 * 터미널 로그와 별도로 최근 AI 대화를 읽기 쉬운 카드로 강조한다.
 * 응답 HTML은 LogPanel과 같은 서버 ansiToHtml 결과다. 서버가 이스케이프를 보장한다.
 */
export function AiConversationPanel(props: {
  readonly question: string;
  readonly responseEvents: readonly RunEvent[];
  readonly waiting: boolean;
}): JSX.Element {
  return (
    <section className="space-y-3" aria-label="AI 대화">
      <div className="ml-auto max-w-[85%] rounded-lg border border-accent-border bg-accent-soft p-3">
        <p className="mb-1 text-xs font-semibold text-accent">사용자 질문</p>
        <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{props.question}</p>
      </div>

      {props.waiting && (
        <div
          className="mr-auto flex max-w-[85%] items-center gap-2 rounded-lg border border-line bg-surface p-3 text-sm text-ink-muted"
          role="status"
          aria-live="polite"
        >
          <span
            className="inline-block size-4 animate-spin rounded-full border-2 border-line border-t-accent"
            aria-hidden="true"
          />
          AI가 답변 중입니다...
        </div>
      )}

      {props.responseEvents.length > 0 && (
        <div className="mr-auto max-w-[85%] rounded-lg border border-line bg-surface p-3">
          <p className="mb-1 text-xs font-semibold text-ink-muted">AI 응답</p>
          <div className="space-y-1 whitespace-pre-wrap font-mono text-sm leading-6 text-ink">
            {props.responseEvents.map((event) => {
              if (event.kind !== "stdout" && event.kind !== "stderr") return null;
              return (
                <div
                  key={event.id}
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: 서버 ansiToHtml이 이스케이프한 실행 출력이다.
                  dangerouslySetInnerHTML={{ __html: event.html }}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

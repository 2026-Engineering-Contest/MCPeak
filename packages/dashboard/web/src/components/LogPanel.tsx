import { Fragment, type JSX, type ReactNode } from "react";
import type { RunEvent } from "../../../src/api-types.js";

export interface TerminalConversation {
  readonly question: string;
  /** 사용자 질문을 입력했던 question 이벤트의 id. */
  readonly questionEventId: number;
  /** provider 응답으로 판정한 첫 stdout/stderr 이벤트의 id. */
  readonly firstResponseEventId: number | null;
  readonly waiting: boolean;
}

/**
 * 로그 패널(UI 설계 §4). 터미널 재현 영역이라 테마와 무관하게 항상 다크다.
 * 다크 모드 구분 장치(UI 설계 §3): 본문 --terminal-bg(주변보다 어두운 단차),
 * 테두리 --terminal-border(다크에서 주변 --line보다 밝음), 헤더 스트립
 * --terminal-header-bg, 다크에서만 값이 생기는 inset 하이라이트 --terminal-inset.
 *
 * stdout/stderr와 AI 대화 표식을 수신 순서 그대로 한 흐름에 렌더한다. 출력 html은
 * dangerouslySetInnerHTML로 넣는다. 이스케이프는 서버 ansiToHtml이 보장한다
 * (기반 계획 T1 테스트가 지키는 전제, 기반 계획 T4와 동일).
 */
export function LogPanel(props: {
  title: string;
  meta?: ReactNode;
  events: readonly RunEvent[];
  conversations?: readonly TerminalConversation[];
  footer?: ReactNode;
}): JSX.Element {
  const questionsByEventId = new Map(
    props.conversations?.map((conversation) => [conversation.questionEventId, conversation]) ?? [],
  );
  const responsesByEventId = new Map(
    props.conversations
      ?.filter(
        (
          conversation,
        ): conversation is TerminalConversation & { readonly firstResponseEventId: number } =>
          conversation.firstResponseEventId !== null,
      )
      .map((conversation) => [conversation.firstResponseEventId, conversation]) ?? [],
  );

  return (
    <section
      className="overflow-hidden rounded-lg"
      style={{
        background: "var(--terminal-bg)",
        border: "1px solid var(--terminal-border)",
        boxShadow: "var(--terminal-inset)",
      }}
    >
      <header
        className="flex items-center justify-between px-4 py-2"
        style={{ background: "var(--terminal-header-bg)" }}
      >
        <span className="text-xs font-medium" style={{ color: "var(--terminal-muted)" }}>
          {props.title}
        </span>
        {props.meta !== undefined && <span>{props.meta}</span>}
      </header>
      <div
        className="max-h-[60vh] overflow-auto whitespace-pre-wrap p-4 font-mono"
        style={{ color: "var(--terminal-fg)", fontSize: 13, lineHeight: 1.85 }}
      >
        {props.events.map((event) => {
          const question = questionsByEventId.get(event.id);
          const response = responsesByEventId.get(event.id);
          return (
            <Fragment key={event.id}>
              {response !== undefined && (
                <p className="mt-3 font-sans text-xs font-semibold text-accent">AI 응답</p>
              )}
              {(event.kind === "stdout" || event.kind === "stderr") && (
                <div
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: html 이스케이프는 서버 ansiToHtml이 보장한다(구현계획 §4-5)
                  dangerouslySetInnerHTML={{ __html: event.html }}
                />
              )}
              {question !== undefined && (
                <div className="my-3 font-sans">
                  <p className="text-xs font-semibold text-accent">사용자 질문</p>
                  <p className="whitespace-pre-wrap text-sm text-white">{question.question}</p>
                </div>
              )}
            </Fragment>
          );
        })}
        {props.conversations?.some((conversation) => conversation.waiting) && (
          <p className="mt-3 font-sans text-sm text-ink-muted" role="status" aria-live="polite">
            AI가 답변 중입니다...
          </p>
        )}
      </div>
      {props.footer !== undefined && (
        <div className="px-4 pb-4 font-mono" style={{ color: "var(--terminal-fg)" }}>
          {props.footer}
        </div>
      )}
    </section>
  );
}

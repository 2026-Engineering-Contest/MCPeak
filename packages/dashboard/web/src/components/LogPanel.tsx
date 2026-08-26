import { Fragment, type JSX, type ReactNode, useLayoutEffect, useRef } from "react";
import type { RunEvent } from "../../../src/api-types.js";

/**
 * "바닥에 붙어 있다" 로 볼 여유(px). 한 줄 높이(13px × 1.85 ≈ 24px)보다 조금 크게 둔다 —
 * 사용자가 끝까지 내렸는데 반올림 때문에 1~2px 떠 있는 경우를 바닥이 아니라고 판정하면,
 * 정작 따라가야 할 때 안 따라간다.
 */
const BOTTOM_THRESHOLD_PX = 32;

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
 *
 * **새 출력이 오면 바닥을 따라간다.** 본문은 높이가 묶인 자체 스크롤 영역이라, 따라가지
 * 않으면 답변할 때마다 새 출력이 화면 밖 아래에 쌓인다 — 검토 메뉴를 한 번 고를 때마다
 * 사용자가 다시 내려야 했다. 다만 **위로 올라가 읽는 중이면 끌어내리지 않는다.** 지난
 * 출력을 확인하려고 올린 사람을 새 줄이 올 때마다 바닥으로 던지는 것이 더 나쁘다.
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

  const bodyRef = useRef<HTMLDivElement>(null);
  /**
   * 사용자가 바닥에 붙어 있는가. **스크롤할 때마다 갱신하고 렌더에서는 읽지 않는다** —
   * 렌더 중 DOM 을 재는 것도, 이 값으로 다시 그리는 것도 필요 없다. 처음에는 참이다:
   * 넘칠 내용이 없으면 사용자는 이미 바닥에 있다.
   */
  const pinnedToBottom = useRef(true);
  const eventCount = props.events.length;
  const waiting = props.conversations?.some((conversation) => conversation.waiting) === true;

  /**
   * `useEffect` 가 아니라 `useLayoutEffect` 다. 그려진 뒤에 옮기면 사용자가 옛 위치를 한 프레임
   * 보고 나서 튀는 것을 본다. 페인트 전에 옮기면 처음부터 바닥에 있던 것처럼 보인다.
   */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body === null || !pinnedToBottom.current) {
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [eventCount, waiting]);

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
        ref={bodyRef}
        className="max-h-[60vh] overflow-auto whitespace-pre-wrap p-4 font-mono"
        style={{ color: "var(--terminal-fg)", fontSize: 13, lineHeight: 1.85 }}
        onScroll={(event) => {
          const body = event.currentTarget;
          pinnedToBottom.current =
            body.scrollHeight - body.clientHeight - body.scrollTop <= BOTTOM_THRESHOLD_PX;
        }}
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
            질문 답변중...
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

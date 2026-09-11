import { Fragment, type JSX, type ReactNode, useLayoutEffect, useRef } from "react";
import type { RunEvent } from "../../../src/api-types.js";
import { Logo } from "./Logo.js";

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
 * 로그 패널(UI 설계 §4). **본문**은 터미널 재현 영역이라 테마와 무관하게 항상 다크다.
 * 다크 모드 구분 장치(UI 설계 §3): 본문 --terminal-bg(주변보다 어두운 단차),
 * 테두리 --terminal-border(다크에서 주변 --line보다 밝음), 다크에서만 값이 생기는 inset
 * 하이라이트 --terminal-inset.
 *
 * **머리는 카드다**(#459). 예전에는 다크 헤더 스트립에 작은 회색 글씨로 제목만 있었다. 이제
 * 다른 카드와 같은 면 위에 섹션 제목(`text-title`)·설명·상태·동작 버튼을 두고, 다크 본문은
 * 그 안에 얹는다. 푸터(질문 패널)는 카드 **아래** 따로 선다 — 답해야 하는 자리가 로그와 같은
 * 무게로 묻히지 않게 한다.
 *
 * **본문 밖에 `div > div` 를 만들지 않는다.** `log-panel.test.tsx` 가 출력 줄을 `div[class] > div`
 * 로 센다. 머리는 `hgroup`·`span` 으로 짠다.
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
  /** 제목 아래 한 줄. */
  description?: string;
  /** 머리 오른쪽의 상태 표시(줄 수·수신 상태). */
  meta?: ReactNode;
  /** 머리 오른쪽 끝의 버튼들(복사·지우기). */
  actions?: ReactNode;
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
   * 질문 패널의 등장·퇴장도 본문을 밀어 올린다. **새 줄이 없어도 바닥이 움직이므로** 이것도
   * 따라갈 조건이다 — 안 넣으면 실행 화면을 열자마자 질문이 뜨는 순간 본문이 그만큼 떠 있고,
   * 사용자는 첫 화면부터 한 번 내려야 한다.
   */
  const hasFooter = props.footer !== undefined;

  /**
   * `useEffect` 가 아니라 `useLayoutEffect` 다. 그려진 뒤에 옮기면 사용자가 옛 위치를 한 프레임
   * 보고 나서 튀는 것을 본다. 페인트 전에 옮기면 처음부터 바닥에 있던 것처럼 보인다.
   *
   * deps 의 세 값은 콜백 안에서 읽지 않고 "언제 다시 내려야 하는지" 를 알리는 트리거로만
   * 쓴다 — 실제로 옮기는 값은 그때그때의 `body.scrollHeight` 다. 자동 수정으로 지우면 새
   * 줄이 와도 재실행되지 않아 이 파일 전체가 고치려던 문제로 되돌아간다.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: 위 설명대로 트리거 용도라 의도적이다.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body === null || !pinnedToBottom.current) {
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [eventCount, waiting, hasFooter]);

  return (
    // 남는 높이를 채운다. 높이가 정해져야 본문이 "안에서 넘치고" 푸터(질문 패널)가 늘 보인다.
    //
    // **터미널이 실행 화면의 주인공이다**(#459 피드백). 카드는 440px 아래로 줄지 않는다. 예전에는
    // 바닥이 0 이라 창이 조금만 낮아도 몇 줄짜리 띠가 됐다. 창이 그보다 낮으면 카드와 질문 패널이 이
    // div 밖으로 넘치고, 넘친 만큼 바깥 `main` 이 스크롤한다 — 잘리지 않는다(이 div 는 `overflow` 를
    // 막지 않는다).
    //
    // 이 div 의 `min-h-0` 은 지운다고 같아지지 않는다. 지우면 자동 최소 높이가 **로그 전체 높이**가
    // 돼 터미널이 안에서 스크롤하지 않고 화면이 로그만큼 길어진다. 바닥은 카드 쪽에 둔다.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section className="flex min-h-[440px] flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        {/* 머리는 얇게 둔다 — 여기 쓰는 높이만큼 본문이 준다. */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-2.5">
          <Logo size={32} />
          <hgroup className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-ink">{props.title}</h2>
            {props.description !== undefined && (
              <p className="text-caption text-ink-muted">{props.description}</p>
            )}
          </hgroup>
          {(props.meta !== undefined || props.actions !== undefined) && (
            <span className="flex shrink-0 items-center gap-2">
              {props.meta}
              {props.actions}
            </span>
          )}
        </header>
        <div
          ref={bodyRef}
          /*
          **바닥값을 두지 않는다.** 이 패널은 `overflow-hidden` 이라 넘친 것이 스크롤되지 않고
          잘리는데, 본문에 최소 높이를 주면 창이 낮을 때 헤더+본문+푸터가 패널을 넘겨 질문
          패널 아래가 잘렸다 — 잘린 것은 꺼내 볼 방법이 없다.

          줄어드는 몫은 전부 본문이 받는다(헤더·푸터는 `shrink-0`). 본문은 어차피 자기 안에서
          스크롤하므로 좁아질 뿐 내용을 잃지 않고, 답해야 하는 질문 패널은 온전히 남는다.
        */
          className="scrollbar-terminal mx-3 mb-3 flex-1 overflow-auto whitespace-pre-wrap rounded-md p-4 font-mono"
          style={{
            background: "var(--terminal-bg)",
            border: "1px solid var(--terminal-border)",
            boxShadow: "var(--terminal-inset)",
            color: "var(--terminal-fg)",
            fontSize: 13,
            lineHeight: 1.85,
          }}
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
      </section>
      {props.footer !== undefined && (
        // 질문 패널 자리. **줄어들지 않는다** — 이것이 안 보이면 사용자는 답할 수 없다.
        <div className="shrink-0">{props.footer}</div>
      )}
    </div>
  );
}

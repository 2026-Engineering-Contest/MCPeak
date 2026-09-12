import type { JSX } from "react";
import { useState } from "react";
import type { PendingQuestion } from "../../../src/api-types.js";
import { Button } from "./Button.js";
import { INPUT_ON_ACCENT_CLASS } from "./Field.js";

/**
 * 대화형 승인 질문 하나(UI 설계 §4). 터미널 흐름 안의 "질문" 라벨 + message + kind별 컨트롤.
 * 표시 전용이다: 응답 전송·패널 숨김은 호출부가 onAnswer로 처리한다(구현계획 §4-5).
 * input→입력값, choose→선택지 그대로, confirm→"y"|"n".
 *
 * onAnswer가 진행 중인 동안 모든 컨트롤을 비활성화한다. 같은 questionId로
 * POST /answer가 중복 전송되면 첫 요청만 성공하고 나머지는 409가 되어,
 * 이미 처리된 질문인데 사용자에게 오류가 보인다(PR #199 리뷰 반영).
 *
 * 질문이 바뀔 때 입력값 초기화는 호출부의 `key={question.id}` 리마운트에 맡긴다.
 */
export function QuestionPanel(props: {
  question: PendingQuestion;
  onAnswer: (value: string) => Promise<void>;
  onBack?: () => Promise<void>;
}): JSX.Element {
  const { question, onAnswer, onBack } = props;
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(value: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await onAnswer(value);
    } finally {
      setBusy(false);
    }
  }

  async function goBack(): Promise<void> {
    if (busy || onBack === undefined) return;
    setBusy(true);
    try {
      await onBack();
    } finally {
      setBusy(false);
    }
  }

  return (
    // 터미널 카드 **아래** 따로 서는 카드다(#459). 예전에는 다크 터미널 안 바닥에 끼어 있어
    // 로그와 같은 무게로 읽혔다. 답해야 하는 자리이므로 accent 면과 그림자로 떼어 둔다.
    <div className="space-y-3 rounded-lg border border-accent-border bg-accent-soft p-4 font-sans shadow-card">
      <p className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface text-accent"
        >
          {/* biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접 */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-caption font-semibold text-accent">질문</span>
          <span className="block text-title font-medium text-ink">{question.message}</span>
        </span>
      </p>

      {question.kind === "input" && (
        <div className="space-y-2">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(inputValue);
            }}
          >
            <input
              className={INPUT_ON_ACCENT_CLASS}
              value={inputValue}
              disabled={busy}
              onChange={(event) => setInputValue(event.target.value)}
            />
            {/* 폼 안이라 `type="submit"` 을 명시한다 — Button 의 기본값은 "button" 이다. */}
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              제출
            </Button>
          </form>
          {onBack !== undefined && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-accent-border bg-surface px-3 py-1.5 text-sm text-ink-muted hover:border-accent disabled:opacity-50"
              disabled={busy}
              onClick={() => void goBack()}
            >
              <span aria-hidden="true">←</span>
              검토 메뉴로 돌아가기
            </button>
          )}
        </div>
      )}

      {question.kind === "choose" && (
        <div className="flex flex-wrap gap-2">
          {question.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              className="rounded border border-accent-border bg-surface px-3 py-1.5 text-sm text-ink hover:border-accent disabled:opacity-50"
              disabled={busy}
              onClick={() => void submit(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      {question.kind === "confirm" && (
        <div className="flex gap-2">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit("y")}>
            예
          </Button>
          <button
            type="button"
            className="rounded border border-accent-border bg-surface px-3 py-1.5 text-sm text-ink hover:border-accent disabled:opacity-50"
            disabled={busy}
            onClick={() => void submit("n")}
          >
            아니오
          </button>
        </div>
      )}
    </div>
  );
}

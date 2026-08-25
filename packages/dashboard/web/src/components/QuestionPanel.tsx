import type { JSX } from "react";
import { useState } from "react";
import type { PendingQuestion } from "../../../src/api-types.js";

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
    <div className="space-y-3 font-sans">
      <p className="text-sm">
        <span className="mr-2 text-xs font-semibold text-accent">질문</span>
        <span className="font-medium text-white">{question.message}</span>
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
              className="flex-1 rounded border border-line bg-transparent px-3 py-1.5 text-sm text-white disabled:opacity-50"
              value={inputValue}
              disabled={busy}
              onChange={(event) => setInputValue(event.target.value)}
            />
            <button
              type="submit"
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={busy}
            >
              제출
            </button>
          </form>
          {onBack !== undefined && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-line bg-transparent px-3 py-1.5 text-sm text-ink-muted hover:border-accent disabled:opacity-50"
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
              className="rounded border border-line bg-transparent px-3 py-1.5 text-sm text-white hover:border-accent disabled:opacity-50"
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
          <button
            type="button"
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void submit("y")}
          >
            예
          </button>
          <button
            type="button"
            className="rounded border border-line bg-transparent px-3 py-1.5 text-sm text-white hover:border-accent disabled:opacity-50"
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

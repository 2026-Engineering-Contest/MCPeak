import type { JSX } from "react";
import { useState } from "react";
import type { PendingQuestion } from "../../../src/api-types.js";

/**
 * 대화형 승인 질문 하나(UI 설계 §4). "질문" 뱃지 + message + kind별 컨트롤.
 * 표시 전용이다: 응답 전송·패널 숨김은 호출부가 onAnswer로 처리한다(구현계획 §4-5).
 * input→입력값, choose→선택지 그대로, confirm→"y"|"n".
 *
 * 질문이 바뀔 때 입력값 초기화는 호출부의 `key={question.id}` 리마운트에 맡긴다.
 */
export function QuestionPanel(props: {
  question: PendingQuestion;
  onAnswer: (value: string) => void;
}): JSX.Element {
  const { question, onAnswer } = props;
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="space-y-3 rounded-lg border border-accent-border bg-accent-soft p-4">
      <p className="text-sm">
        <span className="mr-2 inline-flex items-center rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">
          질문
        </span>
        <span className="font-medium text-ink">{question.message}</span>
      </p>

      {question.kind === "input" && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onAnswer(inputValue);
          }}
        >
          <input
            className="flex-1 rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
          />
          <button
            type="submit"
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white"
          >
            제출
          </button>
        </form>
      )}

      {question.kind === "choose" && (
        <div className="flex flex-wrap gap-2">
          {question.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              className="rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-line-subtle"
              onClick={() => onAnswer(choice)}
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
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => onAnswer("y")}
          >
            예
          </button>
          <button
            type="button"
            className="rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-line-subtle"
            onClick={() => onAnswer("n")}
          >
            아니오
          </button>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import type { PendingQuestion } from "../../../src/api-types.js";
import { apiSend } from "../api.js";

interface QuestionPanelProps {
  readonly runId: string;
  readonly question: PendingQuestion;
}

/**
 * 대화형 승인 질문 하나를 보여주고 `POST /api/runs/:id/answer`로 응답한다.
 *
 * `run-stream.ts`는 새 question 이벤트로 교체되거나 done이 올 때만 pendingQuestion을
 * 비운다(질문과 답 사이에 낀 stdout/stderr 한 줄로 패널이 사라져 응답 불가 상태가 되는
 * 문제를 막기 위해서다). 그래서 "답변 후 패널을 감춘다"는 규칙은 이 컴포넌트가 직접
 * 담당한다: 자신이 마지막으로 성공시킨 question.id를 로컬 state로 들고 있다가, 같은
 * id의 질문이 다시 props로 오면(즉 상위 state가 아직 안 바뀌었으면) null을 렌더한다.
 *
 * 질문이 바뀔 때 입력값·에러를 초기화하는 책임은 useEffect가 아니라 호출부의
 * `key={question.id}` 리마운트에 맡긴다(리마운트가 곧 초기화라 effect가 필요 없다).
 */
export function QuestionPanel({ runId, question }: QuestionPanelProps) {
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (answeredId === question.id) {
    return null;
  }

  async function answer(value: string): Promise<void> {
    setSending(true);
    setError(null);
    try {
      await apiSend("POST", `/api/runs/${encodeURIComponent(runId)}/answer`, {
        questionId: question.id,
        value,
      });
      setAnsweredId(question.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="font-medium text-slate-800">{question.message}</p>

      {question.kind === "input" && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void answer(inputValue);
          }}
        >
          <input
            className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            value={inputValue}
            disabled={sending}
            onChange={(event) => setInputValue(event.target.value)}
          />
          <button
            type="submit"
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            disabled={sending}
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
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
              disabled={sending}
              onClick={() => void answer(choice)}
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
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            disabled={sending}
            onClick={() => void answer("y")}
          >
            예
          </button>
          <button
            type="button"
            className="rounded bg-slate-200 px-3 py-1.5 text-sm text-slate-800 disabled:opacity-50"
            disabled={sending}
            onClick={() => void answer("n")}
          >
            아니오
          </button>
        </div>
      )}

      {error !== null && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { JsonValue, SessionEntry, SessionInteractionEntry } from "../../../src/api-types.js";
import { apiGet } from "../api.js";
import { Button } from "../components/Button.js";
import { INPUT_CLASS } from "../components/Field.js";
import { isBlankResult, type PickedResponse } from "./draft.js";
import { describeInteraction, interactionsPath } from "./interactions.js";

/** 폼의 응답 줄 하나. "result 로 넣기" 의 대상 목록이다. */
export interface ResponseTarget {
  readonly label: string;
  readonly resultJson: string;
}

export interface RecordingPanelProps {
  /** 폼에 이미 있는 도구 이름. 입력 칸의 제안 목록이다. */
  readonly toolNames: readonly string[];
  readonly responses: readonly ResponseTarget[];
  readonly onAdd: (pick: PickedResponse) => void;
  readonly onReplaceResult: (index: number, body: JsonValue) => void;
}

/** 한 번에 한 호출에서만 입력을 받는다. */
type Action =
  | {
      readonly kind: "add";
      readonly ordinal: number;
      readonly tool: string;
      readonly anyArgs: boolean;
      readonly argsJson: string;
      readonly error: string | null;
    }
  | { readonly kind: "confirm-replace"; readonly ordinal: number; readonly index: number };

/**
 * 편집 중 폼 옆에 펴 두는 녹화본 패널(설계 §화면 흐름). 녹화본은 **읽기만** 한다 — 서버 실행 ·
 * 재생 · 새 녹화 없음. 가져온 본문은 가공하지 않고 넘긴다. 무엇을 지울지는 폼에서 사람이 정한다.
 */
export function RecordingPanel({
  toolNames,
  responses,
  onAdd,
  onReplaceResult,
}: RecordingPanelProps): JSX.Element {
  const [sessions, setSessions] = useState<readonly SessionEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [sessionPath, setSessionPath] = useState("");
  const [interactions, setInteractions] = useState<readonly SessionInteractionEntry[] | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  /** 호출(ordinal)마다 고른 "넣을 응답" 번호. 고르지 않았으면 0 이다. */
  const [targets, setTargets] = useState<Record<number, number>>({});

  useEffect(() => {
    apiGet<SessionEntry[]>("/api/sessions")
      .then(setSessions)
      .catch((err: unknown) => setListError(err instanceof Error ? err.message : String(err)));
  }, []);

  function open(path: string): void {
    setSessionPath(path);
    setInteractions(null);
    setOpenError(null);
    setAction(null);
    if (path === "") return;
    apiGet<SessionInteractionEntry[]>(interactionsPath(path))
      .then(setInteractions)
      .catch((err: unknown) => setOpenError(err instanceof Error ? err.message : String(err)));
  }

  function submitAdd(current: Extract<Action, { kind: "add" }>, body: JsonValue): void {
    const tool = current.tool.trim();
    if (tool === "") {
      setAction({
        ...current,
        error: "어느 도구의 답인지 적으세요. 폼에 없는 도구면 이름만 채워 새로 만듭니다.",
      });
      return;
    }
    onAdd({ tool, argsJson: current.anyArgs ? null : current.argsJson, body });
    setAction(null);
  }

  function replace(ordinal: number, body: JsonValue): void {
    // 폼에서 응답을 지우면 고른 번호가 범위를 벗어날 수 있다. 마지막 줄로 붙인다.
    const index = Math.min(targets[ordinal] ?? 0, responses.length - 1);
    const target = responses[index];
    if (target === undefined) return;
    if (isBlankResult(target.resultJson)) {
      onReplaceResult(index, body);
      return;
    }
    setAction({ kind: "confirm-replace", ordinal, index });
  }

  if (listError !== null) {
    return (
      <p role="alert" className="whitespace-pre-line text-sm text-ink">
        {listError}
      </p>
    );
  }
  if (sessions === null) return <p className="text-sm text-ink-muted">녹화본을 찾는 중…</p>;
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        {
          "이 디렉터리 아래에 녹화본이 없습니다. mcpeak test --record-session <path> 로 녹화한 파일이 여기에 나옵니다."
        }
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor="recording-session">
          녹화본
        </label>
        <select
          id="recording-session"
          className={INPUT_CLASS}
          value={sessionPath}
          onChange={(event) => open(event.target.value)}
        >
          <option value="">녹화본을 고르세요</option>
          {sessions.map((session) => (
            <option key={session.path} value={session.path}>
              {`${session.path} · 외부 호출 ${session.interactionCount}건`}
            </option>
          ))}
        </select>
      </div>

      {openError !== null && (
        <p role="alert" className="whitespace-pre-line text-sm text-ink">
          {openError}
        </p>
      )}

      {interactions !== null && (
        <ol className="space-y-2">
          {interactions.map((entry) => {
            const view = describeInteraction(entry);
            if (!view.pickable) {
              return (
                <li key={entry.ordinal} className="space-y-1 rounded border border-line p-3">
                  <p className="font-mono text-xs text-ink-muted">{view.label}</p>
                  <p className="text-xs text-ink-muted">{view.reason}</p>
                </li>
              );
            }
            const current = action?.ordinal === entry.ordinal ? action : null;
            return (
              <li key={entry.ordinal} className="space-y-2 rounded border border-line p-3">
                <details>
                  <summary className="cursor-pointer font-mono text-xs text-ink">
                    {view.label}
                  </summary>
                  <pre className="mt-2 overflow-auto text-xs text-ink">
                    {JSON.stringify(view.body, null, 2)}
                  </pre>
                </details>

                {current?.kind === "add" && (
                  <div className="space-y-2">
                    <label className="block text-sm text-ink" htmlFor="pick-tool">
                      어느 도구의 답인가
                    </label>
                    <input
                      id="pick-tool"
                      list="pick-tool-names"
                      className={INPUT_CLASS}
                      value={current.tool}
                      onChange={(event) =>
                        setAction({ ...current, tool: event.target.value, error: null })
                      }
                    />
                    <datalist id="pick-tool-names">
                      {toolNames.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={current.anyArgs}
                        onChange={(event) =>
                          setAction({ ...current, anyArgs: event.target.checked })
                        }
                      />
                      인자 무관으로 넣기
                    </label>
                    <label className="block text-sm text-ink" htmlFor="pick-args">
                      어떤 인자일 때 (JSON)
                    </label>
                    <textarea
                      id="pick-args"
                      className={`${INPUT_CLASS} font-mono`}
                      rows={2}
                      disabled={current.anyArgs}
                      value={current.argsJson}
                      onChange={(event) => setAction({ ...current, argsJson: event.target.value })}
                    />
                    {current.error !== null && <p className="text-xs text-ink">{current.error}</p>}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => submitAdd(current, view.body)}
                      >
                        목에 넣기
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
                        취소
                      </Button>
                    </div>
                  </div>
                )}

                {current?.kind === "confirm-replace" && (
                  <div className="space-y-2">
                    <p className="text-sm text-ink">
                      {`${responses[current.index]?.label ?? ""} 의 result 를 이 본문으로 바꿉니다. 지금 적힌 값은 사라집니다.`}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          onReplaceResult(current.index, view.body);
                          setAction(null);
                        }}
                      >
                        바꾸기
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
                        취소
                      </Button>
                    </div>
                  </div>
                )}

                {current === null && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="xs"
                      onClick={() =>
                        setAction({
                          kind: "add",
                          ordinal: entry.ordinal,
                          tool: "",
                          anyArgs: false,
                          argsJson: "{}",
                          error: null,
                        })
                      }
                    >
                      새 응답으로 추가
                    </Button>
                    {responses.length > 0 && (
                      <>
                        <select
                          aria-label="넣을 응답"
                          className={INPUT_CLASS}
                          value={String(
                            Math.min(targets[entry.ordinal] ?? 0, responses.length - 1),
                          )}
                          onChange={(event) =>
                            setTargets({ ...targets, [entry.ordinal]: Number(event.target.value) })
                          }
                        >
                          {responses.map((target, index) => (
                            <option key={target.label} value={String(index)}>
                              {target.label}
                            </option>
                          ))}
                        </select>
                        <Button size="xs" onClick={() => replace(entry.ordinal, view.body)}>
                          result 로 넣기
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type { JsonValue, SessionEntry, SessionInteractionEntry } from "../../../src/api-types.js";
import { apiGet } from "../api.js";
import { Button } from "../components/Button.js";
import { INPUT_CLASS } from "../components/Field.js";
import { isBlankResult } from "./draft.js";
import { describeInteraction, interactionsPath } from "./interactions.js";

/** 채운 result 아래 출처 한 줄. `ordinal` 은 0부터라 사람이 세는 번호로 바꾼다. */
export function recordedFromNote(sessionPath: string, ordinal: number): string {
  return `${sessionPath} 의 ${ordinal + 1}번째 외부 호출에서 가져왔습니다.`;
}

export interface RecordingPickerProps {
  /** 이 응답 줄의 칸 id 접두사. */
  readonly id: string;
  /** 지금 result. 비었거나 `{}` 가 아니면 바꾸기 전에 확인받는다. */
  readonly resultJson: string;
  readonly onPick: (body: JsonValue, recordedFrom: string) => void;
}

interface Pending {
  readonly body: JsonValue;
  readonly recordedFrom: string;
}

/**
 * 응답 카드 안에 펼치는 녹화본 선택 창(설계 §사용 훑기 반영 U6). 채우고 있는 칸에서 출발하므로
 * "어느 줄에 넣을지" 를 따로 묻지 않는다. 녹화본은 **읽기만** 한다 — 서버 실행 · 재생 · 새 녹화
 * 없음. 본문은 가공하지 않고 넘긴다.
 */
export function RecordingPicker({ id, resultJson, onPick }: RecordingPickerProps): JSX.Element {
  const [sessions, setSessions] = useState<readonly SessionEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [sessionPath, setSessionPath] = useState("");
  const [interactions, setInteractions] = useState<readonly SessionInteractionEntry[] | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // 빠르게 녹화본을 바꾸면 먼저 부른 요청이 나중 것보다 늦게 돌아올 수 있다. ref 로 "지금
  // 고른 경로" 를 들고 있다가, 응답이 왔을 때 그 경로가 아니면 버린다 — state 는 리렌더를
  // 트리거해 .then 클로저가 가진 낡은 값을 다시 읽는 문제가 있어 ref 를 쓴다.
  const requestedPath = useRef("");

  function open(path: string): void {
    setSessionPath(path);
    setInteractions(null);
    setOpenError(null);
    setPending(null);
    requestedPath.current = path;
    if (path === "") return;
    apiGet<SessionInteractionEntry[]>(interactionsPath(path))
      .then((found) => {
        if (requestedPath.current !== path) return; // 그 사이에 다른 녹화본을 골랐다
        setInteractions(found);
      })
      .catch((err: unknown) => {
        if (requestedPath.current !== path) return;
        setOpenError(err instanceof Error ? err.message : String(err));
      });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: 열 때 한 번만 목록을 부른다
  useEffect(() => {
    apiGet<SessionEntry[]>("/api/sessions")
      .then((found) => {
        setSessions(found);
        const only = found.length === 1 ? found[0] : undefined;
        if (only !== undefined) open(only.path);
      })
      .catch((err: unknown) => setListError(err instanceof Error ? err.message : String(err)));
  }, []);

  function pick(body: JsonValue, ordinal: number): void {
    const recordedFrom = recordedFromNote(sessionPath, ordinal);
    if (isBlankResult(resultJson)) {
      onPick(body, recordedFrom);
      return;
    }
    setPending({ body, recordedFrom });
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
    <div className="space-y-3 rounded border border-accent bg-accent-soft p-3">
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-recording`}>
          녹화본
        </label>
        <select
          id={`${id}-recording`}
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

      {pending !== null && (
        <div className="space-y-2">
          <p className="text-sm text-ink">
            지금 적힌 result 를 이 본문으로 바꿉니다. 지금 값은 사라집니다.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onPick(pending.body, pending.recordedFrom);
                setPending(null);
              }}
            >
              바꾸기
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              취소
            </Button>
          </div>
        </div>
      )}

      {interactions !== null && pending === null && (
        <ol className="space-y-2">
          {interactions.map((entry) => {
            const view = describeInteraction(entry);
            return (
              <li
                key={entry.ordinal}
                className="space-y-2 rounded border border-line bg-canvas p-3"
              >
                <p className="break-all font-mono text-xs text-ink">{view.label}</p>
                {view.pickable ? (
                  <>
                    <pre className="max-h-32 overflow-auto text-xs text-ink-muted">
                      {JSON.stringify(view.body, null, 2)}
                    </pre>
                    <Button
                      size="xs"
                      variant="primary"
                      onClick={() => pick(view.body, entry.ordinal)}
                    >
                      이걸로 채우기
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-ink-muted">{view.reason}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

import type { JSX } from "react";
import { useState } from "react";
import type { PutFileRequest, PutFileResponse } from "../../../src/api-types.js";
import { apiSend } from "../api.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Field, INPUT_CLASS } from "../components/Field.js";
import { PageHeader } from "../components/PageHeader.js";
import { leaveAnyway, useLeaveGuard } from "../leave-guard.js";
import { newResponseFor } from "../mock-builder/args-check.js";
import { bodyUrlWarning, recordingUrlCount } from "../mock-builder/body-urls.js";
import {
  buildMockDefinition,
  EMPTY_MOCK_DRAFT,
  type MockDraft,
  mockFilePath,
  newToolDraft,
  preservedKeysNote,
  serializeMockDefinition,
} from "../mock-builder/draft.js";
import { MockStart } from "../mock-builder/MockStart.js";
import { ResponseEditor } from "../mock-builder/ResponseEditor.js";
import { ToolEditor } from "../mock-builder/ToolEditor.js";

/** 무엇을 편집 중인가. `file` 의 `mtimeMs` 가 저장할 때 덮어쓰기 기준이다. */
type EditSource =
  | { readonly kind: "new" }
  | { readonly kind: "file"; readonly path: string; readonly mtimeMs: number };

type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "invalid"; readonly errors: readonly string[] }
  | { readonly kind: "saving" }
  | {
      readonly kind: "conflict";
      readonly path: string;
      readonly mtimeMs: number;
      /** `exists`: 새 목인데 경로에 파일이 있다. `changed`: 연 뒤 누가 파일을 바꿨다. */
      readonly reason: "exists" | "changed";
    }
  | { readonly kind: "saved"; readonly path: string }
  | { readonly kind: "failed"; readonly message: string };

const DEFAULT_TARGET = "mock.json";

/**
 * 목 만들기 — `mock.json` 을 새로 만들거나 기존 파일을 열어 고친다(설계 2026-09-28).
 *
 * 첫 화면에서 새로 만들기 · 기존 목 수정을 고른다. 녹화본은 시작 갈래가 아니라 응답 카드
 * 안에서 result 를 채울 때 고르는 곳이다. 검증은 서버가 `assertMockDefinition` 으로 한다 — web 은
 * `@mcpeak/mock` 을 import 하지 않는다.
 *
 * 덮어쓰기: 새 목은 `baseMtimeMs: 0`, 연 파일은 열 때 받은 mtime 을 보낸다. 저장에 성공하면
 * 그 경로 · 새 mtime 이 기준이 된다 — 같은 목을 다시 저장할 때마다 확인을 묻지 않는다.
 */
export function MockBuilder(): JSX.Element {
  const [source, setSource] = useState<EditSource | null>(null);
  const [draft, setDraft] = useState<MockDraft>(EMPTY_MOCK_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [targetPath, setTargetPath] = useState(DEFAULT_TARGET);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [pickerAt, setPickerAt] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  /** 막힌 이동의 목적지. 확인 줄을 띄운다. */
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  useLeaveGuard(source !== null && dirty, setLeavingTo);

  function begin(next: EditSource, nextDraft: MockDraft, path: string): void {
    setSource(next);
    setDraft(nextDraft);
    setTargetPath(path);
    setDirty(false);
    setSave({ kind: "idle" });
    setPickerAt(null);
    setHighlighted(null);
    setLeaving(false);
    setLeavingTo(null);
  }

  if (source === null) {
    return (
      <div className="space-y-6">
        <PageHeader title="목 만들기" description="어떻게 시작할지 고르세요." />
        <MockStart
          onNew={() => begin({ kind: "new" }, EMPTY_MOCK_DRAFT, DEFAULT_TARGET)}
          onOpen={(mock) =>
            begin({ kind: "file", path: mock.path, mtimeMs: mock.mtimeMs }, mock.draft, mock.path)
          }
        />
      </div>
    );
  }

  const editing = source;
  const urlWarning = bodyUrlWarning(recordingUrlCount(draft), "definition");
  const topPreserved = preservedKeysNote(draft.extra);

  /** `touched` 는 녹화본에서 방금 가져온 줄. 그 밖의 편집은 강조를 지운다. */
  function update(next: MockDraft, touched: number | null = null): void {
    setDraft(next);
    setDirty(true);
    setSave({ kind: "idle" });
    setHighlighted(touched);
  }

  function baseMtimeFor(path: string): number {
    return editing.kind === "file" && editing.path === path ? editing.mtimeMs : 0;
  }

  async function submit(baseMtimeMs: number): Promise<void> {
    const built = buildMockDefinition(draft);
    if (!built.ok) {
      setSave({ kind: "invalid", errors: built.errors });
      return;
    }
    const path = targetPath.trim();
    if (path === "") {
      setSave({
        kind: "invalid",
        errors: ["저장 위치를 적으세요. 대시보드를 띄운 디렉터리 기준 상대경로입니다."],
      });
      return;
    }
    setSave({ kind: "saving" });
    const request: PutFileRequest = {
      content: serializeMockDefinition(built.definition),
      baseMtimeMs,
    };
    try {
      const result = await apiSend<PutFileResponse>("PUT", mockFilePath(path), request);
      if (result.saved) {
        setSource({ kind: "file", path, mtimeMs: result.mtimeMs });
        setDirty(false);
        setSave({ kind: "saved", path });
        return;
      }
      setSave({
        kind: "conflict",
        path,
        mtimeMs: result.mtimeMs,
        reason: baseMtimeMs === 0 ? "exists" : "changed",
      });
    } catch (err: unknown) {
      setSave({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function leave(): void {
    if (dirty) {
      setLeaving(true);
      return;
    }
    setSource(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="목 만들기"
        description={editing.kind === "new" ? "새 목" : `편집 중: ${editing.path}`}
        aside={
          <Button variant="ghost" onClick={leave}>
            ← 처음으로
          </Button>
        }
      />

      {leaving && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink">→ 지금 폼의 내용을 버리고 처음으로 돌아갑니다.</p>
          <Button size="sm" variant="primary" onClick={() => setSource(null)}>
            버리고 돌아가기
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLeaving(false)}>
            취소
          </Button>
        </div>
      )}

      {leavingTo !== null && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink">→ 저장하지 않은 목을 버리고 다른 화면으로 이동합니다.</p>
          <Button size="sm" variant="primary" onClick={() => leaveAnyway(leavingTo)}>
            버리고 이동
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLeavingTo(null)}>
            취소
          </Button>
        </div>
      )}

      {topPreserved !== null && <p className="text-xs text-ink-muted">{topPreserved}</p>}

      <div className="space-y-6">
        <Card className="space-y-4 p-6">
          <h2 className="text-title font-semibold text-ink">도구</h2>
          <p className="text-sm text-ink-muted">
            {
              '목 서버가 "이런 도구가 있다" 고 알려 주는 목록입니다. 입력 필드는 그 도구를 부를 때 넘기는 값입니다.'
            }
          </p>
          {draft.tools.map((tool, index) => (
            <ToolEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: 도구 이름은 비거나 겹칠 수 있어 유일 키가 없고, 목록은 변경마다 통째로 재생성된다
              key={index}
              index={index}
              tool={tool}
              onChange={(next) =>
                update({ ...draft, tools: draft.tools.map((t, i) => (i === index ? next : t)) })
              }
              onRemove={() =>
                update({ ...draft, tools: draft.tools.filter((_, i) => i !== index) })
              }
            />
          ))}
          <Button onClick={() => update({ ...draft, tools: [...draft.tools, newToolDraft()] })}>
            도구 추가
          </Button>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-title font-semibold text-ink">응답</h2>
          <p className="text-sm text-ink-muted">
            {
              "도구가 불렸을 때 목이 돌려줄 답입니다. 도구와 args 가 호출과 똑같을 때 그 줄의 result 를 돌려줍니다."
            }
          </p>
          {draft.responses.map((response, index) => (
            <ResponseEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: 같은 도구 · 같은 인자 응답이 겹칠 수 있어 유일 키가 없고, 목록은 변경마다 통째로 재생성된다
              key={index}
              index={index}
              response={response}
              tools={draft.tools}
              highlighted={highlighted === index}
              pickerOpen={pickerAt === index}
              onTogglePicker={() => setPickerAt(pickerAt === index ? null : index)}
              onPicked={(next) => {
                update(
                  { ...draft, responses: draft.responses.map((r, i) => (i === index ? next : r)) },
                  index,
                );
                setPickerAt(null);
              }}
              onChange={(next) =>
                update({
                  ...draft,
                  responses: draft.responses.map((r, i) => (i === index ? next : r)),
                })
              }
              onRemove={() => {
                update({ ...draft, responses: draft.responses.filter((_, i) => i !== index) });
                setPickerAt(null);
              }}
            />
          ))}
          <Button
            onClick={() =>
              update({
                ...draft,
                responses: [...draft.responses, newResponseFor(draft.tools)],
              })
            }
          >
            응답 추가
          </Button>
        </Card>

        <Card className="space-y-3 p-6">
          <Field
            label="저장 위치"
            htmlFor="mock-target"
            hint="대시보드를 띄운 디렉터리 기준 상대경로"
          >
            <input
              id="mock-target"
              className={INPUT_CLASS}
              value={targetPath}
              onChange={(event) => {
                setTargetPath(event.target.value);
                setSave({ kind: "idle" });
              }}
            />
          </Field>
          {urlWarning.length > 0 && (
            <div role="note" className="space-y-0.5 text-xs text-ink">
              {urlWarning.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          <Button
            variant="primary"
            disabled={save.kind === "saving"}
            onClick={() => void submit(baseMtimeFor(targetPath.trim()))}
          >
            저장
          </Button>
          <SaveStatus
            state={save}
            onOverwrite={(mtimeMs) => void submit(mtimeMs)}
            onCancel={() => setSave({ kind: "idle" })}
          />
        </Card>
      </div>
    </div>
  );
}

function SaveStatus(props: {
  readonly state: SaveState;
  readonly onOverwrite: (mtimeMs: number) => void;
  readonly onCancel: () => void;
}): JSX.Element | null {
  const { state } = props;
  switch (state.kind) {
    case "idle":
    case "saving":
      return null;
    case "saved":
      return <p className="text-sm text-ink">{`저장했습니다 — ${state.path}`}</p>;
    case "conflict":
      return (
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink">
            {state.reason === "exists"
              ? `이미 파일이 있습니다 — ${state.path}. 덮어쓸까요?`
              : `이 파일이 불러온 뒤에 바뀌었습니다 — ${state.path}. 덮어쓸까요?`}
          </p>
          <Button size="sm" variant="primary" onClick={() => props.onOverwrite(state.mtimeMs)}>
            덮어쓰기
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onCancel}>
            취소
          </Button>
        </div>
      );
    case "invalid":
      return (
        <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-ink">
          {state.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      );
    case "failed":
      return (
        <p role="alert" className="whitespace-pre-line text-sm text-ink">
          {state.message}
        </p>
      );
  }
}

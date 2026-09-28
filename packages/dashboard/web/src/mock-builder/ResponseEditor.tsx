import type { JSX } from "react";
import { Button } from "../components/Button.js";
import { INPUT_CLASS, Toggle } from "../components/Field.js";
import { argsProblems, findTool, prefillArgs, toolProblem } from "./args-check.js";
import { bodyUrlWarning, responseUrlCount } from "./body-urls.js";
import { pickedResult, preservedKeysNote, type ResponseDraft, type ToolDraft } from "./draft.js";
import { RecordingPicker } from "./RecordingPicker.js";

export interface ResponseEditorProps {
  readonly index: number;
  readonly response: ResponseDraft;
  /** 폼의 도구 전부. 도구 선택지 · args 점검 · 채우기에 쓴다. */
  readonly tools: readonly ToolDraft[];
  /** 녹화본에서 방금 가져온 줄. 다음 편집 전까지 강조한다(타이머 없음). */
  readonly highlighted: boolean;
  /** 이 줄의 녹화본 선택 창이 열려 있나. 한 번에 한 줄만 열린다 — 부모가 정한다. */
  readonly pickerOpen: boolean;
  readonly onTogglePicker: () => void;
  /** 녹화본에서 result 를 채운 줄. 부모가 강조하고 선택 창을 닫는다. */
  readonly onPicked: (response: ResponseDraft) => void;
  readonly onChange: (response: ResponseDraft) => void;
  readonly onRemove: () => void;
}

/**
 * 응답 한 줄. 녹화본에서 가져온 result 면 남은 URL 을 **고칠 때마다** 다시 센다 — 값을
 * 지우면 경고가 사라져 사람이 한 확인이 바로 보인다. 저장은 막지 않는다.
 */
export function ResponseEditor({
  index,
  response,
  tools,
  highlighted,
  pickerOpen,
  onTogglePicker,
  onPicked,
  onChange,
  onRemove,
}: ResponseEditorProps): JSX.Element {
  const id = `response-${index}`;
  const toolNames = tools.map((tool) => tool.name.trim()).filter((name) => name !== "");
  const toolIssue = toolProblem(response.tool, toolNames);
  const argsIssues = argsProblems(response, tools);
  // 폼에서 도구 이름을 고치면 이 응답의 도구가 목록에서 사라질 수 있다. 그 값도 보여야
  // 사용자가 무엇을 다시 골라야 하는지 안다.
  const options = toolNames.includes(response.tool) ? toolNames : [response.tool, ...toolNames];
  const warning =
    response.origin === "recording"
      ? bodyUrlWarning(responseUrlCount(response.resultJson), "response")
      : [];
  const preserved = preservedKeysNote(response.extra);

  return (
    <fieldset
      data-highlighted={highlighted ? "true" : undefined}
      className={`space-y-3 rounded border p-4 ${highlighted ? "border-accent bg-accent-soft" : "border-line"}`}
    >
      <legend className="px-1 text-sm font-semibold text-ink">{`응답 ${index + 1}`}</legend>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-tool`}>
          도구
        </label>
        <select
          id={`${id}-tool`}
          className={INPUT_CLASS}
          value={response.tool}
          onChange={(event) =>
            onChange(
              prefillArgs(
                { ...response, tool: event.target.value },
                findTool(tools, event.target.value),
              ),
            )
          }
        >
          {options.map((name) => (
            <option key={name} value={name}>
              {name === "" ? "(도구를 고르세요)" : name}
            </option>
          ))}
        </select>
        {toolIssue !== null && (
          <p role="note" className="text-xs text-ink">
            {toolIssue}
          </p>
        )}
      </div>
      <Toggle
        id={`${id}-any`}
        label="인자 무관 (ANY)"
        checked={response.anyArgs}
        hint="켜면 args 를 적지 않습니다. 인자를 지정한 응답이 항상 먼저 매칭됩니다."
        onChange={(anyArgs) => onChange({ ...response, anyArgs })}
      />
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-args`}>
          args (JSON)
        </label>
        <textarea
          id={`${id}-args`}
          className={`${INPUT_CLASS} font-mono`}
          rows={3}
          disabled={response.anyArgs}
          value={response.argsJson}
          onChange={(event) => onChange({ ...response, argsJson: event.target.value })}
        />
        {argsIssues.length > 0 && (
          <div role="note" className="space-y-0.5 text-xs text-ink">
            {argsIssues.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label className="block text-sm font-medium text-ink" htmlFor={`${id}-result`}>
            result (JSON)
          </label>
          <Button
            size="xs"
            aria-expanded={pickerOpen}
            aria-controls={`${id}-picker`}
            onClick={onTogglePicker}
          >
            {pickerOpen ? "녹화본 닫기" : "녹화본에서 가져오기"}
          </Button>
        </div>
        {pickerOpen && (
          <div id={`${id}-picker`}>
            <RecordingPicker
              id={id}
              resultJson={response.resultJson}
              onPick={(body, recordedFrom) => onPicked(pickedResult(response, body, recordedFrom))}
            />
          </div>
        )}
        <textarea
          id={`${id}-result`}
          className={`${INPUT_CLASS} font-mono`}
          rows={8}
          value={response.resultJson}
          onChange={(event) => onChange({ ...response, resultJson: event.target.value })}
        />
        {response.origin === "recording" && response.recordedFrom !== undefined && (
          <div className="space-y-0.5 text-xs">
            <p className="text-ink-muted">{response.recordedFrom}</p>
            {/* 녹화본은 서버가 받은 것이고 목의 result 는 서버가 주는 것이다. 가공하는 도구라면
                사람이 답 모양으로 고쳐야 한다(설계 U6 · 가져온 응답은 가공하지 않는다). */}
            <p className="text-ink">
              → 서버가 바깥 API 에게서 받은 응답을 그대로 가져왔습니다. 서버가 사용자에게 돌려주는
              답이 아닙니다.
            </p>
            <p className="text-ink">
              → 실제 서버가 이 응답에서 값을 꺼내 다른 모양으로 답한다면, result 도 그 모양으로 고쳐
              쓰세요.
            </p>
          </div>
        )}
      </div>
      {warning.length > 0 && (
        <div role="note" className="space-y-0.5 text-xs text-ink">
          {warning.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <Toggle
        id={`${id}-error`}
        label="서버의 거절로 표시 (isError)"
        checked={response.isError}
        hint={
          '켜면 이 result 를 도구의 실패 답으로 돌려줍니다. 예: 없는 도시를 물었을 때 "지역을 찾지 못했습니다".'
        }
        onChange={(isError) => onChange({ ...response, isError })}
      />
      {preserved !== null && <p className="text-xs text-ink-muted">{preserved}</p>}
      <Button variant="ghost" size="sm" onClick={onRemove}>
        응답 삭제
      </Button>
    </fieldset>
  );
}

import type { JSX } from "react";
import { Button } from "../components/Button.js";
import { INPUT_CLASS } from "../components/Field.js";
import { preservedKeysNote, type ToolDraft } from "./draft.js";
import {
  FIELD_TYPES,
  type FieldDraft,
  type FieldType,
  fieldsToSchema,
  schemaToFields,
} from "./schema-fields.js";

export interface ToolEditorProps {
  readonly index: number;
  readonly tool: ToolDraft;
  readonly onChange: (tool: ToolDraft) => void;
  readonly onRemove: () => void;
}

/** JSON 모드에서 평면 폼으로 돌아갈 수 있으면 그 필드, 없으면 이유. */
function backToFields(
  schemaJson: string,
): { readonly fields: readonly FieldDraft[] } | { readonly reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaJson);
  } catch {
    return { reason: "스키마 JSON 을 읽을 수 없습니다. 따옴표·쉼표·괄호 짝을 확인하세요." };
  }
  const result = schemaToFields(parsed);
  return result.ok ? { fields: result.fields } : { reason: result.reason };
}

/**
 * 도구 하나. 상태는 부모가 갖는다. 평면 폼은 중첩 · enum 을 다루지 않으므로 "JSON 으로 편집"
 * 을 둔다. JSON 에서 평면으로 돌아갈 수 없는 스키마면 버튼을 끄고 이유를 적는다 — 눌러서
 * 스키마 일부가 조용히 사라지면 저장한 목이 왜 인자를 다르게 검사하는지 알 수 없다.
 */
export function ToolEditor({ index, tool, onChange, onRemove }: ToolEditorProps): JSX.Element {
  const id = `tool-${index}`;
  const patchField = (at: number, patch: Partial<FieldDraft>): void => {
    onChange({
      ...tool,
      fields: tool.fields.map((field, i) => (i === at ? { ...field, ...patch } : field)),
    });
  };
  const back = tool.schemaMode === "json" ? backToFields(tool.schemaJson) : null;
  const preserved = preservedKeysNote(tool.extra);

  return (
    <fieldset className="space-y-3 rounded border border-line p-4">
      <legend className="px-1 text-sm font-semibold text-ink">{`도구 ${index + 1}`}</legend>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-name`}>
          도구 이름
        </label>
        <input
          id={`${id}-name`}
          className={INPUT_CLASS}
          value={tool.name}
          onChange={(event) => onChange({ ...tool, name: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-description`}>
          설명
        </label>
        <input
          id={`${id}-description`}
          className={INPUT_CLASS}
          value={tool.description}
          onChange={(event) => onChange({ ...tool, description: event.target.value })}
        />
      </div>
      {tool.schemaMode === "fields" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">입력 필드</p>
          {tool.fields.map((field, at) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 필드 이름은 비거나 겹칠 수 있어 유일 키가 없고, 목록은 변경마다 통째로 재생성된다
              key={at}
              className="flex items-center gap-2"
            >
              <input
                aria-label={`필드 ${at + 1} 이름`}
                className={INPUT_CLASS}
                value={field.name}
                onChange={(event) => patchField(at, { name: event.target.value })}
              />
              <select
                aria-label={`필드 ${at + 1} 타입`}
                className={INPUT_CLASS}
                value={field.type}
                onChange={(event) => patchField(at, { type: event.target.value as FieldType })}
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <label className="flex shrink-0 items-center gap-1 text-sm text-ink">
                <input
                  type="checkbox"
                  aria-label={`필드 ${at + 1} 필수`}
                  checked={field.required}
                  onChange={(event) => patchField(at, { required: event.target.checked })}
                />
                필수
              </label>
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  onChange({ ...tool, fields: tool.fields.filter((_, i) => i !== at) })
                }
              >
                필드 삭제
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                onChange({
                  ...tool,
                  fields: [...tool.fields, { name: "", type: "string", required: false }],
                })
              }
            >
              필드 추가
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  ...tool,
                  schemaMode: "json",
                  schemaJson: JSON.stringify(fieldsToSchema(tool.fields), null, 2),
                })
              }
            >
              JSON 으로 편집
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-ink" htmlFor={`${id}-schema`}>
            입력 스키마 (JSON)
          </label>
          <textarea
            id={`${id}-schema`}
            className={`${INPUT_CLASS} font-mono`}
            rows={8}
            value={tool.schemaJson}
            onChange={(event) => onChange({ ...tool, schemaJson: event.target.value })}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={back !== null && "reason" in back}
            onClick={() => {
              if (back !== null && "fields" in back) {
                onChange({ ...tool, schemaMode: "fields", fields: back.fields });
              }
            }}
          >
            폼으로 돌아가기
          </Button>
          {back !== null && "reason" in back && (
            <p className="text-xs text-ink-muted">{`평면 폼으로 돌아갈 수 없습니다 — ${back.reason}`}</p>
          )}
        </div>
      )}
      {preserved !== null && <p className="text-xs text-ink-muted">{preserved}</p>}
      <Button variant="ghost" size="sm" onClick={onRemove}>
        도구 삭제
      </Button>
    </fieldset>
  );
}

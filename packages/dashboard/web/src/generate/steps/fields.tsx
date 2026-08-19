import type { JSX, ReactNode } from "react";

/** Generate 단계 공용 필드 래퍼: 라벨 + 컨트롤 + 부가 설명. */
export function Field(props: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-ink" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      {props.children}
      {props.hint !== undefined && <p className="text-xs text-ink-muted">{props.hint}</p>}
    </div>
  );
}

export const INPUT_CLASS =
  "w-full rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink disabled:opacity-50";

/** 켬/끔 토글(체크박스 기반). disabled 사유는 hint로 보여준다. */
export function Toggle(props: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm text-ink" htmlFor={props.id}>
        <input
          id={props.id}
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled ?? false}
          onChange={(event) => props.onChange(event.target.checked)}
        />
        {props.label}
      </label>
      {props.hint !== undefined && <p className="pl-6 text-xs text-ink-muted">{props.hint}</p>}
    </div>
  );
}

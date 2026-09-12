import type { JSX, ReactNode } from "react";
import { FOCUS_RING } from "./focus-ring.js";

/**
 * 입력 프리미티브(ADR-0093 PR 3, #458). `Field`·`Toggle`·`INPUT_CLASS`·`INPUT_ON_ACCENT_CLASS`
 * 는 Generate 마법사만의 것이 아니라 화면 전체가 쓰는 공용 프리미티브다.
 *
 * 예전에는 `generate/steps/fields.tsx` 에 있었다. 그런데 `generate/` 밖 5개 파일
 * (`ArgChips`·`TestOptionsPanel`·`TransportFields`·`StepRunOptions`·`ReplayView`)이
 * `../../generate/steps/fields.js` 를 가리키고 있었다 — `components/` 는 `generate/` 를
 * 참조하지 않는다는 의존 방향(§1)에 역행하는 참조였다. 그래서 `components/` 로 옮긴다.
 */
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

/*
 * 두 갈래가 **같은 바탕에서 나온다.** 예전에는 RunView 가 이 문자열을 손으로 베껴
 * `REPAIR_INPUT_CLASS` 를 만들면서 `disabled:opacity-50` 을 빠뜨렸다 — 비활성인데 흐려지지
 * 않는 칸이 repair 폼에만 생겼고, 그것을 알려 주는 것이 아무것도 없었다.
 *
 * 폭(`w-full`·`flex-1`)과 테두리 색을 갈래마다 한 번씩만 적는 것은 Tailwind 때문이다.
 * `${INPUT_CLASS} border-accent-border` 처럼 덧붙이면 승패를 호출부가 아니라 생성된 CSS 의
 * 소스 순서가 정한다.
 */
const INPUT_BASE = `rounded border bg-surface px-3 py-1.5 text-sm text-ink disabled:opacity-50 ${FOCUS_RING}`;

/** 대시보드 기본 입력칸. `<input>`·`<select>` 가 함께 쓴다. */
export const INPUT_CLASS = `w-full border-line ${INPUT_BASE}`;

/** accent-soft 패널 위에 놓이는 입력칸. QuestionPanel 하나가 쓴다. */
export const INPUT_ON_ACCENT_CLASS = `flex-1 border-accent-border ${INPUT_BASE}`;

/** 켬/끔 토글(체크박스 기반). disabled 사유는 hint 로 보여준다. */
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

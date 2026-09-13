import type { JSX } from "react";
import { FOCUS_RING_INSET } from "./focus-ring.js";

/**
 * 세그먼트 컨트롤 한 벌(ADR-0093 PR 3, #458).
 *
 * 예전에는 **같은 것이 세 곳에 글자 하나 안 틀리게 복제돼 있었다** —
 * `TransportFields`(접속 방식) · `StepServer`(실행 방법) · `StepRunOptions`(External 세션).
 * `<fieldset className="inline-flex overflow-hidden rounded-md border border-line">` 부터
 * 눌린 쪽의 `bg-accent-soft font-semibold text-accent` 까지 전부 같았고, 다른 것은 딱 하나였다
 * — `TransportFields` 한 벌만 `disabled:opacity-50` 을 빠뜨리고 있었다. 세 번 베껴 적으면
 * 그중 하나는 빠진다는 것을 그 한 벌이 보여 준다.
 *
 * **`disabled` 가 두 갈래인 것은 실측 근거가 있다.** `StepServer` 는 세그먼트 전체를 한 번에
 * 끄고(HTTP 대상일 때), `StepRunOptions` 는 선택지마다 다르게 끈다
 * (`http || (mode !== "off" && determinism)`). 어느 한쪽만 두면 나머지 호출부가 자기 `map` 을
 * 다시 적게 되어 이 컴포넌트가 헛돈다. **비활성 사유 문구는 전파하지 않는다** — 사유는 지금도
 * 세그먼트 밖 `<p>` 에 있고, 안으로 들이면 `TransportFields`·`StepServer` 에는 그릴 자리가 없다.
 *
 * **링을 안쪽으로 들이는 이유(`FOCUS_RING_INSET`).** `<fieldset>` 에 `overflow-hidden` 이 있고
 * 버튼이 그 상자를 꽉 채운다. 바깥으로 2px 띄우면 조상이 링을 네 면 다 잘라 **테스트는 초록인데
 * 화면에는 아무것도 안 보인다.** jsdom 은 CSS 를 읽지 않아 이것을 잡지 못한다.
 *
 * **감싸는 요소를 만들지 않는다.** `<fieldset>` 하나와 그 직계 `<button>` 들만 낸다
 * (`Button`·`Card` 와 같은 규율). 래퍼가 생기면 이 컨트롤과 상관없는 구조 검사가 깨진다.
 */
export interface SegmentedOption<V extends string> {
  readonly value: V;
  readonly label: string;
  /** 이 선택지만 못 고르는 경우. 사유 문장은 세그먼트 밖에 호출부가 적는다. */
  readonly disabled?: boolean;
}

export interface SegmentedControlProps<V extends string> {
  readonly options: readonly SegmentedOption<V>[];
  readonly value: V;
  /** 전부 비활성. 개별 `option.disabled` 와 OR 로 합친다. */
  readonly disabled?: boolean;
  readonly onChange: (value: V) => void;
}

export function SegmentedControl<V extends string>(props: SegmentedControlProps<V>): JSX.Element {
  return (
    <fieldset className="inline-flex overflow-hidden rounded-md border border-line">
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={props.value === option.value}
          disabled={(props.disabled ?? false) || (option.disabled ?? false)}
          className={`px-3 py-1.5 text-sm disabled:opacity-50 ${FOCUS_RING_INSET} ${
            props.value === option.value
              ? "bg-accent-soft font-semibold text-accent"
              : "text-ink-muted hover:bg-line-subtle"
          }`}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

import type { JSX } from "react";
import type { StartRunRequest } from "../../../src/api-types.js";

/** flow 칩: test/generate/repair를 mono 소문자 그대로 회색 필에(UI 설계 §4). */
export function FlowChip(props: { flow: StartRunRequest["flow"] }): JSX.Element {
  return (
    <span className="inline-flex items-center rounded bg-line-subtle px-2 py-0.5 font-mono text-xs text-ink-muted">
      {props.flow}
    </span>
  );
}

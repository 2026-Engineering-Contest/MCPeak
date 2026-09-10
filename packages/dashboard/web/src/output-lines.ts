import type { RunEvent } from "../../src/api-types.js";

/**
 * 터미널 출력의 줄 수.
 *
 * **이벤트 수가 아니다.** 서버는 `writeStdout` 호출 하나를 이벤트 하나로 만드는데
 * (`run-registry.ts`), `mcpeak test` 는 출력을 모았다가 끝에 한 번 쓴다. 그래서 8케이스든
 * 800케이스든 stdout 이벤트는 1개다 — 이벤트를 세어 "줄" 이라고 부르면 화면에 13줄이 보이는데
 * "1줄" 이라고 말하게 된다.
 *
 * 정의는 **개행 기준 논리 줄 수**다. 빈 줄은 화면에 빈 행으로 보이므로 센다. 접힘(긴 줄이
 * `whitespace-pre-wrap` 으로 여러 행이 되는 것)은 세지 않는다 — 창 너비에 따라 달라지는 값이라
 * DOM 을 재야 하고, 그러면 같은 run 이 창 크기마다 다른 숫자를 갖는다.
 */
export function countOutputLines(events: readonly RunEvent[]): number {
  // 이어 붙인 뒤에 센다. 이벤트별로 세어 더하면 한 줄이 두 이벤트에 걸쳐 갈릴 때 모자란다 —
  // "a\n" + "b" 는 화면에 두 줄인데 이벤트별 개행 합계는 1이다.
  const text = events
    .filter((event) => event.kind === "stdout" || event.kind === "stderr")
    .map((event) => event.html)
    .join("");

  if (text === "") return 0;

  const breaks = text.match(/\n/g)?.length ?? 0;
  // 끝이 개행이면 마지막 개행 뒤에 줄이 없다. 아니면 개행 없이 끝난 줄이 하나 더 있다.
  return text.endsWith("\n") ? breaks : breaks + 1;
}

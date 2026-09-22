/**
 * 거절 문안에 **사용자 입력을 되짚어 넣을 때** 쓰는 이스케이프. 순수 함수만 둔다.
 *
 * `relay-env.ts` 안에 있던 것을 옮겼다. 소비자가 `--env` 하나였을 때는 거기 사는 것이
 * 맞았지만 `--port` 와 모르는 인자도 값을 되짚게 되면서 파일 이름이 거짓이 됐다.
 */

/**
 * 터미널 제어 문자를 무해한 토큰으로 바꾼다.
 *
 * `packages/cli/src/repair-render.ts:14` 의 같은 이름 함수의 **사본**이다. import 하지 않는
 * 근거는 두 가지다. 첫째로 의존 방향이 `cli → mock` 이라 여기서 cli 를 부르면 역방향이고
 * 순환이다(ADR-0091 은 하위 계층을 직접 의존하는 것만 허용한다). 둘째로 이 저장소는 이미
 * 같은 이유로 사본을 셋 두고 있다 — `test-command.ts` · `process-diagnostics.ts` ·
 * `repair-render.ts` 이고 근거는 ADR-0013 이다. 여기가 넷째다.
 *
 * TAB(0x09)도 이스케이프한다. 거절 문안에 실리는 것은 사용자가 친 **인자 한 토막**이라
 * 보존할 들여쓰기가 없고, 우리가 맞춰 둔 `     read -rs …` 들여쓰기를 TAB 이 흔들면
 * 화면이 어긋난다.
 */
export const escapeTerminalText = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    // 0x7f..0x9f 는 DEL 과 C1 제어 문자다. U+009B 를 8비트 CSI 로 해석하는 터미널이 있다.
    return codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");

/** 되짚어 준 값 하나의 표시 상한. `connect-target.ts:102` 의 `MAX_ECHOED_CHARACTERS` 와 같다. */
const MAX_ECHOED_CHARACTERS = 200;

/**
 * 거절 문장에 되짚어 넣는 **사용자 입력**을 무해하게 만든다. `connect-target.ts:112` 의
 * `echoValue` 사본이고, 사본인 근거는 위 `escapeTerminalText` 와 같다.
 *
 * `mcpeak-relay --env $'\e[2J…'` 처럼 ANSI 를 실은 인자가 그대로 stderr 를 거쳐 터미널에
 * 닿는 것을 막는다. **값 단위로만 건다** — 문장 전체에 걸면 우리가 쓴 개행(`\n→ …`)까지
 * 이스케이프되어 안내가 한 줄로 뭉개진다. #289 가 정확히 그 결함이었다.
 */
export function echoValue(value: string): string {
  const escaped = escapeTerminalText(value);
  return escaped.length <= MAX_ECHOED_CHARACTERS
    ? escaped
    : `${escaped.slice(0, MAX_ECHOED_CHARACTERS)}…`;
}

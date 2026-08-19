/**
 * ANSI 이스케이프가 섞인 CLI 출력을 브라우저에 그대로 붙일 수 있는 HTML 조각으로 바꾼다.
 *
 * 계약(계획서 §4-5):
 * - SGR 색·굵기 코드(30–37, 90–97, 1, 0)만 `<span class="ansi-...">`로 옮긴다.
 * - 그 외 이스케이프 시퀀스는 화면 제어라 웹에서는 의미가 없으므로 전부 제거한다.
 * - HTML 특수문자(`&`, `<`, `>`)는 항상 이스케이프한다.
 * - 같은 입력이면 항상 같은 출력이다(난수·시각 같은 비결정 값을 섞지 않는다).
 */

const ESCAPE = "\u001b";

/**
 * 이스케이프 시퀀스 한 덩어리. CSI(`ESC [ ... 최종바이트`), OSC(`ESC ] ... BEL`),
 * 그리고 두 글자짜리 단순 시퀀스를 모두 잡는다.
 */
const ESCAPE_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 이스케이프 자체가 대상이다.
  /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

/** span으로 옮기는 SGR 코드만 모아 둔다. 여기 없는 코드는 조용히 무시한다. */
function isSpanCode(code: number): boolean {
  if (code === 1) return true;
  if (code >= 30 && code <= 37) return true;
  if (code >= 90 && code <= 97) return true;
  return false;
}

export function ansiToHtml(text: string): string {
  let out = "";
  let open = 0;
  let cursor = 0;

  for (const match of text.matchAll(ESCAPE_PATTERN)) {
    const index = match.index ?? 0;
    out += escapeHtml(text.slice(cursor, index));
    cursor = index + match[0].length;

    const sgr = parseSgr(match[0]);
    if (sgr === null) continue; // 색·굵기가 아닌 제어 시퀀스는 버린다.
    for (const code of sgr) {
      if (code === 0) {
        out += "</span>".repeat(open);
        open = 0;
        continue;
      }
      if (!isSpanCode(code)) continue;
      out += `<span class="ansi-${code}">`;
      open += 1;
    }
  }
  out += escapeHtml(text.slice(cursor));

  // 리셋 없이 끝난 출력도 HTML로는 닫혀 있어야 한다. 안 닫으면 뒤에 붙는 줄까지 물든다.
  out += "</span>".repeat(open);
  return out;
}

/**
 * SGR(`ESC [ ... m`)이면 코드 배열을, 아니면 null을 준다.
 * 파라미터가 비면 `ESC[m`은 `ESC[0m`과 같다는 규약을 따른다.
 */
function parseSgr(sequence: string): number[] | null {
  if (!sequence.startsWith(`${ESCAPE}[`) || !sequence.endsWith("m")) return null;
  const body = sequence.slice(2, -1);
  if (body.includes("?")) return null; // 사설 모드 시퀀스는 색이 아니다.
  if (body === "") return [0];
  const codes: number[] = [];
  for (const part of body.split(";")) {
    const code = part === "" ? 0 : Number.parseInt(part, 10);
    if (Number.isNaN(code)) return null;
    codes.push(code);
  }
  return codes;
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

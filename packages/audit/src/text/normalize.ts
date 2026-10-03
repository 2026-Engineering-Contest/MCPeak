import type { TextForm } from "../types.js";

export interface NormalizedText {
  readonly forms: ReadonlyArray<{ readonly form: TextForm; readonly text: string }>;
}

/** 보이지 않는 문자의 범주. 계획서 §3.2 `desc/hidden-unicode` 의 표다. */
export type HiddenCategory = "zero-width" | "bidi" | "tag" | "confusable-space" | "variation";

const ZERO_WIDTH = new Set([
  0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff, 0x180e, 0x00ad,
]);
const BIDI = new Set([
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x061c, 0x200e, 0x200f,
]);
const CONFUSABLE_SPACE = new Set([0x00a0, 0x202f, 0x205f, 0x3000]);

/** 코드포인트가 §3.2 표의 어느 범주인지. 표 밖이면 undefined. */
export function hiddenCategory(codePoint: number): HiddenCategory | undefined {
  if (ZERO_WIDTH.has(codePoint)) return "zero-width";
  if (BIDI.has(codePoint)) return "bidi";
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return "tag";
  if (CONFUSABLE_SPACE.has(codePoint) || (codePoint >= 0x2000 && codePoint <= 0x200a))
    return "confusable-space";
  if (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  )
    return "variation";
  return undefined;
}

/**
 * 혼동 문자 접기 표(§3.1). 전각 ASCII 는 NFKC 가 먼저 처리하므로 여기 없다.
 * 표 끝의 여섯 항목은 계획서 표에 더한 것이다. 키릴 대문자 І Ј Ѕ 는 표에 소문자(і ј ѕ)만 있어
 * 문장 첫 글자(`Іgnore`)로 쓰면 빠져나간다. 둥근 따옴표·수정자 아포스트로피는 `don't` 를 `don’t`
 * 로 써서 injection 문형의 `don'?t` 를 피하는 것을 막는다(NFKC 는 U+2019 를 바꾸지 않는다).
 */
export const CONFUSABLES: ReadonlyMap<number, string> = new Map([
  [0x0430, "a"],
  [0x0435, "e"],
  [0x043e, "o"],
  [0x0440, "p"],
  [0x0441, "c"],
  [0x0443, "y"],
  [0x0445, "x"],
  [0x0456, "i"],
  [0x0458, "j"],
  [0x04bb, "h"],
  [0x0455, "s"],
  [0x0501, "d"],
  [0x051b, "q"],
  [0x051d, "w"],
  [0x03b1, "a"],
  [0x03bf, "o"],
  [0x03c1, "p"],
  [0x03bd, "v"],
  [0x0391, "A"],
  [0x0392, "B"],
  [0x0395, "E"],
  [0x0397, "H"],
  [0x0399, "I"],
  [0x039a, "K"],
  [0x039c, "M"],
  [0x039d, "N"],
  [0x039f, "O"],
  [0x03a1, "P"],
  [0x03a4, "T"],
  [0x03a5, "Y"],
  [0x03a7, "X"],
  [0x0410, "A"],
  [0x0412, "B"],
  [0x0421, "C"],
  [0x0415, "E"],
  [0x041d, "H"],
  [0x041a, "K"],
  [0x041c, "M"],
  [0x041e, "O"],
  [0x0420, "P"],
  [0x0422, "T"],
  [0x0425, "X"],
  [0x0406, "I"],
  [0x0408, "J"],
  [0x0405, "S"],
  [0x2018, "'"],
  [0x2019, "'"],
  [0x02bc, "'"],
]);

/** §3.1 의 base64 토큰. 전역 플래그라 `matchAll` 로만 쓴다(`lastIndex` 공유 방지). */
export const BASE64_TOKEN = /[A-Za-z0-9+/]{40,}={0,2}/g;
/** §3.1 의 hex 토큰. */
export const HEX_TOKEN = /(?:[0-9a-f]{2}){20,}/gi;

/** §3.2 `desc/ansi-escape` 의 두 문형(CSI, OSC). folded 는 이것을 지운 뒤 대조한다. */
export const ANSI_ESCAPE_PATTERNS: readonly RegExp[] = [
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC 를 찾는 것이 이 정규식의 목적이다.
  /\x1b\[[0-9;?]*[ -/]*[@-~]/,
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC·BEL 을 찾는 것이 이 정규식의 목적이다.
  /\x1b\][^\x07\x1b]*(\x07|\x1b\\)/,
];

const ANSI_GLOBAL = ANSI_ESCAPE_PATTERNS.map((pattern) => new RegExp(pattern.source, "g"));

/** 공백(\t·\n·\r 포함)이 아닌 제어 문자. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 지우는 것이 목적이다.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/**
 * folded 단계(§3.1 의 2). NFKC → 보이지 않는 문자 제거 → 혼동 문자 접기 → `[_-]` 와 연속 공백을
 * 공백 하나로 → 소문자. 계획서 표에 더해 tag·variation 문자, ANSI 이스케이프, 제어 문자도 지운다.
 * 모두 사람 눈에 안 보이는 것이라, 남겨 두면 문형 사이에 끼워 넣는 것만으로 대조를 피할 수 있다.
 */
export function foldText(text: string): string {
  let result = text.normalize("NFKC");
  for (const pattern of ANSI_GLOBAL) result = result.replace(pattern, "");
  result = result.replace(CONTROL, "");
  let folded = "";
  for (const char of result) {
    const codePoint = char.codePointAt(0) ?? 0;
    const category = hiddenCategory(codePoint);
    if (category !== undefined && category !== "confusable-space") continue;
    folded += CONFUSABLES.get(codePoint) ?? char;
  }
  return folded.replace(/[\s_-]+/gu, " ").toLowerCase();
}

/** ROT13. ASCII 영문자만 돌린다. */
export function rot13(text: string): string {
  return text.replace(/[a-z]/gi, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });
// biome-ignore lint/suspicious/noControlCharactersInRegex: 인쇄 불가 문자를 세는 것이 목적이다.
const NON_PRINTABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cs}\p{Co}\p{Cn}]/u;

/** UTF-8 로 유효하고 인쇄 가능 비율이 0.9 이상이면 문자열, 아니면 undefined (§3.1). */
function decodePrintable(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0) return undefined;
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return undefined;
  }
  const chars = [...text];
  const printable = chars.filter((char) => !NON_PRINTABLE.test(char)).length;
  return printable / chars.length >= 0.9 ? text : undefined;
}

/** 디코딩에 성공한 토큰 하나. `text` 는 접기 전 디코딩 결과다. */
export interface DecodedToken {
  readonly kind: "base64" | "hex";
  readonly token: string;
  readonly text: string;
}

/** raw 에서 base64·hex 토큰을 찾아 디코딩에 성공한 것만 돌려준다. base64 가 먼저, 각각 등장 순. */
export function decodeTokens(raw: string): DecodedToken[] {
  const decoded: DecodedToken[] = [];
  for (const [token] of raw.matchAll(BASE64_TOKEN)) {
    const text = decodePrintable(Buffer.from(token, "base64"));
    if (text !== undefined) decoded.push({ kind: "base64", token, text });
  }
  for (const [token] of raw.matchAll(HEX_TOKEN)) {
    const text = decodePrintable(Buffer.from(token, "hex"));
    if (text !== undefined) decoded.push({ kind: "hex", token, text });
  }
  return decoded;
}

/** 형 하나와, 디코딩형이면 그 출처 토큰. */
export interface TextFormEntry {
  readonly form: TextForm;
  readonly text: string;
  readonly source?: DecodedToken;
}

/**
 * `normalizeText` 와 같은 형들에 디코딩형의 출처 토큰을 붙여 돌려준다. `desc/encoded-blob` 이
 * 어느 토큰이 다른 규칙에 걸렸는지 알아야 해서 둔다. 순서: raw, folded, base64…, hex…, rot13.
 */
export function normalizeTextWithSources(raw: string): TextFormEntry[] {
  const folded = foldText(raw);
  return [
    { form: "raw", text: raw },
    { form: "folded", text: folded },
    ...decodeTokens(raw).map((source) => ({
      form: source.kind,
      text: foldText(source.text),
      source,
    })),
    { form: "rot13", text: rot13(folded) },
  ];
}

export function normalizeText(raw: string): NormalizedText {
  return { forms: normalizeTextWithSources(raw).map(({ form, text }) => ({ form, text })) };
}

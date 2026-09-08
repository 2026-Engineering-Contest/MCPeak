/**
 * `pattern` 의 컴파일과 최소 문자열 합성. 설계 §5.2.1 의 부분집합만 안다.
 *
 * 정규식 라이브러리를 붙이지 않는다. 의존성 제약도 있지만, 우리에게 필요한 것은 "매칭" 이
 * 아니라 "그 언어에 속하는 가장 짧은 문자열 하나" 라서 일반 엔진이 답을 주지 않는다. 갈래와
 * 문자 선택은 전부 "선언 순서의 첫 번째" 또는 "최소" 라 같은 pattern 에 같은 값이 나온다.
 *
 * 표 밖 구문은 오프셋과 구문 이름을 실은 `UNSUPPORTED_SCHEMA` 다(그 툴만 건너뛴다). 정규식
 * 자체가 깨진 것은 `INVALID_SCHEMA_CONSTRAINT` 다(서버 선언의 결함이라 사용자가 알아야 한다).
 */

import { fail } from "./schema.js";

/** `pattern` 이 나타내는 최소 문자열을 만들 때 함께 지켜야 할 길이 제약. */
export interface PatternLengthBounds {
  readonly minLength: number | null;
  readonly maxLength: number | null;
}

interface RepeatNode {
  readonly kind: "repeat";
  readonly body: Node;
  readonly min: number;
  readonly max: number | null;
}

type Node =
  | { readonly kind: "char"; readonly value: string }
  | { readonly kind: "empty" }
  | { readonly kind: "alt"; readonly branches: readonly (readonly Node[])[] }
  | RepeatNode;

interface ParseState {
  readonly source: string;
  index: number;
}

/** 문자 클래스의 원소 하나. `first` 는 이 원소를 고를 때 쓸 문자다. */
interface ClassItem {
  readonly first: string;
  readonly test: (ch: string) => boolean;
}

const EMPTY: Node = { kind: "empty" };

const isWord = (ch: string): boolean =>
  (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_";
const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isSpace = (ch: string): boolean => /\s/u.test(ch);

/** `\d` 류. `first` 는 설계 §5.2.1 의 표 값이다. */
const CLASS_ESCAPES: ReadonlyMap<string, ClassItem> = new Map([
  ["d", { first: "0", test: isDigit }],
  ["D", { first: "a", test: (ch: string) => !isDigit(ch) }],
  ["w", { first: "a", test: isWord }],
  ["W", { first: "-", test: (ch: string) => !isWord(ch) }],
  ["s", { first: " ", test: isSpace }],
  ["S", { first: "a", test: (ch: string) => !isSpace(ch) }],
]);

const CONTROL_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["f", "\f"],
  ["v", "\v"],
  ["0", "\0"],
]);

/** 부정 클래스에서 고를 문자의 우선순위. 설계 §5.2.1 의 표 순서다. */
const NEGATED_CANDIDATES: readonly string[] = [
  ...charRange("a", "z"),
  ...charRange("A", "Z"),
  ...charRange("0", "9"),
  "-",
  "_",
  " ",
];

function charRange(from: string, to: string): string[] {
  const start = from.codePointAt(0) as number;
  const end = to.codePointAt(0) as number;
  const out: string[] = [];
  for (let code = start; code <= end; code++) out.push(String.fromCodePoint(code));
  return out;
}

/** 코드 포인트 기준 길이. `valueMatchesConstraints` 의 길이 계산과 같은 단위여야 한다. */
const length = (value: string): number => Array.from(value).length;

function unsupported(path: string, offset: number, syntax: string): never {
  return fail(
    "UNSUPPORTED_SCHEMA",
    `${path}.pattern`,
    `'pattern' 에 아직 지원하지 않는 정규식 구문이 있습니다: ${path}.pattern (오프셋 ${offset}: ${syntax})`,
    "전방·후방탐색, 후방참조, \\p{…} 는 지원하지 않습니다. examples 나 default 에 pattern 을 만족하는 값을 적으면 그 값을 사용합니다.",
  );
}

/**
 * 컴파일만 시도한다. `"u"` 를 먼저 쓰고 실패하면 플래그 없이 다시 만든다. 둘 다 실패면 null.
 *
 * 던지지 않는 갈래가 따로 필요하다. `valueMatchesSchema` 는 경로를 들고 있지 않고, 거기 닿는
 * 스키마는 `assertConstraints` 가 이미 컴파일을 확인했다.
 */
export function tryCompilePattern(pattern: string): RegExp | null {
  for (const flags of ["u", ""]) {
    try {
      return new RegExp(pattern, flags);
    } catch {
      // "u" 에서만 깨지는 구문이 있다(Annex B). 플래그 없이 한 번 더 본다.
    }
  }
  return null;
}

/** 컴파일된 검증기. `"u"` 먼저, 실패하면 플래그 없음. 둘 다 실패면 INVALID_SCHEMA_CONSTRAINT. */
export function compilePattern(pattern: unknown, path: string): RegExp {
  if (typeof pattern !== "string") {
    return fail(
      "INVALID_SCHEMA_CONSTRAINT",
      `${path}.pattern`,
      `'pattern' 은 문자열이어야 합니다: ${path}.pattern (${JSON.stringify(pattern)})`,
      "JSON Schema 의 pattern 은 ECMA-262 정규식 문자열이어야 합니다.",
    );
  }
  const regex = tryCompilePattern(pattern);
  if (regex !== null) return regex;
  let reason = "";
  try {
    new RegExp(pattern, "");
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  return fail(
    "INVALID_SCHEMA_CONSTRAINT",
    `${path}.pattern`,
    `'pattern' 이 올바른 ECMA-262 정규식이 아닙니다: ${path}.pattern (${reason})`,
    "JSON Schema 의 pattern 은 ECMA-262 정규식이어야 합니다.",
  );
}

/**
 * 설계 §5.2.1 부분집합으로 최소 문자열을 만들고 §5.2.2 로 minLength 를 채운다.
 * 부분집합 밖 구문·길이 불가는 UNSUPPORTED_SCHEMA. 만든 값은 compilePattern 결과로 재검증한다.
 */
export function synthesizePatternString(
  pattern: string,
  bounds: PatternLengthBounds,
  path: string,
): string {
  const regex = compilePattern(pattern, path);
  const state: ParseState = { source: pattern, index: 0 };
  const root = parseAlternation(state, path);
  if (state.index < pattern.length) {
    unsupported(path, state.index, `해석하지 못한 구문 '${pattern[state.index] as string}'`);
  }

  const repeats: RepeatNode[] = [];
  collectRepeats(root, repeats);
  const counts = new Map<RepeatNode, number>(repeats.map((repeat) => [repeat, repeat.min]));
  let value = generate(root, counts);

  const { minLength, maxLength } = bounds;
  if (minLength !== null && length(value) < minLength) {
    // 왼쪽부터 첫 번째로 만나는, 상한에 여유가 있는 수량자부터 늘린다(설계 §5.2.2).
    for (const repeat of repeats) {
      if (length(generate(repeat.body, counts)) === 0) continue;
      while (
        length(value) < minLength &&
        (repeat.max === null || (counts.get(repeat) as number) < repeat.max)
      ) {
        counts.set(repeat, (counts.get(repeat) as number) + 1);
        value = generate(root, counts);
      }
      if (length(value) >= minLength) break;
    }
    if (length(value) < minLength) failLength(path, value, "minLength", minLength);
  }
  if (maxLength !== null && length(value) > maxLength) {
    failLength(path, value, "maxLength", maxLength);
  }

  // 생성기 결함을 조용히 넘기지 않는다. 다른 값으로 바꿔치기하면 무엇이 틀렸는지 사라진다.
  if (!regex.test(value)) {
    return fail(
      "UNSUPPORTED_SCHEMA",
      path,
      `생성기가 만든 값 "${value}" 이 pattern 을 통과하지 못했습니다: ${path}`,
      "이 pattern 을 이슈로 알려 주세요. 그동안은 examples 에 값을 적으면 그 값을 사용합니다.",
    );
  }
  return value;
}

function failLength(
  path: string,
  value: string,
  keyword: "minLength" | "maxLength",
  bound: number,
): never {
  return fail(
    "UNSUPPORTED_SCHEMA",
    path,
    `'pattern' 을 만족하는 문자열 "${value}"(${length(value)}자)로는 ${keyword} ${bound} 을 지킬 수 없습니다: ${path}`,
    "examples 에 두 제약을 모두 만족하는 값을 적으세요.",
  );
}

function generate(node: Node, counts: ReadonlyMap<RepeatNode, number>): string {
  switch (node.kind) {
    case "empty":
      return "";
    case "char":
      return node.value;
    case "alt":
      // 갈래는 언제나 첫 번째다. 다른 선택 규칙은 결정론성을 지키더라도 근거가 없다.
      return (node.branches[0] ?? []).map((child) => generate(child, counts)).join("");
    case "repeat":
      return generate(node.body, counts).repeat(counts.get(node) ?? node.min);
  }
}

/** 실제로 생성에 쓰이는 자리의 수량자만, 왼쪽부터 모은다. */
function collectRepeats(node: Node, out: RepeatNode[]): void {
  if (node.kind === "alt") {
    for (const child of node.branches[0] ?? []) collectRepeats(child, out);
    return;
  }
  if (node.kind === "repeat") {
    out.push(node);
    collectRepeats(node.body, out);
  }
}

function parseAlternation(state: ParseState, path: string): Node {
  const branches: Node[][] = [parseSequence(state, path)];
  while (state.source[state.index] === "|") {
    state.index += 1;
    branches.push(parseSequence(state, path));
  }
  return { kind: "alt", branches };
}

function parseSequence(state: ParseState, path: string): Node[] {
  const nodes: Node[] = [];
  while (state.index < state.source.length) {
    const ch = state.source[state.index];
    if (ch === "|" || ch === ")") break;
    nodes.push(applyQuantifier(state, path, parseAtom(state, path)));
  }
  return nodes;
}

function applyQuantifier(state: ParseState, path: string, atom: Node): Node {
  const ch = state.source[state.index];
  let min: number;
  let max: number | null;
  if (ch === "*") {
    min = 0;
    max = null;
    state.index += 1;
  } else if (ch === "+") {
    min = 1;
    max = null;
    state.index += 1;
  } else if (ch === "?") {
    min = 0;
    max = 1;
    state.index += 1;
  } else if (ch === "{") {
    const braces = parseBraces(state.source, state.index);
    // 수량자 꼴이 아닌 '{' 는 리터럴이다(Annex B). 다음 atom 으로 넘긴다.
    if (braces === null) return atom;
    min = braces.min;
    max = braces.max;
    state.index = braces.end;
  } else {
    return atom;
  }
  // lazy 접미 '?' 는 최소 반복을 쓰는 우리 규칙에서 결과를 바꾸지 않는다.
  if (state.source[state.index] === "?") state.index += 1;
  return { kind: "repeat", body: atom, min, max };
}

function parseBraces(
  source: string,
  index: number,
): { min: number; max: number | null; end: number } | null {
  const matched = /^\{(\d+)(?:,(\d*))?\}/.exec(source.slice(index));
  if (matched === null) return null;
  const min = Number(matched[1]);
  const upper = matched[2];
  return {
    min,
    max: upper === undefined ? min : upper === "" ? null : Number(upper),
    end: index + matched[0].length,
  };
}

function parseAtom(state: ParseState, path: string): Node {
  const { source } = state;
  const start = state.index;
  const ch = source[start];
  if (ch === "^" || ch === "$") {
    state.index += 1;
    return EMPTY;
  }
  if (ch === "(") return parseGroup(state, path);
  if (ch === "[") return parseClass(state, path);
  if (ch === "\\") return parseEscape(state, path);
  if (ch === ".") {
    state.index += 1;
    return { kind: "char", value: "a" };
  }
  const point = String.fromCodePoint(source.codePointAt(start) as number);
  state.index += point.length;
  return { kind: "char", value: point };
}

function parseGroup(state: ParseState, path: string): Node {
  const { source } = state;
  const start = state.index;
  state.index += 1;
  if (source[state.index] === "?") {
    const next = source[state.index + 1];
    if (next === ":") state.index += 2;
    else if (next === "=") unsupported(path, start, "전방탐색 (?=…)");
    else if (next === "!") unsupported(path, start, "부정 전방탐색 (?!…)");
    else if (next === "<") {
      const after = source[state.index + 2];
      if (after === "=") unsupported(path, start, "후방탐색 (?<=…)");
      if (after === "!") unsupported(path, start, "부정 후방탐색 (?<!…)");
      const close = source.indexOf(">", state.index + 2);
      if (close === -1) unsupported(path, start, "닫히지 않은 이름 붙은 그룹 (?<name>…)");
      state.index = close + 1;
    } else unsupported(path, start, `그룹 수식자 (?${next ?? ""}…)`);
  }
  const body = parseAlternation(state, path);
  if (state.source[state.index] !== ")") unsupported(path, start, "닫히지 않은 그룹 (");
  state.index += 1;
  return body;
}

function parseEscape(state: ParseState, path: string): Node {
  const { source } = state;
  const start = state.index;
  const ch = source[start + 1];
  if (ch === undefined) unsupported(path, start, "끝나지 않은 이스케이프 \\");
  state.index = start + 2;
  rejectUnsupportedEscape(ch, start, path);
  // 클래스 밖의 \b·\B 는 경계라 빈 문자열이다.
  if (ch === "b" || ch === "B") return EMPTY;
  const cls = CLASS_ESCAPES.get(ch);
  if (cls !== undefined) return { kind: "char", value: cls.first };
  const control = CONTROL_ESCAPES.get(ch);
  if (control !== undefined) return { kind: "char", value: control };
  const point = parseCodePointEscape(state, ch, start);
  return { kind: "char", value: point ?? ch };
}

function rejectUnsupportedEscape(ch: string, start: number, path: string): void {
  if (ch >= "1" && ch <= "9") unsupported(path, start, `후방참조 \\${ch}`);
  if (ch === "k") unsupported(path, start, "이름 붙은 후방참조 \\k<…>");
  if (ch === "p" || ch === "P") unsupported(path, start, `유니코드 속성 \\${ch}{…}`);
  if (ch === "c") unsupported(path, start, "제어 문자 이스케이프 \\c");
}

/** `\xHH` · `\uHHHH` · `\u{H…}`. 그 꼴이 아니면 null 이고 호출자가 리터럴로 본다. */
function parseCodePointEscape(state: ParseState, ch: string, start: number): string | null {
  const { source } = state;
  if (ch === "x") {
    const hex = source.slice(start + 2, start + 4);
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
    state.index = start + 4;
    return String.fromCodePoint(Number.parseInt(hex, 16));
  }
  if (ch !== "u") return null;
  if (source[start + 2] === "{") {
    const close = source.indexOf("}", start + 3);
    const hex = close === -1 ? "" : source.slice(start + 3, close);
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    state.index = close + 1;
    return String.fromCodePoint(Number.parseInt(hex, 16));
  }
  const hex = source.slice(start + 2, start + 6);
  if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
  state.index = start + 6;
  return String.fromCodePoint(Number.parseInt(hex, 16));
}

function parseClass(state: ParseState, path: string): Node {
  const start = state.index;
  state.index += 1;
  const negated = state.source[state.index] === "^";
  if (negated) state.index += 1;

  const items: ClassItem[] = [];
  while (state.index < state.source.length && state.source[state.index] !== "]") {
    items.push(parseClassItem(state, path));
  }
  if (state.source[state.index] !== "]") unsupported(path, start, "닫히지 않은 문자 클래스 [");
  state.index += 1;
  if (items.length === 0) unsupported(path, start, "빈 문자 클래스 []");

  if (!negated) return { kind: "char", value: (items[0] as ClassItem).first };
  const found = NEGATED_CANDIDATES.find((candidate) => !items.some((item) => item.test(candidate)));
  if (found === undefined) unsupported(path, start, "부정 문자 클래스에 남는 문자가 없음");
  return { kind: "char", value: found };
}

function parseClassItem(state: ParseState, path: string): ClassItem {
  const lower = parseClassAtom(state, path);
  const { source } = state;
  const isRange =
    lower.single !== null && source[state.index] === "-" && source[state.index + 1] !== undefined;
  if (!isRange || source[state.index + 1] === "]") return lower.item;

  const dash = state.index;
  state.index += 1;
  const upper = parseClassAtom(state, path);
  if (upper.single === null) {
    // '[a-\d]' 꼴. Annex B 는 '-' 를 리터럴로 보지만 한 원소로 담을 수 없어 미지원이다.
    unsupported(path, dash, "문자 클래스 범위의 끝이 한 문자가 아님");
  }
  const from = (lower.single as string).codePointAt(0) as number;
  const to = (upper.single as string).codePointAt(0) as number;
  return {
    first: lower.single as string,
    test: (ch: string) => {
      const code = ch.codePointAt(0) as number;
      return code >= from && code <= to;
    },
  };
}

/** 클래스 원소 하나. `single` 은 범위의 끝이 될 수 있는 단일 문자일 때만 채운다. */
function parseClassAtom(
  state: ParseState,
  path: string,
): { single: string | null; item: ClassItem } {
  const { source } = state;
  const start = state.index;
  if (source[start] !== "\\") {
    const point = String.fromCodePoint(source.codePointAt(start) as number);
    state.index += point.length;
    return literalClassAtom(point);
  }

  const ch = source[start + 1];
  if (ch === undefined) unsupported(path, start, "끝나지 않은 이스케이프 \\");
  state.index = start + 2;
  rejectUnsupportedEscape(ch, start, path);
  const cls = CLASS_ESCAPES.get(ch);
  if (cls !== undefined) return { single: null, item: cls };
  // 클래스 안의 \b 는 경계가 아니라 백스페이스다.
  if (ch === "b") return literalClassAtom("\b");
  const control = CONTROL_ESCAPES.get(ch);
  if (control !== undefined) return literalClassAtom(control);
  return literalClassAtom(parseCodePointEscape(state, ch, start) ?? ch);
}

function literalClassAtom(value: string): { single: string; item: ClassItem } {
  return { single: value, item: { first: value, test: (ch: string) => ch === value } };
}

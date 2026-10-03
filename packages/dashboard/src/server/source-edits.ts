import { realpath, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import type { SourceEdit, SourceEditResult, SourceEditStatus } from "../api-types.js";

/**
 * 토큰 탭 "MCP 수정하기" 의 소스 치환(ADR-0106). 파서를 쓰지 않고 글자 패턴만 본다. 안전은 패턴의
 * 정밀함이 아니라 개수 규칙에서 나온다. 찾은 출현 수가 변경 수와 같을 때만 고치고, 그때는 출현을
 * 전부 같은 식으로 고치므로 어느 출현이 어느 도구의 것인지 가릴 필요가 없다.
 *
 * 그래서 찾기는 느슨하게, 고치기는 엄격하게 한다. 문맥이 낯선 출현도 출현으로 세고(빼면 개수가
 * 우연히 맞아 엉뚱한 자리를 고친다), 안전하게 떼어 낼 수 없는 출현이 하나라도 있으면 그 그룹은
 * 통째로 건드리지 않는다.
 */

/** 원본 기준 치환 하나. `[start, end)` 를 `text` 로 바꾼다. */
interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** 찾은 출현 하나. 안전하게 고칠 수 없는 자리면 `null` 이다(출현 수에는 들어간다). */
type Occurrence = Replacement | null;

const QUOTES = ['"', "'", "`"] as const;
type Quote = (typeof QUOTES)[number];

const NOT_FOUND_DETAIL =
  "소스 파일에서 찾지 못했습니다. SDK 나 라이브러리가 만드는 값이면 소스에서 고칠 수 없습니다.";
const UNSUPPORTED_DETAIL = "이 종류의 변경은 자동으로 고치지 않습니다. 직접 고쳐야 합니다.";
const DIFFERENT_AFTER_DETAIL = "같은 문자열을 서로 다르게 바꾸는 변경이 있어 건드리지 않습니다.";
const PROMOTED_DETAIL =
  "공통 파라미터 설명은 서버 instructions 에 사전을 함께 더해야 뜻이 남습니다. 자동으로 고치지 않습니다.";
const SAME_AS_PROMOTED_DETAIL =
  "같은 설명이 공통 파라미터 변경에도 있어 어느 것인지 가릴 수 없습니다. 건드리지 않습니다.";
const OVERLAP_DETAIL = "다른 변경과 같은 자리를 고치게 되어 건드리지 않습니다.";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 내용이 `content` 인 문자열 리터럴의 표기들. 따옴표마다 글자 그대로 적은 것과 `JSON.stringify` 표기
 * (`\n`, `\"`)를 본다. 그 따옴표 안에서 다른 값이 되거나 리터럴이 끊기는 표기는 뺀다. 예를 들어
 * 내용에 `"` 가 있으면 큰따옴표 안에 글자 그대로 적을 수 없다(`"a" + "b"` 는 리터럴 하나가 아니다).
 */
function literalForms(content: string): readonly string[] {
  const json = JSON.stringify(content).slice(1, -1);
  const forms: string[] = [];
  for (const quote of QUOTES) {
    const bodies = new Set<string>();
    const interpolates = quote === "`" && content.includes("${");
    const rawOk =
      !content.includes("\\") &&
      !content.includes(quote) &&
      !interpolates &&
      (quote === "`" || !/[\n\r]/.test(content));
    if (rawOk) bodies.add(content);
    // JSON 표기는 `"` 와 `\` 만 이스케이프한다. 다른 따옴표가 내용에 있으면 그 따옴표로는 못 감싼다.
    const jsonOk = quote === '"' || (!content.includes(quote) && !interpolates);
    if (jsonOk) bodies.add(json);
    for (const body of bodies) forms.push(`${quote}${body}${quote}`);
  }
  return forms;
}

/** `LIT(content)` 의 정규식 조각. */
function literalPattern(content: string): string {
  return `(?:${literalForms(content).map(escapeRegExp).join("|")})`;
}

/** 아무 문자열 리터럴. 보간이 있는 템플릿 리터럴은 문자열 값이 아니라 식이라 뺀다. */
const ANY_STRING_PATTERN =
  "(?:\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'|`(?:[^`\\\\$]|\\\\.|\\$(?!\\{))*`)";

/** 속성 키. 따옴표는 있어도 없어도 된다. 맨 키는 다른 이름의 일부(`patternProperties`, `a.title`)가 아니어야 한다. */
function keyPattern(key: string): string {
  const escaped = escapeRegExp(key);
  return `(?:(?<![\\w$.])${escaped}|"${escaped}"|'${escaped}')`;
}

function propertyPattern(key: string, value: string): RegExp {
  return new RegExp(`${keyPattern(key)}\\s*:\\s*${value}`, "g");
}

/** `schema-key-removed` 가 지울 수 있는 키와 그 값의 모양(§3.2 표). 여기 없는 키는 `unsupported` 다. */
const SCHEMA_KEY_VALUES: ReadonlyMap<string, string> = new Map([
  ["properties", "\\{\\s*\\}"],
  ["required", "\\[\\s*\\]"],
  ["additionalProperties", "true(?![\\w$])"],
  ["$schema", ANY_STRING_PATTERN],
  ["$id", ANY_STRING_PATTERN],
  ["$comment", ANY_STRING_PATTERN],
  ["title", ANY_STRING_PATTERN],
]);

/** `after` 를 그 따옴표 안에 적을 수 있게 이스케이프한다. */
function escapeForQuote(text: string, quote: Quote): string {
  let escaped = text
    .replaceAll("\\", "\\\\")
    .replaceAll(quote, `\\${quote}`)
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
  if (quote === "`") escaped = escaped.replaceAll("${", "\\${");
  return escaped;
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

/** `index` 앞의 공백(개행 포함)을 건너뛴 첫 글자의 위치. 없으면 -1. */
function previousTokenIndex(source: string, index: number): number {
  let cursor = index - 1;
  while (cursor >= 0 && isWhitespace(source[cursor])) cursor -= 1;
  return cursor;
}

/** `index` 부터 공백(개행 포함)을 건너뛴 첫 글자의 위치. 없으면 `source.length`. */
function nextTokenIndex(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
  return cursor;
}

/** `index` 부터 그 줄 안의 공백만 건너뛴 위치. */
function skipInlineSpace(source: string, index: number): number {
  let cursor = index;
  while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
  return cursor;
}

function lineStartOf(source: string, index: number): number {
  return source.lastIndexOf("\n", index - 1) + 1;
}

function isLineEnd(source: string, index: number): boolean {
  return (
    index >= source.length ||
    source[index] === "\n" ||
    (source[index] === "\r" && source[index + 1] === "\n")
  );
}

/**
 * 속성 삭제 규칙(§3.2). `[start, end)` 는 키에서 값 끝까지다. 결과가 문법상 유효하고 빈 줄을 남기지
 * 않는 범위를 돌려준다. 앞뒤 문맥이 속성 자리로 보이지 않으면 `null` 이다.
 */
function propertyRemoval(source: string, start: number, end: number): Occurrence {
  const lineStart = lineStartOf(source, start);
  const firstOnLine = skipInlineSpace(source, lineStart) === start;
  const next = nextTokenIndex(source, end);
  const hasComma = source[next] === ",";
  const closes = source[next] === "}";
  if (!hasComma && !closes) return null;

  if (firstOnLine) {
    // 줄 전체가 이 속성이면 줄을 통째로 지운다. 끝 쉼표가 없으면 객체의 마지막 속성이어야 한다.
    const afterValue = skipInlineSpace(source, end);
    const afterComma =
      source[afterValue] === "," ? skipInlineSpace(source, afterValue + 1) : afterValue;
    if (isLineEnd(source, afterComma)) {
      const newline = source.indexOf("\n", afterComma);
      return { start: lineStart, end: newline === -1 ? source.length : newline + 1, text: "" };
    }
    // 같은 줄에 다음 속성이 이어진다. 들여쓰기는 두고 이 속성과 쉼표만 지운다.
    if (hasComma) return { start, end: skipInlineSpace(source, next + 1), text: "" };
  }

  const previous = previousTokenIndex(source, start);
  // 앞 속성의 쉼표째로 지운다. 뒤 쉼표를 지우는 것보다 이웃 속성의 삭제 범위와 덜 겹친다.
  if (source[previous] === ",") return { start: previous, end, text: "" };
  if (source[previous] !== "{") return null;
  if (closes) return { start: previous + 1, end: next, text: "" };
  // 객체의 첫 속성이다. 쉼표 뒤가 줄 끝이면 `{` 뒤 공백까지 지워 끝 공백을 남기지 않는다.
  const afterComma = skipInlineSpace(source, next + 1);
  return isLineEnd(source, afterComma)
    ? { start: previous + 1, end: next + 1, text: "" }
    : { start, end: afterComma, text: "" };
}

/**
 * `.describe(...)` 삭제 규칙(§3.2). 호출이 줄의 첫 토큰이면 앞 토큰 뒤의 개행과 들여쓰기까지 지워
 * 빈 줄이나 쉼표만 남은 줄을 만들지 않는다. 앞 줄이 주석으로 끝나면 줄을 이을 수 없어 `null` 이다
 * (이으면 뒤따르는 쉼표가 주석 안으로 들어간다).
 */
function describeRemoval(source: string, start: number, end: number): Occurrence {
  const lineStart = lineStartOf(source, start);
  if (lineStart === 0 || skipInlineSpace(source, lineStart) !== start) {
    return { start, end, text: "" };
  }
  const previous = previousTokenIndex(source, start);
  if (previous < 0) return { start, end, text: "" };
  const previousLine = source.slice(lineStartOf(source, previous), previous + 1);
  if (previousLine.includes("//") || previousLine.endsWith("*/")) return null;
  return { start: previous + 1, end, text: "" };
}

function allMatches(source: string, pattern: RegExp): readonly RegExpExecArray[] {
  return [...source.matchAll(pattern)];
}

type Change = SourceEdit["change"];

interface Group {
  readonly kind: Change["kind"];
  /** `description-*` 는 before, `schema-key-removed` 는 key. */
  readonly subject: string;
  /** 이 그룹에 속한 변경의 `edits` 인덱스. */
  readonly indexes: number[];
  /** `description-cleaned` 의 after 들(중복 없이). */
  readonly afters: Set<string>;
}

/** 변경의 그룹 키와 재료. 런타임 값은 형식 검사를 덜 거쳤을 수 있어 필드를 다시 확인한다. */
function groupOf(change: Change): { readonly key: string; readonly subject: string } | null {
  const raw = change as {
    readonly kind?: unknown;
    readonly before?: unknown;
    readonly after?: unknown;
    readonly key?: unknown;
  };
  if (raw.kind === "description-cleaned") {
    if (typeof raw.before !== "string" || typeof raw.after !== "string") return null;
    return { key: `description-cleaned\u0000${raw.before}`, subject: raw.before };
  }
  if (raw.kind === "description-removed") {
    if (typeof raw.before !== "string") return null;
    return { key: `description-removed\u0000${raw.before}`, subject: raw.before };
  }
  if (raw.kind === "schema-key-removed") {
    if (typeof raw.key !== "string" || !SCHEMA_KEY_VALUES.has(raw.key)) return null;
    return { key: `schema-key-removed\u0000${raw.key}`, subject: raw.key };
  }
  return null;
}

function findOccurrences(source: string, group: Group): readonly Occurrence[] {
  switch (group.kind) {
    case "description-cleaned": {
      // after 가 갈리면 어차피 반영하지 않는다. 출현 수만 세면 되므로 아무 값이나 쓴다.
      const after = [...group.afters][0] ?? "";
      // 앞이 `\` 인 따옴표는 다른 문자열 안의 이스케이프된 따옴표라 여는 따옴표가 아니다.
      const pattern = new RegExp(`(?<!\\\\)${literalPattern(group.subject)}`, "g");
      return allMatches(source, pattern).map((match) => {
        const quote = match[0][0] as Quote;
        return {
          start: match.index,
          end: match.index + match[0].length,
          text: `${quote}${escapeForQuote(after, quote)}${quote}`,
        };
      });
    }
    case "description-removed": {
      const literal = literalPattern(group.subject);
      const calls = allMatches(
        source,
        new RegExp(`\\.describe\\(\\s*${literal}\\s*,?\\s*\\)`, "g"),
      ).map((match) => describeRemoval(source, match.index, match.index + match[0].length));
      const properties = allMatches(source, propertyPattern("description", literal)).map((match) =>
        propertyRemoval(source, match.index, match.index + match[0].length),
      );
      return [...calls, ...properties];
    }
    case "schema-key-removed": {
      const value = SCHEMA_KEY_VALUES.get(group.subject);
      if (value === undefined) return [];
      return allMatches(source, propertyPattern(group.subject, value)).map((match) =>
        propertyRemoval(source, match.index, match.index + match[0].length),
      );
    }
  }
}

interface GroupVerdict {
  readonly status: SourceEditStatus;
  readonly detail: string;
  /** `ready` 일 때만 채운다. */
  readonly replacements: readonly Replacement[];
}

function judgeGroup(
  source: string,
  group: Group,
  promotedBefores: ReadonlySet<string>,
): GroupVerdict {
  const occurrences = findOccurrences(source, group);
  const found = occurrences.length;
  const wanted = group.indexes.length;
  if (found === 0) return { status: "not-found", detail: NOT_FOUND_DETAIL, replacements: [] };
  // 같은 설명을 사전으로 옮기는 변경이 있다. 소스의 출현이 지울 것인지 남길 것인지 가릴 수 없다.
  if (group.kind === "description-removed" && promotedBefores.has(group.subject)) {
    return { status: "ambiguous", detail: SAME_AS_PROMOTED_DETAIL, replacements: [] };
  }
  if (group.afters.size > 1) {
    return { status: "ambiguous", detail: DIFFERENT_AFTER_DETAIL, replacements: [] };
  }
  if (found !== wanted) {
    return {
      status: "ambiguous",
      detail: `소스에서 ${found}곳을 찾았는데 변경은 ${wanted}건입니다. 어느 것이 도구 정의인지 가릴 수 없어 건드리지 않습니다.`,
      replacements: [],
    };
  }
  const replacements = occurrences.filter((occurrence) => occurrence !== null);
  // 개수는 맞지만 안전하게 떼어 낼 수 없는 자리가 섞였다. 일부만 고치면 개수 규칙이 깨진다.
  if (replacements.length !== found) {
    return { status: "unsupported", detail: UNSUPPORTED_DETAIL, replacements: [] };
  }
  return { status: "ready", detail: `소스에서 ${found}곳을 찾았습니다.`, replacements };
}

function overlaps(a: Replacement, b: Replacement): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * 압축기가 설명을 서버 `instructions` 사전으로 옮긴 변경인가. 소스에서 설명만 지우면 정보가 사라지므로
 * (무손실이 아니다) 소스를 찾지도 않는다.
 */
function isPromoted(change: Change): change is Extract<Change, { kind: "description-removed" }> {
  return change.kind === "description-removed" && change.reason === "promoted";
}

/** 소스 텍스트에 변경을 반영한다. 파일을 읽거나 쓰지 않는다. 같은 입력이면 같은 결과다. */
export function planSourceEdits(
  source: string,
  edits: readonly SourceEdit[],
): {
  readonly after: string;
  readonly results: readonly SourceEditResult[];
  readonly readyCount: number;
} {
  // Map 은 넣은 순서를 지킨다. 그룹 순서가 edits 순서에서만 나오므로 결과가 결정론이다.
  const groups = new Map<string, Group>();
  const groupKeys: (string | null)[] = [];
  const promotedBefores = new Set<string>();
  for (const [index, edit] of edits.entries()) {
    if (isPromoted(edit.change)) {
      groupKeys.push(null);
      if (typeof edit.change.before === "string") promotedBefores.add(edit.change.before);
      continue;
    }
    const located = groupOf(edit.change);
    groupKeys.push(located?.key ?? null);
    if (located === null) continue;
    let group = groups.get(located.key);
    if (group === undefined) {
      group = { kind: edit.change.kind, subject: located.subject, indexes: [], afters: new Set() };
      groups.set(located.key, group);
    }
    group.indexes.push(index);
    if (edit.change.kind === "description-cleaned") group.afters.add(edit.change.after);
  }

  const verdicts = new Map<string, GroupVerdict>();
  for (const [key, group] of groups) {
    verdicts.set(key, judgeGroup(source, group, promotedBefores));
  }

  // 겹침은 처음 ready 였던 범위 전부를 놓고 한 번에 본다. 차례로 내리면 순서에 따라 결과가 달라진다.
  const ready = [...verdicts].flatMap(([key, verdict]) =>
    verdict.replacements.map((replacement) => ({ key, replacement })),
  );
  const overlapped = new Set<string>();
  for (const [index, a] of ready.entries()) {
    for (const b of ready.slice(index + 1)) {
      if (overlaps(a.replacement, b.replacement)) {
        overlapped.add(a.key);
        overlapped.add(b.key);
      }
    }
  }
  for (const key of overlapped) {
    verdicts.set(key, { status: "ambiguous", detail: OVERLAP_DETAIL, replacements: [] });
  }

  // 원본 기준 위치로 계산했으므로 뒤에서 앞으로 적용해야 앞쪽 위치가 밀리지 않는다.
  const replacements = [...verdicts.values()]
    .flatMap((verdict) => verdict.replacements)
    .sort((a, b) => b.start - a.start);
  let after = source;
  for (const replacement of replacements) {
    after = after.slice(0, replacement.start) + replacement.text + after.slice(replacement.end);
  }

  const results = edits.map((edit, index): SourceEditResult => {
    const key = groupKeys[index];
    const verdict = key === null || key === undefined ? undefined : verdicts.get(key);
    return {
      tool: edit.tool,
      change: edit.change,
      status: verdict?.status ?? "unsupported",
      detail: verdict?.detail ?? (isPromoted(edit.change) ? PROMOTED_DETAIL : UNSUPPORTED_DETAIL),
    };
  });
  return {
    after,
    results,
    readyCount: results.filter((result) => result.status === "ready").length,
  };
}

export type SourceFileOutcome =
  | { readonly ok: true; readonly absolute: string; readonly relative: string }
  | { readonly ok: false; readonly error: string };

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".py"]);

const REMOTE_ERROR = "원격(HTTP) 서버는 소스 파일 위치를 알 수 없어 고칠 수 없습니다.";
const NOT_RESOLVED_ERROR =
  "실행 명령에서 프로젝트 안의 서버 소스 파일을 찾지 못했습니다.\n해결: 인자에 스크립트 경로가 있어야 합니다(예: node ./server.mjs).";

/** `paths.ts` 의 판정과 같은 식이다. 루트 자체는 안으로 치지 않는다. */
function isInside(rootAbs: string, absolute: string): boolean {
  return absolute !== rootAbs && absolute.startsWith(rootAbs + sep);
}

/** `--command` 의 값, 그 뒤 `--arg` 의 값들. `--env` 같은 다른 옵션의 값은 후보가 아니다. */
function sourceCandidates(argv: readonly string[]): readonly string[] {
  const commands: string[] = [];
  const args: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === undefined || !option.startsWith("--")) continue;
    // 옵션은 전부 값을 하나 받는다. 값 자리를 건너뛰어야 값이 `--arg` 여도 옵션으로 읽지 않는다.
    index += 1;
    const value = argv[index];
    if (value === undefined) break;
    if (option === "--command") commands.push(value);
    if (option === "--arg") args.push(value);
  }
  return [...commands, ...args];
}

/** 실행 명령에서 고칠 소스 파일 하나를 찾는다(§3.3). */
export async function resolveSourceFile(
  root: string,
  argv: readonly string[],
): Promise<SourceFileOutcome> {
  if (argv.some((item) => item === "--url" || item.startsWith("--url="))) {
    return { ok: false, error: REMOTE_ERROR };
  }
  const rootAbs = resolve(root);
  for (const candidate of sourceCandidates(argv)) {
    const absolute = resolve(rootAbs, candidate);
    if (!isInside(rootAbs, absolute)) continue;
    if (relative(rootAbs, absolute).split(sep).includes("node_modules")) continue;
    if (!SOURCE_EXTENSIONS.has(extname(absolute))) continue;
    try {
      if (!(await stat(absolute)).isFile()) continue;
      // 심볼릭 링크를 따라가면 루트 밖 파일일 수 있다. 실제 위치도 루트 안이어야 쓴다.
      const [realRoot, realFile] = await Promise.all([realpath(rootAbs), realpath(absolute)]);
      if (!isInside(realRoot, realFile)) continue;
      if (relative(realRoot, realFile).split(sep).includes("node_modules")) continue;
    } catch {
      // 없는 파일·못 읽는 경로는 후보가 아니다.
      continue;
    }
    return { ok: true, absolute, relative: relative(rootAbs, absolute).split(sep).join("/") };
  }
  return { ok: false, error: NOT_RESOLVED_ERROR };
}

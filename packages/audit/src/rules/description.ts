import { KNOWN_SCHEMA_KEYWORDS, stringContext } from "../collect.js";
import {
  ANSI_ESCAPE_PATTERNS,
  foldText,
  type HiddenCategory,
  hiddenCategory,
  normalizeTextWithSources,
  type TextFormEntry,
} from "../text/normalize.js";
import type { CollectedString, Finding, Location, RuleInfo, Severity, TextForm } from "../types.js";

export { ANSI_ESCAPE_PATTERNS } from "../text/normalize.js";

export const DESC_RULES: readonly RuleInfo[] = [
  {
    id: "desc/injection",
    family: "desc",
    defaultSeverity: "high",
    summary: "설명에 모델에게 내리는 지시가 있다",
  },
  {
    id: "desc/covert-action",
    family: "desc",
    defaultSeverity: "high",
    summary: "본래 기능 외의 숨은 부차 동작을 말한다",
  },
  {
    id: "desc/implicit-trigger",
    family: "desc",
    defaultSeverity: "medium",
    summary: "조건이 맞으면 자동으로 행동하라고 지시한다",
  },
  {
    id: "desc/shadowing",
    family: "desc",
    defaultSeverity: "high",
    summary: "다른 도구·서버의 동작을 바꾸라고 지시한다",
  },
  {
    id: "desc/cross-origin",
    family: "desc",
    defaultSeverity: "info",
    summary:
      "이 서버와 무관한 서비스를 거론한다. shadowing·implicit-trigger 와 같은 문자열이면 medium",
  },
  {
    id: "desc/sensitive-path",
    family: "desc",
    defaultSeverity: "info",
    summary: "민감한 경로를 언급한다. 지시와 같은 문자열이면 high",
  },
  {
    id: "desc/hidden-unicode",
    family: "desc",
    defaultSeverity: "high",
    summary: "보이지 않는 유니코드 문자가 들어 있다",
  },
  {
    id: "desc/ansi-escape",
    family: "desc",
    defaultSeverity: "high",
    summary: "터미널 제어 문자(ANSI 이스케이프)가 들어 있다",
  },
  {
    id: "desc/encoded-blob",
    family: "desc",
    defaultSeverity: "medium",
    summary: "디코딩되는 인코딩 문자열이 들어 있다",
  },
  {
    id: "desc/non-standard-field",
    family: "desc",
    defaultSeverity: "low",
    summary: "스키마 표준 밖의 필드에 긴 문자열이 있다",
  },
];

// ── 문형 (§3.2). folded 형(소문자)을 기준으로 쓴다. raw 형에는 대소문자 무시 사본을 쓴다. ──

/**
 * `this is important … <동사>` 문형은 계획서에서 `use` 를 뺐다. "This is important: use short sentences" 같은 정상 문장이 high 가 된다.
 *
 * ignore·disregard·forget 세 문형은 계획서와 달리 관사(`the`, `all the`, `any of the`)를 허용하고,
 * ignore 문형의 끝 `\b` 를 뺐다. MCPTox 의 가장 흔한 주입 문장 "Ignore the previous instructions" 가
 * 관사 때문에 418건 중 3건만 걸렸고, 그중 292건은 원문이 "instructionsand" 처럼 공백이 빠져 끝 경계에도
 * 막혔다(audit-T7 실측).
 */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore (all |any |the |all the |any of the )?(previous|prior|above|earlier|preceding) (instructions?|prompts?|rules?|messages?)/,
  /\bdisregard (all |any |the |all the |any of the )?(previous|prior|above|earlier) /,
  /\bforget (all |everything |any |the |all the |any of the )?(previous|prior|above|earlier|you were told)/,
  /\b(do not|don'?t|never) (tell|inform|alert|notify|mention|show|display|reveal|disclose)( this| it| that)? (to )?(the )?user\b/,
  /\b(the )?user (should|must|can) ?not (see|know|be told|be informed)\b/,
  /\b(hide|conceal) (this|it|that|these instructions?) from (the )?user\b/,
  /\bsystem ?: ?you are\b/,
  /\byou are now (in )?(admin|developer|debug|god|unrestricted) mode\b/,
  /\bbefore (doing|you do) anything else\b/,
  /\bthis is (very )?(very )?important\b.*\b(read|send|include|call|run|execute)\b/,
  /<\s*(important|instructions?|system|secret|hidden|admin|override)\s*>/,
  /\b(exfiltrate|send|forward|upload|post|transmit) (the |all |any )?(conversation|chat|message) (history|log|context)\b/,
  /\binclude (the )?(full |entire |complete )?(contents? of|text of) ~?\/?(\.ssh|\.env|\.aws|id_rsa|\.cursor|mcp\.json)/,
  /\bexecute (any|all|arbitrary) (shell |system )?commands?\b/,
  /\bact as (if|an?) (unrestricted|jailbroken|different)/,
];

/**
 * covert-action 의 "저장·기록 + 자격증명" 문형. 인증 도구(`AUTH_TOOL_NAME`)에는 적용하지 않는다.
 * 자격증명을 저장하는 것이 그 도구의 본업이라서다(schema/secret-field 의 제외와 같은 근거).
 */
export const STORES_SECRETS_PATTERN =
  /\b(index|cache|store|log|record|track)(s|es|ing|ed)? (any |all )?(api[ _-]?keys?|tokens?|credentials?|passwords?|secrets?)\b/;

/** §3.3 의 인증 도구 이름 정규식. */
export const AUTH_TOOL_NAME =
  /\b(auth|login|authenticate|connect|configure|set_?credentials?|rotate|token)\b/i;

/**
 * 도구 이름이 인증 도구인지. 원래 이름과, `_`·`-` 를 공백으로 바꾼 이름 둘 다에 대본다.
 * 원래 이름만 보면 밑줄이 낱말 경계를 막아 `login_user` 를 놓치고, 바꾼 이름만 보면
 * `set_credentials` 가 `set_?credentials?` 에 맞지 않는다.
 */
export function isAuthToolName(name: string): boolean {
  return AUTH_TOOL_NAME.test(name) || AUTH_TOOL_NAME.test(name.replace(/[_-]+/g, " "));
}

const COVERT_ADVERB =
  "(also|additionally|furthermore|moreover|besides|in addition|at the same time|silently|secretly|quietly|covertly|in the background)";

/**
 * 첫 문형을 계획서와 달리 둘로 나눴다. 전송류 동사(collects·sends…)는 그대로 잡는다. 기록류 동사
 * (logs·records·stores…)는 뒤 6단어 안에 민감한 목적어가 있을 때만 잡는다. "Additionally logs
 * the request id for debugging" 같은 정상 설명이 high 가 되기 때문이다.
 */
export const COVERT_ACTION_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `\\b${COVERT_ADVERB}[ ,]+(collects?|gathers?|extracts?|sends?|uploads?|forwards?|posts?|transmits?|captures?)\\b`,
  ),
  new RegExp(
    `\\b${COVERT_ADVERB}[ ,]+(logs?|records?|stores?|caches?|indexes|tracks?|monitors?)(\\s+\\S+){0,5}?\\s+(api[ _-]?keys?|tokens?|credentials?|passwords?|secrets?|conversations?|chats?|messages?|history|contents?|files?|data|inputs?|prompts?|context|arguments?|queries|emails?)\\b`,
  ),
  /\b(for|as) (caching|optimization|performance|quality|improvement|analytics|backup|sync|telemetry|debugging) (purposes?|reasons?)[ ,]*(send|upload|store|collect|transmit|forward|post)/,
  /\b(actually|really|secretly|covertly|silently) (does|performs?|executes?|runs?|sends?|uploads?|collects?)\b/,
  STORES_SECRETS_PATTERN,
  /\b(extract|parse|scan|identify|harvest)(s|ing|ed)? (all |any )?(api[ _-]?keys?|tokens?|credentials?|passwords?|phone numbers?|credit cards?|ssn|social security|private keys?)\b/,
  /\bautomatically (opt|subscribe|enroll|register|sign)[ -]?(in|up)\b/,
];

export const IMPLICIT_TRIGGER_PATTERN =
  /\b(whenever|every time|each time|after every|before every|on every|when(ever)? the user|if the user|once the user|after (any|each|every) (call|request|tool))\b/;
export const IMPLICIT_ACTION_PATTERN =
  /\b(call|invoke|use|run|execute|set|pass|include|append|add|send|forward|replace|override)\b/;

/**
 * 첫 문형은 계획서와 다르다. 도구 이름 자리를 한 단어에서 세 단어까지로 넓혔다. folded 형은
 * `send_email` 을 `send email` 로 접으므로, 원래 문형으로는 키릴 문자 등으로 raw 대조를 피한
 * 경우 folded 에서 다시 잡을 수 없다.
 *
 * 끝의 두 문형은 계획서에 더한 것이다. 따옴표·백틱으로 다른 도구를 가리키는 꼴("when using the
 * 'get-autocomplete' tool", "the `x` tool is available")로, MCPTox 의 주된 섀도잉 표현인데 0건이었다
 * (audit-T7 실측). 따옴표 안 이름은 `quoted` 이름표로 잡고, 그것이 자기 도구 이름이면 자기 사용법이라
 * 제외한다(`isSelfReference`). 이름 자리에 공백을 세 번까지 허용하는 것은 folded 형이 `-`·`_` 를 공백으로
 * 접기 때문이다. 둘째 문형의 관사는 `(\bthe )?` 다. `\b` 를 앞에 두면 관사가 없을 때 따옴표 앞에서
 * 경계가 성립하지 않는다.
 */
export const SHADOWING_PATTERNS: readonly RegExp[] = [
  /\bwhen(ever)? (the )?\w[\w-]*( [\w-]+){0,2} tool is (available|present|installed|enabled)\b/,
  /\boverride (the )?(behavior|behaviour|output|result) of\b/,
  /\binstead of (using|calling|invoking) (the )?[\w-]+\b/,
  /\bmodify (the )?(usage|behavior|behaviour|output|arguments?) of (the )?[\w-]+ (tool|function)\b/,
  /\b(before|after) (using|calling|invoking) (any|every|all|other|the) (other )?tools?\b/,
  /\breplace (the|all|any) (function|tool|method)s?\b/,
  /\bprioriti[sz]e this (tool|function)( over| above)/,
  /\b(this tool|this function) (must|should) (always )?be (called|used|invoked) (first|before|instead)\b/,
  /\b(when|whenever|before|after|while) (using|calling|invoking) (the )?['"`](?<quoted>[\w.-]+(?: [\w.-]+){0,3})['"`] (tool|function)\b/,
  /(\bthe )?['"`](?<quoted>[\w.-]+(?: [\w.-]+){0,3})['"`] (tool|function) (is|has been|becomes) (available|present|installed|enabled)\b/,
];

/** 도구 이름 비교용. 대소문자를 무시하고 밑줄·하이픈·공백 덩어리를 공백 하나로 본다. */
const comparableName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();

/**
 * 따옴표로 가리킨 도구가 이 문자열이 속한 도구 자신인지. 자기 설명에서 "when using the 'read_file'
 * tool, pass an absolute path" 라고 쓰는 것은 자기 사용법이다. 도구 위치가 아니면 판단하지 않는다.
 */
function isSelfReference(location: Location): (match: RegExpExecArray) => boolean {
  if (location.kind !== "tool") return () => false;
  const own = comparableName(location.toolName);
  return (match) => {
    const quoted = match.groups?.quoted;
    return quoted !== undefined && own !== "" && comparableName(quoted) === own;
  };
}

export const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /~\/\.ssh\b/,
  /\bid_(rsa|ed25519|ecdsa)\b/,
  /\.env\b/,
  /\bmcp\.json\b/,
  /\.cursor\//,
  /\.claude\//,
  /\/etc\/(passwd|shadow)\b/,
  /\.aws\/credentials\b/,
  /\.npmrc\b/,
  /\.netrc\b/,
  /\.git-credentials\b/,
];

export const CROSS_ORIGIN_NAMES: readonly string[] = [
  "whatsapp",
  "slack",
  "discord",
  "telegram",
  "signal",
  "gmail",
  "outlook",
  "github",
  "gitlab",
  "bitbucket",
  "jira",
  "confluence",
  "notion",
  "linear",
  "asana",
  "trello",
  "gdrive",
  "google drive",
  "dropbox",
  "onedrive",
  "aws",
  "gcp",
  "azure",
  "stripe",
  "paypal",
  "supabase",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
  "kubernetes",
  "docker",
  "1password",
  "lastpass",
  "bitwarden",
];

/**
 * 흔한 영어 단어와 겹치는 서비스 이름. 계획서에 없는 제외다. "linear interpolation",
 * "signal value", "the notion of" 같은 정상 설명이 medium 으로 걸리지 않게, 원문에 대문자로
 * 시작하는 고유명사(`Linear`)로 있을 때만 본다.
 */
const AMBIGUOUS_NAMES: ReadonlyMap<string, RegExp> = new Map([
  ["signal", /\bSignal\b/],
  ["linear", /\bLinear\b/],
  ["notion", /\bNotion\b/],
]);

// ── 대조 도구 ──

const caseInsensitive = (patterns: readonly RegExp[]) =>
  patterns.map((pattern) =>
    pattern.flags.includes("i") ? pattern : new RegExp(pattern.source, `${pattern.flags}i`),
  );

interface PatternSet {
  readonly folded: readonly RegExp[];
  readonly raw: readonly RegExp[];
}

const patternSet = (patterns: readonly RegExp[]): PatternSet => ({
  folded: patterns,
  raw: caseInsensitive(patterns),
});

const INJECTION = patternSet(INJECTION_PATTERNS);
const COVERT = patternSet(COVERT_ACTION_PATTERNS);
const COVERT_FOR_AUTH_TOOLS = patternSet(
  COVERT_ACTION_PATTERNS.filter((pattern) => pattern !== STORES_SECRETS_PATTERN),
);
const SHADOWING = patternSet(SHADOWING_PATTERNS);
const SENSITIVE = patternSet(SENSITIVE_PATH_PATTERNS);
const TRIGGER = patternSet([IMPLICIT_TRIGGER_PATTERN]);
const ACTION_GLOBAL = new RegExp(IMPLICIT_ACTION_PATTERN.source, "gi");

const FRAGMENT_LIMIT = 80;

/** 보이지 않는 문자와 제어 문자를 `<U+XXXX>` 로 바꾼다. 줄바꿈·탭은 공백 하나로. */
export function escapeInvisible(text: string): string {
  let escaped = "";
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (char === "\n" || char === "\r" || char === "\t") escaped += " ";
    else if (
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      hiddenCategory(codePoint)
    )
      escaped += `<${codePointLabel(codePoint)}>`;
    else escaped += char;
  }
  return escaped;
}

/** 근거 조각. 보이지 않는 문자를 드러내고 80자(코드포인트)를 넘으면 잘라 "…" 로 끝낸다. */
export function evidenceFragment(text: string): string {
  const chars = [...escapeInvisible(text)];
  return chars.length <= FRAGMENT_LIMIT
    ? chars.join("")
    : `${chars.slice(0, FRAGMENT_LIMIT - 1).join("")}…`;
}

const codePointLabel = (codePoint: number) =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

/** 형 하나에서 걸린 문형. `fragment` 는 그 형의 글자 그대로다(근거로 쓰기 전에 다듬는다). */
export interface PatternHit {
  readonly form: TextForm;
  readonly fragment: string;
}

/** 형 하나에 문형 묶음을 대조해 가장 앞에서 시작하는 일치를 돌려준다. 같은 위치면 문형 순서. */
function firstMatch(
  text: string,
  patterns: readonly RegExp[],
  exclude?: (match: RegExpExecArray) => boolean,
): string | undefined {
  let best: RegExpExecArray | undefined;
  for (const pattern of patterns) {
    if (exclude === undefined) {
      const match = pattern.exec(text);
      if (match !== null && (best === undefined || match.index < best.index)) best = match;
      continue;
    }
    // 제외가 있으면 같은 문형의 다음 일치도 본다. 첫 일치가 자기 사용법이어도 뒤에 다른 도구를
    // 가리키는 일치가 있을 수 있다.
    for (const match of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
      if (exclude(match)) continue;
      if (best === undefined || match.index < best.index) best = match;
      break;
    }
  }
  return best?.[0];
}

/** 걸린 형 자체도 함께 든 일치. encoded-blob 이 어느 디코딩형이 걸렸는지 본다. */
type FormHit = PatternHit & { readonly entry: TextFormEntry };

/** 각 형에 문형을 대조한다. 형 순서(raw, folded, base64…, hex…, rot13)대로 걸린 것 전부. */
function matchForms(
  forms: readonly TextFormEntry[],
  set: PatternSet,
  exclude?: (match: RegExpExecArray) => boolean,
): FormHit[] {
  const hits: FormHit[] = [];
  for (const entry of forms) {
    const fragment = firstMatch(entry.text, entry.form === "raw" ? set.raw : set.folded, exclude);
    if (fragment !== undefined) hits.push({ form: entry.form, fragment, entry });
  }
  return hits;
}

/**
 * "If the user does not specify a unit, use metric" 같은 기본값 안내. 계획서에 없는 제외다.
 * 사용자가 무엇을 하지 *않을* 때의 대체값을 말하는 것이라 자동 행동 지시가 아니다.
 */
const DEFAULT_VALUE_CLAUSE = /^\s*(does not|doesn'?t|did not|didn'?t|omits|leaves out)\b/i;

/**
 * 문장 하나에서 트리거 뒤에 오는, 자기 사용법이 아닌 행동 동사까지의 조각. 행동 동사 뒤 3단어
 * 안에 "this tool"·"this function" 이 오거나(§3.2) 자기 도구 이름이 오면(계획서에 더한 제외)
 * 자기 사용법이라 건너뛴다.
 */
function triggerInSentence(
  sentence: string,
  trigger: RegExp,
  isOwnName: (words: readonly string[]) => boolean,
): string | undefined {
  const triggers = new RegExp(trigger.source, `${trigger.flags}g`);
  for (let start = triggers.exec(sentence); start !== null; start = triggers.exec(sentence)) {
    const afterTrigger = start.index + start[0].length;
    if (/if the user$/i.test(start[0]) && DEFAULT_VALUE_CLAUSE.test(sentence.slice(afterTrigger)))
      continue;
    ACTION_GLOBAL.lastIndex = afterTrigger;
    for (
      let action = ACTION_GLOBAL.exec(sentence);
      action !== null;
      action = ACTION_GLOBAL.exec(sentence)
    ) {
      const end = action.index + action[0].length;
      const words = sentence.slice(end).trim().split(/\s+/).slice(0, 3);
      const selfUse =
        /\bthis (tool|function)\b/.test(foldText(words.join(" "))) || isOwnName(words);
      if (!selfUse) return sentence.slice(start.index, end).trim();
    }
  }
  return undefined;
}

const SENTENCE_SPLIT = /[.;\n]/;

/**
 * `desc/implicit-trigger`. 문장(마침표·줄바꿈·세미콜론)마다 본다. folded 형은 줄바꿈을 공백으로
 * 접어 문장 경계를 잃으므로, raw 를 먼저 문장으로 나눈 뒤 각 문장을 접는다.
 */
function matchImplicitTrigger(
  raw: string,
  forms: readonly TextFormEntry[],
  location: Location,
): FormHit[] {
  const toolName = location.kind === "tool" ? location.toolName : "";
  // raw 는 낱말을 도구 이름과 그대로 견준다(`tag_photo_backup` 은 `tag_photo` 가 아니다). 접힌 형은
  // 밑줄이 공백이 되어 낱말 경계를 잃으므로 접힌 이름이 낱말 열로 들어 있는지만 본다.
  const rawOwn = (words: readonly string[]) =>
    toolName !== "" &&
    words.some(
      (word) => word.replace(/^[^\w]+|[^\w]+$/g, "").toLowerCase() === toolName.toLowerCase(),
    );
  const foldedName = foldText(toolName);
  const foldedOwn = (words: readonly string[]) =>
    foldedName !== "" && ` ${foldText(words.join(" "))} `.includes(` ${foldedName} `);
  const hits: FormHit[] = [];
  for (const entry of forms) {
    const sentences =
      entry.form === "raw" || entry.form === "folded"
        ? raw
            .split(SENTENCE_SPLIT)
            .map((sentence) => (entry.form === "raw" ? sentence : foldText(sentence)))
        : entry.text.split(SENTENCE_SPLIT);
    const trigger = (entry.form === "raw" ? TRIGGER.raw : TRIGGER.folded)[0] as RegExp;
    for (const sentence of sentences) {
      const fragment = triggerInSentence(
        sentence,
        trigger,
        entry.form === "raw" ? rawOwn : foldedOwn,
      );
      if (fragment !== undefined) {
        hits.push({ form: entry.form, fragment, entry });
        break;
      }
    }
  }
  return hits;
}

/** 다른 패키지(protocol·result 규칙)가 쓰는 진입점. raw 하나에서 모델 지시를 찾는다. */
export function findInjection(raw: string): PatternHit | undefined {
  const [hit] = matchForms(normalizeTextWithSources(raw), INJECTION);
  return hit === undefined ? undefined : { form: hit.form, fragment: hit.fragment };
}

export interface HiddenCharacter {
  readonly codePoint: number;
  readonly category: HiddenCategory;
}

const EMOJI = /\p{Emoji}/u;
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Emoji_Modifier}/u;

/** 이모지 표현에 정당하게 쓰이는 보이지 않는 문자인지. 계획서에 없는 제외다(정상 설명의 이모지 오탐). */
function isEmojiSequencePart(chars: readonly string[], index: number): boolean {
  const codePoint = chars[index]?.codePointAt(0) ?? 0;
  const previous = chars[index - 1] ?? "";
  // 변형 선택자 FE0E·FE0F 는 이모지(숫자 키캡 포함) 바로 뒤에서 표시 방식을 고른다.
  if (codePoint === 0xfe0e || codePoint === 0xfe0f) return EMOJI.test(previous);
  // ZWJ 는 이모지 둘을 이어 붙인다(👩\u200D💻). 앞쪽은 FE0F 를 건너뛰고 본다(🏳\uFE0F\u200D🌈).
  if (codePoint === 0x200d) {
    let back = index - 1;
    if (chars[back] === "\uFE0F") back -= 1;
    return PICTOGRAPH.test(chars[back] ?? "") && PICTOGRAPH.test(chars[index + 1] ?? "");
  }
  // 태그 문자는 🏴 뒤에서 E007F 로 끝나면 지역 국기(잉글랜드 등)다.
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) {
    let start = index;
    while (start > 0 && isTag(chars[start - 1])) start -= 1;
    let end = index;
    while (end < chars.length - 1 && isTag(chars[end + 1])) end += 1;
    return chars[start - 1] === "\u{1F3F4}" && chars[end] === "\u{E007F}";
  }
  return false;
}

const isTag = (char: string | undefined) => {
  const codePoint = char?.codePointAt(0) ?? 0;
  return codePoint >= 0xe0000 && codePoint <= 0xe007f;
};

/** raw 에서 §3.2 표의 보이지 않는 문자를 코드포인트 순으로 중복 없이 찾는다. */
export function findHiddenCharacters(raw: string): HiddenCharacter[] {
  const chars = [...raw];
  const found = new Map<number, HiddenCategory>();
  chars.forEach((char, index) => {
    const codePoint = char.codePointAt(0) ?? 0;
    const category = hiddenCategory(codePoint);
    if (category !== undefined && !isEmojiSequencePart(chars, index))
      found.set(codePoint, category);
  });
  return [...found]
    .sort(([left], [right]) => left - right)
    .map(([codePoint, category]) => ({ codePoint, category }));
}

/** raw 에서 첫 ANSI 이스케이프를 찾는다. 없으면 undefined. */
export function findAnsiEscape(raw: string): string | undefined {
  return firstMatch(raw, ANSI_ESCAPE_PATTERNS);
}

// ── 규칙 ──

const MESSAGES = {
  "desc/injection": {
    message: (fragment: string, form: string) =>
      `모델에게 내리는 지시가 있습니다: "${fragment}" (${form} 형에서 발견)`,
    fix: "이 서버를 신뢰하지 않는다면 등록하지 마세요. 서버 작성자라면 설명에서 모델 지시를 빼세요.",
  },
  "desc/covert-action": {
    message: (fragment: string) => `본래 기능 외의 숨은 동작을 말합니다: "${fragment}"`,
    fix: "설명이 말하는 부차 동작이 실제로 필요한지 서버 작성자에게 확인하세요. 아니면 등록하지 마세요.",
  },
  "desc/implicit-trigger": {
    message: (fragment: string) =>
      `조건이 맞을 때 자동으로 행동하라는 지시가 있습니다: "${fragment}"`,
    fix: "사용자 요청 없이 도구가 불리는 규칙은 데이터 유출의 전형입니다. 설명에서 빼야 합니다.",
  },
  "desc/shadowing": {
    message: (fragment: string) => `다른 도구의 동작을 바꾸라는 지시가 있습니다: "${fragment}"`,
    fix: "이 서버를 다른 서버와 함께 켜지 마세요. 서버 작성자라면 자기 도구만 설명하세요.",
  },
  "desc/sensitive-path": {
    message: (fragment: string) => `민감한 경로 '${fragment}' 을 언급합니다`,
    fix: "이 경로를 읽는 것이 도구의 본래 목적인지 확인하세요.",
  },
} as const;

type PatternRuleId = keyof typeof MESSAGES;

function patternFinding(
  ruleId: PatternRuleId,
  severity: Severity,
  location: Location,
  hit: PatternHit,
): Finding {
  const fragment = evidenceFragment(hit.fragment);
  const spec = MESSAGES[ruleId];
  return {
    ruleId,
    severity,
    location,
    message: spec.message(fragment, hit.form),
    fix: spec.fix,
    evidence: [fragment, hit.form],
  };
}

function crossOriginFindings(
  entry: CollectedString,
  folded: string,
  serverName: string,
  severity: Severity,
): Finding[] {
  const own = foldText(serverName);
  const tokens = folded.split(/[^a-z0-9]+/).filter((token) => token !== "");
  const tokenSet = new Set(tokens);
  const pairs = new Set(tokens.slice(1).map((token, index) => `${tokens[index]} ${token}`));
  const inEnum = /(^|\.)enum\[\d+\]$/.test(entry.location.path);
  const scheme =
    entry.location.kind === "resource" && entry.location.path === "uri"
      ? (/^([a-z][a-z0-9+.-]*):/i.exec(entry.raw)?.[1]?.toLowerCase() ?? "")
      : "";
  const findings: Finding[] = [];
  for (const name of CROSS_ORIGIN_NAMES) {
    const present = name.includes(" ") ? pairs.has(name) : tokenSet.has(name);
    if (!present || own.includes(name) || inEnum || name === scheme) continue;
    const proper = AMBIGUOUS_NAMES.get(name);
    if (proper !== undefined && !proper.test(entry.raw)) continue;
    findings.push({
      ruleId: "desc/cross-origin",
      severity,
      location: entry.location,
      message: `이 서버와 무관한 서비스 '${name}' 을 거론합니다`,
      fix: `다른 서버(${name})의 도구를 가로채는 섀도잉일 수 있습니다. 함께 켤 때 주의하세요.`,
      evidence: [name],
    });
  }
  return findings;
}

function hiddenUnicodeFinding(entry: CollectedString): Finding | undefined {
  const hidden = findHiddenCharacters(entry.raw);
  if (hidden.length === 0) return undefined;
  const labels = hidden.map(
    ({ codePoint, category }) => `${codePointLabel(codePoint)} (${category})`,
  );
  const shown = labels.length > 5 ? [...labels.slice(0, 5), "…"] : labels;
  const onlySpaces = hidden.every(({ category }) => category === "confusable-space");
  return {
    ruleId: "desc/hidden-unicode",
    severity: onlySpaces ? "info" : "high",
    location: entry.location,
    message: `보이지 않는 문자 ${shown.join(", ")} 가 들어 있습니다`,
    fix: "보이지 않는 문자는 사람에게는 안 보이고 모델에게는 보입니다. 설명을 ASCII 로 다시 쓰세요.",
    evidence: labels,
  };
}

const ENCODED_EXEMPT_FORMATS = new Set(["uri", "byte"]);

/** §3.2 의 encoded-blob 제외: 리소스 uri·mimeType, format 이 uri·byte 인 속성의 default·examples. */
function encodedBlobExempt(entry: CollectedString): boolean {
  if (
    entry.location.kind === "resource" &&
    (entry.location.path === "uri" || entry.location.path === "mimeType")
  )
    return true;
  const format = stringContext(entry).enclosingFormat;
  return format !== undefined && ENCODED_EXEMPT_FORMATS.has(format);
}

/** 문자열 하나에 desc 규칙 전부를 돌린다. 규칙마다 위치 하나에 발견 하나(cross-origin 은 이름마다). */
function scanString(entry: CollectedString, serverName: string): Finding[] {
  const forms = normalizeTextWithSources(entry.raw);
  const folded = forms[1]?.text ?? "";
  const findings: Finding[] = [];
  const hitForms = new Set<TextFormEntry>();

  const record = (ruleId: PatternRuleId, severity: Severity, hits: readonly FormHit[]) => {
    for (const hit of hits) hitForms.add(hit.entry);
    const [first] = hits;
    if (first !== undefined) findings.push(patternFinding(ruleId, severity, entry.location, first));
    return first !== undefined;
  };

  const injected = record("desc/injection", "high", matchForms(forms, INJECTION));
  const authTool = entry.location.kind === "tool" && isAuthToolName(entry.location.toolName);
  const covert = record(
    "desc/covert-action",
    "high",
    matchForms(forms, authTool ? COVERT_FOR_AUTH_TOOLS : COVERT),
  );
  // 파라미터(스키마 속성) 설명의 조건문은 인자 채우기 안내라 자동 트리거로 보지 않는다. 다른 규칙은 그대로 돈다.
  const inParameter =
    entry.location.kind === "tool" && entry.location.path.startsWith("inputSchema");
  const implicit = inParameter
    ? false
    : record(
        "desc/implicit-trigger",
        "medium",
        matchImplicitTrigger(entry.raw, forms, entry.location),
      );
  const shadowing = record(
    "desc/shadowing",
    "high",
    matchForms(forms, SHADOWING, isSelfReference(entry.location)),
  );
  record("desc/sensitive-path", injected || covert ? "high" : "info", matchForms(forms, SENSITIVE));

  findings.push(
    ...crossOriginFindings(entry, folded, serverName, shadowing || implicit ? "medium" : "info"),
  );

  const hidden = hiddenUnicodeFinding(entry);
  if (hidden !== undefined) findings.push(hidden);

  const ansi = findAnsiEscape(entry.raw);
  if (ansi !== undefined)
    findings.push({
      ruleId: "desc/ansi-escape",
      severity: "high",
      location: entry.location,
      message: "터미널 제어 문자(ANSI 이스케이프)가 들어 있습니다",
      fix: "터미널에서 글자를 숨기는 수법입니다. 설명에서 제어 문자를 빼세요.",
      evidence: [evidenceFragment(ansi)],
    });

  const blob = forms.find(
    (formEntry) => formEntry.source !== undefined && !hitForms.has(formEntry),
  );
  if (blob?.source !== undefined && !encodedBlobExempt(entry))
    findings.push({
      ruleId: "desc/encoded-blob",
      severity: "medium",
      location: entry.location,
      message: `인코딩된 긴 문자열(${blob.source.kind}, ${blob.source.token.length}자)이 들어 있습니다`,
      fix: "설명에 인코딩된 데이터가 있을 이유가 없습니다. 디코딩해 내용을 확인하세요.",
      evidence: [blob.source.kind, evidenceFragment(blob.source.token)],
    });

  const schemaKey = stringContext(entry).schemaKey;
  if (
    schemaKey !== undefined &&
    !KNOWN_SCHEMA_KEYWORDS.has(schemaKey) &&
    [...entry.raw].length >= 40
  )
    findings.push({
      ruleId: "desc/non-standard-field",
      severity: "low",
      location: entry.location,
      message: `스키마 표준 밖의 필드 '${schemaKey}' 에 긴 문자열이 있습니다`,
      fix: "모델은 이 필드도 읽습니다. 표준 키워드(description 등)만 쓰고 그 내용을 검토하세요.",
      evidence: [schemaKey, evidenceFragment(entry.raw)],
    });

  return findings;
}

/** 두 문자열을 코드 단위 순으로 비교한다. localeCompare 는 실행 환경의 로캘에 따라 달라진다. */
const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const toolIndexOf = (location: Location) =>
  location.kind === "tool" || location.kind === "result" ? location.toolIndex : -1;

/** §3.0 의 정렬·중복 제거. 입력 순서와 무관하게 같은 결과를 낸다. */
function sortAndDedupe(findings: readonly Finding[]): Finding[] {
  const sorted = [...findings].sort(
    (left, right) =>
      toolIndexOf(left.location) - toolIndexOf(right.location) ||
      compareText(left.ruleId, right.ruleId) ||
      compareText(left.location.path, right.location.path) ||
      compareText(left.evidence[0] ?? "", right.evidence[0] ?? ""),
  );
  const seen = new Set<string>();
  return sorted.filter((finding) => {
    // §3.0 의 (ruleId, path, evidence[0]) 에 위치 전체를 더한다. path 만으로는 서로 다른 프롬프트의
    // "description" 이 하나로 합쳐진다.
    const key = JSON.stringify([finding.ruleId, finding.location, finding.evidence[0] ?? ""]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function runDescRules(
  strings: readonly CollectedString[],
  context: { serverName: string },
): Finding[] {
  return sortAndDedupe(strings.flatMap((entry) => scanString(entry, context.serverName)));
}

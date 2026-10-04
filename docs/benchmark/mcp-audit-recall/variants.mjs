/**
 * MCPTox 사례를 바꿔 쓰는 변형. 새 문장을 짓지 않고 치환만 한다. 같은 입력이면 같은 출력이다.
 *
 * 변형은 2026-10-05 한계 실험(ADR-0114)에서 `desc/steering` 의 점수표를 구할 때 쓴 것과 같다. 여기를 고치면
 * RESULTS.md 의 수치와 견줄 수 없게 되므로, 고칠 때는 새 변형을 더하고 기존 것은 그대로 둔다.
 */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameTokens = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_\-./]+/).filter(Boolean);

/** `packages/audit/src/rules/steering.ts` 의 nameSource 와 같은 규칙이다(공개 면을 늘리지 않으려고 옮겨 적었다). */
function nameSource(name) {
  const t = nameTokens(name);
  if (t.length >= 2) return `(?<![A-Za-z0-9])${t.map(esc).join("[\\s_\\-./]?")}(?![A-Za-z0-9])`;
  if (name.length < 3) return null;
  return "(?:['\"`]" + esc(name) + "['\"`]|(?<![A-Za-z0-9])" + esc(name) + "\\s+tool\\b|\\btool\\s+" + esc(name) + "(?![A-Za-z0-9]))";
}

const TAG = /<\s*\/?\s*(important|instructions?|system|secret|hidden|admin|override)\s*>/gi;

/** 말투 완화: 태그, 무시·은폐 동사, 의무 표현, 도구 이름의 따옴표를 바꾼다. */
const soften = (d) =>
  d
    .replace(TAG, " Note: ")
    .replace(/\bignore\b/gi, "set aside")
    .replace(/\bdisregard\b/gi, "pay no attention to")
    .replace(/\b(do not|don'?t|never) (tell|inform|alert|notify|mention|show|display|reveal|disclose)\b/gi, "keep quiet about this toward")
    .replace(/\bwhenever\b/gi, "any time")
    .replace(/\byou MUST FIRST\b/gi, "it is best to first")
    .replace(/\b(must|have to|need to)\b/gi, "should")
    .replace(/\balways\b/gi, "each time")
    .replace(/\b(mandatory|required)\b/gi, "recommended")
    .replace(/\bnever\b/gi, "avoid")
    .replace(/['"`]([A-Za-z][\w.-]*)['"`]/g, "$1");

/** 말투 전부: 완화에 더해 조건·순서 낱말, 사용자·파라미터를 가리키는 낱말까지 바꾼다. */
const reword = (d) =>
  soften(d)
    .replace(/\bbefore\b/gi, "ahead of")
    .replace(/\bwhen\b/gi, "at the time")
    .replace(/\bif\b/gi, "in case")
    .replace(/\bafter\b/gi, "following")
    .replace(/\bany time\b/gi, "on every occasion")
    .replace(/\bfirst\b/gi, "up front")
    .replace(/\bshould\b/gi, "is expected to")
    .replace(/\bthe user\b/gi, "the requester")
    .replace(/\buser'?s\b/gi, "requester's")
    .replace(/\bparameter\b/gi, "input")
    .replace(/\binstead\b/gi, "in its place");

/** 길이 늘림: 설명 끝에 무해한 문장을 열두 번 붙인다. 길이에 기대는 판정을 피하는 공격을 본뜬다. */
const PADDING = ` ${"This helper keeps the workspace consistent and reports a short status line. ".repeat(12)}`;

/** 이름을 기능으로 풀어 쓴다: 그 도구의 정상 설명 첫 문장 앞 아홉 낱말을 빌린다. */
function phraseFor(tool) {
  const first = (tool.description ?? "").replace(/\s+/g, " ").split(/[.!?\n]/)[0].split(" ").slice(0, 9).join(" ").toLowerCase();
  return first ? `what is normally used to ${first}` : "the corresponding one";
}

/**
 * 변형 목록. `inplace` 는 가짜 도구를 따로 두지 않고 원문이 처음 언급한 정상 도구의 설명 끝에 원문을 붙인다
 * (그 도구의 이름은 "this tool" 로 바꾼다). `noname` 은 나머지 도구 이름을 기능 설명으로 풀어 쓰고, 가짜 도구에
 * 인자를 하나 단다(인자 없는 운반 도구라는 흔적을 지운다).
 */
export const VARIANTS = [
  { name: "원본" },
  { name: "말투 완화", text: soften },
  { name: "말투 전부 + 길이 늘림", text: (d) => reword(d) + PADDING },
  { name: "기존 도구에 심음", inplace: true },
  { name: "기존 도구에 심음 + 말투 전부", inplace: true, text: reword },
  { name: "이름 풀어 씀", noname: true },
  { name: "이름 풀어 씀 + 말투 전부 + 길이 늘림", noname: true, text: (d) => reword(d) + PADDING },
  { name: "심음 + 이름 풀어 씀 + 말투 전부", inplace: true, noname: true, text: reword },
];

/**
 * 사례 하나에 변형을 적용한다. `poisoned` 는 중독 도구, `clean` 은 그 서버의 정상 도구 목록이다.
 * 돌려주는 `tool` 이 판정 대상이고 `tools` 는 그 도구가 들어 있는 서버 전체의 목록이다.
 */
export function applyVariant(poisoned, clean, variant) {
  let text = poisoned.description;
  const refs = clean
    .filter((t) => t.name.toLowerCase() !== poisoned.name.toLowerCase())
    .map((t) => {
      const source = nameSource(t.name);
      const match = source ? new RegExp(source, "i").exec(text) : null;
      return match ? { tool: t, at: match.index, source } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
  const mention = (source) => new RegExp(`(['"\`])?${source}\\1?( tool)?`, "gi");

  let target = null;
  if (variant.inplace && refs.length > 0) {
    target = refs[0].tool;
    text = text.replace(mention(refs[0].source), "this tool");
  }
  if (variant.noname) for (const ref of refs) if (ref.tool !== target) text = text.replace(mention(ref.source), phraseFor(ref.tool));
  if (variant.text) text = variant.text(text);

  if (target) {
    const tool = { ...target, description: `${target.description}\n\n${text}` };
    return { tool, tools: clean.map((t) => (t === target ? tool : t)) };
  }
  const tool = variant.noname
    ? { ...poisoned, description: text, inputSchema: { type: "object", properties: { input: { type: "string" } } } }
    : { ...poisoned, description: text };
  return { tool, tools: [...clean, tool] };
}

import type { Finding, RawTool, RuleInfo } from "../types.js";

export const FLOW_RULES: readonly RuleInfo[] = [
  {
    id: "flow/toxic-combination",
    family: "flow",
    defaultSeverity: "low",
    summary: "외부 입력 읽기·비공개 데이터 읽기·외부 쓰기 도구가 한 서버에 함께 있는 권한 조합",
  },
] as const;

const words = (list: string): ReadonlySet<string> => new Set(list.split("|"));

const UNTRUSTED = words(
  "issue|issues|comment|comments|ticket|tickets|email|emails|mail|inbox|message|messages|" +
    "dm|web|webpage|page|url|fetch|browse|search|scrape|crawl|document|documents|doc|docs|file|files|" +
    "pull_request|pr|review|feed|rss",
);
const UNTRUSTED_VERBS = words("list|get|read|fetch|search|find|query|browse|open|load|download");
const PRIVATE = words(
  "repo|repository|repositories|private|secret|secrets|credential|credentials|token|tokens|" +
    "database|db|table|record|records|row|rows|user|users|account|accounts|customer|customers|" +
    "message|messages|file|files|drive|vault|wallet|key|keys",
);
const EXTERNAL = words(
  "create|post|send|publish|comment|reply|open|submit|upload|share|invite|transfer|pay|" +
    "email|mail|tweet|push",
);

/**
 * 이름·title·description 을 소문자로 접어 영숫자 아닌 글자(`[_\- ]`·문장부호 포함)에서 나눈다.
 * `pull_request` 같은 두 낱말 키워드를 위해 인접 토큰을 `_` 로 이은 쌍도 넣는다.
 */
function tokenSet(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    const parts = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    parts.forEach((part, i) => {
      out.add(part);
      if (i > 0) out.add(`${parts[i - 1]}_${part}`);
    });
  }
  return out;
}

const hasAny = (tokens: ReadonlySet<string>, list: ReadonlySet<string>): boolean =>
  [...list].some((word) => tokens.has(word));

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** 집합의 도구 이름을 정렬해 최대 3개. 입력 순서와 무관하게 같은 문자열을 낸다. */
function names(set: readonly string[]): string {
  return [...new Set(set)].sort().slice(0, 3).join(", ");
}

export function runFlowRules(tools: readonly RawTool[]): Finding[] {
  const untrusted: string[] = [];
  const privateData: string[] = [];
  const external: string[] = [];
  for (const tool of tools) {
    const annotations =
      typeof tool.annotations === "object" && tool.annotations !== null
        ? (tool.annotations as Record<string, unknown>)
        : {};
    const tokens = tokenSet([
      tool.name,
      str(tool.title),
      str(annotations.title),
      str(tool.description),
    ]);
    const readVerb = hasAny(tokens, UNTRUSTED_VERBS);
    const readOnly = annotations.readOnlyHint === true;
    if (hasAny(tokens, UNTRUSTED) && (readVerb || readOnly)) untrusted.push(tool.name);
    if (hasAny(tokens, PRIVATE) && readVerb) privateData.push(tool.name);
    if (hasAny(tokens, EXTERNAL) && (annotations.openWorldHint === true || !readOnly)) {
      external.push(tool.name);
    }
  }
  if (untrusted.length === 0 || privateData.length === 0 || external.length === 0) return [];

  const evidence = [names(untrusted), names(privateData), names(external)];
  return [
    {
      ruleId: "flow/toxic-combination",
      severity: "low",
      location: { kind: "server", path: "" },
      message: `이 서버는 외부 입력을 읽고(${evidence[0]}), 비공개 데이터에 닿고(${evidence[1]}), 밖으로 쓸 수 있습니다(${evidence[2]}).`,
      fix: "세 역할을 한 세션에서 함께 켜지 마세요. 외부 입력을 읽는 도구만 따로 붙이거나 쓰기 도구를 끄세요.",
      evidence,
    },
  ];
}

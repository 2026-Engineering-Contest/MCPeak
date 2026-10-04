// desc/steering 의 판정. 설계는 docs/plans/2026-10-05-audit-조종-신호-점수-규칙-설계.md 다.
// 정규식·점수·기준·신호 순서는 실측으로 고정한 값이다. 점수표를 고치려면
// docs/benchmark/mcp-audit-recall/measure.mjs 의 변형 표로 전후를 견준다.

import type { Finding, RawTool } from "../types.js";
import { evidenceFragment } from "./description.js";

export interface SteeringSignal {
  readonly id: string;
  readonly points: number;
  /** 사람용 이름. 발견 문장의 "근거:" 뒤에 쉼표로 이어 붙는다. */
  readonly phrase: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameTokens = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-./]+/)
    .filter(Boolean);

/**
 * 도구 이름을 설명에서 찾는 정규식 원문. 두 토큰 이상이면 구분자(`_`·`-`·공백·`.`·`/`)를 서로 바꿔 써도 찾는다
 * (`read_file`, `read-file`, `read file`, `readFile`). 한 낱말 이름(`add`, `echo`)은 흔한 낱말과 겹치므로
 * 따옴표·백틱으로 감쌌거나 `tool` 이 붙었을 때만 찾는다. 세 글자 미만은 찾지 않는다(null).
 */
function nameSource(name: string): string | null {
  const t = nameTokens(name);
  if (t.length >= 2) return `(?<![A-Za-z0-9])${t.map(esc).join("[\\s_\\-./]?")}(?![A-Za-z0-9])`;
  if (name.length < 3) return null;
  const escaped = esc(name);
  return `(?:['"\`]${escaped}['"\`]|(?<![A-Za-z0-9])${escaped}\\s+tool\\b|\\btool\\s+${escaped}(?![A-Za-z0-9]))`;
}

/** 문장 나누기. 마침표·느낌표·물음표·쌍점·쌍반점 뒤 공백, 또는 줄바꿈. */
const splitSentences = (text: string) =>
  text.split(/(?<=[.!?:;])\s+|\n+/).filter((s) => s.trim() !== "");

const LITERAL = /(['"`])([^'"`\n]{1,80})\1/g;
const CRED =
  /(~\/\.[a-z]|\/etc\/(passwd|shadow|hosts)|\.ssh\b|id_rsa|id_ed25519|authorized_keys|\.aws\b|\.bashrc|\.zshrc|\.npmrc|\.netrc|\bprivate key\b|\bssh keys?\b|\bapi[\s_-]?keys?\b|\baccess[\s_-]?tokens?\b|\bcredentials?\b|\benv(ironment)? variables?\b|\bprintenv\b|\bsecrets?\b|\bpasswords?\b|\bcookies?\b|\bsession tokens?\b)/i;
const CRED_PATH =
  /(~\/\.[a-z]|\/etc\/(passwd|shadow|hosts)|\.ssh\b|id_rsa|id_ed25519|authorized_keys|\.aws\/|\.bashrc|\.zshrc|\.npmrc|\.netrc|\bprintenv\b)/i;
const URL_OR_EMAIL = /(https?:\/\/[^\s'"`)]+|[\w.+-]+@[\w-]+\.[a-z]{2,})/gi;
const PAYLOAD =
  /(rm\s+-rf|curl\s+(-\w+\s+)*https?:|wget\s|\$\(|&&\s*\w|\beval\(|document\.(cookie|body|create)|fetch\(|\bchmod\b|\/bin\/(ba)?sh|powershell|DROP TABLE|DELETE FROM|<script|[A-Za-z0-9+/=]{60,})/i;
const DIRECTIVE =
  /\b(you|the (assistant|agent|model|ai|llm|caller))\s+(must|should|need to|have to|are required to|are expected to|shall|will need to|are to)\b|\b(must|should|is expected to|needs? to|have to|has to|make sure|be sure|ensure that|remember to|it is (best|important|essential|necessary|critical|recommended|required) to)\b/i;
const PRETEXT =
  /\b(security|compliance|verification|audit(ing)?|policy|safety|integrity|authenticat\w+|authoriz\w+|analytics|efficiency|stability|accuracy|consistency|backup|logging|telemetry|quality|optimi[sz]\w+|pre-?authoriz\w+|prerequisite|system (policy|alert|update|requirement))\b/i;
const ORDER =
  /\b(before|prior to|ahead of|first|up front|beforehand|as the (very )?first step|initially|prerequisite|whenever|any time|each time|every time|on every occasion|when|at the time|after|following|once)\b/i;
const SLOT =
  /\b(parameter|argument|field|value|input|option|flag|query|path|address|recipient|destination|url|name|id|key|list|message|body|content|command)\b/i;
const SELF_PRECONDITION =
  /\b(before|prior to|ahead of|when|whenever|while|each time|every time|any time|at the time|on every occasion|in case)\b[^.\n]{0,12}\b(us|call|invok|runn?|execut|trigger|query)\w*\s+(the\s+)?this tool\b|\b(before|prior to|ahead of)\b[^.\n]{0,25}\bthis tool\b/i;
const UNIVERSAL =
  /\b(always|each time|every time|any time|all|every|any|on every occasion|at all times|in all cases|automatically|by default)\b/i;
const REWRITE_VERB =
  /\b(replace|rewrite|change|modify|append|prepend|insert|override|alter|redirect|reroute|substitute|swap|force|inject|attach)\w*\b/i;
const CONSEQUENCE =
  /\b(failure to|failing to|skipping|omitting|not doing so|otherwise|without (this|doing|it))\b[^.\n]{0,70}\b(will|may|can|could|would|might)\b[^.\n]{0,50}\b(fail|crash|corrupt|error|disrupt|break|block|reject|loss|lose|unstable|denied|inaccessible|breach|invalid)/i;
const INSTRUCTION_TALK =
  /\b(previous|prior|above|earlier|preceding|other|original|system) (instructions?|prompts?|directives?|guidelines?)\b|\bpriority (is )?higher\b|\btakes? (precedence|priority)\b|\bsupersed\w+\b|\bdo the following\b|\bnew instructions?\b/i;
const SELF_TRIGGER =
  /\b(when|whenever|before|after|each time|every time|any time|at the time|ahead of|following|on every occasion)\b[^.\n]{0,30}\b(this tool|it)\b[^.\n]{0,20}\b(is |gets )?(us|call|invok|run|execut)/i;
const SELF_CALL =
  /\b(call|run|use|invoke|trigger|execute|employ)\w*\s+(the\s+)?this tool\b[^.\n]{0,60}\b(with|on|using|where|for)\b/i;
const SELF_USAGE =
  /\b(call|use|run|invoke)\s+(this|it)( tool| function)?\s+(before|after|prior to|when|whenever|first)\b/i;
const SIBLING_CONDITION_HEAD =
  "\\b(?:before|prior to|ahead of|when|whenever|any time|each time|every time|while|after|following|if|once|at the time|in case|on every occasion)\\b[^.\\n]{0,40}?";

/**
 * 신호와 점수. 점수는 2026-10-05 실측에서 로지스틱 회귀(가중치 0 이상 제약)로 구해 10 을 곱해 반올림한 값이다.
 * 학습 자료는 MCPTox 서버의 절반(이름순 짝수 번째)의 악성 사례 777건 × 변형 8종과 정상 도구 512개다.
 * 음수 가중치를 금지한 것은 공격자가 문구를 더해 점수를 낮추는 길을 막기 위해서다.
 */
export const STEERING_SIGNALS: readonly SteeringSignal[] = [
  { id: "instruction-talk", points: 26, phrase: "이전 지시·우선순위 언급" },
  { id: "carrier", points: 24, phrase: "인자 없는 도구의 다른 도구 지시" },
  { id: "self-precondition", points: 22, phrase: "이 도구 사용 전후의 조건" },
  { id: "consequence", points: 19, phrase: "불이행 시 실패 경고" },
  { id: "value-rewrite", points: 15, phrase: "정해 준 문자열로 값 교체" },
  { id: "sibling-condition", points: 13, phrase: "다른 도구 사용 조건" },
  { id: "pretext", points: 13, phrase: "보안·규정 명분" },
  { id: "ordered-directive", points: 13, phrase: "순서 지시" },
  { id: "external-address", points: 12, phrase: "서버와 무관한 주소" },
  { id: "universal-rewrite", points: 11, phrase: "언제나 값 교체" },
  { id: "credential", points: 10, phrase: "자격 증명 언급" },
  { id: "directive-dense", points: 10, phrase: "지시문 비율 40% 이상" },
  { id: "self-call-literal", points: 9, phrase: "정해 준 값으로 이 도구 호출" },
  { id: "credential-path", points: 8, phrase: "자격 증명 파일 경로" },
  { id: "directive", points: 8, phrase: "의무 표현 지시" },
  { id: "pretext-directive", points: 7, phrase: "명분을 댄 지시" },
  { id: "self-rewrite", points: 7, phrase: "이 도구의 값 교체" },
  { id: "self-trigger", points: 6, phrase: "이 도구 호출 조건" },
  { id: "payload", points: 5, phrase: "명령·코드 조각" },
];

/** 점수가 이 값 이상이면 그 심각도다. 개발용 정상 도구 512개 중 1% 와 5% 만 넘는 값으로 정했다. */
export const STEERING_THRESHOLDS: { readonly medium: 35; readonly low: 22 } = {
  medium: 35,
  low: 22,
};

const hostOf = (text: string) =>
  (/^https?:\/\/([^/:\s]+)/i.exec(text)?.[1] ?? text.split("@").pop() ?? "").toLowerCase();
const propertiesOf = (tool: RawTool): string[] => {
  const schema = tool.inputSchema;
  const properties =
    typeof schema === "object" && schema !== null
      ? (schema as { readonly properties?: unknown }).properties
      : undefined;
  return typeof properties === "object" && properties !== null ? Object.keys(properties) : [];
};
const descriptionOf = (tool: RawTool) =>
  typeof tool.description === "string" ? tool.description : "";

/**
 * 도구 하나의 설명에서 신호를 찾는다. 돌려주는 Map 은 신호 id → 그 신호가 처음 걸린 문장(설명 전체에서 걸린
 * 신호는 설명 전체)이다. `tools` 는 같은 서버의 도구 전부, `serverName` 은 서버 이름이다.
 */
export function steeringSignals(
  tool: RawTool,
  tools: readonly RawTool[],
  serverName: string,
): Map<string, string> {
  const text = descriptionOf(tool);
  const found = new Map<string, string>();
  const mark = (id: string, fragment: string) => {
    if (!found.has(id)) found.set(id, fragment);
  };
  if (text === "") return found;

  const ownName = tool.name.toLowerCase();
  const siblingNames = [...new Set(tools.map((t) => t.name))].filter(
    (n) => n.toLowerCase() !== ownName,
  );
  const siblingSet = new Set(siblingNames.map((n) => n.toLowerCase()));
  const own = propertiesOf(tool);
  const refs = siblingNames
    .map((n) => nameSource(n))
    .filter((source): source is string => source !== null && new RegExp(source, "i").test(text));

  if (refs.length > 0 && own.length === 0) mark("carrier", text);
  if (CRED.test(text)) mark("credential", CRED.exec(text)?.[0] ?? text);
  if (CRED_PATH.test(text)) mark("credential-path", CRED_PATH.exec(text)?.[0] ?? text);
  if (PAYLOAD.test(text)) mark("payload", PAYLOAD.exec(text)?.[0] ?? text);

  // 서버 이름에도, 같은 서버의 다른 도구 설명에도 나오지 않는 호스트. 예시용 주소(example.com 류, localhost)는 뺀다.
  const vendorText = `${serverName} ${tools
    .filter((t) => t.name !== tool.name)
    .map(descriptionOf)
    .join(" ")}`.toLowerCase();
  const vendorTokens = nameTokens(serverName)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 4);
  for (const match of text.matchAll(URL_OR_EMAIL)) {
    const host = hostOf(match[0]);
    const base = host.split(".").slice(-2).join(".");
    if (/^(localhost|127\.)/.test(host) || /example\.(com|org|net)$/.test(host)) continue;
    if (vendorText.includes(base) || vendorTokens.some((t) => host.includes(t))) continue;
    mark("external-address", match[0]);
  }

  const sentences = splitSentences(text);
  let directives = 0;
  for (const sentence of sentences) {
    const directive = DIRECTIVE.test(sentence);
    if (directive) {
      directives += 1;
      mark("directive", sentence);
    }
    const literals = [...sentence.matchAll(LITERAL)]
      .map((m) => (m[2] ?? "").trim())
      .filter((l) => !siblingSet.has(l.toLowerCase()));
    const hasLiteral = literals.length > 0 || /\b(to|as|with|of)\s+\d+\b/.test(sentence);
    const ownParam = own.some(
      (p) =>
        p.length >= 3 &&
        new RegExp(`(?<![A-Za-z0-9_])${esc(p)}(?![A-Za-z0-9_])`, "i").test(sentence),
    );
    const rewrite = REWRITE_VERB.test(sentence);

    // "Call this before run_query" 처럼 이 도구 자신을 언제 부를지 말하는 문장은 자기 사용법이라 뺀다.
    if (
      !SELF_USAGE.test(sentence) &&
      refs.some((source) => new RegExp(SIBLING_CONDITION_HEAD + source, "i").test(sentence))
    )
      mark("sibling-condition", sentence);
    if (PRETEXT.test(sentence)) {
      mark("pretext", sentence);
      if (directive) mark("pretext-directive", sentence);
    }
    if (ORDER.test(sentence) && directive) mark("ordered-directive", sentence);
    if (SELF_TRIGGER.test(sentence)) mark("self-trigger", sentence);
    if (SELF_PRECONDITION.test(sentence)) mark("self-precondition", sentence);
    if (/\bthis tool\b/i.test(sentence) && rewrite && (hasLiteral || ownParam))
      mark("self-rewrite", sentence);
    if (UNIVERSAL.test(sentence) && rewrite && (hasLiteral || ownParam || SLOT.test(sentence)))
      mark("universal-rewrite", sentence);
    if (rewrite && hasLiteral) mark("value-rewrite", sentence);
    if (SELF_CALL.test(sentence) && (hasLiteral || /\w+\s*=\s*\w/.test(sentence)) && directive)
      mark("self-call-literal", sentence);
    if (CONSEQUENCE.test(sentence)) mark("consequence", sentence);
    if (INSTRUCTION_TALK.test(sentence)) mark("instruction-talk", sentence);
  }
  if (sentences.length > 0 && directives / sentences.length >= 0.4) mark("directive-dense", text);
  return found;
}

/** 걸린 신호의 점수 합. */
export function steeringScore(found: ReadonlyMap<string, string>): number {
  return STEERING_SIGNALS.reduce(
    (sum, signal) => sum + (found.has(signal.id) ? signal.points : 0),
    0,
  );
}

/** 설명 전체에 붙는 신호. 근거 문장을 고를 때는 세지 않는다. */
const WHOLE_TEXT_SIGNALS = new Set(["carrier", "directive-dense"]);

/**
 * 근거로 보일 조각. 신호가 처음 걸린 문장마다 점수를 더해 합이 가장 큰 문장을 고른다. 합이 같으면 점수표에서
 * 먼저 나오는 신호의 문장이다. 문장에 붙은 신호가 하나도 없으면(설명 전체 신호뿐이면) 설명 자체다.
 */
function steeringFragment(found: ReadonlyMap<string, string>, description: string): string {
  const totals = new Map<string, number>();
  for (const signal of STEERING_SIGNALS) {
    const fragment = found.get(signal.id);
    if (fragment === undefined || WHOLE_TEXT_SIGNALS.has(signal.id)) continue;
    totals.set(fragment, (totals.get(fragment) ?? 0) + signal.points);
  }
  let best = description;
  let bestTotal = -1;
  for (const [fragment, total] of totals) {
    if (total > bestTotal) {
      best = fragment;
      bestTotal = total;
    }
  }
  return best;
}

const FIX = {
  medium:
    "도구 설명은 그 도구가 하는 일만 말해야 합니다. 이 서버를 신뢰하지 않는다면 등록하지 마세요. 서버 작성자라면 호출 순서나 인자 값을 정하는 문장을 설명에서 빼세요.",
  low: "정상 서버의 사용 안내도 이렇게 보일 수 있습니다. 근거 문장이 이 도구의 사용법인지, 다른 도구나 인자 값을 정하는 지시인지 읽어 보세요.",
};
const LABEL = { medium: "주의", low: "낮음" };

/** `desc/steering`. 도구마다 설명의 신호 점수를 내고, 기준 이상이면 발견 하나를 낸다. 도구 순서대로다. */
export function runSteeringRules(
  tools: readonly RawTool[],
  context: { serverName: string },
): Finding[] {
  const findings: Finding[] = [];
  for (const [toolIndex, tool] of tools.entries()) {
    const found = steeringSignals(tool, tools, context.serverName);
    const score = steeringScore(found);
    const severity =
      score >= STEERING_THRESHOLDS.medium
        ? "medium"
        : score >= STEERING_THRESHOLDS.low
          ? "low"
          : undefined;
    if (severity === undefined) continue;
    const hit = STEERING_SIGNALS.filter((signal) => found.has(signal.id));
    const shown = hit
      .slice(0, 3)
      .map((signal) => signal.phrase)
      .join(", ");
    const rest = hit.length > 3 ? ` 외 ${hit.length - 3}개` : "";
    const fragment = evidenceFragment(steeringFragment(found, descriptionOf(tool)));
    findings.push({
      ruleId: "desc/steering",
      severity,
      location: { kind: "tool", toolIndex, toolName: tool.name, path: "description" },
      message: `모델의 도구 사용을 조종하는 문장이 있습니다: "${fragment}" (근거: ${shown}${rest}. 점수 ${score}, ${LABEL[severity]} 기준 ${STEERING_THRESHOLDS[severity]})`,
      fix: FIX[severity],
      evidence: [fragment, hit.map((signal) => signal.id).join(","), String(score)],
    });
  }
  return findings;
}

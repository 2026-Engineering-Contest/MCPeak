import { BlockList, isIP } from "node:net";
import { normalizeText } from "../text/normalize.js";
import type {
  CanaryValue,
  Finding,
  Location,
  Observation,
  ObservedRequest,
  RuleInfo,
  SandboxNetworkMode,
  SandboxPhase,
  TextForm,
} from "../types.js";
import { findForm, type Needle, needlesFor } from "./secret.js";

/** `network` 가족의 규칙 목록. 조건과 심각도는 계획서 §3.4 의 표다. */
export const NETWORK_RULES: readonly RuleInfo[] = [
  {
    id: "network/canary-exfiltration",
    family: "network",
    defaultSeverity: "high",
    summary: "심어 둔 카나리 값이 나가는 요청이나 이름 조회에 실리는지 본다.",
  },
  {
    id: "network/undeclared-destination",
    family: "network",
    defaultSeverity: "medium",
    summary: "서버 문서와 --allow-host 에 없는 호스트로 접속하는지 본다.",
  },
  {
    id: "network/declared-destination",
    family: "network",
    defaultSeverity: "info",
    summary: "선언된 호스트로 간 접속을 기록한다.",
  },
  {
    id: "network/internal-destination",
    family: "network",
    defaultSeverity: "medium",
    summary: "바깥 이름이 내부 주소로 풀려 전달하지 않은 요청이 있는지 본다.",
  },
  {
    id: "network/pinned-certificate",
    family: "network",
    defaultSeverity: "info",
    summary: "점검용 인증서를 거부해 내용을 보지 못한 접속을 기록한다.",
  },
  {
    id: "network/replay-miss",
    family: "network",
    defaultSeverity: "medium",
    summary: "재생 실행에서 녹화에 없는 요청이 나오는지 본다.",
  },
  {
    id: "network/direct-ip",
    family: "network",
    defaultSeverity: "medium",
    summary: "이름 조회 없이 IP 주소로 직접 접속하는지 본다.",
  },
] as const;

export interface NetworkContext {
  readonly observation: Observation;
  readonly declaredHosts: readonly string[];
  readonly canaries: readonly CanaryValue[];
  readonly mode: SandboxNetworkMode;
}

const GATEWAY = "<gateway>";

/** 계획서 §3.4 의 내부 주소 표. IPv4 로 사상된 IPv6 주소(`::ffff:10.0.0.1`)도 IPv4 행에 걸린다. */
const INTERNAL_ADDRESSES = new BlockList();
INTERNAL_ADDRESSES.addSubnet("10.0.0.0", 8, "ipv4");
INTERNAL_ADDRESSES.addSubnet("172.16.0.0", 12, "ipv4");
INTERNAL_ADDRESSES.addSubnet("192.168.0.0", 16, "ipv4");
INTERNAL_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4");
INTERNAL_ADDRESSES.addSubnet("169.254.0.0", 16, "ipv4");
INTERNAL_ADDRESSES.addAddress("::1", "ipv6");
INTERNAL_ADDRESSES.addSubnet("fc00::", 7, "ipv6");
INTERNAL_ADDRESSES.addSubnet("fe80::", 10, "ipv6");

function isInternalAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false;
  return INTERNAL_ADDRESSES.check(address, version === 4 ? "ipv4" : "ipv6");
}

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const uniqueSorted = (values: readonly string[]) => [...new Set(values)].sort(compareText);

/** message 에 싣는 경로의 상한(§6.2 의 "path 앞 80자"). */
const PATH_LIMIT = 80;
const head = (text: string) => [...text].slice(0, PATH_LIMIT).join("");

/** 대조용 호스트 이름. 소문자이고 끝의 점이 없다. */
const normalizeHost = (host: string) => host.toLowerCase().replace(/\.$/, "");

/**
 * 선언 목록과의 맞춤(§3.6). 정확히 같거나, `*.` 항목이면 레이블 경계의 뒤 일치다.
 * `*.example.com` 은 `api.example.com` 을 덮고 `evil-example.com` 과 `example.com` 은 덮지 않는다.
 */
function isDeclared(host: string, declaredHosts: readonly string[]): boolean {
  return declaredHosts.some((entry) => {
    const declared = entry.toLowerCase();
    return declared.startsWith("*.") ? host.endsWith(declared.slice(1)) : host === declared;
  });
}

type CallPhase = Extract<SandboxPhase, { kind: "call" }>;

const PHASE_LABELS: Readonly<Record<Exclude<SandboxPhase["kind"], "call">, string>> = {
  start: "시작",
  list: "목록",
  shutdown: "종료",
};

/**
 * 호출의 차례. 계획 순서는 관측에 실려 오지 않고 입력 순서에도 기대지 않으므로(§4), 도구 번호 다음에
 * 자리값 호출(`placeholder`, 계획의 첫 호출)을 앞에 두고 나머지는 이름의 코드 단위 순으로 세운다.
 */
function compareCalls(left: CallPhase, right: CallPhase): number {
  return (
    left.toolIndex - right.toolIndex ||
    Number(left.callId !== "placeholder") - Number(right.callId !== "placeholder") ||
    compareText(left.callId, right.callId)
  );
}

const callsOf = (phases: readonly SandboxPhase[]) =>
  phases.filter((phase): phase is CallPhase => phase.kind === "call").sort(compareCalls);

/** 접는 키의 "도구" 자리. 호출이 아닌 단계는 전부 `server` 다(§3.4). */
const toolKey = (phase: SandboxPhase) =>
  phase.kind === "call" ? `call:${phase.toolIndex}` : "server";

const SERVER: Location = { kind: "server", path: "" };

/** 접힌 발견의 위치. 첫 호출이고, 호출이 아닌 단계의 관측이면 서버 전체다. */
function locate(phases: readonly SandboxPhase[]): Location {
  const first = callsOf(phases)[0];
  if (first === undefined) return SERVER;
  return {
    kind: "call",
    toolIndex: first.toolIndex,
    toolName: first.toolName,
    callId: first.callId,
    path: "",
  };
}

/** `evidence` 의 둘째 칸. `호출: <callId>, …` 이고, 호출이 하나도 없으면 `단계: <이름>, …` 이다. */
function describePhases(phases: readonly SandboxPhase[]): string {
  const calls = callsOf(phases);
  if (calls.length > 0) return `호출: ${[...new Set(calls.map((call) => call.callId))].join(", ")}`;
  const labels = Object.entries(PHASE_LABELS)
    .filter(([kind]) => phases.some((phase) => phase.kind === kind))
    .map(([, label]) => label);
  return `단계: ${labels.join(", ")}`;
}

/** §3.4 의 `evidence` 형식. 대상, 호출 또는 단계, 나머지 둘까지, 더 있으면 `외 <n>개`. */
function evidenceOf(
  subject: string,
  phases: readonly SandboxPhase[],
  rest: readonly string[],
): string[] {
  const shown = rest.slice(0, 2);
  const hidden = rest.length - shown.length;
  return [subject, describePhases(phases), ...shown, ...(hidden > 0 ? [`외 ${hidden}개`] : [])];
}

interface Matcher {
  readonly canary: CanaryValue;
  /** 값 대신 출력에 쓰는 자리표. */
  readonly placeholder: string;
  readonly needles: readonly Needle[];
  /** `normalizeText` 가 만든 형들과 대조할, 같은 방식으로 접은 값. */
  readonly folded: string;
}

const foldedOf = (text: string) =>
  normalizeText(text).forms.find((entry) => entry.form === "folded")?.text ?? "";

const PERCENT_RUN = /(?:%[0-9a-f]{2})+/gi;

/** 퍼센트 인코딩을 푼 것. 풀리지 않는 조각은 그대로 둔다. */
function percentDecoded(text: string): string {
  return text.replace(PERCENT_RUN, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/** 대조할 꼴들. 받은 그대로와, 다르면 퍼센트 인코딩을 푼 것. */
function variantsOf(text: string): string[] {
  const decoded = percentDecoded(text);
  return decoded === text ? [text] : [text, decoded];
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly placeholder: string;
}

/** 바늘 옆에 붙어 있는 같은 토큰의 글자. 인코딩된 값의 가장자리가 출력에 남지 않게 함께 가린다. */
const TOKEN_BEFORE = /(?:[a-z0-9+_-]|%[0-9a-f]{2})*$/i;
const TOKEN_AFTER = /^(?:[a-z0-9+_-]|%[0-9a-f]{2})*=*/i;
/** base64 는 `/` 도 알파벳이다. */
const BASE64_BEFORE = /(?:[a-z0-9+/_-]|%[0-9a-f]{2})*$/i;
const BASE64_AFTER = /^(?:[a-z0-9+/_-]|%[0-9a-f]{2})*=*/i;

/**
 * 카나리 대조와, 출력에 싣는 문자열에서 카나리를 가리는 일을 한데 묶는다. 값 쪽을 인코딩한 바늘
 * (`needlesFor`)로 먼저 찾고, 못 찾으면 요청 쪽을 `normalizeText` 로 풀어(보이지 않는 문자 제거,
 * base64·hex 디코딩) 접은 값과 대조한다.
 */
class CanaryScanner {
  readonly matchers: readonly Matcher[];
  private readonly normalized = new Map<string, ReadonlyArray<{ form: TextForm; text: string }>>();

  constructor(canaries: readonly CanaryValue[]) {
    this.matchers = canaries
      .filter((canary) => canary.value !== "")
      .map((canary) => ({
        canary,
        placeholder: `<canary:${canary.name}>`,
        needles: needlesFor(canary.value),
        folded: foldedOf(canary.value),
      }))
      .sort(
        (left, right) =>
          compareText(left.canary.origin, right.canary.origin) ||
          compareText(left.canary.name, right.canary.name),
      );
  }

  private formsOf(text: string) {
    let forms = this.normalized.get(text);
    if (forms === undefined) {
      forms = normalizeText(text).forms.filter((entry) => entry.form !== "raw");
      this.normalized.set(text, forms);
    }
    return forms;
  }

  /** 문자열에 그 카나리가 실려 있으면 찾은 형. */
  detect(text: string, matcher: Matcher): TextForm | undefined {
    if (text === "") return undefined;
    const variants = variantsOf(text);
    for (const variant of variants) {
      const form = findForm(variant, matcher.needles);
      if (form !== undefined) return form;
    }
    if (matcher.folded === "") return undefined;
    for (const variant of variants) {
      for (const entry of this.formsOf(variant)) {
        if (entry.text.includes(matcher.folded)) return entry.form;
      }
    }
    return undefined;
  }

  /** 바늘이 나온 자리들. */
  private spansIn(text: string, widen: boolean): Span[] {
    const lower = text.toLowerCase();
    // 소문자로 바꿀 때 길이가 달라지는 글자가 있으면 자리가 어긋난다. 그때는 대소문자를 가려 찾는다.
    const insensitive = lower.length === text.length;
    const spans: Span[] = [];
    for (const matcher of this.matchers) {
      for (const needle of matcher.needles) {
        const fold = needle.caseInsensitive && insensitive;
        const haystack = fold ? lower : text;
        const target = fold ? needle.text.toLowerCase() : needle.text;
        if (target === "") continue;
        for (let at = haystack.indexOf(target); at !== -1; at = haystack.indexOf(target, at + 1)) {
          let start = at;
          let end = at + target.length;
          if (widen) {
            const base64 = needle.form === "base64";
            const before = (base64 ? BASE64_BEFORE : TOKEN_BEFORE).exec(text.slice(0, start));
            const after = (base64 ? BASE64_AFTER : TOKEN_AFTER).exec(text.slice(end));
            start -= before?.[0].length ?? 0;
            end += after?.[0].length ?? 0;
          }
          spans.push({ start, end, placeholder: matcher.placeholder });
        }
      }
    }
    return spans.sort((left, right) => left.start - right.start || right.end - left.end);
  }

  /** 가린 뒤에도 카나리가 찾아지면 문자열을 통째로 자리표로 바꾼다. 값이 출력에 남는 길을 막는다. */
  private verified(shown: string, compact: (text: string) => string): string {
    const found = this.matchers.filter(
      (matcher) => this.detect(compact(shown), matcher) !== undefined,
    );
    return found.length === 0 ? shown : found.map((matcher) => matcher.placeholder).join(" ");
  }

  /** 경로처럼 출력에 싣는 문자열. 카나리가 실린 토큰을 `<canary:NAME>` 으로 바꾼다. */
  safeText(text: string): string {
    for (const variant of variantsOf(text)) {
      const spans = this.spansIn(variant, true);
      if (spans.length === 0) continue;
      let shown = "";
      let cursor = 0;
      for (const span of spans) {
        if (span.start < cursor) continue;
        shown += variant.slice(cursor, span.start) + span.placeholder;
        cursor = span.end;
      }
      return this.verified(shown + variant.slice(cursor), (value) => value);
    }
    return this.verified(text, (value) => value);
  }

  /**
   * 출력에 싣는 호스트 이름. 카나리는 레이블 여럿에 나뉘어 실릴 수 있어서 점을 빼고 찾고, 바늘이
   * 걸친 레이블을 통째로 자리표 하나로 바꾼다.
   */
  safeHost(host: string): string {
    const labels = host.split(".");
    const owner = labels.flatMap((label, index) => Array<number>(label.length).fill(index));
    const marks = new Map<number, string>();
    for (const span of this.spansIn(labels.join(""), false)) {
      const first = owner[span.start];
      const last = owner[span.end - 1];
      if (first === undefined || last === undefined) continue;
      for (let index = first; index <= last; index += 1) {
        if (!marks.has(index)) marks.set(index, span.placeholder);
      }
    }
    const shown: string[] = [];
    labels.forEach((label, index) => {
      const mark = marks.get(index);
      if (mark === undefined) shown.push(label);
      else if (marks.get(index - 1) !== mark) shown.push(mark);
    });
    return this.verified(shown.join("."), withoutDots);
  }
}

const withoutDots = (name: string) => name.replaceAll(".", "");

interface CanaryHit {
  readonly phase: SandboxPhase;
  readonly matcher: Matcher;
  /** 가린 호스트 이름. */
  readonly host: string;
  /** 채널의 차례. URL, 헤더, 본문, 이름 조회 순이다. */
  readonly rank: number;
  readonly channel: string;
  readonly form: TextForm;
}

/** 요청 하나에서 카나리를 찾을 자리(§3.4). 경로·쿼리, 헤더 값, 본문. */
function channelsOf(request: ObservedRequest, scanner: CanaryScanner) {
  return [
    { rank: 0, channel: "요청의 URL", text: request.path },
    ...request.headers.map(([name, value]) => ({
      rank: 1,
      channel: `요청의 헤더 '${scanner.safeText(name)}'`,
      text: value,
    })),
    {
      rank: 2,
      channel: "요청의 본문",
      text: Buffer.from(request.bodyBase64, "base64").toString("utf8"),
    },
  ];
}

function findCanaryHits(context: NetworkContext, scanner: CanaryScanner): CanaryHit[] {
  if (scanner.matchers.length === 0) return [];
  const hits: CanaryHit[] = [];
  for (const request of context.observation.requests) {
    const host = scanner.safeHost(normalizeHost(request.host));
    for (const { rank, channel, text } of channelsOf(request, scanner)) {
      for (const matcher of scanner.matchers) {
        const form = scanner.detect(text, matcher);
        if (form !== undefined)
          hits.push({ phase: request.phase, matcher, host, rank, channel, form });
      }
    }
  }
  for (const { phase, name } of context.observation.dnsNames) {
    const normalized = normalizeHost(name);
    for (const matcher of scanner.matchers) {
      const form = scanner.detect(withoutDots(normalized), matcher);
      if (form === undefined) continue;
      const host = scanner.safeHost(normalized);
      hits.push({ phase, matcher, host, rank: 3, channel: "이름 조회", form });
    }
  }
  return hits;
}

/** 접는 키마다 모은 관측. */
interface Bucket<T> {
  readonly phases: SandboxPhase[];
  readonly items: T[];
}

function collect<T>(buckets: Map<string, Bucket<T>>, key: readonly string[], phase: SandboxPhase) {
  const id = JSON.stringify(key);
  let bucket = buckets.get(id);
  if (bucket === undefined) {
    bucket = { phases: [], items: [] };
    buckets.set(id, bucket);
  }
  bucket.phases.push(phase);
  return bucket.items;
}

interface RequestLine {
  readonly method: string;
  readonly path: string;
}

const lineText = (line: RequestLine) => `${line.method} ${line.path}`;

/** 요청 줄을 중복 없이 정렬한 것. 첫째가 message 에, 나머지가 evidence 에 실린다. */
function sortedLines(lines: readonly RequestLine[]): RequestLine[] {
  const byText = new Map(lines.map((line) => [lineText(line), line]));
  return [...byText.keys()].sort(compareText).flatMap((text) => byText.get(text) ?? []);
}

const canaryLabel = (canary: CanaryValue) =>
  canary.origin === "env" ? `환경변수 ${canary.name}` : `파일 ${canary.name}`;

const undeclaredFix = (host: string) =>
  `서버 문서에 없는 목적지입니다. 의도된 접속이면 --allow-host ${host} 로 선언하세요. 아니면 등록하지 마세요.`;

const toolIndexOf = (location: Location) => (location.kind === "call" ? location.toolIndex : -1);

/** `finalize` 와 같은 정렬 키. 입력 순서와 무관한 출력을 만든다. */
function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (left, right) =>
      toolIndexOf(left.location) - toolIndexOf(right.location) ||
      compareText(left.ruleId, right.ruleId) ||
      compareText(left.evidence[0] ?? "", right.evidence[0] ?? "") ||
      compareText(JSON.stringify(left.location), JSON.stringify(right.location)) ||
      compareText(left.message, right.message),
  );
}

/**
 * `network` 가족의 판정(§3.4). 순수 함수이고 시각과 입력 순서에 기대지 않는다. 출력에 싣는 호스트와
 * 경로는 전부 카나리를 가린 것이다. 서버가 값을 호스트 이름이나 쿼리에 실어 보내면 그 문자열이
 * 그대로 message 에 들어가기 때문이다.
 */
export function runNetworkRules(context: NetworkContext): Finding[] {
  const { observation, declaredHosts } = context;
  const scanner = new CanaryScanner(context.canaries);
  const findings: Finding[] = [];

  // canary-exfiltration: (도구, 호스트, 카나리)로 접는다.
  const exfiltrations = new Map<string, Bucket<CanaryHit>>();
  for (const hit of findCanaryHits(context, scanner)) {
    const { canary } = hit.matcher;
    collect(
      exfiltrations,
      [toolKey(hit.phase), hit.host, canary.origin, canary.name],
      hit.phase,
    ).push(hit);
  }
  for (const { phases, items } of exfiltrations.values()) {
    const sorted = [...items].sort(
      (left, right) =>
        left.rank - right.rank ||
        compareText(left.channel, right.channel) ||
        compareText(left.form, right.form),
    );
    const first = sorted[0];
    if (first === undefined) continue;
    const channels = [...new Set(sorted.map((hit) => `${hit.channel}: ${hit.form}`))];
    findings.push({
      ruleId: "network/canary-exfiltration",
      severity: "high",
      location: locate(phases),
      message: `${canaryLabel(first.matcher.canary)} 에 심은 값이 ${first.host} 로 가는 ${first.channel} 에 실렸습니다 (${first.form} 형에서 발견)`,
      fix: "서버가 자격 증명을 밖으로 보냅니다. 등록하지 마세요.",
      evidence: evidenceOf(`${first.host} ${first.matcher.placeholder}`, phases, channels),
    });
  }

  // 요청과 인증서 거부를 목적지별로 모은다.
  const undeclared = new Map<string, Bucket<RequestLine>>();
  const declared = new Map<string, Bucket<RequestLine>>();
  const internal = new Map<string, Bucket<RequestLine>>();
  const replayMisses = new Map<string, Bucket<RequestLine>>();
  const pinned = new Map<string, Bucket<never>>();

  for (const request of observation.requests) {
    const host = normalizeHost(request.host);
    const shownHost = scanner.safeHost(host);
    const line = { method: request.method, path: head(scanner.safeText(request.path)) };
    const byTool = [toolKey(request.phase), shownHost];
    if (isDeclared(host, declaredHosts)) collect(declared, [shownHost], request.phase).push(line);
    else collect(undeclared, byTool, request.phase).push(line);
    if (request.served === "blocked") collect(internal, byTool, request.phase).push(line);
    if (request.served === "replay-miss") collect(replayMisses, byTool, request.phase).push(line);
  }
  for (const rejection of observation.tlsRejections) {
    const host = normalizeHost(rejection.host);
    const shownHost = scanner.safeHost(host);
    collect(pinned, [shownHost], rejection.phase);
    if (!isDeclared(host, declaredHosts))
      collect(undeclared, [toolKey(rejection.phase), shownHost], rejection.phase);
  }

  const hostOf = (key: string) => (JSON.parse(key) as string[]).at(-1) ?? "";

  for (const [key, { phases, items }] of undeclared) {
    const host = hostOf(key);
    const [first, ...rest] = sortedLines(items);
    findings.push({
      ruleId: "network/undeclared-destination",
      severity: "medium",
      location: locate(phases),
      message:
        first === undefined
          ? `선언되지 않은 호스트 ${host} 에 접속했습니다 (인증서 고정이라 내용은 보지 못했습니다)`
          : `선언되지 않은 호스트 ${host} 에 접속했습니다: ${lineText(first)}`,
      fix: undeclaredFix(host),
      evidence: evidenceOf(host, phases, rest.map(lineText)),
    });
  }
  for (const [key, { phases, items }] of declared) {
    const host = hostOf(key);
    findings.push({
      ruleId: "network/declared-destination",
      severity: "info",
      location: SERVER,
      message: `선언된 호스트 ${host} 에 ${items.length}회 접속했습니다`,
      fix: "기록입니다. 조치가 필요 없습니다.",
      evidence: evidenceOf(host, phases, sortedLines(items).map(lineText)),
    });
  }
  for (const [key, { phases, items }] of internal) {
    const host = hostOf(key);
    const [first, ...rest] = sortedLines(items);
    if (first === undefined) continue;
    findings.push({
      ruleId: "network/internal-destination",
      severity: "medium",
      location: locate(phases),
      message: `${host} 가 내부 주소로 풀려 요청을 전달하지 않았습니다: ${lineText(first)}`,
      fix: "바깥 이름이 내부 주소를 가리킵니다. 사내망이나 메타데이터 주소에 닿으려는 모양입니다. 이 호스트가 왜 필요한지 확인하세요.",
      evidence: evidenceOf(host, phases, rest.map(lineText)),
    });
  }
  for (const [key, { phases }] of pinned) {
    const host = hostOf(key);
    findings.push({
      ruleId: "network/pinned-certificate",
      severity: "info",
      location: SERVER,
      message: `${host} 가 점검용 인증서를 거부해 요청 내용을 보지 못했습니다`,
      fix: "인증서 고정을 쓰는 접속입니다. 목적지만 기록됐습니다. 그 호스트를 신뢰할지는 직접 판단하세요.",
      evidence: evidenceOf(host, phases, []),
    });
  }
  for (const [key, { phases, items }] of replayMisses) {
    const host = hostOf(key);
    const [first, ...rest] = sortedLines(items);
    if (first === undefined) continue;
    findings.push({
      ruleId: "network/replay-miss",
      severity: "medium",
      location: locate(phases),
      message: `녹화에 없는 요청이 재생에서 나왔습니다: ${first.method} ${host}${first.path}`,
      fix: "같은 입력에 다른 요청을 보냅니다. 요청이 시각이나 난수에 의존한다는 뜻입니다. 서버가 무엇을 바꿔 보내는지 확인하세요.",
      evidence: evidenceOf(host, phases, rest.map(lineText)),
    });
  }

  // direct-ip: (도구, 주소)로 접는다. 포트가 여럿이면 정렬한 첫째가 message 에 실린다.
  const directs = new Map<string, Bucket<string>>();
  for (const event of observation.events) {
    if (event.kind !== "connect" || event.family === "unix") continue;
    if (event.address === GATEWAY || isInternalAddress(event.address)) continue;
    const address = event.family === "inet6" ? `[${event.address}]` : event.address;
    collect(directs, [toolKey(event.phase), event.address], event.phase).push(
      `${address}:${event.port}`,
    );
  }
  for (const { phases, items } of directs.values()) {
    const [first, ...rest] = uniqueSorted(items);
    if (first === undefined) continue;
    findings.push({
      ruleId: "network/direct-ip",
      severity: "medium",
      location: locate(phases),
      message: `이름 조회 없이 ${first} 에 직접 접속을 시도했습니다`,
      fix: "격리 안이라 닿지 않았습니다. 주소를 코드에 박아 둔 접속은 목적지를 감추는 수법일 수 있습니다.",
      evidence: evidenceOf(first, phases, rest),
    });
  }

  return sortFindings(findings);
}

/** 호출 단계에서 나가는 요청에 실린 카나리. runNetworkRules 와 같은 판정을 쓴다. audit() 이 behavior 에 넘긴다. */
export function exfiltratedCanaries(context: NetworkContext): ReadonlyArray<{
  readonly toolIndex: number;
  readonly name: string;
  readonly origin: "env" | "file";
}> {
  const scanner = new CanaryScanner(context.canaries);
  const found = new Map<string, { toolIndex: number; name: string; origin: "env" | "file" }>();
  for (const { phase, matcher } of findCanaryHits(context, scanner)) {
    if (phase.kind !== "call") continue;
    const { name, origin } = matcher.canary;
    found.set(JSON.stringify([phase.toolIndex, origin, name]), {
      toolIndex: phase.toolIndex,
      name,
      origin,
    });
  }
  return [...found.values()].sort(
    (left, right) =>
      left.toolIndex - right.toolIndex ||
      compareText(left.origin, right.origin) ||
      compareText(left.name, right.name),
  );
}

import type { ServerMessage } from "@mcpeak/core";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { normalizeTextWithSources } from "../text/normalize.js";
import type { AuditTarget, Finding, RuleInfo, Severity, TextForm } from "../types.js";
import {
  COVERT_ACTION_PATTERNS,
  evidenceFragment,
  findInjection,
  SHADOWING_PATTERNS,
} from "./description.js";

export const PROTOCOL_RULES: readonly RuleInfo[] = [
  {
    id: "protocol/plaintext",
    family: "protocol",
    defaultSeverity: "medium",
    summary: "원격 서버에 평문 HTTP 로 연결하는지 본다",
  },
  {
    id: "protocol/unauthenticated",
    family: "protocol",
    defaultSeverity: "medium",
    summary: "인증 헤더 없이도 initialize 를 받아들이는지 본다",
  },
  {
    id: "protocol/origin-check",
    family: "protocol",
    defaultSeverity: "medium",
    summary: "로컬 서버가 임의 Origin 의 요청을 거르는지 본다(DNS 리바인딩)",
  },
  {
    id: "protocol/oauth-endpoint",
    family: "protocol",
    defaultSeverity: "high",
    summary: "OAuth 메타데이터의 엔드포인트가 https 이고 셸 메타문자가 없는지 본다",
  },
  {
    id: "protocol/session-in-url",
    family: "protocol",
    defaultSeverity: "medium",
    summary: "세션 식별자나 토큰이 URL 에 실리는지 본다",
  },
  {
    id: "protocol/server-request",
    family: "protocol",
    defaultSeverity: "info",
    summary: "감사 중 서버가 보낸 샘플링·입력 요청·roots 요청을 센다",
  },
  {
    id: "protocol/server-request-injection",
    family: "protocol",
    defaultSeverity: "high",
    summary: "서버가 보낸 요청 안에 모델 지시가 있는지 본다",
  },
  {
    id: "protocol/list-changed",
    family: "protocol",
    defaultSeverity: "high",
    summary: "감사 중 도구 목록이 바뀌었는지 본다(실시간 러그풀)",
  },
] as const;

export interface ProtocolContext {
  readonly target: AuditTarget;
  readonly fetch: typeof globalThis.fetch;
  readonly serverMessages: readonly ServerMessage[];
  readonly listChanged: {
    readonly notified: boolean;
    readonly surfaceHashBefore: string;
    readonly surfaceHashAfter: string;
  };
}

const PROBE_TIMEOUT_MS = 5000;
const EVIL_ORIGIN = "http://evil.invalid";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const OBSERVED_METHODS = ["sampling/createMessage", "elicitation/create", "roots/list"];
const WELL_KNOWN = ["oauth-protected-resource", "oauth-authorization-server"] as const;
const UNSAFE_ENDPOINT = /[\s;&|`$<>'"]/;
const SESSION_PARAM = /[?&](session|sessionid|session_id|sid|token)=/i;
const SESSION_PARAM_VALUE = /([?&](?:session|sessionid|session_id|sid|token)=)[^&#]*/gi;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>\\]+/g;
const EVIDENCE_MAX = 80;

const UNVERIFIED_FIX =
  "이 항목은 통과가 아니라 미확인입니다. 서버에 닿는지 확인하고 다시 실행하세요.";

/** 프로브 하나의 결과. 판정할 수 없었으면 cause 에 사람용 원인을 담는다. */
type ProbeOutcome =
  | {
      readonly ok: true;
      readonly status: number;
      readonly contentType: string;
      readonly body: string;
    }
  | { readonly ok: false; readonly cause: string };

/** session-in-url 이 볼 URL 하나와 그것을 본 자리. */
interface ObservedUrl {
  readonly url: string;
  readonly source: "Location" | "응답 본문" | "--url";
}

export async function runProtocolRules(context: ProtocolContext): Promise<Finding[]> {
  const findings: Finding[] = [
    ...serverRequestFindings(context.serverMessages),
    ...listChangedFindings(context.listChanged),
  ];
  const url = context.target.kind === "http" ? parseUrl(context.target.url) : undefined;
  if (url !== undefined) {
    findings.push(...(await httpFindings(context, url)));
  }
  return sortFindings(findings);
}

async function httpFindings(context: ProtocolContext, url: URL): Promise<Finding[]> {
  const findings: Finding[] = [];
  const target = url.href;
  const local = LOCAL_HOSTS.has(url.hostname);
  const observed: ObservedUrl[] = [{ url: target, source: "--url" }];
  // 프로브는 하나씩 순서대로 보낸다. 서버 쪽 상태(세션 생성 등)가 실행마다 같은 순서로 쌓이게 하려는 것이다.
  const probe = (input: string, init: RequestInit) => send(context.fetch, input, init, observed);

  if (url.protocol === "http:") {
    findings.push(
      finding(
        "protocol/plaintext",
        local ? "info" : "medium",
        `평문 HTTP 로 연결합니다: ${redactUrl(target)}`,
        local
          ? "로컬호스트 안에서만 오가므로 보통은 괜찮습니다. 외부에 노출한다면 https 를 쓰세요."
          : "토큰과 응답이 네트워크에 그대로 노출됩니다. https 를 쓰세요.",
        [redactUrl(target)],
      ),
    );
  }

  if (context.target.headerNames.length === 0) {
    findings.push(
      finding(
        "protocol/unauthenticated",
        "info",
        "인증 없이 열려 있습니다. 로컬 전용이면 정상입니다",
        "네트워크에 노출할 서버라면 인증을 붙이고 --header-env 로 다시 점검하세요.",
        [redactUrl(target)],
      ),
    );
  } else {
    const outcome = await probe(target, initializeRequest({}));
    const accepted = judgeInitialize(outcome);
    if (accepted.kind === "unverified") {
      findings.push(
        unverified(
          "protocol/unauthenticated",
          "인증 없이 initialize 를 받아들이는지 판정하지 못했습니다",
          accepted.cause,
          redactUrl(target),
        ),
      );
    } else if (accepted.kind === "accepted") {
      findings.push(
        finding(
          "protocol/unauthenticated",
          "medium",
          "인증 헤더 없이도 initialize 를 받아들입니다",
          "서버가 인증을 검사하지 않습니다. 네트워크에 노출된 서버라면 누구나 도구를 부를 수 있습니다.",
          [redactUrl(target), `HTTP ${accepted.status}`],
        ),
      );
    }
  }

  if (local) {
    const outcome = await probe(target, initializeRequest({ origin: EVIL_ORIGIN }));
    const label = "임의 Origin 의 요청을 거르는지 판정하지 못했습니다";
    if (!outcome.ok) {
      findings.push(unverified("protocol/origin-check", label, outcome.cause, redactUrl(target)));
    } else if (isSuccess(outcome.status)) {
      findings.push(
        finding(
          "protocol/origin-check",
          "medium",
          "임의 Origin 의 요청을 받아들입니다",
          "브라우저에서 DNS 리바인딩으로 로컬 서버를 부를 수 있습니다. Origin 을 검사하세요(SDK 2025-07 권고).",
          [redactUrl(target), `Origin: ${EVIL_ORIGIN}`, `HTTP ${outcome.status}`],
        ),
      );
    } else if (outcome.status === 401 && context.target.headerNames.length > 0) {
      // 인증 헤더 값은 감사가 모른다. 401 은 Origin 이 아니라 인증이 막은 것이라 Origin 검사 여부를 알 수 없다.
      findings.push(
        unverified(
          "protocol/origin-check",
          label,
          `인증이 먼저 요청을 막았습니다, HTTP ${outcome.status}`,
          redactUrl(target),
        ),
      );
    }
  }

  for (const name of WELL_KNOWN) {
    const metadataUrl = `${url.origin}/.well-known/${name}`;
    const outcome = await probe(metadataUrl, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!outcome.ok) {
      findings.push(
        unverified(
          "protocol/oauth-endpoint",
          `OAuth 메타데이터 ${metadataUrl} 를 읽지 못했습니다`,
          outcome.cause,
          metadataUrl,
        ),
      );
      continue;
    }
    if (!isSuccess(outcome.status)) continue;
    const metadata = parseJson(outcome.body);
    if (!isRecord(metadata)) continue;
    for (const [field, value] of endpointFields(metadata)) {
      if (value.startsWith("https://") && !UNSAFE_ENDPOINT.test(value)) continue;
      const shown = clip(value);
      findings.push(
        finding(
          "protocol/oauth-endpoint",
          "high",
          `OAuth 메타데이터의 ${field} 가 안전하지 않습니다: ${shown}`,
          "mcp-remote CVE-2025-6514 가 이 값으로 명령 주입을 당했습니다. https 가 아닌 엔드포인트는 쓰지 마세요.",
          [`${name}.${field}`, shown],
        ),
      );
    }
  }

  const reported = new Set<string>();
  for (const seen of observed) {
    const shown = clip(redactUrl(seen.url));
    if (!SESSION_PARAM.test(seen.url) || reported.has(shown)) continue;
    reported.add(shown);
    findings.push(
      finding(
        "protocol/session-in-url",
        "medium",
        "세션 식별자가 URL 에 실립니다",
        "URL 은 로그와 히스토리에 남습니다. 헤더로 옮기세요.",
        [shown, seen.source],
      ),
    );
  }

  return findings;
}

/** 프로브를 보내고, 응답의 Location 과 본문 URL 을 observed 에 모은다. 던지면 원인 문장으로 바꾼다. */
async function send(
  fetch: typeof globalThis.fetch,
  input: string,
  init: RequestInit,
  observed: ObservedUrl[],
): Promise<ProbeOutcome> {
  try {
    const response = await fetch(input, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await response.text();
    const location = response.headers.get("location");
    if (location !== null) observed.push({ url: location, source: "Location" });
    for (const match of body.matchAll(URL_IN_TEXT)) {
      observed.push({ url: match[0], source: "응답 본문" });
    }
    return {
      ok: true,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body,
    };
  } catch (error) {
    return { ok: false, cause: describeFailure(error) };
  }
}

function describeFailure(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "TimeoutError") return `${PROBE_TIMEOUT_MS}ms 안에 응답이 없습니다`;
  const message =
    error instanceof Error || error instanceof DOMException ? error.message : String(error);
  return `요청 실패: ${message.split("\n")[0] ?? ""}`;
}

/** 감사 클라이언트가 보내는 것과 같은 꼴의 initialize. 값은 고정이라 실행마다 같은 바이트다. */
function initializeRequest(extraHeaders: Readonly<Record<string, string>>): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mcpeak-audit", version: "0.0.0" },
      },
    }),
  };
}

type InitializeJudgement =
  | { readonly kind: "accepted"; readonly status: number }
  | { readonly kind: "rejected" }
  | { readonly kind: "unverified"; readonly cause: string };

/** 2xx 에 JSON-RPC result 가 있으면 받아들인 것이다. 2xx 인데 읽을 수 없으면 판정 불가다. */
function judgeInitialize(outcome: ProbeOutcome): InitializeJudgement {
  if (!outcome.ok) return { kind: "unverified", cause: outcome.cause };
  if (!isSuccess(outcome.status)) return { kind: "rejected" };
  const messages = outcome.contentType.includes("text/event-stream")
    ? sseMessages(outcome.body)
    : [parseJson(outcome.body)];
  const answered = messages.some((message) => isRecord(message) && "result" in message);
  if (answered) return { kind: "accepted", status: outcome.status };
  const hasError = messages.some((message) => isRecord(message) && "error" in message);
  if (hasError) return { kind: "rejected" };
  return {
    kind: "unverified",
    cause: `HTTP ${outcome.status} 응답이 JSON-RPC 결과가 아닙니다`,
  };
}

/** text/event-stream 본문에서 이벤트마다 data 줄을 이어 JSON 으로 읽는다. */
function sseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data !== "") messages.push(parseJson(data));
  }
  return messages;
}

/** 검사 대상 필드를 [표시 이름, 값] 으로. 문자열이 아닌 값은 보지 않는다. */
function endpointFields(metadata: Record<string, unknown>): [string, string][] {
  const fields: [string, string][] = [];
  for (const key of ["authorization_endpoint", "token_endpoint"]) {
    const value = metadata[key];
    if (typeof value === "string") fields.push([key, value]);
  }
  const servers = metadata.authorization_servers;
  if (Array.isArray(servers)) {
    servers.forEach((value, index) => {
      if (typeof value === "string") fields.push([`authorization_servers[${index}]`, value]);
    });
  }
  return fields;
}

/**
 * 세 메서드의 서버 요청을 메서드마다 센다. 어떤 메서드에 server-request-injection 이 걸리면 그 메서드의
 * server-request(info)는 내지 않고, 횟수는 injection 의 evidence 로 옮긴다(픽스처의 "정확히 하나" 를 위한 결정).
 */
function serverRequestFindings(messages: readonly ServerMessage[]): Finding[] {
  const byMethod = new Map<string, ServerMessage[]>();
  for (const message of messages) {
    if (message.kind !== "request" || !OBSERVED_METHODS.includes(message.method)) continue;
    byMethod.set(message.method, [...(byMethod.get(message.method) ?? []), message]);
  }
  const findings: Finding[] = [];
  for (const [method, requests] of byMethod) {
    const count = `${requests.length}회`;
    const injections: Finding[] = [];
    for (const request of requests) {
      for (const { path, text } of paramStrings(request.params, "params")) {
        const hit = findInstruction(text);
        if (hit === undefined) continue;
        injections.push(
          finding(
            "protocol/server-request-injection",
            "high",
            `서버 요청 ${method} 안에 모델 지시가 있습니다: "${hit.fragment}"`,
            "샘플링 요청으로 대화를 가로채는 수법입니다(Unit 42, 2025-12). 등록하지 마세요.",
            [hit.fragment, method, count, path, hit.form],
          ),
        );
      }
    }
    if (injections.length > 0) {
      findings.push(...injections);
      continue;
    }
    findings.push(
      finding(
        "protocol/server-request",
        "info",
        `서버가 ${method} 를 ${count} 요청했습니다`,
        "서버가 모델 호출(샘플링)이나 사용자 입력을 요구합니다. 클라이언트가 이 요청을 어떻게 처리하는지 확인하세요.",
        [method, count],
      ),
    );
  }
  return findings;
}

/**
 * 요청 params 안의 문자열 값과 키 이름을 §3.0.2 와 같은 규칙으로 모은다. 점 경로, 배열은 [i],
 * 키 이름 자체는 경로에 "(key)" 접미. collectStrings 는 도구 전용이라 여기서 따로 걷는다.
 */
function paramStrings(value: unknown, path: string): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value))
    return value.flatMap((item, index) => paramStrings(item, `${path}[${index}]`));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    { path: `${path}.${key}(key)`, text: key },
    ...paramStrings(child, `${path}.${key}`),
  ]);
}

/** §3.6 의 나머지 두 가족. 문형은 folded(소문자) 기준이라 raw 에는 대소문자 무시 사본을 댄다(description.ts 와 같은 방식). */
const SIDE_PATTERNS: readonly RegExp[] = [...COVERT_ACTION_PATTERNS, ...SHADOWING_PATTERNS];
const SIDE_PATTERNS_RAW: readonly RegExp[] = SIDE_PATTERNS.map((pattern) =>
  pattern.flags.includes("i") ? pattern : new RegExp(pattern.source, `${pattern.flags}i`),
);

/**
 * 문자열 하나에서 desc/injection·covert-action·shadowing 문형을 찾는다. injection 은 T1 의 findInjection 이
 * 모든 형(raw, folded, 디코딩형, rot13)을 본다. 나머지 둘은 같은 형 순서로 대조해 처음 걸린 형에서 가장 앞의
 * 일치를 쓴다. 문자열 하나에 발견 하나이고 injection 이 먼저다.
 */
function findInstruction(
  text: string,
): { readonly fragment: string; readonly form: TextForm } | undefined {
  const injection = findInjection(text);
  if (injection !== undefined) {
    return { fragment: evidenceFragment(injection.fragment), form: injection.form };
  }
  for (const entry of normalizeTextWithSources(text)) {
    let best: RegExpExecArray | undefined;
    for (const pattern of entry.form === "raw" ? SIDE_PATTERNS_RAW : SIDE_PATTERNS) {
      const match = pattern.exec(entry.text);
      if (match !== null && (best === undefined || match.index < best.index)) best = match;
    }
    if (best !== undefined) return { fragment: evidenceFragment(best[0]), form: entry.form };
  }
  return undefined;
}

function listChangedFindings(listChanged: ProtocolContext["listChanged"]): Finding[] {
  if (!listChanged.notified) return [];
  const { surfaceHashBefore: before, surfaceHashAfter: after } = listChanged;
  if (before !== after) {
    return [
      finding(
        "protocol/list-changed",
        "high",
        "감사 중 도구 목록이 바뀌었습니다",
        "승인 뒤 정의가 바뀌는 러그풀의 실시간형입니다. 등록하지 마세요.",
        [before, after],
      ),
    ];
  }
  return [
    finding(
      "protocol/list-changed",
      "info",
      "감사 중 도구 목록 변경 알림이 왔지만 목록은 그대로입니다",
      "지금은 문제가 없습니다. 알림이 반복되면 서버가 정의를 바꾸는 시점을 확인하세요.",
      [before],
    ),
  ];
}

function finding(
  ruleId: Finding["ruleId"],
  severity: Severity,
  message: string,
  fix: string,
  evidence: readonly string[],
): Finding {
  return { ruleId, severity, location: { kind: "protocol", path: "" }, message, fix, evidence };
}

/** 판정 불가를 조용한 통과로 만들지 않는다. evidence[0] 은 프로브 주소라 같은 규칙의 두 프로브가 겹치지 않는다. */
function unverified(
  ruleId: Finding["ruleId"],
  what: string,
  cause: string,
  probeUrl: string,
): Finding {
  return finding(ruleId, "info", `확인 안 함: ${what} (${cause})`, UNVERIFIED_FIX, [
    probeUrl,
    cause,
  ]);
}

/** §3.0 정렬. protocol 발견은 모두 toolIndex 가 없고 path 가 "" 라 ruleId, evidence[0] 순이 된다. */
function sortFindings(findings: Finding[]): Finding[] {
  const key = (f: Finding) => [f.ruleId, f.location.path, f.evidence[0] ?? ""];
  return findings.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const x = ka[i] ?? "";
      const y = kb[i] ?? "";
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });
}

function parseUrl(text: string | undefined): URL | undefined {
  if (text === undefined) return undefined;
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

/** 세션·토큰 파라미터의 값을 가린다. evidence 와 message 에 비밀을 싣지 않기 위해서다. */
function redactUrl(url: string): string {
  return url.replace(SESSION_PARAM_VALUE, "$1<redacted>");
}

function clip(text: string): string {
  return text.length <= EVIDENCE_MAX ? text : `${text.slice(0, EVIDENCE_MAX - 1)}…`;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

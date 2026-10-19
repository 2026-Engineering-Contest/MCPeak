import type { ObservedRequest } from "./types.js";

/** JSON 값에서 뽑는 토큰의 최소 길이. 작은 정수는 우연 일치가 많아 뺀다(§6.1). */
const MIN_JSON_TOKEN_LENGTH = 4;
/** JSON 이 아닌 본문의 토큰 모양. */
const TEXT_TOKEN = /[A-Za-z0-9_.-]{8,}/g;

/** 문자열·숫자 값을 String(v) 로 모은다. 키·불리언·null 은 넣지 않는다. */
function collectJsonValues(value: unknown, into: Set<string>): void {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    if (text.length >= MIN_JSON_TOKEN_LENGTH) into.add(text);
  } else if (Array.isArray(value)) {
    for (const item of value) collectJsonValues(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectJsonValues(item, into);
  }
}

/** §6.1 tokens(text). JSON 으로 파싱되면 값, 아니면 8자 이상 토큰. */
function tokens(text: string): ReadonlySet<string> {
  const found = new Set<string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    for (const match of text.matchAll(TEXT_TOKEN)) found.add(match[0]);
    return found;
  }
  collectJsonValues(parsed, found);
  return found;
}

/**
 * 응답 본문 토큰. 한 요청은 같은 호출의 뒤 요청 여럿과 비교되므로(§6.2) 본문을 한 번만 파싱한다.
 * 키가 요청 객체라 같은 입력에 같은 결과이고, 요청이 버려지면 함께 사라진다.
 */
const bodyTokens = new WeakMap<ObservedRequest, ReadonlySet<string>>();

function responseTokens(request: ObservedRequest, body: string): ReadonlySet<string> {
  let found = bodyTokens.get(request);
  if (found === undefined) {
    found = tokens(body);
    bodyTokens.set(request, found);
  }
  return found;
}

/** decodeURIComponent 가 던지면 원문을 쓴다. */
function decodeUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * §6.1 의존 판정. later 의 입력(URL·요청 본문·담긴 요청 헤더 값)에 earlier 의 출력(응답 본문 토큰, Location)이
 * 부분 문자열로 들어 있으면 dependent 다. 호출 입력과 earlier 자신의 요청에 이미 있던 토큰은 출력에서 뺀다.
 * 본문을 못 본 쪽이 있으면 unknown 이다. 거짓 독립 경고를 내지 않는 쪽으로 기운다.
 */
export function judge(
  later: ObservedRequest,
  earlier: ObservedRequest,
  input: Readonly<Record<string, unknown>>,
): "dependent" | "independent" | "unknown" {
  if (earlier.responseBody === undefined || earlier.responseBodyTruncated === true) {
    return "unknown";
  }
  if (later.requestBodyUnknown === true) return "unknown";

  const outputs = [...responseTokens(earlier, earlier.responseBody)];
  const location = earlier.responseHeaders?.location;
  if (location !== undefined) outputs.push(location);

  const inputEcho = JSON.stringify(input);
  const earlierUrl = decodeUrl(earlier.url);
  const earlierBody = earlier.requestBody ?? "";
  const laterInputs = [
    decodeUrl(later.url),
    later.requestBody ?? "",
    Object.values(later.requestHeaders ?? {}).join(" "),
  ].join(" ");

  for (const token of outputs) {
    if (inputEcho.includes(token)) continue;
    if (earlierUrl.includes(token) || earlierBody.includes(token)) continue;
    if (laterInputs.includes(token)) return "dependent";
  }
  return "independent";
}

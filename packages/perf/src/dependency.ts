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

/** decodeURIComponent 가 던지면 원문을 쓴다. */
function decodeUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/*
 * 아래 두 캐시가 있는 이유. rules.ts 는 순차 요청마다 앞선 모든 요청과 judge 를 부른다(§6.2). 그래서 한 요청은
 * earlier 로 뒤 요청 여럿과, later 로 앞 요청 여럿과 비교된다. 쌍마다 출력을 다시 걸러 내고 입력 문자열을 다시
 * 훑으면 요청 수의 제곱에 본문 길이가 곱해진다. 키가 요청 객체라 같은 입력에 같은 결과이고, 요청이 버려지면
 * 함께 사라진다.
 */

/** earlier 의 걸러 낸 출력. 입력 반향 제외가 호출 입력에 달려 있어 그 문자열을 함께 둔다. */
interface Outputs {
  readonly inputEcho: string;
  readonly tokens: readonly string[];
}
const outputCache = new WeakMap<ObservedRequest, Outputs>();

/**
 * §6.1 outputs(earlier): 응답 본문 토큰과 Location 에서 호출 입력과 자기 요청에 이미 있던 토큰을 뺀 것.
 * 순서는 본문 토큰, Location 이다.
 */
function outputsOf(earlier: ObservedRequest, body: string, inputEcho: string): readonly string[] {
  const cached = outputCache.get(earlier);
  if (cached !== undefined && cached.inputEcho === inputEcho) return cached.tokens;

  const candidates = [...tokens(body)];
  const location = earlier.responseHeaders?.location;
  if (location !== undefined) candidates.push(location);

  const earlierUrl = decodeUrl(earlier.url);
  const earlierBody = earlier.requestBody ?? "";
  const kept = candidates.filter(
    (token) =>
      !inputEcho.includes(token) && !earlierUrl.includes(token) && !earlierBody.includes(token),
  );
  outputCache.set(earlier, { inputEcho, tokens: kept });
  return kept;
}

/** 입력 문자열의 부분 문자열 검사에 앞서 쓰는 조각 길이. JSON 토큰의 최소 길이와 같다. */
const GRAM = MIN_JSON_TOKEN_LENGTH;

/** later 의 입력 문자열과 그 안의 모든 GRAM 길이 조각. */
interface Inputs {
  readonly text: string;
  readonly grams: ReadonlySet<string>;
}
const inputCache = new WeakMap<ObservedRequest, Inputs>();

/** §6.1 inputs(later): URL, 요청 본문, 담긴 요청 헤더 값을 " " 로 이은 것. */
function inputsOf(later: ObservedRequest): Inputs {
  const cached = inputCache.get(later);
  if (cached !== undefined) return cached;
  const text = [
    decodeUrl(later.url),
    later.requestBody ?? "",
    Object.values(later.requestHeaders ?? {}).join(" "),
  ].join(" ");
  const grams = new Set<string>();
  for (let i = 0; i + GRAM <= text.length; i += 1) grams.add(text.slice(i, i + GRAM));
  const inputs = { text, grams };
  inputCache.set(later, inputs);
  return inputs;
}

/**
 * `inputs.text.includes(token)` 와 같은 답을 낸다. 토큰이 들어 있으려면 그 첫 조각과 끝 조각이 입력의 조각이어야
 * 하므로, 둘 중 하나라도 없으면 본문을 훑지 않고 거짓이다. 조각보다 짧은 토큰(짧은 Location)은 바로 훑는다.
 */
function contains(inputs: Inputs, token: string): boolean {
  if (
    token.length >= GRAM &&
    (!inputs.grams.has(token.slice(0, GRAM)) || !inputs.grams.has(token.slice(-GRAM)))
  ) {
    return false;
  }
  return inputs.text.includes(token);
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

  const outputs = outputsOf(earlier, earlier.responseBody, JSON.stringify(input));
  const inputs = inputsOf(later);
  for (const token of outputs) {
    if (contains(inputs, token)) return "dependent";
  }
  return "independent";
}

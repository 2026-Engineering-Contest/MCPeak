import { createHash } from "node:crypto";
import { MAX_HTTP_BODY_BYTES } from "../shared/limits.mjs";
import { sensitiveKeyIn, sensitiveKeysOf } from "../shared/sensitive-keys.mjs";

const REDACTED = "[redacted]";
const MATCH_HEADER_NAMES = new Set(["accept", "accept-language", "content-type", "range"]);
/**
 * 단어 규칙(`sensitiveKey`)만으로는 걸리지 않는 표준 헤더들. 접미 단어열이 `authorization`
 * 이나 `authenticate` 라 민감 키 목록에 없기 때문이다.
 *
 * `*-authenticate` 계열은 값 자체가 비밀은 아니지만 Digest 인증의 nonce 와 realm 이
 * 들어간다. 녹화본은 커밋되거나 공유되므로 보수적으로 지운다.
 */
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "www-authenticate",
  "proxy-authenticate",
  "authentication-info",
  "proxy-authentication-info",
]);
export const HTTP_MATCH_KEY_DOMAIN = "mcpeak.external.http";
export const HTTP_INTERACTION_SCHEMA_VERSION = 1;

/**
 * External 은 **자기 interaction schema version 의 스냅샷**을 쓴다. 최신을 따라가면
 * 목록에 단어가 추가되는 순간 이미 저장된 세션의 matchKey 가 바뀌어 전부 miss 가 된다.
 */
const SENSITIVE_KEYS = sensitiveKeysOf(HTTP_INTERACTION_SCHEMA_VERSION);

const fail = (code, message) => {
  const error = new Error(message);
  error.name = "ExternalRecordReplayError";
  error.code = code;
  throw error;
};

export const sensitiveKey = (key) => sensitiveKeyIn(SENSITIVE_KEYS, key);

const setOwn = (target, key, value) => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

const plainObject = (value) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const normalizeJson = (value, redact, active = new Set()) => {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("REQUEST_INVALID", "JSON에 유한하지 않은 숫자가 있습니다.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (!Array.isArray(value) && !plainObject(value))
    fail("REQUEST_INVALID", "JSON으로 저장할 수 없는 값입니다.");
  if (active.has(value)) fail("REQUEST_INVALID", "순환 참조는 JSON으로 저장할 수 없습니다.");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index))
          fail("REQUEST_INVALID", "sparse array는 JSON으로 저장할 수 없습니다.");
        const item = value[index];
        result.push(item === undefined ? null : normalizeJson(item, redact, active));
      }
      return result;
    }
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined && !(redact && sensitiveKey(key))) continue;
      const child =
        redact && sensitiveKey(key) ? REDACTED : normalizeJson(value[key], redact, active);
      setOwn(result, key, child);
    }
    return result;
  } finally {
    active.delete(value);
  }
};

export const redactJson = (value) => normalizeJson(value, true);

export const stableStringify = (value) => JSON.stringify(normalizeJson(value, false));

const decodeQueryKey = (value) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
};

const redactQuery = (search) => {
  if (search === "") return "";
  return search
    .slice(1)
    .split("&")
    .map((part) => {
      const separator = part.indexOf("=");
      const rawKey = separator < 0 ? part : part.slice(0, separator);
      if (!sensitiveKey(decodeQueryKey(rawKey))) return part;
      return `${rawKey}=%5Bredacted%5D`;
    })
    .join("&");
};

const normalizedUrl = (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    fail("UNSUPPORTED_HTTP_URL", "외부 HTTP 요청 URL은 절대 URL이어야 합니다.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    fail("UNSUPPORTED_HTTP_URL", "외부 요청은 http 또는 https URL만 지원합니다.");
  if (parsed.username !== "" || parsed.password !== "")
    fail("UNSUPPORTED_HTTP_URL", "URL에 포함된 자격증명은 지원하지 않습니다.");
  parsed.hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  )
    parsed.port = "";
  const query = redactQuery(parsed.search);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${query === "" ? "" : `?${query}`}`;
};

const jsonContentType = (value) => {
  const [mediaType = "", ...parameters] = value.split(";").map((part) => part.trim().toLowerCase());
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) return false;
  for (const parameter of parameters) {
    if (parameter.startsWith("charset=") && parameter !== "charset=utf-8") return false;
  }
  return true;
};

const bytesAsJson = (bytes, contentType, direction) => {
  if (bytes.byteLength > MAX_HTTP_BODY_BYTES)
    fail("HTTP_BODY_TOO_LARGE", `${direction} body가 1 MiB 상한을 초과했습니다.`);
  if (!jsonContentType(contentType))
    fail("UNSUPPORTED_HTTP_BODY", `${direction} body는 UTF-8 JSON만 지원합니다.`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("UNSUPPORTED_HTTP_BODY", `${direction} body가 유효한 UTF-8이 아닙니다.`);
  }
  try {
    return redactJson(JSON.parse(text));
  } catch (error) {
    if (error?.code !== undefined) throw error;
    fail("UNSUPPORTED_HTTP_BODY", `${direction} body가 유효한 JSON이 아닙니다.`);
  }
};

const normalizedHeaders = (headers) => {
  const match = {};
  const display = {};
  for (const [rawName, rawValue] of headers.entries()) {
    const name = rawName.toLowerCase();
    const value = rawValue.trim();
    if (MATCH_HEADER_NAMES.has(name)) setOwn(match, name, [value]);
    setOwn(display, name, MATCH_HEADER_NAMES.has(name) ? [value] : [REDACTED]);
  }
  return { match, display };
};

export const cloneHttpMatch = (value) => normalizeJson(value, false);

/**
 * matchKey 는 정규화한 `match` 를 그대로 해싱하지 않고 **envelope 로 감싸서** 해싱한다
 * (ADR-0053 `HttpMatchKeyEnvelopeV1`).
 *
 * `domain` 은 legacy Tool 카세트와 External 의 해시 입력 공간을 구조적으로 분리한다. 두
 * 로더는 상대 형식을 받아들이지 않으므로, 우연히 같은 값이 나와도 서로의 카세트를 집지
 * 않는다.
 *
 * `schemaVersion` 이 해시 **입력** 에 들어가는 것이 핵심이다. 형제 필드로만 두면 정규화
 * 규칙이 version 2 에서 바뀌어도 같은 요청이 같은 matchKey 를 내고, version 1 세션에
 * version 2 요청이 hit 해서 **잘못된 응답을 Replay** 한다. 입력에 넣으면 version 이
 * 달라지는 순간 키 공간이 통째로 갈라져 그 사고가 구조적으로 불가능해진다.
 */
export const httpMatchKey = (match) =>
  createHash("sha256")
    .update(
      stableStringify({
        domain: HTTP_MATCH_KEY_DOMAIN,
        schemaVersion: HTTP_INTERACTION_SCHEMA_VERSION,
        match,
      }),
      "utf8",
    )
    .digest("hex");

export async function normalizeHttpRequest(request) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST")
    fail("UNSUPPORTED_HTTP_METHOD", `외부 HTTP 요청 method '${method}'은 지원하지 않습니다.`);
  const headers = normalizedHeaders(request.headers);
  let body = { kind: "none" };
  if (request.body !== null) {
    const bytes = new Uint8Array(await request.clone().arrayBuffer());
    body = {
      kind: "json",
      value: bytesAsJson(bytes, request.headers.get("content-type") ?? "", "request"),
    };
  }
  const match = {
    method,
    url: normalizedUrl(request.url),
    headers: headers.match,
    body,
  };
  const display = {
    method,
    url: match.url,
    headers: headers.display,
    body,
  };
  return {
    protocol: "http",
    schemaVersion: HTTP_INTERACTION_SCHEMA_VERSION,
    matchKey: httpMatchKey(match),
    match,
    display,
  };
}

/**
 * 응답 헤더를 저장 형태로 바꾼다.
 *
 * 한때 `SENSITIVE_HEADER_NAMES` 4개만 마스킹했다. 그 blocklist 에 없는 `x-api-key` ·
 * `x-auth-token` · `www-authenticate` 는 토큰을 원문 그대로 세션에 남겼다. 요청 쪽은
 * allowlist(`MATCH_HEADER_NAMES`)라 안전했는데 응답 쪽만 반대였다.
 *
 * 그래서 이름 판정에도 `sensitiveKey` 를 태운다. 헤더 이름은 `-` 로 끊긴 단어열이라
 * 민감 키 판정이 그대로 먹는다 — `x-api-key` 의 접미 단어열이 `apikey` 다(ADR-0039).
 * 고정 목록은 `authorization` 처럼 단어 규칙만으로는 안 걸리는 이름을 위해 남긴다.
 */
const storedResponseHeaders = (headers) => {
  const result = [];
  for (const [rawName, rawValue] of headers.entries()) {
    const name = rawName.toLowerCase();
    if (name === "content-length") continue;
    const secret = SENSITIVE_HEADER_NAMES.has(name) || sensitiveKey(name);
    result.push([name, secret ? REDACTED : rawValue]);
  }
  return result;
};

export async function encodeHttpResponse(response) {
  if (response.redirected)
    fail("UNSUPPORTED_HTTP_RESPONSE", "redirect가 발생한 외부 HTTP 응답은 지원하지 않습니다.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let body;
  try {
    body = bytesAsJson(bytes, response.headers.get("content-type") ?? "", "response");
  } catch (error) {
    if (error?.code === "UNSUPPORTED_HTTP_BODY") error.code = "UNSUPPORTED_HTTP_RESPONSE";
    throw error;
  }
  return {
    kind: "response",
    status: response.status,
    statusText: response.statusText,
    headers: storedResponseHeaders(response.headers),
    url: normalizedUrl(response.url),
    body,
  };
}

/** 저장을 허용하는 오류 code. 여기 없는 값은 자유 텍스트로 보고 버린다. */
const FAILURE_CODES = new Map([
  ["ABORT_ERR", "abort"],
  ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
  ["ETIMEDOUT", "timeout"],
  ["EAI_AGAIN", "dns"],
  ["ENOTFOUND", "dns"],
  ["ECONNREFUSED", "connection"],
  ["ECONNRESET", "connection"],
  ["CERT_HAS_EXPIRED", "tls"],
  ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls"],
  ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
  ["SELF_SIGNED_CERT_IN_CHAIN", "tls"],
  ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls"],
]);

const FAILURE_NAMES = new Set(["Error", "TypeError", "AbortError"]);

/** 사용자가 보는 문장. **저장본이 아니라 복원 시점에 kind 로부터 만든다.** */
const FAILURE_MESSAGES = {
  abort: "외부 HTTP 호출이 중단되었습니다 (abort).",
  timeout: "외부 HTTP 호출이 제한 시간 안에 끝나지 않았습니다 (timeout).",
  dns: "외부 HTTP 호출의 host 이름을 찾지 못했습니다 (DNS).",
  connection: "외부 HTTP 호출의 연결이 거부되었거나 끊겼습니다 (connection).",
  tls: "외부 HTTP 호출의 TLS 인증서 검증에 실패했습니다 (TLS).",
  network: "외부 HTTP 호출이 네트워크 오류로 실패했습니다.",
  unknown: "외부 HTTP 호출이 실패했습니다.",
};

/**
 * 던져진 오류를 **안전한 envelope** 로 좁힌다(ADR-0053 `StoredHttpThrowV1`).
 *
 * 원본 `message`·`stack`·`cause` 는 담지 않는다. 여기서 버리지 않으면 실패한 URL 과 그
 * query 의 token 이 세션에 그대로 남는다 — 자유 텍스트라 마스킹이 걸리지 않는다.
 *
 * 분류 우선순위는 code 가 먼저다. code 는 런타임이 주는 닫힌 식별자라 문구보다 안정적이다.
 * 목록에 없는 code 는 그 자체가 자유 텍스트일 수 있으므로 저장하지 않고 kind 만 남긴다.
 */
export function encodeHttpThrow(error) {
  if (!(error instanceof Error)) return { kind: "throw", failureKind: "unknown", name: "Error" };

  const name = FAILURE_NAMES.has(error.name) ? error.name : "Error";
  const code = typeof error.code === "string" ? error.code : undefined;
  const byCode = code === undefined ? undefined : FAILURE_CODES.get(code);
  if (byCode !== undefined) return { kind: "throw", failureKind: byCode, name, code };

  // code 로 못 가르면 name 만 본다. `TypeError` 는 `fetch` 가 네트워크 실패에 쓰는 이름이다.
  if (name === "AbortError") return { kind: "throw", failureKind: "abort", name };
  if (name === "TypeError") return { kind: "throw", failureKind: "network", name };
  return { kind: "throw", failureKind: "unknown", name };
}

export function restoreHttpOutcome(outcome) {
  if (outcome.kind === "throw") {
    // 문장은 저장본이 아니라 failureKind 에서 만든다. 원본 message 를 저장하지 않기 때문이고,
    // 덕분에 같은 kind 는 항상 같은 문장을 낸다(결정론성).
    const error = new Error(FAILURE_MESSAGES[outcome.failureKind] ?? FAILURE_MESSAGES.unknown);
    error.name = outcome.name;
    if (outcome.code !== undefined) error.code = outcome.code;
    throw error;
  }
  const response = new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    statusText: outcome.statusText,
    headers: outcome.headers,
  });
  try {
    Object.defineProperty(response, "url", {
      value: outcome.url,
      configurable: true,
      enumerable: true,
    });
  } catch {
    fail("UNSUPPORTED_HTTP_RESPONSE", "현재 런타임에서 Response.url을 복원할 수 없습니다.");
  }
  if (response.url !== outcome.url)
    fail("UNSUPPORTED_HTTP_RESPONSE", "현재 런타임에서 Response.url을 복원할 수 없습니다.");
  return response;
}

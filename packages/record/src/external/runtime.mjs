import { createHash } from "node:crypto";

const REDACTED = "[redacted]";
const MAX_HTTP_BODY_BYTES = 1024 * 1024;
const MATCH_HEADER_NAMES = new Set(["accept", "accept-language", "content-type", "range"]);
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);
const SENSITIVE_KEYS = new Set([
  "authorization",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "token",
  "secret",
  "password",
  "cookie",
  "privatekey",
  "secretkey",
  "signingkey",
  "sessionkey",
  "credential",
  "passwd",
]);

const fail = (code, message) => {
  const error = new Error(message);
  error.name = "ExternalRecordReplayError";
  error.code = code;
  throw error;
};

const keyWords = (key) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[-_ ]+/)
    .map((word) => word.toLowerCase().replace(/[0-9]+$/, ""))
    .filter((word) => word.length > 0);

export const sensitiveKey = (key) => {
  const words = keyWords(key);
  for (let start = words.length - 1; start >= 0; start -= 1) {
    const joined = words.slice(start).join("");
    if (SENSITIVE_KEYS.has(joined)) return true;
    if (joined.endsWith("s") && SENSITIVE_KEYS.has(joined.slice(0, -1))) return true;
  }
  return false;
};

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
    schemaVersion: 1,
    matchKey: createHash("sha256").update(stableStringify(match), "utf8").digest("hex"),
    match,
    display,
  };
}

const storedResponseHeaders = (headers) => {
  const result = [];
  for (const [rawName, rawValue] of headers.entries()) {
    const name = rawName.toLowerCase();
    if (name === "content-length") continue;
    result.push([name, SENSITIVE_HEADER_NAMES.has(name) ? REDACTED : rawValue]);
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

export function encodeHttpThrow(error) {
  if (error instanceof Error) {
    const code = typeof error.code === "string" ? error.code : undefined;
    return {
      kind: "throw",
      name: error.name,
      message: error.message,
      ...(code === undefined ? {} : { code }),
    };
  }
  return { kind: "throw", name: "Error", message: "외부 HTTP 호출이 실패했습니다." };
}

export function restoreHttpOutcome(outcome) {
  if (outcome.kind === "throw") {
    const error = new Error(outcome.message);
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

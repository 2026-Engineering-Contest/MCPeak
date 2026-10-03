// @ts-check
import { createHash } from "node:crypto";

/**
 * @typedef {{ label: string, value: string }} Secret
 *   `label` 은 자리표(`<canary:NAME>`·`<env:NAME>`), `value` 는 이 실행의 실제 값
 * @typedef {{ method: string, scheme: "http" | "https", host: string, port: number, path: string, bodySha256: string }} MatchKey
 * @typedef {{ status: number, headers: Array<[string, string]>, body: Buffer }} SessionResponse
 * @typedef {{ status: number, headers: Array<[string, string]>, bodyBase64: string }} StoredResponse
 * @typedef {{ key: MatchKey, responses: StoredResponse[] }} SessionEntry
 * @typedef {{ schemaVersion: 1, entries: SessionEntry[] }} Session
 */

export const SESSION_SCHEMA_VERSION = 1;
export const REPLAY_MISS_STATUS = 504;
export const REPLAY_MISS_BODY = "mcpeak: 녹화에 없는 요청입니다";

/** 세션 파일의 형식이 어긋났다. `message` 가 원인 한 줄이다. */
export class SessionFormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "SessionFormatError";
  }
}

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 문자열의 `from` 들을 한 번 훑어 `to` 로 바꾼다. 차례로 바꾸지 않는 이유는 먼저 끼운 자리표 안의
 * 글자가 다음 값에 다시 걸리지 않게 하려는 것이다. 긴 것부터 맞춘다(한 값이 다른 값을 품을 때).
 * @param {string} text
 * @param {ReadonlyArray<readonly [from: string, to: string]>} pairs
 * @returns {string}
 */
function replaceAll(text, pairs) {
  /** @type {Map<string, string>} */
  const table = new Map();
  const ordered = pairs
    .filter(([from]) => from !== "")
    .sort(
      ([a, aTo], [b, bTo]) => b.length - a.length || compareText(a, b) || compareText(aTo, bTo),
    );
  // 같은 `from` 이 둘이면 정렬상 첫째가 이긴다. 입력 순서에 기대지 않는다.
  for (const [from, to] of ordered) if (!table.has(from)) table.set(from, to);
  if (table.size === 0) return text;
  const pattern = new RegExp([...table.keys()].map(escapeRegExp).join("|"), "g");
  return text.replace(pattern, (found) => table.get(found) ?? found);
}

/**
 * 코드 단위 비교. `localeCompare` 는 로캘에 따라 순서가 달라진다.
 * @param {string} a
 * @param {string} b
 */
function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 비밀 값을 자리표로 바꾼다.
 * @param {string} text
 * @param {ReadonlyArray<Secret>} secrets
 */
export function maskText(text, secrets) {
  return replaceAll(
    text,
    secrets.map((secret) => /** @type {const} */ ([secret.value, secret.label])),
  );
}

/**
 * 자리표를 이 실행의 값으로 되돌린다.
 * @param {string} text
 * @param {ReadonlyArray<Secret>} secrets
 */
export function unmaskText(text, secrets) {
  return replaceAll(
    text,
    secrets
      .filter((secret) => secret.value !== "")
      .map((secret) => /** @type {const} */ ([secret.label, secret.value])),
  );
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * UTF-8 로 풀리는 바이트에만 `transform` 을 건다. 풀리지 않으면 그대로 돌려준다.
 * @param {Buffer} bytes
 * @param {(text: string) => string} transform
 * @returns {Buffer}
 */
function transformBytes(bytes, transform) {
  let text;
  try {
    text = utf8.decode(bytes);
  } catch {
    return bytes;
  }
  const changed = transform(text);
  return changed === text ? bytes : Buffer.from(changed, "utf8");
}

/**
 * @param {Buffer} bytes
 * @param {ReadonlyArray<Secret>} secrets
 */
export function maskBytes(bytes, secrets) {
  return transformBytes(bytes, (text) => maskText(text, secrets));
}

/**
 * @param {Buffer} bytes
 * @param {ReadonlyArray<Secret>} secrets
 */
export function unmaskBytes(bytes, secrets) {
  return transformBytes(bytes, (text) => unmaskText(text, secrets));
}

/**
 * §3.7 의 매칭 키. 헤더는 받지 않는다. `user-agent`·`date` 처럼 버전과 시각이 실리는 것이 섞여 있다.
 * 경로와 본문은 비밀을 가린 뒤에 쓴다. 그래야 실행마다 값이 다른 카나리가 실린 요청도 같은 키가 된다.
 * @param {{ method: string, scheme: "http" | "https", host: string, port: number, path: string, body: Buffer }} request
 *   `body` 는 `content-encoding` 을 푼 본문 전체다(상한으로 자르기 전)
 * @param {ReadonlyArray<Secret>} secrets
 * @returns {MatchKey}
 */
export function matchKey(request, secrets) {
  return {
    method: request.method,
    scheme: request.scheme,
    host: request.host,
    port: request.port,
    path: maskText(request.path, secrets),
    bodySha256: createHash("sha256").update(maskBytes(request.body, secrets)).digest("hex"),
  };
}

/**
 * 키를 한 줄 문자열로. Map 의 키로 쓴다. JSON 배열이라 필드 경계가 섞이지 않는다.
 * @param {MatchKey} key
 */
function keyId(key) {
  return JSON.stringify([key.method, key.scheme, key.host, key.port, key.path, key.bodySha256]);
}

/**
 * 키의 여섯 필드 순 비교.
 * @param {MatchKey} a
 * @param {MatchKey} b
 */
function compareKeys(a, b) {
  return (
    compareText(a.method, b.method) ||
    compareText(a.scheme, b.scheme) ||
    compareText(a.host, b.host) ||
    a.port - b.port ||
    compareText(a.path, b.path) ||
    compareText(a.bodySha256, b.bodySha256)
  );
}

/**
 * 키 순서를 §3.7 그대로 다시 세운 사본. 직렬화의 키 순서를 입력 객체의 순서에 맡기지 않는다.
 * @param {Session} session
 * @returns {Session}
 */
function canonical(session) {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    entries: session.entries
      .map((entry) => ({
        key: {
          method: entry.key.method,
          scheme: entry.key.scheme,
          host: entry.key.host,
          port: entry.key.port,
          path: entry.key.path,
          bodySha256: entry.key.bodySha256,
        },
        responses: entry.responses.map((response) => ({
          status: response.status,
          headers: response.headers.map(
            ([name, value]) => /** @type {[string, string]} */ ([name, value]),
          ),
          bodyBase64: response.bodyBase64,
        })),
      }))
      .sort((a, b) => compareKeys(a.key, b.key)),
  };
}

/**
 * 세션 파일의 내용. 같은 요청 집합이면 바이트 단위로 같다.
 * @param {Session} session
 * @returns {string}
 */
export function serializeSession(session) {
  return `${JSON.stringify(canonical(session), null, 2)}\n`;
}

/**
 * 녹화기. 응답을 키별로 온 순서대로 쌓는다. 값은 쌓을 때 자리표로 바뀌므로 녹화기 안에는 비밀 값이 없다.
 */
export function createRecorder() {
  /** @type {Map<string, SessionEntry>} */
  const entries = new Map();
  return {
    /**
     * @param {MatchKey} key `matchKey` 가 만든 것(이미 가려져 있다)
     * @param {SessionResponse} response 상류가 준 그대로
     * @param {ReadonlyArray<Secret>} secrets
     */
    record(key, response, secrets) {
      const id = keyId(key);
      let entry = entries.get(id);
      if (entry === undefined) {
        entry = { key, responses: [] };
        entries.set(id, entry);
      }
      entry.responses.push({
        status: response.status,
        headers: response.headers.map(([name, value]) => [name, maskText(value, secrets)]),
        bodyBase64: maskBytes(response.body, secrets).toString("base64"),
      });
    },
    /** @returns {Session} */
    session() {
      return canonical({ schemaVersion: SESSION_SCHEMA_VERSION, entries: [...entries.values()] });
    },
  };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * 세션 파일을 읽는다. 형식이 어긋나면 원인 한 줄을 담은 `SessionFormatError` 를 던진다.
 * @param {string} text
 * @returns {Session}
 */
export function parseSession(text) {
  /** @param {string} reason @returns {never} */
  const fail = (reason) => {
    throw new SessionFormatError(reason);
  };
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("JSON 으로 읽을 수 없습니다.");
  }
  if (!isRecord(value)) return fail("최상위 값이 객체가 아닙니다.");
  if (value.schemaVersion !== SESSION_SCHEMA_VERSION) {
    return fail(
      `schemaVersion 이 ${SESSION_SCHEMA_VERSION} 이 아닙니다(받은 값: ${JSON.stringify(value.schemaVersion) ?? "없음"}).`,
    );
  }
  if (!Array.isArray(value.entries)) return fail("entries 가 배열이 아닙니다.");

  /** @type {SessionEntry[]} */
  const entries = [];
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const [index, entry] of value.entries.entries()) {
    const at = `entries[${index}]`;
    if (!isRecord(entry)) return fail(`${at} 가 객체가 아닙니다.`);
    const key = entry.key;
    if (!isRecord(key)) return fail(`${at}.key 가 객체가 아닙니다.`);
    const { method, scheme, host, port, path, bodySha256 } = key;
    if (typeof method !== "string" || method === "") {
      return fail(`${at}.key.method 가 문자열이 아닙니다.`);
    }
    if (scheme !== "http" && scheme !== "https") {
      return fail(`${at}.key.scheme 이 http 도 https 도 아닙니다.`);
    }
    if (typeof host !== "string") return fail(`${at}.key.host 가 문자열이 아닙니다.`);
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      return fail(`${at}.key.port 가 1~65535 의 정수가 아닙니다.`);
    }
    if (typeof path !== "string") return fail(`${at}.key.path 가 문자열이 아닙니다.`);
    if (typeof bodySha256 !== "string" || !/^[0-9a-f]{64}$/.test(bodySha256)) {
      return fail(`${at}.key.bodySha256 이 sha256 hex(64자)가 아닙니다.`);
    }
    /** @type {MatchKey} */
    const parsedKey = { method, scheme, host, port, path, bodySha256 };
    const id = keyId(parsedKey);
    const earlier = seen.get(id);
    if (earlier !== undefined) {
      return fail(
        `${at} 의 키가 entries[${earlier}] 과 같습니다. 같은 키는 한 항목의 responses 에 모아야 합니다.`,
      );
    }
    seen.set(id, index);

    if (!Array.isArray(entry.responses)) return fail(`${at}.responses 가 배열이 아닙니다.`);
    if (entry.responses.length === 0) {
      return fail(`${at}.responses 가 비어 있습니다. 응답이 하나 이상 있어야 합니다.`);
    }
    /** @type {StoredResponse[]} */
    const responses = entry.responses.map((response, responseIndex) => {
      const where = `${at}.responses[${responseIndex}]`;
      if (!isRecord(response)) return fail(`${where} 가 객체가 아닙니다.`);
      const { status, headers, bodyBase64 } = response;
      if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) {
        return fail(`${where}.status 가 100~599 의 정수가 아닙니다.`);
      }
      if (!Array.isArray(headers)) return fail(`${where}.headers 가 배열이 아닙니다.`);
      /** @type {Array<[string, string]>} */
      const parsedHeaders = headers.map((header, headerIndex) => {
        if (
          !Array.isArray(header) ||
          header.length !== 2 ||
          typeof header[0] !== "string" ||
          typeof header[1] !== "string"
        ) {
          return fail(`${where}.headers[${headerIndex}] 이 [이름, 값] 문자열 쌍이 아닙니다.`);
        }
        return [header[0], header[1]];
      });
      if (typeof bodyBase64 !== "string" || !BASE64_PATTERN.test(bodyBase64)) {
        return fail(`${where}.bodyBase64 가 base64 가 아닙니다.`);
      }
      return { status, headers: parsedHeaders, bodyBase64 };
    });
    entries.push({ key: parsedKey, responses });
  }
  return canonical({ schemaVersion: SESSION_SCHEMA_VERSION, entries });
}

/**
 * 재생기. 키가 같은 n번째 요청에 `responses[n]` 을 준다. 녹화보다 많이 오면 마지막 응답을 다시 준다.
 * 키가 없으면 `replay-miss` 와 §3.7 이 정한 응답이다. 상류를 아는 것이 이 안에 없다.
 * @param {Session} session
 */
export function createReplayer(session) {
  /** @type {Map<string, { responses: StoredResponse[], next: number }>} */
  const table = new Map();
  for (const entry of session.entries) {
    table.set(keyId(entry.key), { responses: entry.responses, next: 0 });
  }
  return {
    /**
     * @param {MatchKey} key
     * @param {ReadonlyArray<Secret>} secrets 이 실행의 값. 응답의 자리표를 이것으로 되돌린다
     * @returns {{ served: "replay-hit" | "replay-miss", response: SessionResponse }}
     */
    answer(key, secrets) {
      const slot = table.get(keyId(key));
      const stored = slot?.responses[Math.min(slot.next, slot.responses.length - 1)];
      if (slot === undefined || stored === undefined) {
        return {
          served: "replay-miss",
          response: {
            status: REPLAY_MISS_STATUS,
            headers: [["content-type", "text/plain; charset=utf-8"]],
            body: Buffer.from(REPLAY_MISS_BODY, "utf8"),
          },
        };
      }
      slot.next += 1;
      return {
        served: "replay-hit",
        response: {
          status: stored.status,
          headers: stored.headers.map(([name, value]) => [name, unmaskText(value, secrets)]),
          body: unmaskBytes(Buffer.from(stored.bodyBase64, "base64"), secrets),
        },
      };
    },
    /** 받은 세션 그대로. `GET /session` 이 재생 중에 빈 녹화를 내주지 않게 한다. */
    session: () => session,
  };
}

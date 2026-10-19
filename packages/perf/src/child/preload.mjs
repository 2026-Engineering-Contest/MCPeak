// `mcpeak perf` 의 자식 프리로드(설계 §4). `NODE_OPTIONS=--import=<이 파일>` 로 서버 프로세스에 실려
// 나가는 HTTP 요청의 시작·끝 시각을 `${MCPEAK_PERF_TRACE_DIR}/${pid}.jsonl` 에 적는다.
//
// 이 파일의 원칙은 하나다. **관측이 서버 동작을 바꾸면 측정이 아니다.** 그래서
//   - 응답 스트림에 `data` 리스너를 달거나 `resume()`·`setEncoding()` 을 부르지 않는다(§4.3 node:http 2항).
//     flowing 으로 바뀐 스트림은 서버가 나중에 다는 리스너가 앞부분을 놓친다.
//   - fetch 의 본문은 원본이 아니라 `clone()` 복제본을 읽는다. 원본은 즉시 돌려준다.
//   - 관측 코드 자신의 예외는 전부 잡아서 버린다. 단 원래 fetch 가 던진 오류는 end 줄을 쓴 뒤 그대로 다시 던진다.
//   - 환경 변수를 지우지 않는다. `npx` 같은 중간 런처가 지우면 진짜 서버가 빈손으로 뜬다(§4.1).
//   - 의존성 없이 `node:` 모듈만 쓴다. 서버의 `node_modules` 가 무엇이든 이 파일은 로드돼야 한다.
import { AsyncLocalStorage } from "node:async_hooks";
import diagnosticsChannel from "node:diagnostics_channel";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

/** §4.5. 응답 본문 보관 상한(바이트). 넘치면 `responseBodyTruncated: true`. */
const MAX_BODY_BYTES = 262_144;
/** §4.5. 요청 본문 보관 상한(문자). 넘치면 잘라 담고 `requestBodyUnknown: true` 를 함께 적는다. */
const MAX_REQUEST_BODY_CHARS = 65_536;

const INSTALLED = Symbol.for("mcpeak.perf.preload");

const traceDir = process.env.MCPEAK_PERF_TRACE_DIR;

if (traceDir !== undefined && traceDir !== "" && globalThis[INSTALLED] !== true) {
  globalThis[INSTALLED] = true;
  try {
    install(traceDir);
  } catch {
    // 설치 실패는 관측이 없는 것과 같다. 서버는 그대로 뜬다.
  }
}

function install(dir) {
  const pid = process.pid;
  const file = join(dir, `${pid}.jsonl`);

  /** 두 프로세스의 시계를 맞추는 기준(§2.1). 부모도 같은 식으로 잰다. */
  const now = () => performance.timeOrigin + performance.now();

  /** 비동기로 쓰면 프로세스가 끝날 때 버퍼가 사라진다(§4.2). 쓰기 실패는 버린다. */
  const write = (entry) => {
    try {
      appendFileSync(file, `${JSON.stringify(entry)}\n`);
    } catch {
      // 디렉터리가 사라졌거나 권한이 없다. 서버에 알릴 일이 아니다.
    }
  };

  /** 프로세스 안 모든 경로가 공유하는 1부터 오르는 정수(§4.2). */
  let lastSeq = 0;
  const nextSeq = () => {
    lastSeq += 1;
    return lastSeq;
  };

  /** fetch 래퍼 안에서 생긴 undici 요청에 `parentFetch` 를 달기 위한 저장소(§5.2). */
  const als = new AsyncLocalStorage();

  write({ kind: "hello", pid, ppid: process.ppid, node: process.version, t: now() });

  installFetch({ pid, now, write, nextSeq, als });
  installNodeHttp({ pid, now, write, nextSeq });
  installHttp2({ pid, now, write, nextSeq });
  installUndici({ pid, now, write, nextSeq, als });
}

/** §4.3 공통. 소문자 이름으로 `authorization`, `proxy-authorization`, `cookie`, `x-` 접두만 담는다. */
function pickHeaders(pairs) {
  const picked = {};
  let any = false;
  for (const [rawName, rawValue] of pairs) {
    const name = String(rawName).toLowerCase();
    if (
      name !== "authorization" &&
      name !== "proxy-authorization" &&
      name !== "cookie" &&
      !name.startsWith("x-")
    )
      continue;
    if (rawValue === undefined) continue;
    picked[name] = Array.isArray(rawValue) ? rawValue.map(String).join(", ") : String(rawValue);
    any = true;
  }
  return any ? picked : undefined;
}

const hasNoBodyByMethod = (method) => method === "GET" || method === "HEAD";

const errorText = (error) => {
  if (error instanceof Error) return error.message === "" ? error.name : error.message;
  return String(error);
};

// ───────────────────────── globalThis.fetch (§4.3 fetch 1~5항) ─────────────────────────

function installFetch({ pid, now, write, nextSeq, als }) {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return;

  globalThis.fetch = function fetch(input, init) {
    // 1항. Request 로 메서드·URL·헤더를 읽고 원래 fetch 에는 그 Request 를 넘긴다. 여기서 던지면
    // 원래 fetch 도 같은 입력에 같은 이유로 던지므로, 관측 없이 원래 fetch 에 그대로 맡긴다.
    let request;
    let start;
    try {
      request = new Request(input, init);
      start = {
        kind: "start",
        pid,
        seq: nextSeq(),
        via: "fetch",
        method: request.method,
        url: request.url,
        t0: 0,
      };
      const requestHeaders = pickHeaders(request.headers);
      if (requestHeaders !== undefined) start.requestHeaders = requestHeaders;
      const body = init?.body;
      if (typeof body === "string") {
        if (body.length > MAX_REQUEST_BODY_CHARS) {
          start.requestBody = body.slice(0, MAX_REQUEST_BODY_CHARS);
          start.requestBodyUnknown = true;
        } else {
          start.requestBody = body;
        }
      } else if (!hasNoBodyByMethod(request.method) && request.body !== null) {
        start.requestBodyUnknown = true;
      }
    } catch {
      return originalFetch.call(globalThis, input, init);
    }

    // 2항. start 줄을 쓰고 원래 fetch 를 ALS 안에서 부른다.
    start.t0 = now();
    write(start);
    const seq = start.seq;
    const endBase = () => ({ kind: "end", pid, seq });

    let pending;
    try {
      pending = als.run(seq, () => originalFetch.call(globalThis, request));
    } catch (error) {
      // 5항. 동기로 던지는 fetch 는 없지만, 있더라도 end 줄을 남기고 그대로 던진다.
      write({ ...endBase(), tEnd: now(), bodyEnd: false, error: errorText(error) });
      throw error;
    }

    return pending.then(
      (response) => {
        // 3항. tHeaders 는 await 가 돌아온 직후.
        const tHeaders = now();
        try {
          observeFetchResponse(response, { endBase, tHeaders, now, write });
        } catch {
          // 관측에 실패해도 응답은 그대로 돌려준다. 끝 줄은 헤더 시각으로 닫는다.
          write({
            ...endBase(),
            status: response.status,
            tHeaders,
            tEnd: tHeaders,
            bodyEnd: false,
          });
        }
        return response;
      },
      (error) => {
        // 5항. 원래 fetch 가 던지면 end 줄을 쓰고 그대로 다시 던진다.
        write({ ...endBase(), tEnd: now(), bodyEnd: false, error: errorText(error) });
        throw error;
      },
    );
  };
}

function observeFetchResponse(response, { endBase, tHeaders, now, write }) {
  // 4항. status, Location, 리다이렉트됐으면 finalUrl.
  const head = { ...endBase(), status: response.status };
  const location = response.headers.get("location");
  if (location !== null) head.responseHeaders = { location };
  if (response.redirected) head.finalUrl = response.url;
  head.tHeaders = tHeaders;

  // 3항. 본문이 없는 응답(204, HEAD, redirect: "manual" 의 3xx)은 읽을 것이 없다.
  if (response.body === null) {
    write({ ...head, responseBody: "", bytes: 0, tEnd: tHeaders, bodyEnd: true });
    return;
  }

  // 3항. 복제본을 끝까지 읽는 작업을 기다리지 않고 건다. 원본은 호출자가 즉시 받는다.
  // 서버가 원본을 안 읽어도 복제본 읽기가 네트워크를 끝까지 당기므로 tEnd 는 본문 끝이다.
  const clone = response.clone();
  void readClonedBody(clone.body, head, { now, write });
}

async function readClonedBody(stream, head, { now, write }) {
  const chunks = [];
  let kept = 0;
  let bytes = 0;
  let truncated = false;
  try {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (truncated) continue;
      if (kept + value.byteLength <= MAX_BODY_BYTES) {
        chunks.push(value);
        kept += value.byteLength;
      } else {
        chunks.push(value.subarray(0, MAX_BODY_BYTES - kept));
        kept = MAX_BODY_BYTES;
        truncated = true;
      }
    }
  } catch (error) {
    // 5항. 복제본 읽기가 던져도 end 줄은 남긴다. 호출자에게는 원본이 이미 갔으므로 던질 곳이 없다.
    write({ ...head, bytes, tEnd: now(), bodyEnd: false, error: errorText(error) });
    return;
  }
  const tEnd = now();
  const end = { ...head, responseBody: decodeUtf8(chunks, kept) };
  if (truncated) end.responseBodyTruncated = true;
  end.bytes = bytes;
  end.tEnd = tEnd;
  end.bodyEnd = true;
  write(end);
}

function decodeUtf8(chunks, total) {
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(joined);
}

// ───────────────────────── node:http / node:https (§4.3, diagnostics_channel) ─────────────────────────

function installNodeHttp({ pid, now, write, nextSeq }) {
  /** request 객체 → { seq, done }. 끝 줄을 한 번만 쓰기 위한 상태다. */
  const states = new WeakMap();

  const finish = (state, end) => {
    if (state.done) return;
    state.done = true;
    write({ kind: "end", pid, seq: state.seq, ...state.head, ...end });
  };

  const subscribe = (name, handler) => {
    diagnosticsChannel.subscribe(name, (message) => {
      try {
        handler(message);
      } catch {
        // 관측 실패는 서버로 새지 않는다.
      }
    });
  };

  // 1항. request 를 키로 seq 를 정하고 start 줄을 쓴다.
  subscribe("http.client.request.start", ({ request }) => {
    if (request === undefined || request === null || states.has(request)) return;
    const seq = nextSeq();
    states.set(request, { seq, done: false, head: {} });
    const method = String(request.method ?? "GET").toUpperCase();
    const hostHeader = request.getHeader?.("host");
    const host = hostHeader !== undefined ? String(hostHeader) : String(request.host ?? "");
    const start = {
      kind: "start",
      pid,
      seq,
      via: "node:http",
      method,
      url: `${request.protocol ?? "http:"}//${host}${request.path ?? "/"}`,
      t0: now(),
    };
    const requestHeaders = pickHeaders(Object.entries(request.getHeaders?.() ?? {}));
    if (requestHeaders !== undefined) start.requestHeaders = requestHeaders;
    if (!hasNoBodyByMethod(method)) start.requestBodyUnknown = true;
    write(start);
  });

  // 2항·3항. 헤더 시각을 기억하고 end·close 만 건다. data 리스너·resume()·setEncoding() 은 부르지 않는다.
  subscribe("http.client.response.finish", ({ request, response }) => {
    const state = states.get(request);
    if (state === undefined || state.done) return;
    state.head.tHeaders = now();
    if (typeof response.statusCode === "number") state.head.status = response.statusCode;
    const location = response.headers?.location;
    if (typeof location === "string") state.head.responseHeaders = { location };
    response.once("end", () => finish(state, { tEnd: now(), bodyEnd: true }));
    response.once("close", () => finish(state, { tEnd: now(), bodyEnd: false }));
  });

  // 4항.
  subscribe("http.client.request.error", ({ request, error }) => {
    const state = states.get(request);
    if (state === undefined) return;
    finish(state, { tEnd: now(), bodyEnd: false, error: errorText(error) });
  });
}

// ───────────────────────── HTTP/2 (§4.3) ─────────────────────────

function installHttp2({ pid, now, write, nextSeq }) {
  const seqs = new WeakMap();

  diagnosticsChannel.subscribe("http2.client.stream.created", ({ stream, headers }) => {
    try {
      if (stream === undefined || stream === null || seqs.has(stream)) return;
      const seq = nextSeq();
      seqs.set(stream, seq);
      const method = String(headers?.[":method"] ?? "GET").toUpperCase();
      const scheme = headers?.[":scheme"] ?? "https";
      const authority = headers?.[":authority"] ?? "";
      const path = headers?.[":path"] ?? "/";
      const start = {
        kind: "start",
        pid,
        seq,
        via: "http2",
        method,
        url: `${scheme}://${authority}${path}`,
        t0: now(),
      };
      if (!hasNoBodyByMethod(method)) start.requestBodyUnknown = true;
      write(start);
    } catch {
      // 관측 실패는 서버로 새지 않는다.
    }
  });

  diagnosticsChannel.subscribe("http2.client.stream.close", ({ stream }) => {
    try {
      const seq = seqs.get(stream);
      if (seq === undefined) return;
      seqs.delete(stream);
      write({ kind: "end", pid, seq, tEnd: now(), bodyEnd: true });
    } catch {
      // 관측 실패는 서버로 새지 않는다.
    }
  });
}

// ───────────────────────── undici (§4.3) ─────────────────────────

function installUndici({ pid, now, write, nextSeq, als }) {
  /** request 객체 → { seq, done, head }. */
  const states = new WeakMap();

  const finish = (state, end) => {
    if (state.done) return;
    state.done = true;
    write({ kind: "end", pid, seq: state.seq, ...state.head, ...end });
  };

  const subscribe = (name, handler) => {
    diagnosticsChannel.subscribe(name, (message) => {
      try {
        handler(message);
      } catch {
        // 관측 실패는 서버로 새지 않는다.
      }
    });
  };

  subscribe("undici:request:create", ({ request }) => {
    if (request === undefined || request === null || states.has(request)) return;
    const seq = nextSeq();
    states.set(request, { seq, done: false, head: {} });
    const method = String(request.method ?? "GET").toUpperCase();
    const start = {
      kind: "start",
      pid,
      seq,
      via: "undici",
      method,
      url: `${String(request.origin ?? "")}${String(request.path ?? "/")}`,
      t0: now(),
    };
    // fetch 래퍼 안에서 생겼으면 그 fetch 의 seq. §5.2 가 이것으로 중복을 지운다.
    const parentFetch = als.getStore();
    if (typeof parentFetch === "number") start.parentFetch = parentFetch;
    if (!hasNoBodyByMethod(method)) start.requestBodyUnknown = true;
    write(start);
  });

  // 설계는 trailers·error 만 말하지만, 헤더 시각과 상태는 타입이 허용하는 필드라 함께 적는다.
  // 본문을 끝까지 안 읽어 trailers 가 안 오는 요청에 §5.1 의 tHeaders 폴백이 생긴다.
  subscribe("undici:request:headers", ({ request, response }) => {
    const state = states.get(request);
    if (state === undefined || state.done) return;
    state.head.tHeaders = now();
    if (typeof response?.statusCode === "number") state.head.status = response.statusCode;
  });

  subscribe("undici:request:trailers", ({ request }) => {
    const state = states.get(request);
    if (state === undefined) return;
    finish(state, { tEnd: now(), bodyEnd: true });
  });

  subscribe("undici:request:error", ({ request, error }) => {
    const state = states.get(request);
    if (state === undefined) return;
    finish(state, { tEnd: now(), bodyEnd: false, error: errorText(error) });
  });
}

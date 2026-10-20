// `mcpeak perf` 의 자식 프리로드(설계 §4). `NODE_OPTIONS=--import=<이 파일>` 로 서버 프로세스에 실려
// 나가는 HTTP 요청의 시작·끝 시각을 `${MCPEAK_PERF_TRACE_DIR}/${pid}.jsonl` 에 적는다.
//
// 이 파일의 원칙은 하나다. **관측이 서버 동작을 바꾸면 측정이 아니다.** 그래서
//   - 응답 스트림에 `data` 리스너를 달거나 `resume()`·`setEncoding()` 을 부르지 않는다(§4.3 node:http 2항).
//     flowing 으로 바뀐 스트림은 서버가 나중에 다는 리스너가 앞부분을 놓친다.
//   - fetch 의 본문은 복제(`clone()`, tee)하지 않는다. 원본 본문을 통과 스트림으로 감싸 서버가 읽는 청크만
//     센다(§4.3 fetch 3항). 복제본은 서버가 버린 본문도 끝까지 붙들고 안 읽은 본문을 메모리에 쌓는다(계획 E22).
//   - 관측 코드 자신의 예외는 전부 잡아서 버린다. 단 원래 fetch 가 던진 오류와 본문 스트림의 오류는 end 줄을
//     쓴 뒤 서버에게 그대로 간다.
//   - 환경 변수를 지우지 않는다. `npx` 같은 중간 런처가 지우면 진짜 서버가 빈손으로 뜬다(§4.1).
//   - 의존성 없이 `node:` 모듈만 쓴다. 서버의 `node_modules` 가 무엇이든 이 파일은 로드돼야 한다.
import { AsyncLocalStorage } from "node:async_hooks";
import diagnosticsChannel from "node:diagnostics_channel";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { threadId } from "node:worker_threads";

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

  /**
   * §4.2. 스레드마다 `threadId × 1_000_000_000 + n`(n 은 그 스레드에서 1부터). worker_threads 에도 이 파일이
   * 따로 실리는데 pid 가 같아서, 나누지 않으면 `(pid, seq)` 가 겹쳐 병합에서 요청이 사라진다(계획 E23).
   */
  const seqBase = threadId * 1_000_000_000;
  let lastSeq = 0;
  const nextSeq = () => {
    lastSeq += 1;
    return seqBase + lastSeq;
  };

  /** fetch 래퍼 안에서 생긴 undici 요청에 `parentFetch` 를 달기 위한 저장소(§5.2). */
  const als = new AsyncLocalStorage();

  /**
   * fetch seq → 그 fetch 안 undici 요청의 마지막 `trailers` 시각(§4.3 fetch 3항의 tEnd). 작은 본문은 서버가
   * 읽기 전에, 심지어 fetch 가 응답을 돌려주기 전에 trailers 가 올 수 있어 따로 기억한다. 끝 줄을 쓰거나
   * 응답이 수거되면 지운다.
   */
  const trailersAt = new Map();

  write({ kind: "hello", pid, ppid: process.ppid, node: process.version, t: now() });

  installFetch({ pid, now, write, nextSeq, als, trailersAt });
  installNodeHttp({ pid, now, write, nextSeq });
  installHttp2({ pid, now, write, nextSeq });
  installUndici({ pid, now, write, nextSeq, als, trailersAt });
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

function installFetch({ pid, now, write, nextSeq, als, trailersAt }) {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return;

  // 서버가 본문을 끝내 읽지 않은 응답의 trailers 기록을 응답이 수거될 때 지운다.
  const forget = new FinalizationRegistry((seq) => trailersAt.delete(seq));

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
      trailersAt.delete(seq);
      write({ ...endBase(), tEnd: now(), bodyEnd: false, error: errorText(error) });
      throw error;
    }

    return pending.then(
      (response) => {
        // 3항. tHeaders 는 await 가 돌아온 직후.
        const tHeaders = now();
        try {
          const observed = observeFetchResponse(response, {
            endBase,
            tHeaders,
            now,
            write,
            trailersAt,
          });
          // 끝 줄 뒤에 trailers 가 늦게 와 다시 남는 기록도 응답이 수거되면 지운다.
          forget.register(observed, seq);
          return observed;
        } catch {
          // 관측에 실패하면 원본 응답을 그대로 돌려준다. 끝 줄을 쓰지 않아 하한 경로로 간다.
          trailersAt.delete(seq);
          return response;
        }
      },
      (error) => {
        // 5항. 원래 fetch 가 던지면 end 줄을 쓰고 그대로 다시 던진다.
        trailersAt.delete(seq);
        write({ ...endBase(), tEnd: now(), bodyEnd: false, error: errorText(error) });
        throw error;
      },
    );
  };
}

/**
 * 3항·4항. 원본 본문을 통과 스트림으로 감싼 새 Response 를 돌려준다. 서버가 읽는 만큼만 원본에서 당기고
 * (highWaterMark 0), 서버가 버리면 원본도 바로 버린다. 본문이 없으면 끝 줄을 쓰고 원본을 그대로 돌려준다.
 */
function observeFetchResponse(response, { endBase, tHeaders, now, write, trailersAt }) {
  // 4항. status, Location, 리다이렉트됐으면 finalUrl.
  const head = { ...endBase(), status: response.status };
  const location = response.headers.get("location");
  if (location !== null) head.responseHeaders = { location };
  if (response.redirected) head.finalUrl = response.url;
  head.tHeaders = tHeaders;
  const seq = head.seq;

  // 3항. 본문이 없는 응답(204, HEAD, redirect: "manual" 의 3xx)은 읽을 것이 없다.
  if (response.body === null) {
    trailersAt.delete(seq);
    write({ ...head, responseBody: "", bytes: 0, tEnd: tHeaders, bodyEnd: true });
    return response;
  }

  const chunks = [];
  let kept = 0;
  let bytes = 0;
  let truncated = false;
  let done = false;
  /** 끝 줄은 한 번만 쓴다. */
  const finish = (end) => {
    if (done) return;
    done = true;
    trailersAt.delete(seq);
    write({ ...head, ...end });
  };
  const keep = (value) => {
    bytes += value.byteLength;
    if (truncated) return;
    if (kept + value.byteLength <= MAX_BODY_BYTES) {
      chunks.push(value);
      kept += value.byteLength;
    } else {
      chunks.push(value.subarray(0, MAX_BODY_BYTES - kept));
      kept = MAX_BODY_BYTES;
      truncated = true;
    }
  };

  // 원본 reader 는 서버가 처음 읽을 때 잡는다. 아래 new Response 가 던지면 원본 본문이 잠기지 않은 채
  // 원본 응답이 서버에게 간다.
  let source;
  const reader = () => {
    source ??= response.body.getReader();
    return source;
  };

  const passthrough = new ReadableStream(
    {
      async pull(controller) {
        let chunk;
        try {
          chunk = await reader().read();
        } catch (error) {
          // 5항. 본문 스트림 오류는 끝 줄을 남기고 서버에게 그대로 간다.
          finish({ bytes, tEnd: now(), bodyEnd: false, error: errorText(error) });
          throw error;
        }
        if (chunk.done) {
          // tEnd 는 같은 fetch 의 undici trailers(네트워크에서 본문이 끝난 시각). 채널이 없으면 지금.
          const tEnd = trailersAt.get(seq) ?? now();
          const end = { responseBody: decodeUtf8(chunks, kept) };
          if (truncated) end.responseBodyTruncated = true;
          end.bytes = bytes;
          end.tEnd = tEnd;
          end.bodyEnd = true;
          finish(end);
          controller.close();
          return;
        }
        try {
          keep(chunk.value);
        } catch {
          // 보관 실패는 관측의 일이다. 청크는 그대로 서버에게 간다.
        }
        controller.enqueue(chunk.value);
      },
      cancel(reason) {
        // 서버가 본문을 버렸다. 그 시각으로 닫고 원본도 바로 버려 연결을 놓는다.
        finish({ bytes, tEnd: now(), bodyEnd: false });
        return source === undefined ? response.body.cancel(reason) : source.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );

  const wrapped = new Response(passthrough, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  dressAs(wrapped, response);
  return wrapped;
}

/**
 * 프리로드가 로드될 때의 `Response.prototype.clone`. 호출 시점의 프로토타입 값이 함수가 아닐 때만 쓰는 대비값이다.
 * 모듈 최상위라 install 의 try 밖이므로, Response 가 없는 런타임에서도 던지지 않게 읽는다(감싸기는 Response 가
 * 있을 때만 일어난다).
 */
const loadTimeClone = globalThis.Response?.prototype?.clone;

/**
 * §4.3 fetch 3항, 계획 E36. 부를 때마다 지금의 `Response.prototype.clone` 을 읽는다. 프리로드 뒤에 그것을 덮는
 * 라이브러리(msw 류)가 있으면 원본 응답에서처럼 그 clone 이 불려야 한다.
 */
function currentClone() {
  const now = globalThis.Response?.prototype?.clone;
  return typeof now === "function" ? now : loadTimeClone;
}

/**
 * §4.3 fetch 3항 끝 문장(계획 E30). 감싼 응답 target 이 원본 source 와 같게 보이게 한다. 새 Response 는
 * url·redirected·type 을 받지 못하고, headers 는 고칠 수 있는 사본이 되며, 원래 clone() 은 그 둘을 잃은 복제본을
 * 만든다. 그래서 넷을 원본 값으로 덮고 clone 도 덮는다. 모두 열거되지 않는 own 속성이라 Object.keys·
 * JSON.stringify 는 원본처럼 비어 있다.
 */
function dressAs(target, source) {
  const hidden = (value) => ({ value, enumerable: false, writable: false, configurable: true });
  Object.defineProperties(target, {
    url: hidden(source.url),
    redirected: hidden(source.redirected),
    type: hidden(source.type),
    // 원본 응답의 Headers 는 불변(immutable guard)이라 서버가 고치려 하면 원본처럼 TypeError 가 난다.
    headers: hidden(source.headers),
    // 원래 clone 의 의미(두 갈래 모두 읽힘, bodyUsed 면 TypeError)는 호출 시점의 프로토타입 clone 이 지킨다.
    // 그 clone 이 던지면 서버에게 그대로 간다. 이 호출은 서버가 clone() 을 부를 때만 일어나며, 관측이 스스로
    // 본문을 복제하는 일은 없다.
    clone: hidden(function clone() {
      const copy = Reflect.apply(currentClone(), this, []);
      if (copy !== null && typeof copy === "object") {
        try {
          dressAs(copy, source);
        } catch {
          // 덮은 clone 이 고칠 수 없는 객체를 돌려줬다. 그 값을 그대로 서버에게 준다.
        }
      }
      return copy;
    }),
  });
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

function installUndici({ pid, now, write, nextSeq, als, trailersAt }) {
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
    const state = { seq, done: false, head: {} };
    states.set(request, state);
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
    if (typeof parentFetch === "number") {
      start.parentFetch = parentFetch;
      state.parentFetch = parentFetch;
    }
    if (!hasNoBodyByMethod(method)) start.requestBodyUnknown = true;
    write(start);
  });

  // tHeaders 만 적고 status 는 적지 않는다(§4.3 undici 절, 계획 E27). §6.2 (a) 가 undici 를 status 없는
  // 경로로 다룬다. 본문을 끝까지 안 읽어 trailers 가 안 오는 요청에 §5.1 의 tHeaders 폴백이 생긴다.
  subscribe("undici:request:headers", ({ request }) => {
    const state = states.get(request);
    if (state === undefined || state.done) return;
    state.head.tHeaders = now();
  });

  subscribe("undici:request:trailers", ({ request }) => {
    const state = states.get(request);
    if (state === undefined) return;
    const tEnd = now();
    // fetch 안의 요청이면 그 fetch 의 끝 시각으로도 쓴다. 리다이렉트는 홉마다 오므로 마지막 홉이 남는다.
    if (state.parentFetch !== undefined) trailersAt.set(state.parentFetch, tEnd);
    finish(state, { tEnd, bodyEnd: true });
  });

  subscribe("undici:request:error", ({ request, error }) => {
    const state = states.get(request);
    if (state === undefined) return;
    finish(state, { tEnd: now(), bodyEnd: false, error: errorText(error) });
  });
}

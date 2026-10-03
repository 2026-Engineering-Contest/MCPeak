// @ts-check
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isHostname, isInternalAddress, splitHostHeader } from "./address.mjs";
import { decodeBody, observeRequest } from "./observe.mjs";
import { matchKey } from "./session.mjs";

/**
 * @typedef {import("./state.mjs").GatewayState} GatewayState
 * @typedef {import("../../src/types.js").ObservedRequest} ObservedRequest
 * @typedef {"http" | "https"} Scheme
 * @typedef {(host: string) => Promise<string>} Lookup 이름을 **한 번** 풀어 주소 하나를 돌려준다
 * @typedef {(target: { scheme: Scheme, address: string, port: number }) => { host: string, port: number }} Dial
 *   실제로 소켓을 열 곳. 기본은 받은 주소와 포트 그대로다. 루프백 스펙이 상류를 로컬로 돌릴 때만 바꾼다
 */

/** 기록과 매칭 키에 쓰는 포트. 받은 소켓의 실제 포트가 아니라 스킴의 자리다(임시 포트가 기록에 새지 않는다). */
const SCHEME_PORT = /** @type {const} */ ({ http: 80, https: 443 });

/**
 * @param {import("node:http").IncomingMessage} request
 * @returns {Promise<Buffer>}
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
    request.on("aborted", () => reject(new Error("요청이 중간에 끊겼습니다.")));
  });
}

/**
 * 게이트웨이가 스스로 만든 응답.
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {string} text
 */
function reply(response, status, text) {
  if (response.headersSent || response.destroyed) {
    response.destroy();
    return;
  }
  const body = Buffer.from(text, "utf8");
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(body.length),
  });
  response.end(body);
}

/**
 * @param {ReadonlyArray<string>} rawHeaders
 * @returns {Array<[string, string]>}
 */
function pairs(rawHeaders) {
  /** @type {Array<[string, string]>} */
  const result = [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    result.push([rawHeaders[index] ?? "", rawHeaders[index + 1] ?? ""]);
  }
  return result;
}

/**
 * 80·443 으로 온 요청을 다루는 쪽. 재생이면 세션으로 답하고, 아니면 상류로 전달한다.
 * @param {GatewayState} state
 * @param {{ lookup: Lookup, dial: Dial }} io
 */
export function createForwarder(state, io) {
  /** @type {Set<import("node:http").ClientRequest>} */
  const upstreams = new Set();

  /** 게이트웨이가 상류 없이 스스로 답한 요청의 served. 재생에서는 live 일 수 없다. */
  const servedLocally = () => (state.mode === "replay" ? "replay-hit" : "live");

  /**
   * @param {Scheme} scheme
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  async function handle(scheme, request, response) {
    // 단계는 요청을 받은 시점의 것이다. 본문을 다 읽은 때가 아니다.
    const phase = state.phase;
    const raw = await readBody(request);
    const { host, isIp } = splitHostHeader(request.headers.host);
    const method = request.method ?? "";
    const path = request.url ?? "";
    const body = await decodeBody(raw, request.headers["content-encoding"]);
    const port = SCHEME_PORT[scheme];
    /** @param {ObservedRequest["served"]} served */
    const note = (served) => {
      state.requests.push(
        observeRequest({
          phase,
          scheme,
          host,
          port,
          method,
          path,
          rawHeaders: request.rawHeaders,
          body,
          served,
        }),
      );
    };

    if (isIp) {
      note("blocked");
      reply(response, 502, "mcpeak: Host 가 IP 주소인 요청은 전달하지 않습니다");
      return;
    }
    if (!isHostname(host)) {
      note("blocked");
      reply(response, 400, "mcpeak: Host 가 호스트 이름이 아닙니다");
      return;
    }
    if (scheme === "https") {
      const socket = /** @type {import("node:tls").TLSSocket} */ (request.socket);
      const sni = typeof socket.servername === "string" ? socket.servername.toLowerCase() : "";
      if (sni !== host) {
        note(servedLocally());
        reply(response, 421, "mcpeak: SNI 와 Host 가 다릅니다");
        return;
      }
    }

    const key = matchKey({ method, scheme, host, port, path, body }, state.secrets);

    // 재생 분기는 상류에 닿는 어떤 코드보다 앞에 있다. 이 아래의 이름 풀이와 소켓 열기는 재생에서 실행되지 않는다.
    if (state.mode === "replay") {
      const answer = state.replayer.answer(key, state.secrets);
      note(answer.served);
      const stored = answer.response;
      const bodyless = method === "HEAD" || stored.status === 204 || stored.status === 304;
      /** @type {string[]} */
      const flat = [];
      for (const [name, value] of stored.headers) {
        // 자리표를 이 실행의 값으로 되돌리면 본문 길이가 달라질 수 있다. 길이만 실제 값으로 맞춘다.
        const fixed = !bodyless && name.toLowerCase() === "content-length";
        flat.push(name, fixed ? String(stored.body.length) : value);
      }
      response.writeHead(stored.status, flat);
      response.end(stored.body);
      return;
    }

    /** @type {string} */
    let address;
    try {
      address = await io.lookup(host);
    } catch {
      note("live");
      reply(response, 502, "mcpeak: 상류 이름을 풀지 못했습니다");
      return;
    }
    // 방금 푼 그 주소로 판정하고 그 주소로 접속한다. 다시 풀지 않는다(확인과 접속 사이에 답이 바뀌는 틈이 없다).
    if (isInternalAddress(address)) {
      note("blocked");
      reply(response, 502, "mcpeak: 내부 주소로는 전달하지 않습니다");
      return;
    }
    note("live");

    const target = io.dial({ scheme, address, port });
    const upstream = (scheme === "https" ? httpsRequest : httpRequest)({
      host: target.host,
      port: target.port,
      method,
      path,
      headers: request.rawHeaders,
      setHost: false,
      agent: false,
      // 주소로 접속하지만 SNI 와 인증서 대조는 이름으로 한다. 검증은 시스템 CA 다.
      ...(scheme === "https" ? { servername: host } : {}),
    });
    upstreams.add(upstream);
    upstream.on("close", () => upstreams.delete(upstream));
    upstream.on("error", () => reply(response, 502, "mcpeak: 상류에 접속하지 못했습니다"));
    response.on("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });
    upstream.on("response", (answer) => {
      /** @type {Buffer[]} */
      const chunks = [];
      response.writeHead(answer.statusCode ?? 502, answer.statusMessage, answer.rawHeaders);
      answer.on("data", (chunk) => {
        if (state.mode === "record") chunks.push(chunk);
        response.write(chunk);
      });
      answer.on("end", () => {
        response.end();
        if (state.mode === "record") {
          state.recorder.record(
            key,
            {
              status: answer.statusCode ?? 502,
              headers: pairs(answer.rawHeaders),
              body: Buffer.concat(chunks),
            },
            state.secrets,
          );
        }
      });
      answer.on("error", () => response.destroy());
    });
    // 전달은 기록 상한과 무관하게 받은 바이트 전부다.
    upstream.end(raw);
  }

  return {
    /**
     * @param {Scheme} scheme
     * @returns {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void}
     */
    onRequest(scheme) {
      return (request, response) => {
        state.inflight += 1;
        let left = false;
        response.on("close", () => {
          if (left) return;
          left = true;
          state.inflight -= 1;
          if (state.inflight === 0) state.notifyIdle();
        });
        handle(scheme, request, response).catch(() => {
          reply(response, 502, "mcpeak: 요청을 전달하지 못했습니다");
        });
      };
    },
    /**
     * `CONNECT` 와 업그레이드(WebSocket). 전달하지 않고 501 로 답하며 기록한다.
     * @param {Scheme} scheme
     * @returns {(request: import("node:http").IncomingMessage, socket: import("node:stream").Duplex) => void}
     */
    onTunnel(scheme) {
      return (request, socket) => {
        state.requests.push(
          observeRequest({
            phase: state.phase,
            scheme,
            host: splitHostHeader(request.headers.host).host,
            port: SCHEME_PORT[scheme],
            method: request.method ?? "",
            path: request.url ?? "",
            rawHeaders: request.rawHeaders,
            body: Buffer.alloc(0),
            served: servedLocally(),
          }),
        );
        const body = Buffer.from("mcpeak: CONNECT 와 업그레이드는 전달하지 않습니다", "utf8");
        socket.on("error", () => {});
        socket.end(
          Buffer.concat([
            Buffer.from(
              `HTTP/1.1 501 Not Implemented\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n`,
              "latin1",
            ),
            body,
          ]),
        );
      };
    },
    /** 열려 있는 상류 접속을 전부 끊는다. */
    closeUpstreams() {
      for (const upstream of upstreams) upstream.destroy();
      upstreams.clear();
    },
  };
}

// @ts-check
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createReplayer, parseSession, SessionFormatError, serializeSession } from "./session.mjs";

/**
 * @typedef {import("./state.mjs").GatewayState} GatewayState
 * @typedef {import("../../src/types.js").SandboxPhase} SandboxPhase
 */

/** `POST /phase` 가 진행 중 요청을 기다리는 상한(§3.2). */
export const PHASE_WAIT_MS = 500;

/** @param {string} text */
const digest = (text) => createHash("sha256").update(text, "utf8").digest();

/**
 * `Authorization` 이 정확히 `Bearer <토큰>` 인가. 길이가 달라도 같은 시간이 들게 해시끼리 비교한다.
 * @param {string | undefined} header
 * @param {string} token
 */
function authorized(header, token) {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${token}`));
}

/**
 * @param {unknown} value
 * @returns {SandboxPhase | null}
 */
function readPhase(value) {
  if (typeof value !== "object" || value === null) return null;
  const phase = /** @type {Record<string, unknown>} */ (value);
  if (phase.kind === "start" || phase.kind === "list" || phase.kind === "shutdown") {
    return { kind: phase.kind };
  }
  if (
    phase.kind === "call" &&
    typeof phase.toolIndex === "number" &&
    Number.isInteger(phase.toolIndex) &&
    typeof phase.toolName === "string" &&
    typeof phase.callId === "string"
  ) {
    return {
      kind: "call",
      toolIndex: phase.toolIndex,
      toolName: phase.toolName,
      callId: phase.callId,
    };
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {Array<import("./session.mjs").Secret> | null}
 */
function readSecrets(value) {
  if (typeof value !== "object" || value === null) return null;
  const list = /** @type {Record<string, unknown>} */ (value).secrets;
  if (!Array.isArray(list)) return null;
  /** @type {Array<import("./session.mjs").Secret>} */
  const secrets = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) return null;
    const { label, value: secret } = /** @type {Record<string, unknown>} */ (item);
    if (typeof label !== "string" || label === "" || typeof secret !== "string") return null;
    secrets.push({ label, value: secret });
  }
  return secrets;
}

/**
 * 제어 포트(§3.7 의 표). 베어러 토큰이 맞지 않으면 경로가 무엇이든 401 이고 아무것도 내주지 않는다.
 * @param {GatewayState} state
 * @param {{
 *   token: string,
 *   caPem: string,
 *   healthy: () => boolean,
 *   phaseWaitMs?: number,
 * }} options
 * @returns {import("node:http").Server}
 */
export function createControlServer(state, options) {
  const phaseWaitMs = options.phaseWaitMs ?? PHASE_WAIT_MS;

  /**
   * @param {import("node:http").ServerResponse} response
   * @param {number} status
   * @param {string} body
   */
  const sendText = (response, status, body) => {
    const bytes = Buffer.from(body, "utf8");
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(bytes.length),
      "cache-control": "no-store",
    });
    response.end(bytes);
  };
  /**
   * @param {import("node:http").ServerResponse} response
   * @param {number} status
   * @param {unknown} value
   */
  const send = (response, status, value) => sendText(response, status, JSON.stringify(value));

  return createServer((request, response) => {
    // 인증이 가장 먼저다. 본문을 읽기도 전에 판정한다.
    if (!authorized(request.headers.authorization, options.token)) {
      response.setHeader("www-authenticate", "Bearer");
      send(response, 401, { error: "Authorization: Bearer <토큰> 이 없거나 틀립니다." });
      request.resume();
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", () => response.destroy());
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const route = `${request.method} ${(request.url ?? "").split("?")[0]}`;
      /** @returns {unknown} */
      const json = () => {
        try {
          return JSON.parse(text);
        } catch {
          return undefined;
        }
      };
      switch (route) {
        case "GET /health": {
          const ok = options.healthy();
          send(response, ok ? 200 : 503, { ok });
          return;
        }
        case "GET /ca":
          send(response, 200, { pem: options.caPem });
          return;
        case "POST /secrets": {
          const secrets = readSecrets(json());
          if (secrets === null) {
            send(response, 400, {
              error: '본문이 { "secrets": [{ "label": "…", "value": "…" }] } 꼴이 아닙니다.',
            });
            return;
          }
          // 덧붙이지 않고 바꾼다. 같은 목록을 두 번 보내도 결과가 같다.
          state.secrets = secrets;
          send(response, 200, { ok: true });
          return;
        }
        case "POST /session": {
          try {
            state.replayer = createReplayer(parseSession(text));
          } catch (error) {
            if (!(error instanceof SessionFormatError)) throw error;
            send(response, 400, { error: error.message });
            return;
          }
          state.mode = "replay";
          send(response, 200, { ok: true });
          return;
        }
        case "POST /phase": {
          const body = json();
          const phase = readPhase(
            typeof body === "object" && body !== null
              ? /** @type {Record<string, unknown>} */ (body).phase
              : undefined,
          );
          if (phase === null) {
            send(response, 400, { error: '본문이 { "phase": SandboxPhase } 꼴이 아닙니다.' });
            return;
          }
          // 기다리는 동안 온 요청은 이전 단계에 붙는다. 그래서 단계는 기다린 뒤에 바꾼다.
          void state.waitIdle(phaseWaitMs).then(() => {
            state.phase = phase;
            send(response, 200, { ok: true });
          });
          return;
        }
        case "GET /observation":
          send(response, 200, {
            requests: state.requests,
            tlsRejections: state.tlsRejections,
            dnsNames: state.dnsNames,
          });
          return;
        case "GET /session":
          // 세션 파일의 바이트 그대로다. 받은 쪽은 다시 직렬화하지 않고 그대로 쓴다.
          sendText(
            response,
            200,
            serializeSession(
              state.mode === "replay" ? state.replayer.session() : state.recorder.session(),
            ),
          );
          return;
        default:
          send(response, 404, { error: `없는 경로입니다: ${route}` });
      }
    });
  });
}

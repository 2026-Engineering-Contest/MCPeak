// @ts-check
import { createSocket } from "node:dgram";
import { lookup as dnsLookup } from "node:dns/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { isHostname } from "./address.mjs";
import { createControlServer } from "./control.mjs";
import { answerDnsQuery } from "./dns.mjs";
import { createForwarder } from "./forward.mjs";
import { createState } from "./state.mjs";
import { createOpensslAuthority, createSniCallback } from "./tls.mjs";

/**
 * @typedef {{ dns: number, http: number, https: number, control: number }} GatewayPorts
 * @typedef {{
 *   token: string,
 *   mode?: import("./state.mjs").GatewayMode,
 *   address: string | null,
 *   bind?: string,
 *   ports?: Partial<GatewayPorts>,
 *   authority?: import("./tls.mjs").CertificateAuthority,
 *   lookup?: import("./forward.mjs").Lookup,
 *   dial?: import("./forward.mjs").Dial,
 *   phaseWaitMs?: number,
 * }} GatewayOptions
 *   `token` 은 제어 포트의 베어러 토큰. `address` 는 `A` 질의에 줄 주소(internal 네트워크 쪽 자기 주소).
 *   나머지는 루프백 스펙이 포트와 상류를 바꿔 끼우는 주입점이고, 컨테이너 진입점은 기본값을 쓴다.
 */

/** 컨테이너 안의 포트. 제어 포트는 호스트의 127.0.0.1 임의 포트로 publish 된다. */
export const DEFAULT_PORTS = /** @type {const} */ ({
  dns: 53,
  http: 80,
  https: 443,
  control: 7000,
});

/**
 * 이름을 한 번 풀어 주소 하나를 고른다. IPv4 가 있으면 IPv4 다(bridge 에는 IPv6 경로가 없는 것이 보통이다).
 * @type {import("./forward.mjs").Lookup}
 */
async function systemLookup(host) {
  const addresses = await dnsLookup(host, { all: true });
  const chosen = addresses.find((entry) => entry.family === 4) ?? addresses[0];
  if (chosen === undefined) throw new Error("주소가 없습니다.");
  return chosen.address;
}

/**
 * @param {{ listen: (port: number, host: string, callback: () => void) => unknown, once: Function, removeListener: Function }} server
 * @param {number} port
 * @param {string} bind
 * @returns {Promise<void>}
 */
function listen(server, port, bind) {
  return new Promise((resolve, reject) => {
    /** @param {Error} error */
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, bind, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
}

/**
 * @param {import("node:http").Server} server
 * @returns {Promise<void>}
 */
function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/**
 * 게이트웨이를 띄운다: DNS(UDP), HTTP, TLS, 제어 포트. 넷이 전부 듣기 시작한 뒤에 돌아온다.
 * @param {GatewayOptions} options
 * @returns {Promise<{ ports: GatewayPorts, close(): Promise<void> }>}
 */
export async function startGateway(options) {
  if (typeof options.token !== "string" || options.token === "") {
    throw new Error("베어러 토큰이 비어 있습니다.");
  }
  const bind = options.bind ?? "0.0.0.0";
  const wanted = { ...DEFAULT_PORTS, ...options.ports };
  const state = createState(options.mode ?? "live");
  const authority = options.authority ?? (await createOpensslAuthority());
  const forwarder = createForwarder(state, {
    lookup: options.lookup ?? systemLookup,
    dial: options.dial ?? (({ address, port }) => ({ host: address, port })),
  });

  const dns = createSocket("udp4");
  let dnsListening = false;
  dns.on("message", (packet, remote) => {
    const result = answerDnsQuery(packet, options.address);
    if (result === null) return;
    state.dnsNames.push({ phase: state.phase, name: result.name });
    dns.send(result.response, remote.port, remote.address, () => {});
  });
  // 듣기 시작한 뒤의 소켓 오류로 프로세스가 죽지 않게 한다. 관측이 통째로 사라지는 것보다 질의 하나를 잃는 편이 낫다.
  dns.on("error", () => {});

  const http = createHttpServer(forwarder.onRequest("http"));
  http.on("connect", forwarder.onTunnel("http"));
  http.on("upgrade", forwarder.onTunnel("http"));

  /** 인증서를 실제로 내준 이름. 우리가 SNI 를 거절해 끊은 악수를 인증서 거부로 세지 않으려는 것이다. */
  /** @type {Set<string>} */
  const issued = new Set();
  const sni = createSniCallback(authority);
  const https = createHttpsServer(
    {
      // ALPN 은 http/1.1 만 내건다. h2 는 전달하지 않는다.
      ALPNProtocols: ["http/1.1"],
      SNICallback: (servername, callback) => {
        sni(servername, (error, context) => {
          if (!error) issued.add(servername.toLowerCase());
          callback(error, context);
        });
      },
    },
    forwarder.onRequest("https"),
  );
  https.on("connect", forwarder.onTunnel("https"));
  https.on("upgrade", forwarder.onTunnel("https"));
  https.on("tlsClientError", (_error, socket) => {
    const servername = /** @type {{ servername?: unknown }} */ (socket).servername;
    const host = typeof servername === "string" ? servername.toLowerCase() : "";
    // 인증서를 내준 뒤에 악수가 깨졌다. 클라이언트가 우리 CA 를 믿지 않은 것이다(인증서 고정의 흔적).
    if (isHostname(host) && issued.has(host)) {
      state.tlsRejections.push({ phase: state.phase, host });
    }
  });

  const control = createControlServer(state, {
    token: options.token,
    caPem: authority.caPem,
    healthy: () => dnsListening && http.listening && https.listening,
    ...(options.phaseWaitMs === undefined ? {} : { phaseWaitMs: options.phaseWaitMs }),
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    // 기다리던 POST /phase 를 먼저 풀어 준다. 그래야 제어 서버가 닫힌다.
    state.notifyIdle();
    forwarder.closeUpstreams();
    await Promise.all([
      closeServer(http),
      closeServer(https),
      closeServer(control),
      new Promise((resolve) => {
        if (!dnsListening) {
          resolve(undefined);
          return;
        }
        dnsListening = false;
        dns.close(() => resolve(undefined));
      }),
    ]);
    await authority.dispose();
  };

  try {
    await new Promise((resolve, reject) => {
      dns.once("error", reject);
      dns.bind(wanted.dns, bind, () => {
        dns.removeListener("error", reject);
        dnsListening = true;
        resolve(undefined);
      });
    });
    await listen(http, wanted.http, bind);
    await listen(https, wanted.https, bind);
    // 제어 포트를 마지막에 연다. 이것이 열렸을 때는 나머지가 이미 듣고 있다.
    await listen(control, wanted.control, bind);
  } catch (error) {
    await close();
    throw error;
  }

  /** @param {import("node:net").Server} server */
  const portOf = (server) => {
    const address = server.address();
    return typeof address === "object" && address !== null ? address.port : 0;
  };
  return {
    ports: {
      dns: dns.address().port,
      http: portOf(http),
      https: portOf(https),
      control: portOf(control),
    },
    close,
  };
}

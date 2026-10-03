import { createSocket } from "node:dgram";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { startGateway } from "../sandbox/gateway/gateway.mjs";
import type { ObservedRequest, SandboxPhase } from "../src/types.js";

/**
 * 게이트웨이를 테스트 프로세스 안에서 127.0.0.1 임의 포트로 띄운다. 상류는 이 파일이 띄운 로컬 HTTP
 * 서버다. 외부 네트워크와 Docker 를 쓰지 않는다. HTTP 만 본다(TLS 종단은 컨테이너의 openssl 에 기대므로
 * Docker E2E 가 본다).
 */

const TOKEN = "loopback-test-token-5d0c1f";
/** 이름 풀이가 돌려주는 가짜 공인 주소(TEST-NET-3). 실제 접속은 dial 이 루프백으로 돌린다. */
const PUBLIC_ADDRESS = "203.0.113.10";
const HOST = "api.example.test";

type Gateway = Awaited<ReturnType<typeof startGateway>>;

interface Upstream {
  readonly port: number;
  /** 상류가 받은 TCP 접속 수. 재생이 상류에 닿지 않았음을 이 숫자로 본다. */
  connections(): number;
  readonly seen: Array<{
    method: string;
    url: string;
    headers: IncomingMessage["headers"];
    body: Buffer;
  }>;
  close(): Promise<void>;
}

interface Observed {
  readonly requests: ObservedRequest[];
  readonly tlsRejections: Array<{ phase: SandboxPhase; host: string }>;
  readonly dnsNames: Array<{ phase: SandboxPhase; name: string }>;
}

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  // 띄운 순서의 역순으로 전부 닫는다. 하나가 실패해도 나머지를 닫는다.
  const pending = closers.splice(0).reverse();
  const results = await Promise.allSettled(pending.map((close) => close()));
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
});

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
) => void | Promise<void>;

const echo: Handler = (request, response, body) => {
  response.writeHead(200, {
    "Content-Type": "application/json",
    "X-Upstream": "yes",
    Date: "Sat, 03 Oct 2026 00:00:00 GMT",
  });
  response.end(JSON.stringify({ method: request.method, url: request.url, size: body.length }));
};

async function startUpstream(handler: Handler = echo): Promise<Upstream> {
  const seen: Upstream["seen"] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body,
      });
      void handler(request, response, body);
    });
  });
  let connections = 0;
  server.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let closed = false;
  const upstream: Upstream = {
    port: (server.address() as AddressInfo).port,
    connections: () => connections,
    seen,
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
  closers.push(upstream.close);
  return upstream;
}

/** 잠깐 들었다 닫은 포트. 접속하면 거부된다. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface GatewayOptions {
  /** 상류의 루프백 포트. null 이면 상류에 닿으려는 순간 테스트가 실패한다. */
  readonly upstreamPort: number | null;
  readonly addresses?: Readonly<Record<string, string>>;
  readonly mode?: "live" | "record" | "replay";
}

async function gateway(options: GatewayOptions): Promise<Gateway & { lookups: string[] }> {
  const lookups: string[] = [];
  const started = await startGateway({
    token: TOKEN,
    mode: options.mode ?? "live",
    address: "127.0.0.1",
    bind: "127.0.0.1",
    ports: { dns: 0, http: 0, https: 0, control: 0 },
    // 루프백 스펙은 TLS 를 보지 않는다. openssl 없이 뜨도록 서명기를 바꿔 끼운다.
    authority: {
      caPem: "-----BEGIN CERTIFICATE-----\nloopback\n-----END CERTIFICATE-----\n",
      issue: async () => {
        throw new Error("루프백 스펙은 인증서를 만들지 않는다");
      },
      dispose: async () => {},
    },
    lookup: async (host: string) => {
      lookups.push(host);
      if (options.upstreamPort === null) throw new Error(`상류 이름을 풀려 했다: ${host}`);
      return options.addresses?.[host] ?? PUBLIC_ADDRESS;
    },
    dial: () => {
      if (options.upstreamPort === null) throw new Error("상류에 접속하려 했다");
      return { host: "127.0.0.1", port: options.upstreamPort };
    },
  });
  closers.push(() => started.close());
  return Object.assign(started, { lookups });
}

interface Sent {
  readonly status: number;
  readonly headers: IncomingMessage["headers"];
  readonly rawHeaders: string[];
  readonly body: Buffer;
}

function send(
  target: Gateway,
  options: {
    method?: string;
    host?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  } = {},
): Promise<Sent> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: target.ports.http,
        method: options.method ?? "GET",
        path: options.path ?? "/",
        agent: false,
        setHost: false,
        headers: { Host: options.host ?? HOST, ...options.headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            rawHeaders: response.rawHeaders,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

async function control(
  target: Gateway,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  authorization: string | null = `Bearer ${TOKEN}`,
): Promise<{ status: number; text: string; json: unknown }> {
  const response = await fetch(`http://127.0.0.1:${target.ports.control}${path}`, {
    method,
    headers: {
      ...(authorization === null ? {} : { authorization }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, text, json };
}

async function observation(target: Gateway): Promise<Observed> {
  const result = await control(target, "GET", "/observation");
  expect(result.status).toBe(200);
  return result.json as Observed;
}

function bodyOf(request: ObservedRequest | undefined): Buffer {
  return Buffer.from(request?.bodyBase64 ?? "", "base64");
}

const CALL_PHASE: SandboxPhase = {
  kind: "call",
  toolIndex: 2,
  toolName: "fetch_status",
  callId: "fetch_status:valid",
};

describe("게이트웨이 루프백", () => {
  it("전달한 요청이 host, method, path, 헤더, 본문 그대로 기록된다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port });

    const sent = await send(target, {
      method: "POST",
      path: "/v1/items?q=1&q=2",
      headers: { "X-Zeta": "z", "Content-Type": "application/json", "X-Alpha": "a" },
      body: '{"name":"값"}',
    });

    // 응답이 그대로 돌아온다.
    expect(sent.status).toBe(200);
    expect(sent.headers["x-upstream"]).toBe("yes");
    expect(sent.rawHeaders).toContain("X-Upstream");
    expect(JSON.parse(sent.body.toString())).toEqual({
      method: "POST",
      url: "/v1/items?q=1&q=2",
      size: Buffer.byteLength('{"name":"값"}'),
    });
    // 상류가 받은 것이 보낸 것 그대로다.
    expect(upstream.seen).toHaveLength(1);
    expect(upstream.seen[0]?.method).toBe("POST");
    expect(upstream.seen[0]?.url).toBe("/v1/items?q=1&q=2");
    expect(upstream.seen[0]?.headers.host).toBe(HOST);
    expect(upstream.seen[0]?.headers["x-zeta"]).toBe("z");
    expect(upstream.seen[0]?.body.toString()).toBe('{"name":"값"}');
    // 기록.
    const { requests } = await observation(target);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request).toMatchObject({
      phase: { kind: "start" },
      scheme: "http",
      host: HOST,
      port: 80,
      method: "POST",
      path: "/v1/items?q=1&q=2",
      bodyTruncated: false,
      served: "live",
    });
    expect(bodyOf(request).toString()).toBe('{"name":"값"}');
    // 헤더 이름은 소문자이고 (이름, 값) 순으로 정렬된다.
    const names = request?.headers.map(([name]) => name) ?? [];
    expect(names).toEqual([...names].sort());
    expect(names.every((name) => name === name.toLowerCase())).toBe(true);
    expect(request?.headers).toEqual(
      expect.arrayContaining([
        ["content-type", "application/json"],
        ["host", HOST],
        ["x-alpha", "a"],
        ["x-zeta", "z"],
      ]),
    );
    expect(target.lookups).toEqual([HOST]);
  });

  it("Host 에 포트가 붙어 와도 기록의 host 는 이름만이고 port 는 받은 포트의 자리(80)다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port });

    await send(target, { host: `API.Example.Test:${target.ports.http}` });

    const { requests } = await observation(target);
    expect(requests[0]).toMatchObject({ host: HOST, port: 80, served: "live" });
    expect(JSON.stringify(requests[0]?.phase)).not.toContain(String(target.ports.http));
  });

  it("기록의 phase 가 직전에 POST /phase 로 알린 단계다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port });

    await send(target, { path: "/at-start" });
    expect((await control(target, "POST", "/phase", { phase: { kind: "list" } })).json).toEqual({
      ok: true,
    });
    await send(target, { path: "/at-list" });
    await control(target, "POST", "/phase", { phase: CALL_PHASE });
    await send(target, { path: "/at-call-1" });
    await send(target, { path: "/at-call-2" });
    await control(target, "POST", "/phase", { phase: { kind: "shutdown" } });
    await send(target, { path: "/at-shutdown" });

    const { requests } = await observation(target);
    expect(requests.map((request) => [request.path, request.phase])).toEqual([
      ["/at-start", { kind: "start" }],
      ["/at-list", { kind: "list" }],
      ["/at-call-1", CALL_PHASE],
      ["/at-call-2", CALL_PHASE],
      ["/at-shutdown", { kind: "shutdown" }],
    ]);
  });

  it("POST /phase 의 본문이 SandboxPhase 꼴이 아니면 400 이고 단계가 바뀌지 않는다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port });

    for (const body of [
      {},
      { phase: "list" },
      { phase: { kind: "nope" } },
      { phase: { kind: "call", toolIndex: "0", toolName: "t", callId: "t:0" } },
      "{ not json",
    ]) {
      const result = await control(target, "POST", "/phase", body);
      expect(result.status).toBe(400);
      expect(typeof (result.json as { error: string }).error).toBe("string");
    }
    await send(target);

    expect((await observation(target)).requests[0]?.phase).toEqual({ kind: "start" });
  });

  it("POST /phase 는 진행 중 요청이 끝나면 바로 답하고, 안 끝나면 500ms 뒤에 답한다", async () => {
    const releases: Array<() => void> = [];
    const upstream = await startUpstream((_request, response) => {
      releases.push(() => {
        response.writeHead(200);
        response.end("late");
      });
    });
    const target = await gateway({ upstreamPort: upstream.port });
    const waitForUpstream = async (count: number) => {
      while (releases.length < count) await new Promise((resolve) => setTimeout(resolve, 5));
    };

    // 진행 중 요청이 없으면 기다리지 않는다.
    let startedAt = performance.now();
    await control(target, "POST", "/phase", { phase: { kind: "list" } });
    expect(performance.now() - startedAt).toBeLessThan(300);

    // 진행 중 요청이 100ms 뒤에 끝난다. 그때 바로 답한다(500ms 를 채우지 않는다).
    const first = send(target, { path: "/slow-1" });
    await waitForUpstream(1);
    setTimeout(() => releases[0]?.(), 100);
    startedAt = performance.now();
    await control(target, "POST", "/phase", { phase: CALL_PHASE });
    const untilDone = performance.now() - startedAt;
    expect(untilDone).toBeGreaterThanOrEqual(80);
    expect(untilDone).toBeLessThan(400);
    expect((await first).body.toString()).toBe("late");

    // 진행 중 요청이 끝나지 않는다. 500ms 뒤에 답한다.
    const second = send(target, { path: "/slow-2" });
    await waitForUpstream(2);
    startedAt = performance.now();
    const result = await control(target, "POST", "/phase", { phase: { kind: "shutdown" } });
    const untilTimeout = performance.now() - startedAt;
    expect(result.json).toEqual({ ok: true });
    expect(untilTimeout).toBeGreaterThanOrEqual(480);
    expect(untilTimeout).toBeLessThan(1500);
    releases[1]?.();
    await second;

    // 기다리는 동안 받은 요청은 이전 단계에 붙어 있다.
    const { requests } = await observation(target);
    expect(requests.map((request) => [request.path, request.phase.kind])).toEqual([
      ["/slow-1", "list"],
      ["/slow-2", "call"],
    ]);
  });

  it("제어 포트는 Authorization 이 없거나 틀리면 401 이고 기록을 내주지 않는다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port });
    await send(target, { path: "/secret-path-9c1e" });
    await control(target, "POST", "/secrets", { secrets: [] });

    const routes: Array<["GET" | "POST", string, unknown?]> = [
      ["GET", "/health"],
      ["GET", "/ca"],
      ["POST", "/secrets", { secrets: [] }],
      ["POST", "/session", { schemaVersion: 1, entries: [] }],
      ["POST", "/phase", { phase: { kind: "shutdown" } }],
      ["GET", "/observation"],
      ["GET", "/session"],
      ["GET", "/nowhere"],
    ];
    const wrong = [
      null,
      "",
      "Bearer",
      "Bearer ",
      "Bearer wrong",
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.slice(0, -1)}`,
      `Basic ${TOKEN}`,
      TOKEN,
      `bearer  ${TOKEN}`,
    ];
    for (const [method, path, body] of routes) {
      for (const authorization of wrong) {
        const result = await control(target, method, path, body, authorization);
        expect(result.status, `${method} ${path} ${authorization}`).toBe(401);
        expect(result.text).not.toContain("secret-path-9c1e");
        expect(result.text).not.toContain("BEGIN CERTIFICATE");
        expect(result.text).not.toContain(TOKEN);
      }
    }

    // 거절된 요청은 아무것도 바꾸지 않았다. 단계는 그대로고 재생으로 넘어가지도 않았다.
    await send(target, { path: "/after" });
    const { requests } = await observation(target);
    expect(requests.map((request) => [request.path, request.phase.kind, request.served])).toEqual([
      ["/secret-path-9c1e", "start", "live"],
      ["/after", "start", "live"],
    ]);
  });

  it("토큰이 맞으면 GET /health 는 200 과 { ok: true }, GET /ca 는 pem 을 준다", async () => {
    const target = await gateway({ upstreamPort: null });

    const health = await control(target, "GET", "/health");
    expect(health.status).toBe(200);
    expect(health.json).toEqual({ ok: true });
    const ca = await control(target, "GET", "/ca");
    expect(ca.status).toBe(200);
    expect(ca.json).toEqual({
      pem: "-----BEGIN CERTIFICATE-----\nloopback\n-----END CERTIFICATE-----\n",
    });
    expect((await control(target, "GET", "/nowhere")).status).toBe(404);
  });

  it("UDP 로 받은 이름 질의가 그 시점의 단계와 함께 dnsNames 에 남는다", async () => {
    const target = await gateway({ upstreamPort: null });
    const ask = (name: string) =>
      new Promise<Buffer>((resolve, reject) => {
        const socket = createSocket("udp4");
        const labels = name.split(".").map((label) => {
          return Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]);
        });
        const packet = Buffer.concat([
          Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]),
          ...labels,
          Buffer.from([0, 0, 1, 0, 1]),
        ]);
        socket.once("message", (message) => {
          socket.close();
          resolve(message);
        });
        socket.once("error", (error) => {
          socket.close();
          reject(error);
        });
        socket.send(packet, target.ports.dns, "127.0.0.1");
      });

    const first = await ask("Api.Example.Test");
    await control(target, "POST", "/phase", { phase: { kind: "list" } });
    await ask("example.invalid");

    // 답의 마지막 네 바이트가 게이트웨이 주소다.
    expect([...first.subarray(first.length - 4)]).toEqual([127, 0, 0, 1]);
    expect((await observation(target)).dnsNames).toEqual([
      { phase: { kind: "start" }, name: "api.example.test" },
      { phase: { kind: "list" }, name: "example.invalid" },
    ]);
  });

  it("record 로 한 번, replay 로 한 번 돌린 두 관측이 served 필드만 다르다", async () => {
    const secret = { label: "<canary:API_KEY>", value: "mcpeak-canary-7f3a9c2e41d0" };
    const run = async (target: Gateway) => {
      await control(target, "POST", "/secrets", { secrets: [secret] });
      await control(target, "POST", "/phase", { phase: { kind: "list" } });
      const replies = [await send(target, { path: "/tools" })];
      await control(target, "POST", "/phase", { phase: CALL_PHASE });
      replies.push(
        await send(target, {
          method: "POST",
          path: `/collect?key=${secret.value}`,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: secret.value }),
        }),
      );
      replies.push(await send(target, { path: "/tools" }));
      await control(target, "POST", "/phase", { phase: { kind: "shutdown" } });
      return { replies, observed: await observation(target) };
    };

    const upstream = await startUpstream();
    const recorder = await gateway({ upstreamPort: upstream.port, mode: "record" });
    const recorded = await run(recorder);
    const session = await control(recorder, "GET", "/session");
    expect(session.status).toBe(200);

    const replayer = await gateway({ upstreamPort: null, mode: "replay" });
    expect((await control(replayer, "POST", "/session", session.text)).json).toEqual({ ok: true });
    const replayed = await run(replayer);

    expect(recorded.observed.requests.map((request) => request.served)).toEqual([
      "live",
      "live",
      "live",
    ]);
    expect(replayed.observed.requests.map((request) => request.served)).toEqual([
      "replay-hit",
      "replay-hit",
      "replay-hit",
    ]);
    const withoutServed = (observed: Observed) => ({
      ...observed,
      requests: observed.requests.map(({ served: _served, ...rest }) => rest),
    });
    expect(JSON.stringify(withoutServed(replayed.observed))).toBe(
      JSON.stringify(withoutServed(recorded.observed)),
    );
    // 관측은 가리지 않는다. 규칙이 값을 대조해야 한다.
    expect(recorded.observed.requests[1]?.path).toBe(`/collect?key=${secret.value}`);
    // 재생은 상류에 닿지 않았다.
    expect(replayer.lookups).toEqual([]);
    expect(upstream.seen).toHaveLength(3);
    // 클라이언트가 받은 응답도 같다.
    expect(replayed.replies.map((reply) => [reply.status, reply.body.toString()])).toEqual(
      recorded.replies.map((reply) => [reply.status, reply.body.toString()]),
    );
    // 세션 파일에는 비밀 값, 토큰, 이 실행의 포트 번호가 없다.
    expect(session.text).not.toContain(secret.value);
    expect(session.text).toContain("<canary:API_KEY>");
    expect(session.text).not.toContain(TOKEN);
    for (const port of [upstream.port, ...Object.values(recorder.ports)]) {
      expect(session.text).not.toContain(String(port));
    }
    expect(session.text).toBe(`${JSON.stringify(JSON.parse(session.text), null, 2)}\n`);
  });

  it("같은 요청 집합을 두 번 녹화하면 세션 파일이 바이트 단위로 같다", async () => {
    const upstream = await startUpstream();
    const paths = ["/b", "/a", "/c?x=1"];
    const recordOnce = async (order: readonly string[]) => {
      const target = await gateway({ upstreamPort: upstream.port, mode: "record" });
      for (const path of order) await send(target, { path });
      return (await control(target, "GET", "/session")).text;
    };

    const first = await recordOnce(paths);
    const second = await recordOnce([...paths].reverse());

    expect(second).toBe(first);
  });

  it("replay 에서는 상류 서버가 꺼져 있어도 같은 응답을 준다", async () => {
    const upstream = await startUpstream();
    const recorder = await gateway({ upstreamPort: upstream.port, mode: "record" });
    const live = await send(recorder, { method: "POST", path: "/v1/x", body: "payload" });
    const session = await control(recorder, "GET", "/session");
    await upstream.close();

    const replayer = await gateway({ upstreamPort: null, mode: "replay" });
    await control(replayer, "POST", "/session", session.text);
    const replayed = await send(replayer, { method: "POST", path: "/v1/x", body: "payload" });
    const missed = await send(replayer, { method: "POST", path: "/v1/x", body: "other" });

    expect(replayed.status).toBe(live.status);
    expect(replayed.body.toString()).toBe(live.body.toString());
    expect(replayed.rawHeaders).toEqual(live.rawHeaders);
    expect(replayed.headers.date).toBe("Sat, 03 Oct 2026 00:00:00 GMT");
    expect(missed.status).toBe(504);
    expect(missed.body.toString("utf8")).toBe("mcpeak: 녹화에 없는 요청입니다");
    expect((await observation(replayer)).requests.map((request) => request.served)).toEqual([
      "replay-hit",
      "replay-miss",
    ]);
    expect(replayer.lookups).toEqual([]);
  });

  it("replay 에서는 녹화에 없는 요청에도 상류에 접속을 시도하지 않는다", async () => {
    // 상류는 살아 있고 dial 도 거기로 이어져 있다. 닿으려 하면 닿는다. 그래도 접속 수가 0 이어야 한다.
    const upstream = await startUpstream();
    const recorder = await gateway({ upstreamPort: upstream.port, mode: "record" });
    await send(recorder, { path: "/known" });
    const session = await control(recorder, "GET", "/session");
    const connectionsAfterRecord = upstream.connections();
    expect(connectionsAfterRecord).toBe(1);

    const replayer = await gateway({ upstreamPort: upstream.port, mode: "replay" });
    // 세션을 받기 전에도 상류로 가지 않는다.
    const early = await send(replayer, { path: "/before-session" });
    await control(replayer, "POST", "/session", session.text);
    const missed = await send(replayer, { path: "/unknown" });
    const missedPost = await send(replayer, { method: "POST", path: "/known", body: "x" });
    const otherHost = await send(replayer, { host: "intranet.example.test", path: "/known" });
    const hit = await send(replayer, { path: "/known" });

    expect([early.status, missed.status, missedPost.status, otherHost.status, hit.status]).toEqual([
      504, 504, 504, 504, 200,
    ]);
    expect(upstream.connections()).toBe(connectionsAfterRecord);
    expect(replayer.lookups).toEqual([]);
    expect((await observation(replayer)).requests.map((request) => request.served)).toEqual([
      "replay-miss",
      "replay-miss",
      "replay-miss",
      "replay-miss",
      "replay-hit",
    ]);
  });

  it("live 로 띄운 게이트웨이도 POST /session 을 받으면 재생으로 돈다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port, mode: "live" });

    await control(target, "POST", "/session", { schemaVersion: 1, entries: [] });
    const sent = await send(target);

    expect(sent.status).toBe(504);
    expect(upstream.connections()).toBe(0);
    expect(target.lookups).toEqual([]);
  });

  it("POST /session 의 내용이 세션 파일 꼴이 아니면 400 과 원인 한 줄이고 재생으로 넘어가지 않는다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port });

    const result = await control(target, "POST", "/session", { schemaVersion: 2, entries: [] });

    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: "schemaVersion 이 1 이 아닙니다(받은 값: 2)." });
    await send(target);
    expect((await observation(target)).requests[0]?.served).toBe("live");
  });

  it("상류가 접속을 거부하면 502 로 답하고 그 요청도 기록에 남는다", async () => {
    const target = await gateway({ upstreamPort: await closedPort() });

    const sent = await send(target, { path: "/down" });

    expect(sent.status).toBe(502);
    const { requests } = await observation(target);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ host: HOST, path: "/down", served: "live" });
  });

  it("상류 이름이 내부 주소로 풀리면 접속하지 않고 502 이며 served 가 blocked 다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({
      upstreamPort: upstream.port,
      mode: "record",
      addresses: {
        "metadata.example.test": "169.254.169.254",
        "intranet.example.test": "10.0.0.5",
        "loop.example.test": "127.0.0.1",
        "six.example.test": "fd00::1",
      },
    });

    for (const host of Object.keys({
      "metadata.example.test": 1,
      "intranet.example.test": 1,
      "loop.example.test": 1,
      "six.example.test": 1,
    })) {
      expect((await send(target, { host, path: "/latest/meta-data" })).status, host).toBe(502);
    }

    expect(upstream.seen).toHaveLength(0);
    const { requests } = await observation(target);
    expect(requests.map((request) => [request.host, request.served])).toEqual([
      ["metadata.example.test", "blocked"],
      ["intranet.example.test", "blocked"],
      ["loop.example.test", "blocked"],
      ["six.example.test", "blocked"],
    ]);
    // 막힌 요청은 녹화에 들어가지 않는다.
    expect(JSON.parse((await control(target, "GET", "/session")).text).entries).toEqual([]);
  });

  it("Host 가 IP 주소면 접속하지 않고 served 가 blocked 다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port });

    const statuses = [];
    for (const host of ["203.0.113.10", "169.254.169.254:80", "[::1]:80"]) {
      statuses.push((await send(target, { host })).status);
    }

    expect(statuses).toEqual([502, 502, 502]);
    expect(upstream.seen).toHaveLength(0);
    // 이름을 풀어 보지도 않는다.
    expect(target.lookups).toEqual([]);
    const { requests } = await observation(target);
    expect(requests.map((request) => [request.host, request.served])).toEqual([
      ["203.0.113.10", "blocked"],
      ["169.254.169.254", "blocked"],
      ["::1", "blocked"],
    ]);
  });

  it("gzip 으로 온 요청 본문이 풀린 채 기록되고, 상류에는 받은 그대로 간다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port });
    const plain = JSON.stringify({ secret: "mcpeak-canary-7f3a9c2e41d0", filler: "x".repeat(500) });
    const compressed = gzipSync(plain);

    await send(target, {
      method: "POST",
      path: "/gz",
      headers: { "Content-Encoding": "gzip", "Content-Type": "application/json" },
      body: compressed,
    });
    // 풀리지 않는 본문은 받은 그대로 기록한다.
    await send(target, {
      method: "POST",
      path: "/broken",
      headers: { "Content-Encoding": "gzip" },
      body: "not gzip at all",
    });

    expect(upstream.seen[0]?.body.equals(compressed)).toBe(true);
    expect(upstream.seen[0]?.headers["content-encoding"]).toBe("gzip");
    const { requests } = await observation(target);
    expect(bodyOf(requests[0]).toString()).toBe(plain);
    expect(requests[0]?.bodyTruncated).toBe(false);
    expect(bodyOf(requests[1]).toString()).toBe("not gzip at all");
    expect(upstream.seen[1]?.body.toString()).toBe("not gzip at all");
  });

  it("본문이 1048576 바이트를 넘으면 기록은 잘리고 bodyTruncated 이며 상류에는 전부 간다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port });
    const limit = 1_048_576;
    const over = Buffer.alloc(limit + 10, "a");
    over.write("TAIL", limit + 6);
    const exact = Buffer.alloc(limit, "b");

    await send(target, { method: "POST", path: "/over", body: over });
    await send(target, { method: "POST", path: "/exact", body: exact });

    expect(upstream.seen[0]?.body.length).toBe(limit + 10);
    expect(upstream.seen[0]?.body.equals(over)).toBe(true);
    expect(upstream.seen[1]?.body.length).toBe(limit);
    const { requests } = await observation(target);
    expect(bodyOf(requests[0]).length).toBe(limit);
    expect(bodyOf(requests[0]).equals(over.subarray(0, limit))).toBe(true);
    expect(requests[0]?.bodyTruncated).toBe(true);
    expect(bodyOf(requests[1]).length).toBe(limit);
    expect(requests[1]?.bodyTruncated).toBe(false);
  });

  it("CONNECT 와 Upgrade 요청은 501 이고 기록에 남는다", async () => {
    const upstream = await startUpstream();
    const target = await gateway({ upstreamPort: upstream.port });

    const connectStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: target.ports.http,
        method: "CONNECT",
        path: "tunnel.example.test:443",
        agent: false,
        setHost: false,
        headers: { Host: "tunnel.example.test:443" },
      });
      request.on("connect", (response, socket) => {
        socket.destroy();
        resolve(response.statusCode ?? 0);
      });
      request.on("error", reject);
      request.end();
    });
    const upgrade = await send(target, {
      host: "ws.example.test",
      path: "/socket",
      headers: { Connection: "Upgrade", Upgrade: "websocket" },
    });

    expect(connectStatus).toBe(501);
    expect(upgrade.status).toBe(501);
    expect(upstream.seen).toHaveLength(0);
    const { requests } = await observation(target);
    expect(
      requests.map((request) => [request.method, request.host, request.path, request.served]),
    ).toEqual([
      ["CONNECT", "tunnel.example.test", "tunnel.example.test:443", "live"],
      ["GET", "ws.example.test", "/socket", "live"],
    ]);
    expect(target.lookups).toEqual([]);
  });
});

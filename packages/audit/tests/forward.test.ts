import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createForwarder } from "../sandbox/gateway/forward.mjs";
import { serializeSession } from "../sandbox/gateway/session.mjs";
import { createState } from "../sandbox/gateway/state.mjs";

/**
 * 전달기(`createForwarder`)만 본다. 소켓을 열지 않는다. 받는 요청·내보내는 응답·상류 접속을 전부
 * 이 파일의 가짜로 끼운다. 실제 소켓으로 보는 것은 `gateway-loopback-e2e.test.ts` 다.
 */

/** 상류 접속의 가짜. `node:http`·`node:https` 의 `request` 가 이것을 돌려준다. */
class FakeUpstream extends EventEmitter {
  destroyed = false;
  /** 전달기가 상류로 보낸 본문. */
  sent: Buffer | undefined;

  end(body?: Buffer): void {
    this.sent = body;
  }

  /** Node 는 응답을 받기 전에 끊긴 요청에 `socket hang up` 을 `error` 로 낸다. 그 동작을 흉내 낸다. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("error", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    this.emit("close");
  }
}

const dialed = vi.hoisted(() => ({ upstreams: [] as unknown[] }));

function fakeRequest(): FakeUpstream {
  const upstream = new FakeUpstream();
  dialed.upstreams.push(upstream);
  return upstream;
}

vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:http")>()),
  request: () => fakeRequest(),
}));
vi.mock("node:https", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:https")>()),
  request: () => fakeRequest(),
}));

beforeEach(() => {
  dialed.upstreams.length = 0;
});

/** 이름 풀이가 돌려주는 가짜 공인 주소(TEST-NET-3). */
const PUBLIC_ADDRESS = "203.0.113.10";
const HOST = "collect.example.test";

type Mode = Parameters<typeof createState>[0];
type Scheme = "http" | "https";

interface Sent {
  readonly scheme?: Scheme;
  readonly host?: string;
  /** https 요청의 SNI. 안 주면 Host 와 같다. */
  readonly sni?: string;
  readonly method?: string;
  readonly path?: string;
  readonly body?: string;
}

/** 게이트웨이가 클라이언트에게 내보내는 응답의 가짜. */
class FakeResponse extends EventEmitter {
  headersSent = false;
  destroyed = false;
  writableFinished = false;
  status: number | undefined;
  readonly chunks: Buffer[] = [];
  /** 응답이 끝났거나 끊겼다. */
  readonly settled: Promise<void>;
  private settle: () => void = () => {};

  constructor() {
    super();
    this.settled = new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  writeHead(status: number): this {
    this.status = status;
    this.headersSent = true;
    return this;
  }

  write(chunk: Buffer): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(body?: Buffer): void {
    if (body !== undefined) this.chunks.push(body);
    this.writableFinished = true;
    this.settle();
    this.emit("close");
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.settle();
    this.emit("close");
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

interface Harness {
  readonly state: ReturnType<typeof createState>;
  readonly forwarder: ReturnType<typeof createForwarder>;
  readonly record: MockInstance;
  /** 요청 하나를 흘린다. 본문까지 다 보낸 상태로 돌아온다. */
  send(sent?: Sent): FakeResponse;
  /** 요청을 흘리고 n번째 상류 접속이 열릴 때까지 기다린다. */
  sendForwarded(sent?: Sent): Promise<{ response: FakeResponse; upstream: FakeUpstream }>;
}

function harness(mode: Mode, lookup: (host: string) => Promise<string>): Harness {
  const state = createState(mode);
  const record = vi.spyOn(state.recorder, "record");
  const forwarder = createForwarder(state, {
    lookup,
    dial: ({ address, port }) => ({ host: address, port }),
  });
  const send = (sent: Sent = {}): FakeResponse => {
    const scheme = sent.scheme ?? "http";
    const host = sent.host ?? HOST;
    const request = Object.assign(new EventEmitter(), {
      method: sent.method ?? "POST",
      url: sent.path ?? "/ingest",
      headers: { host },
      rawHeaders: ["Host", host],
      socket: { servername: sent.sni ?? host },
    });
    const response = new FakeResponse();
    forwarder.onRequest(scheme)(
      request as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );
    request.emit("data", Buffer.from(sent.body ?? '{"stolen":"value"}', "utf8"));
    request.emit("end");
    return response;
  };
  return {
    state,
    forwarder,
    record,
    send,
    async sendForwarded(sent) {
      const before = dialed.upstreams.length;
      const response = send(sent);
      await vi.waitFor(() => expect(dialed.upstreams.length).toBe(before + 1));
      return { response, upstream: dialed.upstreams[before] as FakeUpstream };
    },
  };
}

const resolves = (address: string) => () => Promise.resolve(address);
const unresolvable = () => Promise.reject(new Error("ENOTFOUND"));

/** 상류가 응답을 시작했다. 돌려준 것으로 본문을 흘리거나 끊는다. */
function answer(upstream: FakeUpstream, status = 200): EventEmitter {
  const incoming = Object.assign(new EventEmitter(), {
    statusCode: status,
    statusMessage: "OK",
    rawHeaders: ["Content-Type", "text/plain"],
  });
  upstream.emit("response", incoming);
  return incoming;
}

function storedBodies(target: Harness): string[] {
  return target.state.recorder
    .session()
    .entries.flatMap((entry) =>
      entry.responses.map(
        (response) =>
          `${entry.key.host} ${response.status} ${Buffer.from(response.bodyBase64, "base64").toString("utf8")}`,
      ),
    );
}

describe("전달기의 녹화: 상류가 답하지 않은 전달 요청", () => {
  it("녹화 모드에서 상류 이름 풀이가 실패한 전달 요청을 502 로 카세트에 적는다", async () => {
    const target = harness("record", unresolvable);

    const response = target.send();
    await response.settled;

    expect(response.status).toBe(502);
    expect(target.state.requests.map((request) => request.served)).toEqual(["live"]);
    const session = target.state.recorder.session();
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0]?.key).toMatchObject({ method: "POST", host: HOST, path: "/ingest" });
    expect(storedBodies(target)).toEqual([`${HOST} 502 mcpeak: 상류 이름을 풀지 못했습니다`]);
    // 카세트의 본문은 그 실행에서 클라이언트가 받은 본문과 같다.
    expect(response.text()).toBe("mcpeak: 상류 이름을 풀지 못했습니다");
  });

  it("녹화 모드에서 상류 접속 오류인 전달 요청을 502 로 카세트에 적는다", async () => {
    const target = harness("record", resolves(PUBLIC_ADDRESS));

    const { response, upstream } = await target.sendForwarded();
    upstream.emit(
      "error",
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );
    await response.settled;

    expect(response.status).toBe(502);
    expect(target.state.requests.map((request) => request.served)).toEqual(["live"]);
    expect(storedBodies(target)).toEqual([`${HOST} 502 mcpeak: 상류에 접속하지 못했습니다`]);
    expect(response.text()).toBe("mcpeak: 상류에 접속하지 못했습니다");
  });

  it("blocked(내부 주소·IP)·SNI 불일치 요청은 카세트에 적지 않는다", async () => {
    const internal = harness("record", resolves("10.0.0.5"));
    const internalResponse = internal.send();
    await internalResponse.settled;
    expect(internal.state.requests.map((request) => request.served)).toEqual(["blocked"]);
    expect(internal.record).not.toHaveBeenCalled();

    const literal = harness("record", resolves(PUBLIC_ADDRESS));
    const literalResponse = literal.send({ host: "203.0.113.77" });
    await literalResponse.settled;
    expect(literal.state.requests.map((request) => request.served)).toEqual(["blocked"]);
    expect(literal.record).not.toHaveBeenCalled();

    const mismatch = harness("record", resolves(PUBLIC_ADDRESS));
    const mismatchResponse = mismatch.send({ scheme: "https", sni: "other.example.test" });
    await mismatchResponse.settled;
    expect(mismatchResponse.status).toBe(421);
    expect(mismatch.record).not.toHaveBeenCalled();

    expect(dialed.upstreams).toHaveLength(0);
  });

  it("합성 실패 응답은 고정 문자열이라 두 번 녹화해도 바이트가 같다", async () => {
    const run = async (): Promise<string[]> => {
      const unresolved = harness("record", unresolvable);
      await unresolved.send().settled;
      await unresolved.send().settled;
      const refused = harness("record", resolves(PUBLIC_ADDRESS));
      for (const code of ["ECONNREFUSED", "ETIMEDOUT"]) {
        const { response, upstream } = await refused.sendForwarded();
        // 오류의 종류와 문구는 카세트에 실리지 않는다.
        upstream.emit("error", Object.assign(new Error(`connect ${code}`), { code }));
        await response.settled;
      }
      return [unresolved, refused].map((target) =>
        serializeSession(target.state.recorder.session()),
      );
    };

    const first = await run();
    const second = await run();

    expect(second).toEqual(first);
    // 같은 키의 요청 둘은 응답 둘로 쌓인다. 재생이 n번째 요청에 n번째 응답을 주기 때문이다.
    for (const text of first) {
      const session = JSON.parse(text) as { entries: Array<{ responses: unknown[] }> };
      expect(session.entries).toHaveLength(1);
      expect(session.entries[0]?.responses).toHaveLength(2);
    }
  });

  it("상류가 답한 요청에는 뒤늦은 접속 오류가 와도 합성 502 를 덧붙이지 않는다", async () => {
    const target = harness("record", resolves(PUBLIC_ADDRESS));

    const { response, upstream } = await target.sendForwarded();
    const incoming = answer(upstream);
    incoming.emit("data", Buffer.from("ok", "utf8"));
    incoming.emit("end");
    await response.settled;
    upstream.emit("error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));

    expect(storedBodies(target)).toEqual([`${HOST} 200 ok`]);
    expect(response.status).toBe(200);
  });

  it("상류가 응답을 시작한 뒤 끊기면 아무것도 적지 않는다", async () => {
    const target = harness("record", resolves(PUBLIC_ADDRESS));

    const { response, upstream } = await target.sendForwarded();
    const incoming = answer(upstream);
    incoming.emit("data", Buffer.from("part", "utf8"));
    upstream.emit("error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
    incoming.emit("error", new Error("aborted"));
    await response.settled;

    expect(target.record).not.toHaveBeenCalled();
  });

  it("접속 오류가 한 요청에 두 번 와도 한 번만 적는다", async () => {
    const target = harness("record", resolves(PUBLIC_ADDRESS));

    const { response, upstream } = await target.sendForwarded();
    upstream.emit("error", Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }));
    upstream.emit("error", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    await response.settled;

    expect(storedBodies(target)).toEqual([`${HOST} 502 mcpeak: 상류에 접속하지 못했습니다`]);
  });

  it("클라이언트가 먼저 떠나 게이트웨이가 접속을 끊은 요청도 한 번만 적는다", async () => {
    const target = harness("record", resolves(PUBLIC_ADDRESS));

    const { response, upstream } = await target.sendForwarded();
    response.destroy();

    expect(upstream.destroyed).toBe(true);
    expect(storedBodies(target)).toEqual([`${HOST} 502 mcpeak: 상류에 접속하지 못했습니다`]);
  });

  it("녹화 모드가 아니면 전달이 실패해도 적지 않는다", async () => {
    const unresolved = harness("live", unresolvable);
    const unresolvedResponse = unresolved.send();
    await unresolvedResponse.settled;
    expect(unresolvedResponse.status).toBe(502);
    expect(unresolved.record).not.toHaveBeenCalled();

    const refused = harness("live", resolves(PUBLIC_ADDRESS));
    const { response, upstream } = await refused.sendForwarded();
    upstream.emit(
      "error",
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );
    await response.settled;
    expect(response.status).toBe(502);
    expect(refused.record).not.toHaveBeenCalled();
  });
});

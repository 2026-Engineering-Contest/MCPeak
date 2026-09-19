import { fileURLToPath } from "node:url";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { type RelayHandle, startRelay } from "../src/relay-server.js";

const CHILD = fileURLToPath(new URL("./fixtures/relay-child.mjs", import.meta.url));

const open: RelayHandle[] = [];
const sessions: Session[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  for (const handle of open.splice(0)) await handle.close();
});

interface Session {
  call(id: number, method: string, params?: unknown): Promise<JSONRPCMessage>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
}

/**
 * 중계기에 붙는 클라이언트. **SDK `Client` 를 쓰지 않는다** — `Client` 는
 * `structuredContent` 를 `outputSchema` 로 검증해서 던지므로, 중계기가 무엇을
 * 통과시켰는지 보는 테스트가 클라이언트 쪽 검증에 가려진다 (§8-3 이 그 자리다).
 * 트랜스포트만 써서 봉투를 그대로 본다.
 */
async function openSession(url: string): Promise<Session> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const waiters = new Map<number, (m: JSONRPCMessage) => void>();
  transport.onmessage = (message) => {
    if ("id" in message && typeof message.id === "number") waiters.get(message.id)?.(message);
  };
  await transport.start();
  const session: Session = {
    call: (id, method, params) =>
      new Promise<JSONRPCMessage>((resolve) => {
        waiters.set(id, resolve);
        void transport.send({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        } as JSONRPCMessage);
      }),
    notify: (method, params) =>
      transport.send({
        jsonrpc: "2.0",
        method,
        ...(params === undefined ? {} : { params }),
      } as JSONRPCMessage),
    close: () => transport.close(),
  };
  sessions.push(session);
  // 핸드셰이크는 클라이언트와 진짜 서버가 직접 한다 — 중계기는 지나가게만 둔다(설계 §4).
  await session.call(0, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "relay-test", version: "0.0.0" },
  });
  await session.notify("notifications/initialized");
  return session;
}

async function startFixtureRelay(
  extra: readonly string[] = [],
): Promise<{ handle: RelayHandle; lines: string[] }> {
  const lines: string[] = [];
  const handle = await startRelay({
    port: 0,
    command: process.execPath,
    args: [CHILD, ...extra],
    log: (line) => lines.push(line),
    json: false,
  });
  open.push(handle);
  return { handle, lines };
}

describe("startRelay — 진짜 서버가 답한다", () => {
  it("§8-1 tools/list 가 진짜 서버가 선언한 목록 그대로 온다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(1, "tools/list");

    expect(response).toMatchObject({
      id: 1,
      result: {
        tools: [
          { name: "echo", description: "받은 인자를 그대로 돌려준다." },
          { name: "bad_structured" },
          { name: "boom" },
        ],
      },
    });
  });

  it("§8-2 tools/call 결과가 structuredContent 까지 그대로 온다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(2, "tools/call", {
      name: "echo",
      arguments: { text: "부산" },
    });

    expect(response).toMatchObject({
      id: 2,
      result: {
        content: [{ type: "text", text: '{"text":"부산"}' }],
        structuredContent: { echo: { text: "부산" } },
      },
    });
  });

  it("§8-4 isError: true 가 프로토콜 오류로 바뀌지 않는다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(3, "tools/call", { name: "boom", arguments: {} });

    expect(response).not.toHaveProperty("error");
    expect(response).toMatchObject({ id: 3, result: { isError: true } });
  });

  it("§8-5 서버가 낸 -32601 이 그대로 온다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(4, "resources/list");

    expect(response).toMatchObject({
      id: 4,
      error: { code: -32601, message: "Method not found: resources/list" },
    });
  });

  it("port 0 이면 받은 포트를 handle 로 돌려준다", async () => {
    const { handle } = await startFixtureRelay();

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/mcp`);
  });
});

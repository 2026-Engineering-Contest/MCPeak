import { createServer, type Server as NodeHttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as McpSdkServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export interface TestHttpServer {
  /** http://127.0.0.1:<OS가 정한 포트>/mcp */
  readonly url: string;
  close(): Promise<void>;
}

export interface TestMcpHttpServer extends TestHttpServer {
  /** tools/call 핸들러가 실제로 불린 횟수. 네트워크 요청이 나갔는지 판정한다. */
  callCount(): number;
  /** 서버가 마지막으로 받은 요청 헤더. 값 비교는 테스트 안에서만 한다. */
  lastRequestHeaders(): Readonly<Record<string, string | string[] | undefined>>;
  /** 이후 모든 요청에 404 를 돌려준다. 서버가 세션을 잊은 상황을 만든다. */
  forgetSession(): void;
}

export interface TestToolDefinition {
  name: string;
  description?: string;
  inputSchema: unknown;
}

async function listen(server: NodeHttpServer): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/mcp`;
}

/** 멱등이다. 이미 닫힌 서버를 다시 닫아도 거부하지 않는다. */
function closeNodeServer(server: NodeHttpServer): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * 요청 처리 Promise 의 거부를 삼킨다.
 * 클라이언트가 응답 도중 끊거나 서버가 닫히는 중이면 거부가 나는데, 그대로 두면 Vitest 가
 * 관련 없는 테스트의 unhandled rejection 으로 보고한다.
 */
function settleResponse(work: Promise<unknown>, response: ServerResponse): void {
  work.catch(() => {
    if (!response.writableEnded) response.destroy();
  });
}

/**
 * SDK 저수준 `Server` 와 `StreamableHTTPServerTransport` 로 실제 MCP 서버를 띄운다.
 * `McpServer` 대신 저수준 `Server` 를 쓰는 이유는 tools/list 의 cursor 를 직접 정해야 하기
 * 때문이다. `packages/mock` 은 의존 방향이 역전되므로 쓰지 않는다.
 */
export async function startMcpHttpServer(options: {
  tools: readonly TestToolDefinition[];
  onCall?: (name: string, args: unknown) => unknown;
  /** 지정하면 tools/list 를 cursor 로 나눠 돌려준다. */
  pageSize?: number;
  /** 항상 같은 cursor 를 돌려준다. pagination 무한 루프 방어를 검증한다. */
  repeatCursor?: boolean;
  /** 세션 ID 를 발급한다. 값은 고정이라 실행마다 같다. */
  stateful?: boolean;
  /** DELETE(세션 종료)에 돌려줄 상태 코드. 지정하면 transport 까지 가지 않는다. */
  terminateStatus?: number;
}): Promise<TestMcpHttpServer> {
  const tools = options.tools;
  let callCount = 0;
  let forgotten = false;
  let lastRequestHeaders: Record<string, string | string[] | undefined> = {};

  /** 요청 하나를 처리할 서버를 만든다. 핸들러는 공유 상태를 닫아 잡는다. */
  const createServerInstance = (): McpSdkServer => {
    const mcp = new McpSdkServer(
      { name: "mcpeak-test-server", version: "0.0.0" },
      { capabilities: { tools: {} } },
    );

    mcp.setRequestHandler(ListToolsRequestSchema, (request) => {
      if (options.repeatCursor === true) {
        return { tools: tools.slice(0, 1), nextCursor: "same" };
      }
      if (options.pageSize === undefined) return { tools: [...tools] };
      const start = request.params?.cursor === undefined ? 0 : Number(request.params.cursor);
      const next = start + options.pageSize;
      return {
        tools: tools.slice(start, next),
        ...(next < tools.length ? { nextCursor: String(next) } : {}),
      };
    });

    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      callCount += 1;
      const result = await options.onCall?.(request.params.name, request.params.arguments);
      if (result === undefined) return { content: [{ type: "text" as const, text: "ok" }] };
      return result as { content: unknown[] };
    });

    return mcp;
  };

  const createTransport = (): StreamableHTTPServerTransport =>
    new StreamableHTTPServerTransport({
      sessionIdGenerator: options.stateful === true ? () => "test-session" : undefined,
      enableJsonResponse: true,
    });

  // stateful 서버는 세션을 유지해야 하므로 인스턴스를 하나만 둔다.
  // stateless 서버는 요청마다 새 인스턴스를 만든다. 하나를 재사용하면 initialize 이후 요청이
  // 서버 쪽에서 예외로 끝난다(SDK 의 stateless 계약).
  const shared = options.stateful === true ? createServerInstance() : undefined;
  const sharedTransport = options.stateful === true ? createTransport() : undefined;
  if (shared !== undefined && sharedTransport !== undefined) {
    await shared.connect(sharedTransport);
  }

  const httpServer = createServer((request, response) => {
    lastRequestHeaders = request.headers;
    if (forgotten) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "session not found" }));
      return;
    }
    if (request.method === "DELETE" && options.terminateStatus !== undefined) {
      response.writeHead(options.terminateStatus);
      response.end();
      return;
    }
    if (sharedTransport !== undefined) {
      settleResponse(sharedTransport.handleRequest(request, response), response);
      return;
    }
    const mcp = createServerInstance();
    const transport = createTransport();
    response.on("close", () => {
      void transport.close().catch(() => undefined);
      void mcp.close().catch(() => undefined);
    });
    settleResponse(
      mcp.connect(transport).then(() => transport.handleRequest(request, response)),
      response,
    );
  });

  const url = await listen(httpServer);
  return {
    url,
    callCount: () => callCount,
    lastRequestHeaders: () => lastRequestHeaders,
    forgetSession: () => {
      forgotten = true;
    },
    close: async () => {
      if (sharedTransport !== undefined) await sharedTransport.close();
      if (shared !== undefined) await shared.close();
      await closeNodeServer(httpServer);
    },
  };
}

/** MCP 를 흉내내지 않고 지정한 상태 코드 · 본문 · 지연만 돌려주는 원시 서버. */
export async function startRawServer(options: {
  status?: number;
  contentType?: string;
  body?: string;
  /** 응답을 지연시켜 handshake timeout 을 만든다. */
  delayMs?: number;
}): Promise<TestHttpServer> {
  const timers = new Set<NodeJS.Timeout>();
  const respond = (response: import("node:http").ServerResponse): void => {
    response.writeHead(options.status ?? 200, {
      "content-type": options.contentType ?? "application/json",
    });
    response.end(options.body ?? "{}");
  };

  const httpServer = createServer((_request, response) => {
    if (options.delayMs === undefined) {
      respond(response);
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      respond(response);
    }, options.delayMs);
    timers.add(timer);
  });

  const url = await listen(httpServer);
  return {
    url,
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await closeNodeServer(httpServer);
    },
  };
}

/**
 * 아무도 듣지 않는 포트의 URL 을 만든다. 잠깐 띄웠다 닫아 OS 가 정한 포트를 얻는다.
 * 같은 실패를 두 번 일으켜 비교하려면 포트가 같아야 하므로 URL 을 재사용한다.
 */
export async function reserveClosedPortUrl(): Promise<string> {
  const httpServer = createServer();
  const url = await listen(httpServer);
  await closeNodeServer(httpServer);
  return url;
}

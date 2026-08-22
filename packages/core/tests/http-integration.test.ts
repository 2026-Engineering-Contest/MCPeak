import { afterEach, describe, expect, it } from "vitest";
import { McpClientError } from "../src/errors.js";
import { connect, connectHttp, type McpHttpConnection } from "../src/index.js";
import {
  reserveClosedPortUrl,
  startMcpHttpServer,
  startRawServer,
  type TestHttpServer,
} from "./fixtures/http-server.js";

const OBJECT_SCHEMA = { type: "object", properties: { text: { type: "string" } } };

const ECHO_TOOLS = [
  { name: "echo", description: "입력을 그대로 돌려준다", inputSchema: OBJECT_SCHEMA },
  { name: "reverse", description: "입력을 뒤집는다", inputSchema: OBJECT_SCHEMA },
];

const servers: TestHttpServer[] = [];
const connections: McpHttpConnection[] = [];
const releases: (() => void)[] = [];

function track<T extends TestHttpServer>(server: T): T {
  servers.push(server);
  return server;
}

function trackConnection(connection: McpHttpConnection): McpHttpConnection {
  connections.push(connection);
  return connection;
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const connection of connections.splice(0)) {
    await connection.close().catch(() => undefined);
  }
  // 한 서버의 close 가 거부해도 나머지가 닫혀야 한다. 안 그러면 포트와 핸들이 남는다.
  for (const server of servers.splice(0)) await server.close().catch(() => undefined);
});

async function expectMcpError(promise: Promise<unknown>): Promise<McpClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(McpClientError);
    return error as McpClientError;
  }
  throw new Error("오류가 발생해야 하는데 정상 반환됐습니다.");
}

describe("connectHttp", () => {
  it("1. 서버가 등록한 tool 목록을 순서대로 반환한다", async () => {
    const server = track(await startMcpHttpServer({ tools: ECHO_TOOLS }));
    const connection = trackConnection(await connectHttp({ url: server.url }));
    const tools = await connection.client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["echo", "reverse"]);
    expect(tools.map((tool) => tool.description)).toEqual([
      "입력을 그대로 돌려준다",
      "입력을 뒤집는다",
    ]);
  });

  it("2. 성공 응답을 ToolResult 로 옮긴다", async () => {
    const content = [{ type: "text", text: "hi" }];
    const server = track(
      await startMcpHttpServer({ tools: ECHO_TOOLS, onCall: () => ({ content }) }),
    );
    const connection = trackConnection(await connectHttp({ url: server.url }));
    const result = await connection.client.callTool("echo", { text: "hi" });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual(content);
  });

  it("3. isError 응답을 던지지 않고 그대로 전달한다", async () => {
    const server = track(
      await startMcpHttpServer({
        tools: ECHO_TOOLS,
        onCall: () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
      }),
    );
    const connection = trackConnection(await connectHttp({ url: server.url }));
    const result = await connection.client.callTool("echo", { text: "hi" });
    expect(result.isError).toBe(true);
  });

  it("4. 잘못된 인자를 네트워크 요청 전에 거절한다", async () => {
    const server = track(await startMcpHttpServer({ tools: ECHO_TOOLS }));
    const connection = trackConnection(await connectHttp({ url: server.url }));
    const error = await expectMcpError(connection.client.callTool("echo", "문자열"));
    expect(error.code).toBe("INVALID_TOOL_ARGUMENTS");
    expect(server.callCount()).toBe(0);
  });

  it("5. cursor 로 나뉜 tools/list 를 모두 모은다", async () => {
    const tools = [
      { name: "a", inputSchema: OBJECT_SCHEMA },
      { name: "b", inputSchema: OBJECT_SCHEMA },
      { name: "c", inputSchema: OBJECT_SCHEMA },
    ];
    const server = track(await startMcpHttpServer({ tools, pageSize: 1 }));
    const connection = trackConnection(await connectHttp({ url: server.url }));
    expect((await connection.client.listTools()).map((tool) => tool.name)).toEqual(["a", "b", "c"]);
  });

  it("6. 같은 cursor 를 반복하는 서버에서 무한 루프에 빠지지 않는다", async () => {
    const server = track(await startMcpHttpServer({ tools: ECHO_TOOLS, repeatCursor: true }));
    const connection = trackConnection(await connectHttp({ url: server.url }));
    const error = await expectMcpError(connection.client.listTools());
    expect(error.code).toBe("PAGINATION_CURSOR_REPEATED");
  });

  it("7. 아무도 듣지 않는 포트를 HTTP_CONNECT_FAILED 로 보고한다", async () => {
    const url = await reserveClosedPortUrl();
    const error = await expectMcpError(connectHttp({ url }));
    expect(error.code).toBe("HTTP_CONNECT_FAILED");
    expect(error.phase).toBe("connect");
    expect(error.diagnostics.transport).toBe("http");
    expect(error.diagnostics).toMatchObject({ status: null });
  });

  it("8. 오류 상태 코드를 HTTP_STATUS_ERROR 로 보고한다", async () => {
    const server = track(await startRawServer({ status: 500 }));
    const error = await expectMcpError(connectHttp({ url: server.url }));
    expect(error.code).toBe("HTTP_STATUS_ERROR");
    expect(error.diagnostics).toMatchObject({ transport: "http", status: 500 });
  });

  it("9. 401 을 HTTP_UNAUTHORIZED 로 보고한다", async () => {
    const server = track(await startRawServer({ status: 401 }));
    const error = await expectMcpError(connectHttp({ url: server.url }));
    expect(error.code).toBe("HTTP_UNAUTHORIZED");
  });

  it("10. JSON 도 SSE 도 아닌 응답을 HTTP_RESPONSE_INVALID 로 보고한다", async () => {
    const server = track(
      await startRawServer({ status: 200, contentType: "text/html", body: "<html>" }),
    );
    const error = await expectMcpError(connectHttp({ url: server.url }));
    expect(error.code).toBe("HTTP_RESPONSE_INVALID");
    expect(error.diagnostics).toMatchObject({ status: null });
  });

  it("11. handshake timeout 을 제한 시간 안에 보고한다", async () => {
    const server = track(await startRawServer({ delayMs: 5_000 }));
    const startedAt = Date.now();
    const error = await expectMcpError(connectHttp({ url: server.url, connectTimeoutMs: 200 }));
    expect(error.code).toBe("HTTP_HANDSHAKE_TIMEOUT");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("12. 연결 뒤 서버가 사라져도 프로세스 오류로 보고하지 않는다", async () => {
    const server = track(await startMcpHttpServer({ tools: ECHO_TOOLS }));
    const connection = trackConnection(await connectHttp({ url: server.url }));
    // closeNodeServer 가 멱등이라 afterEach 가 같은 서버를 다시 닫아도 안전하다.
    await server.close();
    const error = await expectMcpError(connection.client.callTool("echo", { text: "hi" }));
    expect(["PROCESS_EXITED", "PROCESS_START_FAILED", "TRANSPORT_FAILED"]).not.toContain(
      error.code,
    );
  });

  it("13. 서버가 세션을 잊으면 HTTP_SESSION_LOST 로 보고한다", async () => {
    const server = track(await startMcpHttpServer({ tools: ECHO_TOOLS, stateful: true }));
    const connection = trackConnection(await connectHttp({ url: server.url }));
    expect(connection.getDiagnostics().sessionId).not.toBeNull();
    server.forgetSession();
    const error = await expectMcpError(connection.client.callTool("echo", { text: "hi" }));
    expect(error.code).toBe("HTTP_SESSION_LOST");
    expect(error.phase).toBe("transport");
    expect(error.diagnostics).toMatchObject({ status: 404 });
  });

  it("14. close 는 멱등이다", async () => {
    const server = track(await startMcpHttpServer({ tools: ECHO_TOOLS }));
    const connection = await connectHttp({ url: server.url });
    await connection.close();
    await expect(connection.close()).resolves.toBeUndefined();
  });

  it("15. 세션 종료에 405 를 돌려줘도 close 가 정상 반환한다", async () => {
    const server = track(
      await startMcpHttpServer({ tools: ECHO_TOOLS, stateful: true, terminateStatus: 405 }),
    );
    const connection = await connectHttp({ url: server.url });
    await expect(connection.close()).resolves.toBeUndefined();
  });

  it("16. close 뒤 pending 요청이 유한 시간 안에 reject 된다", async () => {
    const server = track(
      await startMcpHttpServer({
        tools: ECHO_TOOLS,
        onCall: () =>
          new Promise((resolve) => {
            releases.push(() => resolve({ content: [{ type: "text", text: "late" }] }));
          }),
      }),
    );
    const connection = await connectHttp({ url: server.url });
    const pending = connection.client.callTool("echo", { text: "hi" });
    await connection.close();
    await expect(pending).rejects.toBeInstanceOf(McpClientError);
  });

  it("17. connect 는 진단을 노출하지 않는 McpClient 를 반환한다", async () => {
    const server = track(await startMcpHttpServer({ tools: ECHO_TOOLS }));
    const client = await connect({ url: server.url });
    expect("getDiagnostics" in client).toBe(false);
    expect(Object.keys(client).sort()).toEqual(["callTool", "close", "listTools"]);
    await client.close();
  });

  it("18. headers 옵션이 실제 요청 헤더로 전달된다", async () => {
    const server = track(await startMcpHttpServer({ tools: ECHO_TOOLS }));
    const connection = trackConnection(
      await connectHttp({ url: server.url, headers: { authorization: "Bearer test-token" } }),
    );
    await connection.client.listTools();
    expect(server.lastRequestHeaders().authorization).toBe("Bearer test-token");
  });
});

describe("connectHttp 결정론성", () => {
  it("19. 같은 연결 거부를 두 번 일으키면 toJSON 이 바이트 단위로 같다", async () => {
    const url = await reserveClosedPortUrl();
    const first = await expectMcpError(connectHttp({ url }));
    const second = await expectMcpError(connectHttp({ url }));
    expect(JSON.stringify(first.toJSON())).toBe(JSON.stringify(second.toJSON()));
  });

  it("20. 같은 상태 코드 오류를 두 번 일으키면 toJSON 이 바이트 단위로 같다", async () => {
    const server = track(await startRawServer({ status: 500 }));
    const first = await expectMcpError(connectHttp({ url: server.url }));
    const second = await expectMcpError(connectHttp({ url: server.url }));
    expect(JSON.stringify(first.toJSON())).toBe(JSON.stringify(second.toJSON()));
  });

  it("21. 같은 성공 경로를 두 번 실행하면 listTools 결과가 같다", async () => {
    const server = track(await startMcpHttpServer({ tools: ECHO_TOOLS }));
    const first = trackConnection(await connectHttp({ url: server.url }));
    const firstTools = JSON.stringify(await first.client.listTools());
    const second = trackConnection(await connectHttp({ url: server.url }));
    const secondTools = JSON.stringify(await second.client.listTools());
    expect(firstTools).toBe(secondTools);
  });
});

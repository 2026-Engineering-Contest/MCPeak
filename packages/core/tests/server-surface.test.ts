import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ErrorCode,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
  type ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import type { AdvertiseOptions } from "../src/options.js";
import {
  clientCapabilities,
  createServerSurface,
  type ServerMessage,
} from "../src/server-surface.js";

const opened: { client: Client; server: Server }[] = [];

afterEach(async () => {
  for (const { client, server } of opened.splice(0)) {
    await client.close();
    await server.close();
  }
});

/** 프로세스 없이 인메모리로 handshake 까지 끝낸 SDK Client 와 Server 를 돌려준다. */
async function connectInMemory(options: {
  capabilities: ServerCapabilities;
  advertise?: AdvertiseOptions;
  setup?: (server: Server) => void;
}): Promise<{ client: Client; server: Server }> {
  const server = new Server(
    { name: "surface-fixture", version: "1.2.3" },
    { capabilities: options.capabilities },
  );
  options.setup?.(server);
  const client = new Client(
    { name: "mcpeak", version: "0.0.0" },
    { capabilities: clientCapabilities(options.advertise) },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  opened.push({ client, server });
  return { client, server };
}

/** 인메모리 전달은 마이크로태스크 몇 번을 거친다. 매크로태스크 한 번이면 끝난다. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("createServerSurface", () => {
  it("1. listToolsRaw 는 annotations·title·_meta 를 버리지 않는다", async () => {
    const { client } = await connectInMemory({
      capabilities: { tools: {} },
      setup: (server) =>
        server.setRequestHandler(ListToolsRequestSchema, () => ({
          tools: [
            {
              name: "delete_file",
              title: "파일 삭제",
              description: "파일을 지운다",
              inputSchema: { type: "object" },
              annotations: { destructiveHint: true, readOnlyHint: false },
              _meta: { "example.com/origin": "fixture" },
            },
          ],
        })),
    });
    const tools = await createServerSurface(client).listToolsRaw();
    expect(tools).toEqual([
      {
        name: "delete_file",
        title: "파일 삭제",
        description: "파일을 지운다",
        inputSchema: { type: "object" },
        annotations: { destructiveHint: true, readOnlyHint: false },
        _meta: { "example.com/origin": "fixture" },
      },
    ]);
  });

  it("2. listToolsRaw 는 cursor 가 반복되면 PAGINATION_CURSOR_REPEATED 로 멈춘다", async () => {
    const { client } = await connectInMemory({
      capabilities: { tools: {} },
      setup: (server) =>
        server.setRequestHandler(ListToolsRequestSchema, () => ({
          tools: [{ name: "loop", inputSchema: { type: "object" } }],
          nextCursor: "same",
        })),
    });
    await expect(createServerSurface(client).listToolsRaw()).rejects.toMatchObject({
      code: "PAGINATION_CURSOR_REPEATED",
      phase: "listTools",
    });
  });

  it("3. prompts 능력이 없으면 listPrompts 는 요청 없이 [] 다", async () => {
    const { client } = await connectInMemory({ capabilities: { tools: {} } });
    expect(await createServerSurface(client).listPrompts()).toEqual([]);
  });

  it("4. prompts 능력이 있으면 listPrompts 는 서버의 목록을 돌려준다", async () => {
    const { client } = await connectInMemory({
      capabilities: { prompts: {} },
      setup: (server) =>
        server.setRequestHandler(ListPromptsRequestSchema, () => ({
          prompts: [{ name: "summarize", description: "요약한다" }],
        })),
    });
    expect(await createServerSurface(client).listPrompts()).toEqual([
      { name: "summarize", description: "요약한다" },
    ]);
  });

  it("5. resources 능력이 없으면 listResources 는 [] 다", async () => {
    const { client } = await connectInMemory({ capabilities: { tools: {} } });
    expect(await createServerSurface(client).listResources()).toEqual([]);
  });

  it("6. serverVersion 은 initialize 응답의 serverInfo 다", async () => {
    const { client } = await connectInMemory({ capabilities: { tools: {} } });
    expect(createServerSurface(client).serverVersion).toEqual({
      name: "surface-fixture",
      version: "1.2.3",
    });
  });

  it("7. advertise.sampling 이 켜지면 서버의 createMessage 가 리스너에 request 로 오고 서버는 MethodNotFound 를 받는다", async () => {
    const { client, server } = await connectInMemory({
      capabilities: { tools: {} },
      advertise: { sampling: true },
    });
    const messages: ServerMessage[] = [];
    createServerSurface(client).observeServerMessages((message) => messages.push(message));

    const params = {
      messages: [{ role: "user" as const, content: { type: "text" as const, text: "안녕" } }],
      maxTokens: 10,
    };
    const failure = await server.createMessage(params).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(McpError);
    expect((failure as McpError).code).toBe(ErrorCode.MethodNotFound);
    expect(messages).toEqual([{ kind: "request", method: "sampling/createMessage", params }]);
  });

  it("8. advertise 가 없으면 클라이언트는 sampling 을 광고하지 않는다", async () => {
    const { server } = await connectInMemory({ capabilities: { tools: {} } });
    expect(server.getClientCapabilities()?.sampling).toBeUndefined();
    expect(clientCapabilities(undefined)).toEqual({});
  });

  it("9. advertise 는 켠 항목만 {} 로 광고한다", () => {
    expect(clientCapabilities({ sampling: true, elicitation: false, roots: true })).toEqual({
      sampling: {},
      roots: {},
    });
  });

  it("10. tools/list_changed 알림이 리스너에 notification 으로 온다", async () => {
    const { client, server } = await connectInMemory({
      capabilities: { tools: { listChanged: true } },
    });
    const messages: ServerMessage[] = [];
    createServerSurface(client).observeServerMessages((message) => messages.push(message));

    await server.sendToolListChanged();
    await settle();

    expect(messages).toEqual([
      { kind: "notification", method: "notifications/tools/list_changed", params: undefined },
    ]);
  });

  it("11. 해제 함수를 부른 뒤에는 알림이 오지 않는다", async () => {
    const { client, server } = await connectInMemory({
      capabilities: { tools: { listChanged: true } },
    });
    const messages: ServerMessage[] = [];
    const stop = createServerSurface(client).observeServerMessages((message) =>
      messages.push(message),
    );

    stop();
    await server.sendToolListChanged();
    await settle();

    expect(messages).toEqual([]);
  });
});

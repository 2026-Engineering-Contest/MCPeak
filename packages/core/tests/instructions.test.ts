import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { readServerInfo } from "../src/server-info.js";

const opened: { client: Client; server: Server }[] = [];

afterEach(async () => {
  for (const { client, server } of opened.splice(0)) {
    await client.close();
    await server.close();
  }
});

/** 프로세스 없이 인메모리로 handshake 까지 끝낸 SDK Client 를 돌려준다. */
async function connectInMemory(options: {
  capabilities: ServerCapabilities;
  instructions?: string;
}): Promise<Client> {
  const server = new Server(
    { name: "instructions-fixture", version: "0.0.0" },
    { capabilities: options.capabilities, instructions: options.instructions },
  );
  const client = new Client({ name: "mcpeak", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  opened.push({ client, server });
  return client;
}

describe("readServerInfo", () => {
  it("1. 서버가 initialize 응답에 실은 instructions 를 그대로 돌려준다", async () => {
    const client = await connectInMemory({
      capabilities: { tools: {} },
      instructions: "도구를 부르기 전에 search_city 로 도시 ID 를 먼저 얻으세요.",
    });
    expect(readServerInfo(client).instructions).toBe(
      "도구를 부르기 전에 search_city 로 도시 ID 를 먼저 얻으세요.",
    );
  });

  it("2. 서버가 instructions 를 싣지 않으면 undefined 다", async () => {
    const client = await connectInMemory({ capabilities: { tools: {} } });
    expect(readServerInfo(client).instructions).toBeUndefined();
  });

  it("3. 광고한 능력 키를 선언 순서와 무관하게 정렬해 돌려준다", async () => {
    const client = await connectInMemory({
      capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
    });
    expect(readServerInfo(client).capabilityKeys).toEqual([
      "logging",
      "prompts",
      "resources",
      "tools",
    ]);
  });

  it("4. 능력을 하나도 광고하지 않으면 빈 목록이다", async () => {
    const client = await connectInMemory({ capabilities: {} });
    expect(readServerInfo(client).capabilityKeys).toEqual([]);
  });
});

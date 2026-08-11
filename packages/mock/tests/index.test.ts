import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDef } from "@ohmymcp/core";
import { afterEach, describe, expect, it } from "vitest";
import { createMockServer, type MockServer } from "../src/index.js";

const { tools } = JSON.parse(
  readFileSync(new URL("../../../fixtures/tools-list.sample.json", import.meta.url), "utf8"),
) as { tools: ToolDef[] };

/** 테스트가 끝나면 열린 서버를 반드시 닫는다 — 안 닫으면 vitest 가 종료되지 않는다. */
const opened: MockServer[] = [];

async function start(): Promise<MockServer> {
  const server = await createMockServer({ tools });
  opened.push(server);
  return server;
}

async function connect(server: MockServer): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  return client;
}

/**
 * 툴 응답의 텍스트 본문을 꺼낸다.
 * `callTool` 반환 타입은 구버전 호환 형태(`toolResult`)와의 유니온이라 `unknown` 으로 받는다.
 */
function text(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  const first = content?.[0]?.text;
  if (first === undefined) throw new Error("응답에 텍스트 content 가 없습니다.");
  return first;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => s.close()));
});

describe("@ohmymcp/mock", () => {
  it("url 을 돌려주고 그 주소로 붙을 수 있다", async () => {
    const server = await start();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const client = await connect(server);
    await client.close();
  });

  it("listTools 가 주어진 툴을 JSON Schema 그대로 노출한다", async () => {
    const server = await start();
    const client = await connect(server);

    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(["get_weather", "add"]);
    expect(listed.tools.find((t) => t.name === "get_weather")?.inputSchema).toEqual(
      tools.find((t) => t.name === "get_weather")?.inputSchema,
    );

    await client.close();
  });

  it("같은 툴을 인자에 따라 다르게 응답한다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    server.on("add", { a: 10, b: 20 }, { sum: 30 });
    const client = await connect(server);

    const small = await client.callTool({ name: "add", arguments: { a: 1, b: 2 } });
    const large = await client.callTool({ name: "add", arguments: { a: 10, b: 20 } });
    expect(JSON.parse(text(small))).toEqual({ sum: 3 });
    expect(JSON.parse(text(large))).toEqual({ sum: 30 });

    await client.close();
  });

  it("인자의 키 순서가 달라도 같은 응답을 찾는다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    const result = await client.callTool({ name: "add", arguments: { b: 2, a: 1 } });
    expect(JSON.parse(text(result))).toEqual({ sum: 3 });

    await client.close();
  });

  it("같은 호출 3회가 바이트 단위로 동일하다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    const runs: string[] = [];
    for (let i = 0; i < 3; i++) {
      runs.push(JSON.stringify(await client.callTool({ name: "add", arguments: { a: 1, b: 2 } })));
    }
    expect(new Set(runs).size).toBe(1);

    await client.close();
  });

  it("주입되지 않은 호출은 무엇이 등록돼 있는지 알려준다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    const result = await client.callTool({ name: "add", arguments: { a: 5, b: 7 } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("주입된 응답이 없습니다");
    expect(text(result)).toContain('{"a":1,"b":2}');
    expect(text(result)).toContain("mock.on(");

    await client.close();
  });

  it("close() 이후에는 연결되지 않는다", async () => {
    const server = await createMockServer({ tools });
    const { url } = server;
    await server.close();

    const client = new Client({ name: "test", version: "0.0.0" });
    await expect(client.connect(new StreamableHTTPClientTransport(new URL(url)))).rejects.toThrow();
  });
});

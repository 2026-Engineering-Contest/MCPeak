#!/usr/bin/env node
/**
 * 중계기 테스트용 가짜 MCP 서버 (stdio). **SDK 를 쓰지 않는다.**
 *
 * SDK `Server` 는 `outputSchema` 에 맞지 않는 `structuredContent` 를 내보내지 못한다.
 * 그런데 §8-3 회귀 테스트는 "진짜 서버가 잘못된 응답을 내면 중계기가 걸러내지 않고
 * 그대로 통과시킨다" 를 봐야 하므로, 잘못된 응답을 **의도적으로** 낼 수 있는 서버가
 * 필요하다. 그래서 줄단위 JSON-RPC 를 직접 다룬다.
 *
 * 응답은 전부 고정값이다 — 랜덤·타임스탬프를 쓰지 않는다.
 *
 * argv:
 *   --exit-after-initialize   initialize 에 답한 뒤 스스로 종료한다 (§8-8)
 * env:
 *   MCPEAK_RELAY_TEST_PIDFILE  주어지면 자기 pid 를 그 경로에 쓴다 (§8-13)
 */
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const exitAfterInitialize = argv.includes("--exit-after-initialize");
const pidfile = process.env.MCPEAK_RELAY_TEST_PIDFILE;
if (pidfile !== undefined) writeFileSync(pidfile, String(process.pid), "utf8");

const TOOLS = [
  {
    name: "echo",
    description: "받은 인자를 그대로 돌려준다.",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
  },
  {
    name: "bad_structured",
    description: "outputSchema 와 맞지 않는 structuredContent 를 낸다 (고의).",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: { temperature: { type: "number" } },
      required: ["temperature"],
    },
  },
  {
    name: "boom",
    description: "isError: true 인 결과를 낸다.",
    inputSchema: { type: "object", properties: {} },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function callResult(name, args) {
  if (name === "bad_structured") {
    // outputSchema 는 temperature(number) 를 요구하는데 temp(string) 를 낸다.
    return { content: [{ type: "text", text: "고장" }], structuredContent: { temp: "21" } };
  }
  if (name === "boom") {
    return { content: [{ type: "text", text: "툴이 실패했습니다" }], isError: true };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(args ?? {}) }],
    structuredContent: { echo: args ?? {} },
  };
}

function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "relay-child", version: "0.0.0" },
      },
    });
    if (exitAfterInitialize) setTimeout(() => process.exit(0), 10);
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    send({ jsonrpc: "2.0", id, result: callResult(params?.name, params?.arguments) });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length > 0) handle(JSON.parse(line));
    index = buffer.indexOf("\n");
  }
});
process.stdin.on("close", () => process.exit(0));

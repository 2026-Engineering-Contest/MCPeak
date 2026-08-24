#!/usr/bin/env node
/**
 * `tools/list` 는 정상 응답하고 첫 `tools/call` 에서 죽는 서버. 이슈 #279 의 재현 서버다.
 *
 * SDK 를 쓰지 않고 줄 단위 JSON-RPC 를 직접 쓴다. `runner` 는
 * `@modelcontextprotocol/sdk` 에 의존하지 않으며(의존 방향은 `runner` → `core`), 픽스처
 * 하나 때문에 의존성을 늘리지 않는다. 프레이밍은 core 가 쓰는 SDK 의 `serializeMessage` 와
 * 같은 규약이다 — `JSON.stringify(message) + "\n"`.
 *
 * 종료 코드 42 는 0 도 1 도 아닌 값이라는 뜻이다. 중단 줄이 실제 종료 코드를 싣는지
 * 확인하려면 흔한 값과 구별돼야 한다.
 */
const TOOLS = [
  {
    name: "add",
    description: "두 수를 더한다.",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let index = buffer.indexOf("\n");
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line !== "") handle(JSON.parse(line));
    index = buffer.indexOf("\n");
  }
});

function handle(message) {
  // 알림에는 id 가 없다. 응답하면 안 된다.
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    // 클라이언트가 보낸 버전을 그대로 돌려준다. 클라이언트가 지원하는 버전임이 보장된다.
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "dies-midway", version: "0.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
    return;
  }
  if (message.method === "tools/call") {
    process.stderr.write("치명적: 내부 상태가 깨졌습니다 (일부러 낸 오류)\n");
    process.exit(42);
  }
  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `Method not found: ${message.method}` },
  });
}

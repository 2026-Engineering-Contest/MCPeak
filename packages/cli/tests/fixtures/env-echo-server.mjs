import { createInterface } from "node:readline";

// `--env <NAME>` E2E 의 대상 서버. 툴 `read_env` 하나가 자기 환경의 변수 하나를 들여다본다.
// **값은 돌려주지 않는다.** 존재 여부와 길이만 준다. 테스트 출력에 값이 찍히면 이 옵션이
// 존재하는 이유가 없어진다(설계 §7.2).

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.id === undefined) return;

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "env-echo-fixture", version: "1.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "read_env",
            description: "환경변수의 존재 여부와 길이를 돌려준다. 값은 돌려주지 않는다.",
            inputSchema: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            },
          },
        ],
      },
    });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params?.arguments?.name;
    const value = typeof name === "string" ? process.env[name] : undefined;
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              present: value !== undefined,
              length: value === undefined ? 0 : value.length,
            }),
          },
        ],
        isError: false,
      },
    });
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32_601, message: "not found" } });
});

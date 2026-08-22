import { createInterface } from "node:readline";

// origin 은 argv 로 받는다. 자식은 부모 env 를 상속하지 않는다 — SDK 의 spawn env 가
// `{...getDefaultEnvironment(), ...options.env}` 라서 임의 변수는 넘어가지 않는다.
const originUrl = process.argv[2];
if (originUrl === undefined) throw new Error("origin URL 인자가 필요합니다.");

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", async (line) => {
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
        serverInfo: { name: "external-fetch-fixture", version: "1.0.0" },
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
            name: "fetch_weather",
            inputSchema: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        ],
      },
    });
    return;
  }
  if (message.method === "tools/call") {
    try {
      const city = message.params?.arguments?.city;
      const url = `${originUrl}?city=${encodeURIComponent(city)}&requestId=fixture-value`;
      const response = await fetch(url, { headers: { accept: "application/json" } });
      const body = await response.json();
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: response.status,
                url: response.url,
                header: response.headers.get("x-origin-fixture"),
                body,
              }),
            },
          ],
          isError: false,
        },
      });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32_000, message: error instanceof Error ? error.message : "fetch failed" },
      });
    }
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32_601, message: "not found" } });
});

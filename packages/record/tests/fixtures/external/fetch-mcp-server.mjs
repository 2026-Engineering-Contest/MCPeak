import { createInterface } from "node:readline";

const originUrl = process.env.MCPEAK_TEST_ORIGIN_URL;
if (originUrl === undefined) throw new Error("MCPEAK_TEST_ORIGIN_URL is required");

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

import { spawnSync } from "node:child_process";
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
          {
            name: "spawn_and_dump",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
    return;
  }
  if (message.method === "tools/call" && message.params?.name === "spawn_and_dump") {
    // 자식을 띄워 **자식의 눈으로** 설정을 본다. 부모의 `process.env` 를 그대로 읽으면 소비
    // 여부까지만 보이고, 이 시점에 태어난 자식이 설정을 물려받는지는 드러나지 않는다.
    const dumped = spawnSync(process.execPath, [
      "-p",
      "JSON.stringify({mode: process.env.MCPEAK_EXTERNAL_MODE ?? null})",
    ]);
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: dumped.stdout.toString("utf8") }],
        isError: false,
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

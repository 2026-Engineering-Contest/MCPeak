import { get as httpGet } from "node:http";
import { createInterface } from "node:readline";

/**
 * `external-fetch-server.mjs` 와 **호출 방식 하나만** 다른 픽스처다. 외부 요청을
 * `globalThis.fetch` 가 아니라 `node:http` 로 낸다.
 *
 * 이 파일이 있는 이유는 ADR-0057 이 정한 범위의 바깥을 재현하기 위해서다. External 어댑터는
 * `globalThis.fetch` 만 교체하므로 이 서버의 호출은 Coordinator 에 도달하지 않는다 — 녹화는
 * 0건이 되고 재생은 실제 네트워크로 나간다. 그것이
 * [#258](https://github.com/2026-Engineering-Contest/MCPeak/issues/258) 이고, 여기서 고정하는
 * 것은 **그 상황에서 도구가 침묵하지 않는다** 는 것이다.
 *
 * **지우지 마라.** 이 픽스처가 사라지면 ADR-0057 의 근거도 함께 사라진다.
 */

const originUrl = process.argv[2];
if (originUrl === undefined) throw new Error("origin URL 인자가 필요합니다.");

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

/** `fetch` 를 거치지 않는다는 것이 이 픽스처의 전부다. */
const getJson = (url) =>
  new Promise((resolve, reject) => {
    const request = httpGet(url, { headers: { accept: "application/json" } }, (response) => {
      let raw = "";
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        try {
          resolve({
            status: response.statusCode,
            header: response.headers["x-origin-fixture"] ?? null,
            body: JSON.parse(raw),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });

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
        serverInfo: { name: "external-http-fixture", version: "1.0.0" },
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
      const { status, header, body } = await getJson(url);
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ status, url, header, body }) }],
          isError: false,
        },
      });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32_000, message: error instanceof Error ? error.message : "http failed" },
      });
    }
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32_601, message: "not found" } });
});

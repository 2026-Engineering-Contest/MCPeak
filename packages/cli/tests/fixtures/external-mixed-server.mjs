import { get as httpGet } from "node:http";
import { createInterface } from "node:readline";

/**
 * 한 툴 호출 안에서 **`globalThis.fetch` 로 한 번, `node:http` 로 한 번** 나간다.
 *
 * 이 픽스처가 있는 이유는 **부분 커버리지**다(ADR-0067). 전부 범위 안인 서버
 * (`external-fetch-server.mjs`)와 전부 범위 밖인 서버(`external-http-server.mjs`)는 이미
 * 있는데, 실제 서버는 섞어 쓴다. 그리고 섞였을 때가 가장 조용히 틀린다 — 어댑터는 앞쪽만 보고,
 * 경고 네 갈래는 전부 이 상황을 비켜가며(`interactionCount > 0`·`consumedCount > 0`·
 * `unusedCount === 0`), 화면에는 초록만 남는다.
 *
 * **`node:http` 호출이 `fetch` 뒤에 오는 순서가 중요하다.** 개수를 마지막 in-scope 호출에
 * 얹어 보내는 설계였다면 바로 이 호출을 놓친다. 순서를 바꾸지 마라.
 *
 * **지우지 마라.** 이 픽스처가 사라지면 ADR-0067 의 근거도 함께 사라진다.
 */

const originUrl = process.argv[2];
if (originUrl === undefined) throw new Error("origin URL 인자가 필요합니다.");

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

/** `fetch` 를 거치지 않는 갈래. 어댑터가 보지 못하는 쪽이다. */
const getJson = (url) =>
  new Promise((resolve, reject) => {
    httpGet(url, { headers: { accept: "application/json" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
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
        serverInfo: { name: "external-mixed-fixture", version: "1.0.0" },
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
      const base = `${originUrl}?city=${encodeURIComponent(city)}`;
      // 범위 안이 먼저, 범위 밖이 나중이다. 위 주석 참고 — 순서가 곧 회귀 방어다.
      const viaFetch = await (await fetch(`${base}&via=fetch`)).json();
      const viaHttp = await getJson(`${base}&via=http`);
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ viaFetch, viaHttp }) }],
          isError: false,
        },
      });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32_000, message: error instanceof Error ? error.message : "failed" },
      });
    }
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32_601, message: "not found" } });
});

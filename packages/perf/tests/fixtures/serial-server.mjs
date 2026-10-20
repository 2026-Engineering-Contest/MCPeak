// perf E2E 픽스처 서버(설계 §10.3, 계획 §10.2). 도구마다 정해진 모양으로 루프백 응답 서버를 부른다.
// 외부 주소는 MCPEAK_PERF_FIXTURE_ORIGIN, serial·parallel·http 의 지연은 MCPEAK_PERF_FIXTURE_DELAY_MS 로 받는다.
// 지연 상수는 tests/fixtures/loopback-origin.ts 의 DELAY_MS 이고, 이 파일은 그것을 import 하지 않는다(계획 E16).
// zod 를 쓰지 않으려고 SDK 의 저수준 Server 와 손으로 쓴 JSON Schema 를 쓴다.
import { get } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const origin = process.env.MCPEAK_PERF_FIXTURE_ORIGIN;
if (origin === undefined || origin === "") {
  process.stderr.write(
    "serial-server: MCPEAK_PERF_FIXTURE_ORIGIN 이 없습니다. 루프백 응답 서버 주소(http://127.0.0.1:<port>)를 넘기세요.\n",
  );
  process.exit(1);
}
const rawDelay = process.env.MCPEAK_PERF_FIXTURE_DELAY_MS;
if (rawDelay === undefined || !/^\d+$/.test(rawDelay)) {
  process.stderr.write(
    `serial-server: MCPEAK_PERF_FIXTURE_DELAY_MS 가 0 이상의 정수가 아닙니다(받은 값: ${rawDelay === undefined ? "없음" : JSON.stringify(rawDelay)}). loopback-origin.ts 의 DELAY_MS 를 String 으로 넘기세요.\n`,
  );
  process.exit(1);
}
const delay = Number(rawDelay);

/** fetch 로 부르고 본문을 끝까지 읽는다. */
async function fetchJson(path) {
  const response = await fetch(`${origin}${path}`);
  return { status: response.status, body: await response.text() };
}

/** node:http 로 부르고 본문을 끝까지 읽는다. */
function httpGet(path) {
  return new Promise((resolve, reject) => {
    const request = get(`${origin}${path}`, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode, body }));
      response.on("error", reject);
    });
    request.on("error", reject);
  });
}

const EMPTY = { type: "object", properties: {}, additionalProperties: false };

const tools = {
  serial: {
    description: "독립 요청 둘을 순차로 보낸다",
    run: async () => [await fetchJson(`/a?ms=${delay}`), await fetchJson(`/b?ms=${delay}`)],
  },
  parallel: {
    description: "독립 요청 둘을 Promise.all 로 보낸다",
    run: () => Promise.all([fetchJson(`/a?ms=${delay}`), fetchJson(`/b?ms=${delay}`)]),
  },
  dependent: {
    description: "첫 응답의 id 를 둘째 요청 경로에 쓴다",
    run: async () => {
      const first = await fetchJson("/first?ms=50");
      const { id } = JSON.parse(first.body);
      return [first, await fetchJson(`/second/${id}?ms=50`)];
    },
  },
  repeat: {
    description: "같은 설정을 한 호출 안에서 두 번 받는다",
    run: async () => [
      await fetchJson("/settings?ms=20"),
      await fetchJson("/settings?ms=20"),
      await fetchJson("/data?ms=20"),
    ],
  },
  retry: {
    description: "429 를 받으면 같은 요청을 한 번 다시 보낸다",
    run: async () => {
      const first = await fetchJson("/flaky?ms=20");
      if (first.status !== 429) return [first];
      return [first, await fetchJson("/flaky?ms=20")];
    },
  },
  prefetch: {
    description: "입력과 무관한 설정을 매 호출 받은 뒤 항목을 받는다",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (input) => [
      await fetchJson("/config?ms=20"),
      await fetchJson(`/item?id=${input.id}&ms=20`),
    ],
  },
  http: {
    description: "node:http 로 요청 하나를 보낸다",
    run: async () => [await httpGet(`/a?ms=${delay}`)],
  },
  local: {
    description: "외부 요청 없이 답한다",
    run: async () => [{ local: true }],
  },
  fails: {
    description: "외부 요청 없이 isError 로 답한다",
    fails: true,
    run: async () => [{ failed: true }],
  },
};

const server = new Server(
  { name: "serial-server", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema ?? EMPTY,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = Object.hasOwn(tools, request.params.name) ? tools[request.params.name] : undefined;
  if (tool === undefined) {
    return {
      content: [{ type: "text", text: `알 수 없는 도구: ${request.params.name}` }],
      isError: true,
    };
  }
  const results = await tool.run(request.params.arguments ?? {});
  return {
    content: [{ type: "text", text: JSON.stringify(results) }],
    ...(tool.fails === true ? { isError: true } : {}),
  };
});

await server.connect(new StdioServerTransport());

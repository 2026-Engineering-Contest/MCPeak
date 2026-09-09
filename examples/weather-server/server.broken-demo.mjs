#!/usr/bin/env node
/**
 * 데모용 **고장난** 예제 서버. `server.mjs` 에서 `add` 의 입력 검증만 뺀 것이다.
 *
 * 승인된 명세(`server.suite.json`)를 이 서버로 돌리면 4건이 실패하고, 그 실패는 전부 한
 * 원인을 가리킨다 — 필수 인자와 타입을 확인하지 않아 서버가 거절해야 할 입력을 받아들인다.
 * repair 가 원인을 정확히 짚는지 보여주는 자리다.
 *
 * **실제 서버로 쓰지 마라.** `server.mjs` 가 이 예제의 정상 구현이다.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const TOOLS = [
  {
    name: "get_weather",
    description: "지정한 도시의 현재 날씨를 반환한다.",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", description: "도시 이름" } },
      required: ["city"],
    },
  },
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

const WEATHER = {
  서울: { temp: 21, condition: "맑음" },
  부산: { temp: 24, condition: "흐림" },
  제주: { temp: 26, condition: "비" },
};

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true });

function handleCall(name, args) {
  if (name === "get_weather") {
    const city = args?.city;
    if (typeof city !== "string") {
      return fail('→ \'city\' 는 문자열이어야 합니다. 예: { "city": "서울" }');
    }
    if (!Object.hasOwn(WEATHER, city)) {
      return fail(
        `→ '${city}' 의 날씨 데이터가 없습니다. 사용 가능한 도시: ${Object.keys(WEATHER).join(", ")}\n` +
          "→ 이 예제 서버는 고정 데이터만 가지고 있습니다.",
      );
    }
    return text({ city, ...WEATHER[city] });
  }

  if (name === "add") {
    // 여기가 이 파일의 고장이다. 정상 구현(`server.mjs`)에는 아래 검사가 있다.
    //   if (typeof a !== "number" || typeof b !== "number")
    //     return fail("→ 'a' 와 'b' 는 모두 숫자여야 합니다.");
    // 검사가 없으니 인자가 빠지거나 문자열이어도 그대로 더해 정상 응답을 돌려준다.
    const { a, b } = args ?? {};
    return text({ sum: a + b });
  }

  return fail(`→ 알 수 없는 툴 '${name}'. 사용 가능한 툴: ${TOOLS.map((t) => t.name).join(", ")}`);
}

const server = new Server(
  { name: "example-weather-server-broken-demo", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) =>
  handleCall(req.params.name, req.params.arguments),
);

await server.connect(new StdioServerTransport());

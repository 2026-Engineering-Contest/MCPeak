#!/usr/bin/env node
/**
 * 예제 MCP 서버 — 날씨 조회.
 *
 * 이 저장소의 도그푸딩 대상이다. `mcpeak` 로 이 서버를 테스트하는 것이
 * "우리 도구로 우리를 검증한다"(CONTRIBUTING §6)의 실체다.
 *
 * 설계상 지킨 것 두 가지:
 *
 * 1. **결정론적이다.** 외부 API 를 부르지 않고 고정 테이블에서 답한다.
 *    같은 도시를 몇 번 물어도 항상 같은 값이 나온다. 랜덤·타임스탬프를 쓰지 않는다.
 *    (CLAUDE.md — 결정론성이 핵심 가치)
 * 2. **API 키가 필요 없다.** 누구나 클론해서 바로 돌릴 수 있어야 예제다.
 *
 * 툴 정의는 `fixtures/tools-list.sample.json` 과 같은 형태로 맞췄다.
 * 저수준 Server 를 쓰므로 JSON Schema 를 그대로 넘길 수 있고 zod 가 필요 없다.
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

/** 고정 데이터. 외부 API 를 부르지 않으므로 언제 돌려도 결과가 같다. */
const WEATHER = {
  서울: { temp: 21, condition: "맑음" },
  부산: { temp: 24, condition: "흐림" },
  제주: { temp: 26, condition: "비" },
};

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** 실패 메시지가 곧 제품이다. 무엇이 왜 안 됐고 무엇을 쓸 수 있는지 알려준다. */
const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true });

function handleCall(name, args) {
  if (name === "get_weather") {
    const city = args?.city;
    if (typeof city !== "string") {
      return fail('→ \'city\' 는 문자열이어야 합니다. 예: { "city": "서울" }');
    }
    // Object.hasOwn 으로 확인한다. WEATHER[city] 의 truthy 검사만 하면
    // "toString" · "constructor" · "__proto__" 같은 프로토타입 속성이 걸려
    // 실패 처리를 통과한다 (WEATHER["toString"] 은 함수라 truthy).
    // 그러면 temp·condition 없는 빈 성공 응답이 나간다.
    if (!Object.hasOwn(WEATHER, city)) {
      return fail(
        `→ '${city}' 의 날씨 데이터가 없습니다. 사용 가능한 도시: ${Object.keys(WEATHER).join(", ")}\n` +
          "→ 이 예제 서버는 고정 데이터만 가지고 있습니다.",
      );
    }
    return text({ city, ...WEATHER[city] });
  }

  if (name === "add") {
    const { a, b } = args ?? {};
    if (typeof a !== "number" || typeof b !== "number") {
      return fail("→ 'a' 와 'b' 는 모두 숫자여야 합니다.");
    }
    return text({ sum: a + b });
  }

  return fail(`→ 알 수 없는 툴 '${name}'. 사용 가능한 툴: ${TOOLS.map((t) => t.name).join(", ")}`);
}

const server = new Server(
  { name: "example-weather-server", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) =>
  handleCall(req.params.name, req.params.arguments),
);

await server.connect(new StdioServerTransport());

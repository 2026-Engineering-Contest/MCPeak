#!/usr/bin/env node
/**
 * 결함을 심은 weather 서버. **E2E 전용 fixture 다.**
 *
 * `examples/weather-server/server.mjs` 를 고치지 않는 이유는 그 파일이 도그푸딩 E2E 의 대상이고
 * `examples/**` 가 전역 수정 금지 대상이기 때문이다. 그래서 결함을 심은 사본을 여기 둔다.
 *
 * **SDK 를 쓰지 않고 stdio JSON-RPC 를 직접 구현한다.** `@modelcontextprotocol/sdk` 는
 * `packages/core` 와 `examples/weather-server` 에만 설치돼 있어 `packages/cli/tests` 에서는
 * 해석되지 않는다. 의존성 추가는 금지 사항이라(팀 CLAUDE.md) 프로토콜을 손으로 쓴다.
 * 주고받는 것은 줄 단위 JSON 하나씩이고, 응답 형식은 원본 서버와 같다.
 *
 * 심은 결함은 하나다. 도시 존재 검사를 `Object.hasOwn(WEATHER, city)` 가 아니라
 * `WEATHER[city]` 의 truthy 검사로 한다. `"toString"` 같은 프로토타입 속성이 truthy 라서
 * 실패 처리를 통과하고, temp·condition 이 없는 빈 성공 응답이 나간다.
 * 원본 `server.mjs:61-64` 주석이 경고하던 바로 그 결함이다.
 */
import { createInterface } from "node:readline";

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
const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true });

function handleCall(name, args) {
  if (name === "get_weather") {
    const city = args?.city;
    if (typeof city !== "string") {
      return fail('→ \'city\' 는 문자열이어야 합니다. 예: { "city": "서울" }');
    }
    // 심은 결함. truthy 검사라 프로토타입 속성이 실패 처리를 통과한다.
    if (!WEATHER[city]) {
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

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

function handle(request) {
  if (request.method === "initialize") {
    // 클라이언트가 요구한 버전을 그대로 돌려준다. 우리가 버전 협상을 흉내 낼 이유가 없다.
    return {
      protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "broken-weather-server", version: "0.1.0" },
    };
  }
  if (request.method === "tools/list") return { tools: TOOLS };
  if (request.method === "tools/call")
    return handleCall(request.params?.name, request.params?.arguments);
  return undefined;
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim() === "") return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  // 알림에는 id 가 없다. 응답을 보내면 클라이언트가 짝 없는 응답으로 보고 끊는다.
  if (request.id === undefined || request.id === null) return;
  const result = handle(request);
  if (result === undefined) {
    send({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32601, message: `알 수 없는 method '${request.method}'` },
    });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result });
});

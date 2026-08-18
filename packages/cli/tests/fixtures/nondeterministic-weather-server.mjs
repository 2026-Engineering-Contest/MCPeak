#!/usr/bin/env node
/**
 * 비결정 응답을 내는 weather 서버. **E2E 전용 fixture 다.**
 *
 * `examples/weather-server/server.mjs` 를 고치지 않는 이유는 그 파일이 도그푸딩 E2E 의 대상이고
 * `examples/**` 가 전역 수정 금지 대상이기 때문이다. 그래서 비결정을 심은 사본을 여기 둔다.
 *
 * **SDK 를 쓰지 않고 stdio JSON-RPC 를 직접 구현한다.** `@modelcontextprotocol/sdk` 는
 * `packages/core` 와 `examples/weather-server` 에만 설치돼 있어 `packages/cli/tests` 에서는
 * 해석되지 않는다. 의존성 추가는 금지 사항이라(팀 CLAUDE.md) 프로토콜을 손으로 쓴다.
 * 골격은 `broken-weather-server.mjs` 와 같고 툴과 응답만 다르다.
 *
 * 심은 비결정은 응답의 조회 시각이다. `--determinism` 이 이 필드를 잡는 것이 이 서버의
 * 존재 이유다.
 *
 * **`fetchedAt` 만으로는 부족하다.** 두 회차가 같은 밀리초에 응답하면 값이 같아져 E2E 가
 * 간헐 실패한다. 간헐 실패는 이 저장소의 핵심 가치(결정론성)에 정면으로 반하므로 값이
 * **반드시** 달라지게 `elapsedNs` 를 함께 싣는다. `process.hrtime.bigint()` 는 부팅 기준
 * 나노초라 회차마다 다른 값이 보장된다(두 회차는 순차 실행이고 프로세스도 다르다).
 * 두 필드 다 시간에서 나온 값이므로 "시간 의존" 이라는 진단도 정직하다.
 */
import { createInterface } from "node:readline";

const TOOLS = [
  {
    name: "get_weather",
    description: "지정한 도시의 현재 날씨를 반환한다. 응답에 조회 시각이 들어간다.",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", description: "도시 이름" } },
      required: ["city"],
    },
  },
];

/** 고정 데이터. 비결정은 아래 조회 시각에서만 나온다. */
const WEATHER = { 서울: { temp: 21, condition: "맑음" } };

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true });

function handleCall(name, args) {
  if (name !== "get_weather")
    return fail(
      `→ '${name}' 툴이 없습니다. 사용 가능한 툴: ${TOOLS.map((t) => t.name).join(", ")}`,
    );
  const city = args?.city;
  if (typeof city !== "string" || !Object.hasOwn(WEATHER, city))
    return fail(`→ '${String(city)}' 의 날씨 데이터가 없습니다.`);
  // 심은 비결정. fetchedAt 이 timestamp 힌트를 만들고, elapsedNs 가 같은 밀리초 충돌을 막는다.
  return text({
    ...WEATHER[city],
    fetchedAt: new Date().toISOString(),
    elapsedNs: process.hrtime.bigint().toString(),
  });
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
      serverInfo: { name: "nondeterministic-weather-server", version: "0.1.0" },
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

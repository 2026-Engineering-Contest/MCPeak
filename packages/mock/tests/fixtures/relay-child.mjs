#!/usr/bin/env node
/**
 * 중계기 테스트용 가짜 MCP 서버 (stdio). **SDK 를 쓰지 않는다.**
 *
 * SDK `Server` 는 `outputSchema` 에 맞지 않는 `structuredContent` 를 내보내지 못한다.
 * 그런데 §8-3 회귀 테스트는 "진짜 서버가 잘못된 응답을 내면 중계기가 걸러내지 않고
 * 그대로 통과시킨다" 를 봐야 하므로, 잘못된 응답을 **의도적으로** 낼 수 있는 서버가
 * 필요하다. 그래서 줄단위 JSON-RPC 를 직접 다룬다.
 *
 * 응답은 전부 고정값이다 — 랜덤·타임스탬프를 쓰지 않는다.
 *
 * argv:
 *   --exit-after-initialize   initialize 에 답한 뒤 스스로 종료한다 (§8-8)
 *   --pidfile <경로>          주어지면 자기 pid 를 그 경로에 쓴다 (§8-13)
 *   --ignore-stdin-close      stdin 이 닫혀도 스스로 끝내지 않는다 (§8-13)
 *   --server-request          initialize 에 답한 뒤 서버발 **요청**을 하나 낸다
 *   --server-notification     initialize 에 답한 뒤 서버발 **알림**을 하나 낸다
 *   --stray-response          대기표에 없는 응답 둘을 낸다 (모르는 id · id 가 null)
 *
 * 서버발 둘은 **플래그가 있을 때만** 낸다. 기본으로 내면 §8-6 의 엄격한 줄 목록 비교가
 * 이 파일 때문에 흔들린다 — 그 테스트는 중계기의 기록 순서를 보는 자리지 픽스처의
 * 성질을 보는 자리가 아니다.
 *
 * pid 를 **환경변수가 아니라 argv 로** 받는 이유: 중계기가 자식을 띄울 때 쓰는 SDK 의
 * `StdioClientTransport` 는 부모 환경을 통째로 물려주지 않는다. `getDefaultEnvironment()`
 * 이 `HOME·LOGNAME·PATH·SHELL·TERM·USER` 만 추려 넘기므로, 테스트가 심은 환경변수는
 * 자식에 닿지 않는다(실측). argv 는 `-- <명령> [인자...]` 로 그대로 전달된다.
 *
 * `read_env` 툴은 바로 그 성질을 **검사 대상으로** 삼는 자리다. `RelayOptions.env` 로
 * 지목한 이름만 자식에 닿고 나머지는 안 닿는다는 것을, 자식이 실제로 보는 `process.env`
 * 를 되돌려 받아 확인한다. 값을 지어내지 않으므로 여전히 결정론적이다.
 */
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const exitAfterInitialize = argv.includes("--exit-after-initialize");
const emitServerRequest = argv.includes("--server-request");
const emitServerNotification = argv.includes("--server-notification");
const emitStrayResponse = argv.includes("--stray-response");
const pidfileIndex = argv.indexOf("--pidfile");
const pidfile = pidfileIndex === -1 ? undefined : argv[pidfileIndex + 1];
if (pidfile !== undefined) writeFileSync(pidfile, String(process.pid), "utf8");

const TOOLS = [
  {
    name: "echo",
    description: "받은 인자를 그대로 돌려준다.",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
  },
  {
    name: "bad_structured",
    description: "outputSchema 와 맞지 않는 structuredContent 를 낸다 (고의).",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: { temperature: { type: "number" } },
      required: ["temperature"],
    },
  },
  {
    name: "boom",
    description: "isError: true 인 결과를 낸다.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_env",
    description: "자식이 실제로 보는 process.env 에서 그 이름의 값을 돌려준다.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function callResult(name, args) {
  if (name === "bad_structured") {
    // outputSchema 는 temperature(number) 를 요구하는데 temp(string) 를 낸다.
    return { content: [{ type: "text", text: "고장" }], structuredContent: { temp: "21" } };
  }
  if (name === "read_env") {
    const wanted = args?.name;
    const value = process.env[wanted];
    // `present` 를 따로 낸다. 없는 변수의 `value` 를 `undefined` 로 두면 JSON 직렬화가
    // 키째로 지워서, 호출한 쪽이 "없다" 와 "키를 안 냈다" 를 구별할 수 없다.
    return {
      content: [{ type: "text", text: value === undefined ? "(없음)" : value }],
      structuredContent: { name: wanted, present: value !== undefined, value: value ?? null },
    };
  }
  if (name === "boom") {
    return { content: [{ type: "text", text: "툴이 실패했습니다" }], isError: true };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(args ?? {}) }],
    structuredContent: { echo: args ?? {} },
  };
}

function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "relay-child", version: "0.0.0" },
      },
    });
    // 서버가 **먼저 거는** 것들. 중계기는 돌려보낼 세션 채널이 없어 버리는데, 버린
    // 사실을 기록하는지가 검사 대상이다. id 는 9001 고정이다 — 랜덤을 쓰지 않는다.
    if (emitServerRequest) {
      send({
        jsonrpc: "2.0",
        id: 9001,
        method: "sampling/createMessage",
        params: { messages: [], maxTokens: 1 },
      });
    }
    if (emitServerNotification) {
      send({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "info", data: "서버가 스스로 보낸 알림" },
      });
    }
    // 중계기가 보낸 적 없는 id 로 낸 응답 둘. 프로토콜 위반이라 중계기가 **조용히**
    // 버려야 하는 갈래다 — 서버가 먼저 건 요청과 달리 기록할 근거가 없다.
    if (emitStrayResponse) {
      send({ jsonrpc: "2.0", id: 9999, result: { 아무도: "안 기다린다" } });
      // `id: null` 은 파싱조차 못 한 요청에 대한 오류 응답의 모양이다. **중계기까지
      // 가지 못한다** — SDK 의 `JSONRPCMessageSchema` 가 `onmessage` 앞에서 거절한다
      // (실측). 중계기의 `id === null` 분기가 지금 닿지 않는 길이라는 사실을 이 줄이
      // 기록한다. SDK 가 검증을 느슨하게 하면 그때부터 실제로 흐른다.
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    if (exitAfterInitialize) setTimeout(() => process.exit(0), 10);
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    send({ jsonrpc: "2.0", id, result: callResult(params?.name, params?.arguments) });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length > 0) handle(JSON.parse(line));
    index = buffer.indexOf("\n");
  }
});
// stdin 이 닫히면 스스로 끝내는 것이 기본이다. `--ignore-stdin-close` 는 그것을 끈다 —
// 그래야 "중계기가 자식을 **직접** 끝낸다" 를 검사할 수 있다. 이 플래그가 없으면 중계기가
// 아무것도 안 해도 부모가 죽는 순간 파이프가 닫혀 자식이 알아서 끝나므로, 테스트가
// 중계기가 아니라 OS 의 동작을 확인하게 된다 (실측).
if (argv.includes("--ignore-stdin-close")) {
  // 핸들러를 떼는 것만으로는 모자란다. stdin 이 끝나면 이벤트 루프에 남는 일이 없어
  // 프로세스가 **저절로** 끝나기 때문이다(실측). 타이머로 루프를 붙잡아 둬야 비로소
  // "중계기가 죽이지 않으면 살아남는 자식" 이 된다.
  setInterval(() => {}, 1000);
} else {
  process.stdin.on("close", () => process.exit(0));
}

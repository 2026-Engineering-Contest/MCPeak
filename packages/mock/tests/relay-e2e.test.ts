import { fileURLToPath } from "node:url";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { type RelayHandle, startRelay } from "../src/relay-server.js";

const CHILD = fileURLToPath(new URL("./fixtures/relay-child.mjs", import.meta.url));

const open: RelayHandle[] = [];
const sessions: Session[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  for (const handle of open.splice(0)) await handle.close();
});

interface Session {
  call(id: number, method: string, params?: unknown): Promise<JSONRPCMessage>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
}

/**
 * 중계기에 붙는 클라이언트. **SDK `Client` 를 쓰지 않는다** — `Client` 는
 * `structuredContent` 를 `outputSchema` 로 검증해서 던지므로, 중계기가 무엇을
 * 통과시켰는지 보는 테스트가 클라이언트 쪽 검증에 가려진다 (§8-3 이 그 자리다).
 * 트랜스포트만 써서 봉투를 그대로 본다.
 */
async function openSession(
  url: string,
  /** 이 세션에 **도착한 모든 봉투**를 엿본다. "버린 것이 새어 나오지 않는다" 가 쓴다. */
  onAny?: (message: JSONRPCMessage) => void,
): Promise<Session> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const waiters = new Map<number, (m: JSONRPCMessage) => void>();
  transport.onmessage = (message) => {
    onAny?.(message);
    if ("id" in message && typeof message.id === "number") waiters.get(message.id)?.(message);
  };
  await transport.start();
  const session: Session = {
    call: (id, method, params) =>
      new Promise<JSONRPCMessage>((resolve) => {
        waiters.set(id, resolve);
        void transport.send({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        } as JSONRPCMessage);
      }),
    notify: (method, params) =>
      transport.send({
        jsonrpc: "2.0",
        method,
        ...(params === undefined ? {} : { params }),
      } as JSONRPCMessage),
    close: () => transport.close(),
  };
  sessions.push(session);
  // 핸드셰이크는 클라이언트와 진짜 서버가 직접 한다 — 중계기는 지나가게만 둔다(설계 §4).
  await session.call(0, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "relay-test", version: "0.0.0" },
  });
  await session.notify("notifications/initialized");
  return session;
}

async function startFixtureRelay(
  extra: readonly string[] = [],
  env: Readonly<Record<string, string>> = {},
): Promise<{ handle: RelayHandle; lines: string[] }> {
  const lines: string[] = [];
  const handle = await startRelay({
    port: 0,
    command: process.execPath,
    args: [CHILD, ...extra],
    log: (line) => lines.push(line),
    json: false,
    env,
  });
  open.push(handle);
  return { handle, lines };
}

/** 프로세스 수를 세지 않고 **이 pid 하나**만 본다. 프로세스 수는 병렬 실행에서 남의 서버를 센다. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("조건이 제한 시간 안에 참이 되지 않았습니다.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("startRelay — 진짜 서버가 답한다", () => {
  it("§8-1 tools/list 가 진짜 서버가 선언한 목록 그대로 온다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(1, "tools/list");

    expect(response).toMatchObject({
      id: 1,
      result: {
        tools: [
          { name: "echo", description: "받은 인자를 그대로 돌려준다." },
          { name: "bad_structured" },
          { name: "boom" },
          { name: "read_env" },
        ],
      },
    });
  });

  it("§8-2 tools/call 결과가 structuredContent 까지 그대로 온다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(2, "tools/call", {
      name: "echo",
      arguments: { text: "부산" },
    });

    expect(response).toMatchObject({
      id: 2,
      result: {
        content: [{ type: "text", text: '{"text":"부산"}' }],
        structuredContent: { echo: { text: "부산" } },
      },
    });
  });

  it("§8-4 isError: true 가 프로토콜 오류로 바뀌지 않는다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(3, "tools/call", { name: "boom", arguments: {} });

    expect(response).not.toHaveProperty("error");
    expect(response).toMatchObject({ id: 3, result: { isError: true } });
  });

  it("§8-5 서버가 낸 -32601 이 그대로 온다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(4, "resources/list");

    expect(response).toMatchObject({
      id: 4,
      error: { code: -32601, message: "Method not found: resources/list" },
    });
  });

  it("port 0 이면 받은 포트를 handle 로 돌려준다", async () => {
    const { handle } = await startFixtureRelay();

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/mcp`);
  });
});

describe("중계기는 응답을 해석하지 않는다", () => {
  /**
   * **이 테스트는 구조를 고정한다.** 중계기에 `outputSchema` 검증을 넣거나 SDK `Client`
   * 를 끼우면 이 테스트가 실패한다 — 그게 이 테스트의 목적이다.
   *
   * SDK `Client` 는 `structuredContent` 를 `outputSchema` 로 검증해 `-32602` 를 던진다
   * (`examples/live-weather-server` 의 결함 A 가 내는 그 오류가 이 경로다). 중계기가
   * `Client` 를 쓰면 진짜 서버의 잘못된 응답을 중계기가 대신 받아서 던지고, 사용자는
   * 서버의 답이 아니라 중계기가 만든 오류를 본다. 설계 §2-2 가 거기서 깨진다.
   */
  it("§8-3 outputSchema 와 안 맞는 structuredContent 가 걸러지지 않고 그대로 간다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(9, "tools/call", {
      name: "bad_structured",
      arguments: {},
    });

    // 중계기가 만든 오류가 아니라 서버의 응답이 온다.
    expect(response).not.toHaveProperty("error");
    expect(response).toMatchObject({
      id: 9,
      result: { structuredContent: { temp: "21" } },
    });
    // 스키마가 요구하는 필드는 실제로 없다 — 즉 검증을 통과할 수 없는 값이다.
    // `JSONRPCMessage` 는 오류 갈래를 포함하는 유니온이라 곧바로 좁히면 TS2352 다.
    // 위 `toMatchObject` 가 이미 result 갈래임을 확인했으므로 `unknown` 을 경유한다.
    const result = (
      response as unknown as { result: { structuredContent: Record<string, unknown> } }
    ).result;
    expect(result.structuredContent).not.toHaveProperty("temperature");
  });
});

describe("세션 격리", () => {
  /**
   * 대시보드는 `claude -p` 를 **질문마다 새 프로세스로** 띄운다. 새 프로세스는 JSON-RPC
   * id 를 1 부터 다시 시작하므로, 동시에 붙은 두 세션이 같은 id 를 쓴다. 자식은 하나뿐이라
   * (설계 §5) 파이프가 1:N 이 되고, 봉투의 id 를 그대로 흘려보내면 나중 세션이 앞 세션의
   * 대기 항목을 덮어써서 응답이 엉뚱한 세션으로 간다.
   *
   * 중계기가 자기 id 를 새로 매기고 돌아올 때 되돌리는 것이 그 해법이다.
   */
  it("§8-11 두 세션이 같은 id 로 번갈아 불러도 응답이 섞이지 않는다", async () => {
    const { handle } = await startFixtureRelay();
    const first = await openSession(handle.url);
    const second = await openSession(handle.url);

    const [a, b] = await Promise.all([
      first.call(1, "tools/call", { name: "echo", arguments: { who: "first" } }),
      second.call(1, "tools/call", { name: "echo", arguments: { who: "second" } }),
    ]);

    expect(a).toMatchObject({ id: 1, result: { structuredContent: { echo: { who: "first" } } } });
    expect(b).toMatchObject({ id: 1, result: { structuredContent: { echo: { who: "second" } } } });
  });
});

describe("수명", () => {
  it("§8-8 뒤 서버가 먼저 죽어도 close() 가 멈추지 않는다", async () => {
    const { handle } = await startFixtureRelay(["--exit-after-initialize"]);
    const session = await openSession(handle.url);
    const pid = handle.childPid;
    expect(pid).not.toBeNull();
    await session.close();
    // 자식이 스스로 종료할 시간을 준다. setTimeout 이 아니라 종료 사실을 폴링한다 —
    // 고정 대기는 느린 CI 에서 가끔 실패한다.
    //
    // 기다리는 조건은 `childPid` 가 null 이 되는 것이다. `RelayHandle` 이 약속한 계약이
    // 바로 그것이고(자식이 끝나면 null), getter 는 살아 있으면 pid · 끝났으면 null 두
    // 상태뿐이라 "null 이 아니면서 죽어 있다" 는 상태는 존재하지 않는다.
    await waitFor(() => handle.childPid === null);
    // 계약이 아니라 실제 프로세스가 죽었는지도 따로 본다.
    expect(isAlive(pid as number)).toBe(false);

    await expect(handle.close()).resolves.toBeUndefined();
  });

  it("§8-9 close() 뒤 자식 프로세스가 남지 않는다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);
    await session.call(1, "tools/list");
    const pid = handle.childPid;
    expect(pid).not.toBeNull();
    expect(isAlive(pid as number)).toBe(true);

    await handle.close();

    await waitFor(() => !isAlive(pid as number));
    expect(isAlive(pid as number)).toBe(false);
  });
});

describe("기록", () => {
  it("§8-6 요청·응답이 한 쌍으로 순서대로 나온다", async () => {
    const { handle, lines } = await startFixtureRelay();
    const session = await openSession(handle.url);
    await session.call(1, "tools/list");
    await session.call(2, "tools/call", { name: "echo", arguments: { text: "부산" } });

    // 초 단위는 시간에 따라 달라지는 유일한 값이라 마스킹하고 비교한다.
    const masked = lines.map((line) => line.replace(/\d+\.\d초/g, "N초"));
    expect(masked).toEqual([
      "→ initialize",
      "← initialize 성공 · 114바이트 · N초",
      "→ tools/list",
      "← tools/list  툴 4개",
      '→ tools/call  echo {"text":"부산"}',
      "← tools/call  echo 성공 · 107바이트 · N초",
    ]);
  });

  it("§8-7 --json 줄이 파싱되고 필드가 맞다", async () => {
    const lines: string[] = [];
    const handle = await startRelay({
      port: 0,
      command: process.execPath,
      args: [CHILD],
      log: (line) => lines.push(line),
      json: true,
      env: {},
    });
    open.push(handle);
    const session = await openSession(handle.url);
    await session.call(7, "tools/call", { name: "echo", arguments: { text: "부산" } });

    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const request = parsed.find((entry) => entry.dir === "req" && entry.tool === "echo");
    const response = parsed.find((entry) => entry.dir === "res" && entry.tool === "echo");
    expect(request).toEqual({
      dir: "req",
      id: expect.any(Number),
      method: "tools/call",
      tool: "echo",
      args: { text: "부산" },
    });
    expect(response).toMatchObject({ dir: "res", id: request?.id, tool: "echo", ok: true });
    expect(typeof response?.ms).toBe("number");
  });

  /**
   * 유닛 테스트는 `jsonResponse` 에 `body` 를 **손으로 넣어** 확인한 것이다. `describeResponse`
   * 가 실제로 채우는지는 여기서만 보인다. `bad_structured` 를 고른 이유는 설계 §3 이 실측한
   * 그 모양이라서다 — AI 경유로는 `structuredContent` 가 사라지는 자리이므로, 중계기 경로로는
   * 살아 있어야 한다는 것이 이 테스트의 요점이다.
   */
  it("--json 응답 줄의 body 에 자식이 낸 content 와 structuredContent 가 다 실린다", async () => {
    const lines: string[] = [];
    const handle = await startRelay({
      port: 0,
      command: process.execPath,
      args: [CHILD],
      log: (line) => lines.push(line),
      json: true,
      env: {},
    });
    open.push(handle);
    const session = await openSession(handle.url);
    await session.call(1, "tools/call", { name: "bad_structured", arguments: {} });

    const responses = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.dir === "res" && entry.tool === "bad_structured");
    expect(responses).toHaveLength(1);
    expect(responses[0]?.body).toEqual({
      content: [{ type: "text", text: "고장" }],
      structuredContent: { temp: "21" },
    });
  });

  it("알림은 짝이 없으므로 기록하지 않는다", () => {
    // openSession 이 보내는 notifications/initialized 가 §8-6 의 목록에 없다는 것으로
    // 이미 확인된다. 이 자리는 그 사실을 문서로 남기는 곳이다.
    expect(true).toBe(true);
  });
});

/**
 * `--env` 의 배선. 여기서 보는 것은 **자식이 실제로 보는 `process.env`** 다 — 중계기가
 * 무엇을 넘겼다고 주장하는지가 아니라, 자식이 무엇을 받았는지를 본다. 그래서 `read_env`
 * 툴이 픽스처에 있다.
 */
describe("자식에게 물려주는 환경변수", () => {
  /** 자식이 본 값. `read_env` 의 structuredContent 를 그대로 꺼낸다. */
  async function readChildEnv(
    session: Session,
    id: number,
    name: string,
  ): Promise<{ present: boolean; value: string | null }> {
    const response = await session.call(id, "tools/call", {
      name: "read_env",
      arguments: { name },
    });
    expect(response).not.toHaveProperty("error");
    // `JSONRPCMessage` 는 오류 갈래를 포함하는 유니온이라 곧바로 좁히면 TS2352 다 (§8-3 과 같다).
    const structured = (
      response as unknown as {
        result: { structuredContent: { name: string; present: boolean; value: string | null } };
      }
    ).result.structuredContent;
    // 물어본 이름의 답이 맞는지 먼저 확인한다 — 세션이 섞이면 엉뚱한 답을 보고 통과할 수 있다.
    expect(structured.name).toBe(name);
    return { present: structured.present, value: structured.value };
  }

  it("env 로 지목한 변수가 자식에게 보인다", async () => {
    const { handle } = await startFixtureRelay([], { MCPEAK_RELAY_E2E_SECRET: "sk-live-1234" });
    const session = await openSession(handle.url);

    expect(await readChildEnv(session, 1, "MCPEAK_RELAY_E2E_SECRET")).toEqual({
      present: true,
      value: "sk-live-1234",
    });
  });

  /**
   * **이 테스트는 SDK 의 기본 동작을 고정한다.** 누가 `env: { ...process.env }` 로 바꾸면
   * 여기서 실패한다 — 그게 이 테스트의 목적이다. 중계기를 띄운 셸의 모든 비밀이 감사하지
   * 않은 사용자 서버에 넘어가는 것이 ADR-0102 가 선택지 ① 로 버린 것이고, 그 판단을
   * 지키는 자리가 여기다.
   *
   * 부모에 실제로 심어야 검사가 성립한다 — 자식이 못 보는 이유가 "부모에도 없어서" 면
   * 아무것도 확인하지 않은 것이다. 전역을 흔들므로 `finally` 에서 반드시 되돌린다.
   */
  it("env 로 지목하지 않은 변수는 자식에게 안 보인다", async () => {
    const UNLISTED = "MCPEAK_RELAY_E2E_UNLISTED";
    process.env[UNLISTED] = "sk-live-9999";
    try {
      // 부모에는 분명히 있다.
      expect(process.env[UNLISTED]).toBe("sk-live-9999");

      const { handle } = await startFixtureRelay([], { MCPEAK_RELAY_E2E_SECRET: "sk-live-1234" });
      const session = await openSession(handle.url);

      expect(await readChildEnv(session, 1, UNLISTED)).toEqual({ present: false, value: null });
      // 같은 자식이 지목된 것은 받았다 — 즉 "아무것도 안 넘어갔다" 가 아니다.
      expect(await readChildEnv(session, 2, "MCPEAK_RELAY_E2E_SECRET")).toEqual({
        present: true,
        value: "sk-live-1234",
      });
    } finally {
      delete process.env[UNLISTED];
    }
  });

  it("SDK 기본 여섯 개는 지목하지 않아도 자식에게 간다", async () => {
    // `getDefaultEnvironment()` 위에 얹는 구조라는 것을 고정한다. PATH 가 끊기면 자식이
    // 띄울 명령을 못 찾으므로, 이것이 깨지면 중계기 자체가 못 쓰게 된다.
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    expect((await readChildEnv(session, 1, "PATH")).present).toBe(true);
  });
});

/**
 * 서버발 메시지를 **버리되 기록한다**(계획서 표 I). 여기서 보는 것은 기록이지 중계가
 * 아니다 — 버리는 동작은 그대로고, 화면에 단서가 남는지만 달라진다.
 */
describe("버린 서버발 메시지의 기록", () => {
  it("서버가 먼저 건 요청을 버렸다고 적는다", async () => {
    const { handle, lines } = await startFixtureRelay(["--server-request"]);
    await openSession(handle.url);

    // 자식이 initialize 에 답한 **뒤** 내므로 openSession 이 끝난 시점과 순서가 정해져
    // 있지 않다. 고정 대기가 아니라 줄이 도착하는 것을 폴링한다.
    await waitFor(() => lines.some((line) => line.includes("버림")));
    expect(lines).toContain(
      "← sampling/createMessage  버림 · 서버가 먼저 거는 요청은 중계하지 않습니다 (서버는 응답을 기다립니다)",
    );
  });

  it("서버가 보낸 알림을 버렸다고 적는다", async () => {
    const { handle, lines } = await startFixtureRelay(["--server-notification"]);
    await openSession(handle.url);

    await waitFor(() => lines.some((line) => line.includes("버림")));
    expect(lines).toContain(
      "← notifications/message  버림 · 서버가 보내는 알림은 중계하지 않습니다",
    );
  });

  it("--json 이면 버린 줄도 한 줄 JSON 이다", async () => {
    const lines: string[] = [];
    const handle = await startRelay({
      port: 0,
      command: process.execPath,
      args: [CHILD, "--server-request", "--server-notification"],
      log: (line) => lines.push(line),
      json: true,
      env: {},
    });
    open.push(handle);
    await openSession(handle.url);

    await waitFor(() => lines.filter((line) => line.includes('"drop"')).length === 2);
    const dropped = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.dir === "drop");
    expect(dropped).toEqual([
      { dir: "drop", kind: "request", method: "sampling/createMessage" },
      { dir: "drop", kind: "notification", method: "notifications/message" },
    ]);
  });

  /**
   * 서버발 메시지를 기록해도 **버리는 동작은 그대로다.** 중계기가 그것을 클라이언트에
   * 흘려보내기 시작하면 이 테스트가 깨진다 — 1 단계 범위 밖이라 버리기로 한 판단이 여기 산다.
   */
  it("버린 것을 클라이언트에게 흘려보내지는 않는다", async () => {
    const { handle, lines } = await startFixtureRelay(["--server-request"]);
    const received: JSONRPCMessage[] = [];
    const session = await openSession(handle.url, (message) => received.push(message));

    await waitFor(() => lines.some((line) => line.includes("버림")));
    // 서버의 요청이 세션으로 새어 나가지 않는다. 정상 왕복은 그대로 된다.
    expect(received.some((m) => "method" in m && m.method === "sampling/createMessage")).toBe(
      false,
    );
    await expect(session.call(1, "tools/list")).resolves.toMatchObject({ id: 1 });
  });

  /**
   * 플래그를 안 준 자식은 서버발 메시지를 내지 않는다. §8-6 의 엄격한 줄 목록이 이
   * 기능 때문에 흔들리지 않는다는 것을 따로 못박는다.
   */
  /**
   * **대기표에 없는 응답은 기록하지 않는다.** 우리가 보낸 적 없는 id 로 온 것이라
   * 프로토콜 위반이고, 서버가 먼저 건 요청과 달리 지어낼 문안이 없다.
   *
   * 기록을 더하면서 이 갈래가 실수로 같이 끌려 들어가지 않았는지를 보는 자리다.
   * 자식은 `--server-notification` 도 함께 받는다 — 그 줄이 나온 뒤에도 버림 줄이
   * 하나뿐이어야, "아직 안 왔을 뿐" 이 아니라 "안 적는다" 를 본 것이 된다.
   */
  it("대기표에 없는 응답은 적지 않는다", async () => {
    const { handle, lines } = await startFixtureRelay([
      "--stray-response",
      "--server-notification",
    ]);
    const session = await openSession(handle.url);

    // 자식은 stray 둘을 **먼저** 내고 알림을 낸다. 알림 줄이 보이면 stray 둘은 이미
    // 중계기를 지나갔다는 뜻이다 — 고정 대기 없이 순서로 확인한다.
    await waitFor(() => lines.some((line) => line.includes("notifications/message")));

    expect(lines.filter((line) => line.includes("버림"))).toEqual([
      "← notifications/message  버림 · 서버가 보내는 알림은 중계하지 않습니다",
    ]);
    // 모르는 id 9999 가 어떤 모양으로도 새어 들어오지 않았다. **이것이 이 테스트의 몫이다**
    // — 기록을 이 갈래에 잘못 달면 여기서 깨진다(실측으로 확인).
    expect(lines.filter((line) => line.includes("9999"))).toEqual([]);
    // `id: null` 쪽은 **중계기까지 오지도 않는다** — SDK 스키마가 먼저 거절한다(실측).
    // 그래서 이 줄은 중계기의 동작이 아니라 SDK 의 동작을 확인하는 것이고, 중계기의
    // `id === null` 갈래는 이 테스트가 덮지 못한다.
    expect(lines.filter((line) => line.includes("-32700"))).toEqual([]);
    // 중계기가 멀쩡히 계속 돈다 — 조용히 버린다는 것이 멈춘다는 뜻은 아니다.
    await expect(session.call(1, "tools/list")).resolves.toMatchObject({ id: 1 });
  });

  it("플래그가 없으면 버림 줄이 하나도 없다", async () => {
    const { handle, lines } = await startFixtureRelay();
    const session = await openSession(handle.url);
    await session.call(1, "tools/list");

    expect(lines.filter((line) => line.includes("버림"))).toEqual([]);
  });
});

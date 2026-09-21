import { createServer, type Server as HttpServer } from "node:http";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
  humanDrop,
  humanRequest,
  humanResponse,
  jsonDrop,
  jsonRequest,
  jsonResponse,
  type RelayDropEvent,
  type RelayRequestEvent,
  type RelayResponseEvent,
} from "./relay-log.js";

/**
 * 중계기 — 앞은 Streamable HTTP, 뒤는 stdio 자식 하나.
 *
 * **SDK 의 `Server`·`Client` 를 쓰지 않는다.** 트랜스포트 둘의 `onmessage`/`send` 를
 * 직접 잇는다. `Client` 를 끼우면 그것이 `structuredContent` 를 `outputSchema` 로
 * 검증해서 진짜 서버의 잘못된 응답을 **중계기가 대신 받아** 던진다. 그러면 사용자는
 * 서버의 답이 아니라 중계기가 만든 오류를 보게 되고, "진짜 서버가 답한다" 가 깨진다.
 * 이 구조를 고정하는 회귀 테스트가 relay-e2e 의 §8-3 이다.
 *
 * 해석하는 지점이 없다는 것이 요점이다 — `initialize` 도 그대로 지나간다. 중계기가
 * 능력을 대신 선언하는 순간 그것은 중계가 아니다.
 */
export interface RelayOptions {
  /** 0 이면 임의 포트를 받아 handle.port 로 돌려준다. */
  port: number;
  command: string;
  args: readonly string[];
  /** 한 줄씩 부른다. bin 은 stderr 쓰기를 넣고, 테스트는 배열에 모은다. */
  log: (line: string) => void;
  json: boolean;
  /**
   * 자식에게 물려줄 환경변수. 이름이 아니라 **해석된 값**이다. bin 이 `resolveEnv` 로 만든다.
   *
   * `log` 를 주입받는 것과 같은 결이다 — 테스트가 `process.env` 를 건드리지 않게 하기
   * 위해서다. 전역을 흔드는 테스트는 실행 순서에 따라 결과가 달라진다.
   */
  env: Readonly<Record<string, string>>;
}

export interface RelayHandle {
  readonly port: number;
  readonly url: string;
  /** 자식 프로세스의 pid. 자식이 끝나면 null 이 된다. */
  readonly childPid: number | null;
  /** HTTP 를 닫고 자식이 실제로 끝날 때까지 기다린다. */
  close(): Promise<void>;
}

const HOST = "127.0.0.1";

function isRequest(
  message: JSONRPCMessage,
): message is JSONRPCMessage & { id: string | number; method: string } {
  return "method" in message && "id" in message;
}

export async function startRelay(options: RelayOptions): Promise<RelayHandle> {
  const { port, command, args, log, json, env } = options;
  const writeRequest = (event: RelayRequestEvent): void =>
    log(json ? jsonRequest(event) : humanRequest(event));
  const writeResponse = (event: RelayResponseEvent): void =>
    log(json ? jsonResponse(event) : humanResponse(event));
  const writeDrop = (event: RelayDropEvent): void => log(json ? jsonDrop(event) : humanDrop(event));

  // `env` 를 넘기면 SDK 가 `{ ...getDefaultEnvironment(), ...env }` 로 합친다
  // (`client/stdio.js` 의 `start()`, 실측). 즉 자식이 받는 것은 SDK 기본 여섯 개
  // (`HOME`·`LOGNAME`·`PATH`·`SHELL`·`TERM`·`USER`) 위에 지정된 이름만 얹은 것이고,
  // `packages/core/src/controlled-stdio.ts:80` 의 합치기와 **같은 의미**가 된다.
  // 여기서 `{ ...process.env }` 로 바꾸면 중계기를 띄운 셸의 모든 비밀이 자식에게 간다
  // (ADR-0102 선택지 ①). relay-e2e 의 "넘기지 않은 변수는 자식에게 안 보인다" 가 그 회귀다.
  const child = new StdioClientTransport({
    command,
    args: [...args],
    env: { ...env },
    stderr: "inherit",
  });
  await child.start();

  // SDK 트랜스포트는 자식이 끝나면 내부 참조를 지워 pid 를 null 로 만든다. 종료 여부를
  // 확인하려면 우리가 처음 pid 를 들고 있어야 한다.
  const childPid = child.pid;
  let childAlive = true;
  child.onclose = () => {
    childAlive = false;
    // 대기 중인 세션에 **오류 문장을 지어내지 않는다** — HTTP 연결만 끊는다. 오류는
    // 진짜 서버가 준 것만 쓴다는 규칙(설계 §4)을 중계기가 스스로 어기지 않기 위해서다.
    for (const entry of pending.values()) void entry.transport.close();
    pending.clear();
  };

  interface Pending {
    readonly transport: StreamableHTTPServerTransport;
    readonly clientId: string | number;
    readonly method: string;
    readonly tool?: string;
    readonly startedAt: number;
  }
  const pending = new Map<number, Pending>();
  // 중계기가 매기는 id. 자식 파이프는 하나인데 세션은 여럿이라, 클라이언트가 준 id 를
  // 그대로 쓰면 서로 덮어쓴다. 봉투의 id 만 바꾼다 — params·result 는 손대지 않으므로
  // "값을 만들지도 바꾸지도 않는다" 는 그대로다. 1 부터 세므로 결정론적이다.
  let nextId = 1;

  child.onmessage = (message) => {
    // id 를 지역 상수로 뽑는다. `isRequest` 의 부정 분기에서는 `message` 가 다시 유니온 전체로
    // 넓어져 `message.id` 가 `undefined` 를 포함하게 되고, `Map` 키로 쓸 수 없다.
    const id = "id" in message ? message.id : undefined;
    if (id === undefined || id === null || isRequest(message)) {
      // 서버가 스스로 낸 요청·알림이다. stateless HTTP 에는 돌려보낼 채널이 없다 —
      // 1 단계 범위 밖이라 버린다. **버리되 기록은 한다**(계획서 표 I).
      //
      // 조용히 버리면 사용자는 자기 서버가 응답을 기다리며 멈춘 이유를 알 방법이 없다.
      // 화면에도 `--json` 보고서에도 단서가 없다 — 중계기의 기록이 유일한 관찰
      // 채널이기 때문이다(설계 §3). 버리는 **동작**은 그대로다.
      //
      // `method` 가 있을 때만 적는다. `method` 없이 여기 닿을 수 있는 것은 `id` 가
      // `null` 인 응답인데, 그건 서버가 먼저 건 것이 아니라 프로토콜 위반이다. 적을
      // 메서드 이름이 없고 문안을 만들 근거도 없어서 조용히 버린다.
      //
      // **다만 그 경우는 지금 여기까지 오지 않는다.** SDK 의 `JSONRPCMessageSchema` 가
      // `id: null` 을 `onmessage` 앞에서 거절한다(실측). 즉 위 `id === null` 조건과 이
      // 가드는 둘 다 지금은 닿지 않는 길이고, 테스트도 이 갈래를 덮지 못한다 — 가드를
      // 빼도 e2e 가 초록이다(실측). SDK 가 검증을 느슨하게 하면 그때 살아나는 안전망이라
      // 남겨 둔다. 실제로 도는 갈래는 아래 "대기표에 없는 id" 쪽이고 그것은 덮여 있다.
      if ("method" in message)
        writeDrop({ method: message.method, kind: "id" in message ? "request" : "notification" });
      return;
    }
    // `id` 는 위 블록에서 뽑아 둔 지역 상수다. `message.id` 를 다시 쓰지 마라 —
    // `isRequest` 의 부정 분기에서 TS 가 유니온을 되돌려 `undefined` 가 다시 섞인다(TS2345).
    //
    // 문(statement)으로 좁힌다. 삼항 안에서 좁히면 그 좁히기가 다음 문장까지 이어지지 않아
    // 아래 세 줄이 전부 `as number` 를 달아야 한다. 중계기가 매기는 id 는 항상 number 이므로
    // 여기 걸리는 것은 자식이 우리가 보낸 적 없는 id 를 낸 경우뿐이고, 그건 아래 `entry`
    // 조회에서도 똑같이 버려진다 — 동작은 같고 캐스트만 사라진다.
    // 아래 두 `return` 은 **기록하지 않는다.** 우리가 보낸 적 없는 id 로 온 응답이라
    // 프로토콜 위반이고, 위 `writeDrop` 이 말하는 "서버가 먼저 건 것" 이 아니다.
    // 지어낼 문안이 없으므로 조용히 버리는 지금 동작을 그대로 둔다.
    if (typeof id !== "number") return;
    const entry = pending.get(id);
    if (entry === undefined) return;
    pending.delete(id);
    writeResponse({ ...describeResponse(message, entry), id });
    void entry.transport.send({ ...message, id: entry.clientId });
  };

  const http: HttpServer = createServer((req, res) => {
    // stateless 모드는 요청마다 새 transport 를 요구한다
    // (SDK: "Stateless transport cannot be reused across requests."). stateful 로 가면
    // sessionIdGenerator 가 randomUUID 를 쓰게 되어 결정론성이 깨진다.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    transport.onmessage = (message) => {
      if (!isRequest(message)) {
        // 알림은 짝이 없다. 그대로 흘려보내고 기록하지 않는다 —
        // 기록하면 §8-6 이 보는 요청·응답 짝이 어긋난다.
        void child.send(message);
        return;
      }
      const params = (message as { params?: { name?: unknown; arguments?: unknown } }).params;
      const tool = typeof params?.name === "string" ? params.name : undefined;
      const relayId = nextId++;
      writeRequest({
        id: relayId,
        method: message.method,
        ...(tool === undefined ? {} : { tool }),
        ...(params?.arguments === undefined ? {} : { args: params.arguments }),
      });
      pending.set(relayId, {
        transport,
        clientId: message.id,
        method: message.method,
        tool,
        startedAt: Date.now(),
      });
      void child.send({ ...message, id: relayId });
    };
    res.on("close", () => {
      void transport.close();
    });
    void transport
      .start()
      .then(() => transport.handleRequest(req, res))
      .catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              [
                `→ 중계기를 띄우지 못했습니다: 포트 ${port} 이 이미 사용 중입니다 (${HOST}).`,
                "→ --port 0 을 주면 빈 포트를 자동으로 받습니다.",
                "→ 앞서 띄운 중계기를 닫지 않았는지도 확인하세요.",
              ].join("\n"),
            )
          : error,
      );
    };
    http.once("error", onError);
    http.listen(port, HOST, () => {
      http.off("error", onError);
      resolve();
    });
  });

  /** 닫기는 한 번만 실제로 수행한다. 아래 `close` 주석 참고. */
  let closing: Promise<void> | undefined;

  const address = http.address();
  if (address === null || typeof address === "string") {
    throw new Error("중계기 주소를 확인할 수 없습니다 (예상치 못한 address() 반환값).");
  }

  return {
    port: address.port,
    url: `http://${HOST}:${address.port}/mcp`,
    get childPid() {
      return childAlive ? childPid : null;
    },
    close: () => {
      // 두 번 불러도 안전해야 한다. 두 번째 `http.close()` 는 ERR_SERVER_NOT_RUNNING
      // ("Server is not running.") 을 던지는데, 닫기를 두 번 부르는 것은 정상적인 일이다 —
      // 테스트의 afterEach 가 정리로 한 번 더 부르고, bin 은 신호 처리와 정상 종료 양쪽에서
      // 부른다. 같은 약속을 돌려주어 두 번째 호출이 첫 번째의 결과를 기다리게 한다.
      closing ??= (async () => {
        await new Promise<void>((resolve, reject) => {
          http.closeAllConnections();
          http.close((error) => (error ? reject(error) : resolve()));
        });
        // 자식이 이미 죽었으면 SDK 가 즉시 반환한다. 살아 있으면 stdin 을 닫고 기다렸다가
        // SIGTERM · SIGKILL 로 올라간다 (SDK StdioClientTransport.close).
        await child.close();
      })();
      return closing;
    },
  };
}

/**
 * 자식이 낸 봉투 하나를 기록 이벤트로 옮긴다. **여기서 값을 바꾸지 않는다** — 오류 코드와
 * 메시지는 진짜 서버가 준 것을 그대로 싣는다.
 */
function describeResponse(
  message: JSONRPCMessage,
  entry: { method: string; tool?: string; startedAt: number },
): RelayResponseEvent {
  const head = {
    id: 0, // 아래에서 덮어쓴다 — 호출부가 relayId 를 안다.
    method: entry.method,
    ...(entry.tool === undefined ? {} : { tool: entry.tool }),
    ms: Date.now() - entry.startedAt,
  };
  if ("error" in message) {
    const error = message.error as { code: number; message: string };
    return { ...head, kind: "protocolError", code: error.code, message: error.message };
  }
  const result = (message as { result: Record<string, unknown> }).result;
  const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  // `result` 를 그대로 싣는다. 복사하거나 고치지 않는다 — 중계기는 값을 만들지 않는다.
  if (Array.isArray(result.tools)) {
    return { ...head, kind: "ok", bytes, toolCount: result.tools.length, body: result };
  }
  if (result.isError === true) return { ...head, kind: "toolError", bytes, body: result };
  return { ...head, kind: "ok", bytes, body: result };
}

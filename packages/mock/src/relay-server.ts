import { createServer, type Server as HttpServer } from "node:http";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

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
  const { port, command, args, log } = options;

  const child = new StdioClientTransport({ command, args: [...args], stderr: "inherit" });
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
      // 1 단계 범위 밖이라 버린다.
      return;
    }
    // `id` 는 위 블록에서 뽑아 둔 지역 상수다. `message.id` 를 다시 쓰지 마라 —
    // `isRequest` 의 부정 분기에서 TS 가 유니온을 되돌려 `undefined` 가 다시 섞인다(TS2345).
    const entry = typeof id === "number" ? pending.get(id) : undefined;
    if (entry === undefined) return;
    pending.delete(id as number);
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

  void log; // Task 6 에서 배선한다.
  void isRequest;

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

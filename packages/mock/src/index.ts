import type { Server as HttpServer } from "node:http";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDef } from "@ohmymcp/core";

/** 목 서버를 띄울 때의 옵션. */
export interface MockOptions {
  /** 노출할 툴 목록. `fixtures/*.json` 의 `tools` 를 그대로 넣을 수 있다. */
  tools: ToolDef[];
  /** 기본값 0 — 빈 포트를 자동으로 받는다. 고정 포트는 병렬 실행 시 충돌한다. */
  port?: number;
  /** 기본값 "127.0.0.1". 외부에 노출하지 않는다. */
  host?: string;
}

export interface MockServer {
  /** 클라이언트가 붙을 주소. `createMockServer` 가 실제 포트를 채워 돌려준다. */
  url: string;
  /**
   * 특정 툴 호출에 대한 응답을 주입한다.
   *
   * `result` 는 MCP 와이어 포맷이 아니라 **알맹이**다. `content[{ type: "text" }]`
   * 로 감싸는 것은 목이 처리한다.
   */
  on(tool: string, args: unknown, result: unknown): void;
  close(): Promise<void>;
}

/**
 * 객체 키 순서와 무관하게 같은 값이면 같은 문자열을 만든다.
 * `JSON.stringify` 는 키 삽입 순서를 따라가므로 매칭 키로 쓸 수 없다 —
 * 같은 인자인데 매칭에 실패하면 결정론성이 깨진다.
 */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableKey(obj[k])}`)
    .join(",")}}`;
}

function matchKey(tool: string, args: unknown): string {
  return `${tool}|${stableKey(args ?? {})}`;
}

/** 주입된 응답이 없을 때 사용자가 읽을 문장을 만든다. 실패 메시지가 곧 제품이다. */
function missMessage(tool: string, args: unknown, injected: Map<string, unknown>): string {
  const forTool = [...injected.keys()].filter((k) => k.startsWith(`${tool}|`));
  const lines = [
    `→ 툴 '${tool}' 을(를) 인자 ${stableKey(args ?? {})} 로 호출했지만 주입된 응답이 없습니다.`,
  ];
  if (forTool.length > 0) {
    lines.push(`→ 이 툴에 주입된 인자: ${forTool.map((k) => k.slice(tool.length + 1)).join(", ")}`);
  } else {
    const tools = [...new Set([...injected.keys()].map((k) => k.split("|")[0]))];
    lines.push(
      tools.length > 0
        ? `→ 주입된 툴: ${tools.map((t) => `'${t}'`).join(", ")}`
        : "→ 아직 아무 응답도 주입되지 않았습니다.",
    );
  }
  lines.push("→ mock.on(툴이름, 인자, 응답) 을 호출했는지 확인하세요.");
  return lines.join("\n");
}

/**
 * 목 MCP 서버를 Streamable HTTP 로 띄운다.
 *
 * 실제 MCP 서버 없이 MCP 를 사용하는 프로그램을 테스트하기 위한 것이다.
 */
export async function createMockServer(options: MockOptions): Promise<MockServer> {
  const { tools, port = 0, host = "127.0.0.1" } = options;
  const injected = new Map<string, unknown>();

  // stateless 모드는 요청마다 새 Server/transport 를 요구한다.
  // (SDK: "Stateless transport cannot be reused across requests.")
  // stateful 로 가면 sessionIdGenerator 가 randomUUID 를 쓰게 되어 결정론성이 깨진다.
  const build = (): Server => {
    const server = new Server(
      { name: "ohmymcp-mock", version: "0.0.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const key = matchKey(req.params.name, req.params.arguments);
      if (!injected.has(key)) {
        return {
          content: [
            { type: "text", text: missMessage(req.params.name, req.params.arguments, injected) },
          ],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(injected.get(key)) }] };
    });
    return server;
  };

  const http: HttpServer = createServer((req, res) => {
    const server = build();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    void server
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, resolve);
  });

  const addr = http.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("목 서버 주소를 확인할 수 없습니다 (예상치 못한 address() 반환값).");
  }

  return {
    url: `http://${host}:${addr.port}/mcp`,
    on(tool, args, result) {
      injected.set(matchKey(tool, args), result);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

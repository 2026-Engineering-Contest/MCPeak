import type { Server as HttpServer } from "node:http";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDef } from "@ohmymcp/core";
// 확장자가 ".ts" 인 것은 오타가 아니다. tests/fixtures/stdio-entry.mjs 가 이 파일을
// raw node(--experimental-strip-types)로 직접 돌리는데, Node 의 ESM 리졸버는 ".js" 를
// ".ts" 로 매핑하지 않아 ERR_MODULE_NOT_FOUND 가 난다. 저장소의 다른 패키지는 ".js" 를
// 쓰지만 그쪽에는 소스를 그대로 실행하는 테스트가 없다.
// packages/mock/tsconfig.json 의 allowImportingTsExtensions 가 이것과 짝이다.
import { assertKeyable, KeyDepthError, MAX_KEY_DEPTH } from "./key-violation.ts";

/**
 * 인자를 가리지 않고 매칭한다. `mock.on(tool, ANY, result)`.
 * 정의 파일에서는 `args` 를 생략하면 같은 뜻이다.
 *
 * 인자를 지정한 응답이 항상 우선한다 — ANY 는 나머지를 받는 기본값이다.
 */
export const ANY = Symbol.for("ohmymcp.mock.any");

/** 툴 하나에 대한 응답 선언. */
export interface MockResponse {
  tool: string;
  /** 생략하면 인자를 가리지 않는다 (= ANY). */
  args?: unknown;
  /** MCP 와이어 포맷이 아니라 **알맹이**다. `content[{ type: "text" }]` 포장은 목이 한다. */
  result: unknown;
}

/** 목 서버가 무엇을 노출하고 무엇을 돌려줄지에 대한 선언. 파일로 저장할 수 있다. */
export interface MockDefinition {
  /** 노출할 툴 목록. `fixtures/*.json` 의 `tools` 를 그대로 넣을 수 있다. */
  tools: ToolDef[];
  /** 미리 넣어둘 응답. HTTP 로 띄운 뒤 `on()` 으로 더 넣을 수도 있다. */
  responses?: MockResponse[];
}

/** 목 서버를 HTTP 로 띄울 때의 옵션. */
export interface MockOptions extends MockDefinition {
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
   * `args` 에 `ANY` 를 넘기면 인자를 가리지 않는다. 인자를 지정한 응답이 항상 우선한다.
   * `result` 는 MCP 와이어 포맷이 아니라 **알맹이**다.
   *
   * `args` 로 매칭 키를 만들 수 없으면 던진다 — 순환 참조, 희소 배열, `NaN`/`Infinity`,
   * JSON 으로 표현할 수 없는 값(예: `Date`, 함수, `Map`), 상한을 넘는 중첩 깊이가 그렇다.
   */
  on(tool: string, args: unknown, result: unknown): void;
  close(): Promise<void>;
}

/**
 * 객체 키 순서와 무관하게 같은 값이면 같은 문자열을 만든다.
 * `JSON.stringify` 는 키 삽입 순서를 따라가므로 매칭 키로 쓸 수 없다 —
 * 같은 인자인데 매칭에 실패하면 결정론성이 깨진다.
 *
 * 값이 `undefined` 인 키는 뺀다. JSON-RPC 를 건너온 인자에는 `undefined` 가 있을 수 없으므로
 * (`JSON.stringify` 가 지운다), 남겨두면 `on(tool, { a: 1, b: undefined }, ...)` 로 주입한
 * 응답이 실제 호출 `{ a: 1 }` 과 다른 키가 되어 영영 잡히지 않는다.
 * `record` 의 ADR-0003(카세트 매칭 키)도 같은 규칙이다 — 두 패키지가 갈리면 안 된다.
 * 배열 안의 `undefined` 는 `JSON.stringify` 와 같이 `null` 로 남긴다 (자리가 의미를 갖는다).
 */
function stableKey(value: unknown, depth = 0): string {
  if (depth > MAX_KEY_DEPTH) throw new KeyDepthError();
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableKey(v, depth + 1)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableKey(obj[k], depth + 1)}`)
    .join(",")}}`;
}

/** 주입된 응답 저장소. 인자 지정본과 ANY 본을 따로 둔다. */
interface Registry {
  exact: Map<string, unknown>;
  any: Map<string, unknown>;
}

function createRegistry(): Registry {
  return { exact: new Map(), any: new Map() };
}

function put(
  registry: Registry,
  tool: string,
  args: unknown,
  result: unknown,
  source: string,
): void {
  // ANY 는 Symbol.for(...) 라서 assertKeyable 의 notJson 에 걸린다.
  // 검사를 이 분기보다 앞에 두면 정상 기능이 죽는다.
  if (args === ANY) {
    registry.any.set(tool, result);
    return;
  }
  assertKeyable(args ?? {}, source);
  registry.exact.set(`${tool}|${stableKey(args ?? {})}`, result);
}

/** 인자 지정본을 먼저 찾고, 없으면 ANY 로 떨어진다. */
function lookup(
  registry: Registry,
  tool: string,
  args: unknown,
): { hit: boolean; result: unknown } {
  const key = `${tool}|${stableKey(args ?? {})}`;
  if (registry.exact.has(key)) return { hit: true, result: registry.exact.get(key) };
  if (registry.any.has(tool)) return { hit: true, result: registry.any.get(tool) };
  return { hit: false, result: undefined };
}

/** 주입된 응답이 없을 때 사용자가 읽을 문장을 만든다. 실패 메시지가 곧 제품이다. */
function missMessage(tool: string, args: unknown, registry: Registry): string {
  const lines = [
    `→ 툴 '${tool}' 을(를) 인자 ${stableKey(args ?? {})} 로 호출했지만 주입된 응답이 없습니다.`,
  ];
  const forTool = [...registry.exact.keys()]
    .filter((k) => k.startsWith(`${tool}|`))
    .map((k) => k.slice(tool.length + 1));

  if (forTool.length > 0) {
    lines.push(`→ 이 툴에 주입된 인자: ${forTool.join(", ")}`);
    lines.push("→ mock.on(툴이름, 인자, 응답) 의 인자가 호출과 일치하는지 확인하세요.");
    lines.push("→ 인자를 가리지 않으려면 mock.on(툴이름, ANY, 응답) — 정의 파일에서는 args 생략.");
  } else {
    const tools = [
      ...new Set(
        [...registry.exact.keys()].map((k) => k.split("|")[0]).concat([...registry.any.keys()]),
      ),
    ];
    lines.push(
      tools.length > 0
        ? `→ 주입된 툴: ${tools.map((t) => `'${t}'`).join(", ")}`
        : "→ 아직 아무 응답도 주입되지 않았습니다.",
    );
    lines.push("→ mock.on(툴이름, 인자, 응답) 을 호출했는지 확인하세요.");
  }
  return lines.join("\n");
}

/** 조회 인자가 너무 깊어 키를 못 만들 때. 던지지 않고 응답으로 나간다. */
function depthMissMessage(tool: string): string {
  return [
    `→ 툴 '${tool}' 의 호출 인자로 매칭 키를 만들 수 없습니다: 중첩이 상한 ${MAX_KEY_DEPTH} 단계를 넘었습니다`,
    "→ 목은 이 인자를 주입된 어떤 응답과도 비교할 수 없습니다. 호출 쪽 인자를 줄이세요.",
  ].join("\n");
}

/** 정의를 검증한다. 사람이 손으로 쓰는 파일이라 오류를 읽을 수 있게 낸다. */
export function assertMockDefinition(
  value: unknown,
  source = "목 정의",
): asserts value is MockDefinition {
  const fail = (why: string): never => {
    throw new Error(
      [
        `→ ${source} 가 올바르지 않습니다: ${why}`,
        '→ 형식: { "tools": [ { "name": ..., "inputSchema": ... } ], "responses": [ { "tool": ..., "result": ... } ] }',
      ].join("\n"),
    );
  };

  if (value === null || typeof value !== "object") fail("객체가 아닙니다");
  const def = value as Record<string, unknown>;

  if (!Array.isArray(def.tools)) fail("'tools' 가 배열이 아닙니다");
  (def.tools as unknown[]).forEach((t, i) => {
    if (t === null || typeof t !== "object") fail(`tools[${i}] 가 객체가 아닙니다`);
    const tool = t as Record<string, unknown>;
    if (typeof tool.name !== "string") fail(`tools[${i}] 에 문자열 'name' 이 없습니다`);
    // inputSchema 가 없으면 클라이언트에 인자 없는 툴로 보인다. ToolDef 가 요구하는 필드다.
    if (!("inputSchema" in tool)) {
      fail(`tools[${i}] ('${tool.name}') 에 'inputSchema' 가 없습니다`);
    }
  });

  if (def.responses !== undefined) {
    if (!Array.isArray(def.responses)) fail("'responses' 가 배열이 아닙니다");
    (def.responses as unknown[]).forEach((r, i) => {
      if (r === null || typeof r !== "object") fail(`responses[${i}] 가 객체가 아닙니다`);
      const res = r as Record<string, unknown>;
      if (typeof res.tool !== "string") fail(`responses[${i}] 에 문자열 'tool' 이 없습니다`);
      if (!("result" in res)) fail(`responses[${i}] 에 'result' 가 없습니다`);
      const names = (def.tools as ToolDef[]).map((t) => t.name);
      if (!names.includes(res.tool as string)) {
        fail(
          `responses[${i}] 의 툴 '${res.tool}' 이 tools 에 없습니다. 있는 툴: ${names.join(", ")}`,
        );
      }
    });
  }
}

/** 정의를 레지스트리로 옮긴다. `args` 가 없으면 ANY 로 취급한다. */
function seed(definition: MockDefinition): Registry {
  const registry = createRegistry();
  const responses = definition.responses ?? [];
  for (const [index, r] of responses.entries()) {
    put(registry, r.tool, "args" in r ? r.args : ANY, r.result, `정의 파일의 responses[${index}]`);
  }
  return registry;
}

/** 요청 핸들러를 등록한 MCP 서버를 만든다. HTTP·stdio 가 이것을 공유한다. */
function buildServer(tools: ToolDef[], registry: Registry): Server {
  const server = new Server(
    { name: "ohmymcp-mock", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    let outcome: { hit: boolean; result: unknown };
    try {
      outcome = lookup(registry, req.params.name, req.params.arguments);
    } catch (error) {
      // KeyDepthError 만 응답으로 바꾼다. 다른 예외를 삼키면 목의 버그가 조용히 묻힌다.
      if (!(error instanceof KeyDepthError)) throw error;
      return {
        content: [{ type: "text", text: depthMissMessage(req.params.name) }],
        isError: true,
      };
    }
    if (!outcome.hit) {
      return {
        content: [
          { type: "text", text: missMessage(req.params.name, req.params.arguments, registry) },
        ],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(outcome.result) }] };
  });
  return server;
}

/**
 * 목 MCP 서버를 Streamable HTTP 로 띄운다.
 *
 * 실제 MCP 서버 없이, MCP 를 사용하는 프로그램을 테스트하기 위한 것이다.
 * 우리 도구로 목을 테스트하려면 `serveStdio` 를 쓴다 — `core.connect()` 가
 * 아직 stdio 만 알기 때문이다 (#16).
 */
export async function createMockServer(options: MockOptions): Promise<MockServer> {
  const { tools, port = 0, host = "127.0.0.1" } = options;
  assertMockDefinition(options, "createMockServer 옵션");
  const registry = seed(options);

  // stateless 모드는 요청마다 새 Server/transport 를 요구한다.
  // (SDK: "Stateless transport cannot be reused across requests.")
  // stateful 로 가면 sessionIdGenerator 가 randomUUID 를 쓰게 되어 결정론성이 깨진다.
  const http: HttpServer = createServer((req, res) => {
    const server = buildServer(tools, registry);
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
      put(registry, tool, args, result, `mock.on('${tool}', ...)`);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * 목 MCP 서버를 stdio 로 띄운다. **이 프로세스가 곧 서버다.**
 *
 * 상대가 stdin 을 닫을 때까지 반환하지 않는다. HTTP 와 달리 나중에 응답을
 * 주입할 수 없으므로 `definition.responses` 에 미리 선언한다.
 *
 * `core.connect({ command, args })` 로 붙을 수 있어, 우리 도구로 목을 검증하는
 * 경로가 이것이다 (CONTRIBUTING §6).
 */
export async function serveStdio(definition: MockDefinition): Promise<void> {
  assertMockDefinition(definition);
  const server = buildServer(definition.tools, seed(definition));
  await server.connect(new StdioServerTransport());
}

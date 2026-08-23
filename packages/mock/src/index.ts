import type { Server as HttpServer } from "node:http";
import { createServer } from "node:http";
import type { ToolDef } from "@mcpeak/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  findSchemaViolations,
  type SchemaViolation,
  unanalyzableReason,
} from "./input-validation.js";
import { assertKeyable, KeyDepthError, MAX_KEY_DEPTH } from "./key-violation.js";

/**
 * 인자를 가리지 않고 매칭한다. `mock.on(tool, ANY, result)`.
 * 정의 파일에서는 `args` 를 생략하면 같은 뜻이다.
 *
 * 인자를 지정한 응답이 항상 우선한다 — ANY 는 나머지를 받는 기본값이다.
 */
export const ANY = Symbol.for("mcpeak.mock.any");

/** 툴 하나에 대한 응답 선언. */
export interface MockResponse {
  tool: string;
  /** 생략하면 인자를 가리지 않는다 (= ANY). */
  args?: unknown;
  /** MCP 와이어 포맷이 아니라 **알맹이**다. `content[{ type: "text" }]` 포장은 목이 한다. */
  result: unknown;
  /**
   * 이 응답을 서버의 **거절**로 표시한다. 생략하면 성공이다.
   *
   * 실패 응답도 계약의 절반이다 — "없는 ID 를 조회하면 이런 오류를 준다" 를 설계 단계에서
   * 보여주려면 사용자가 실패를 선언할 수 있어야 한다.
   *
   * 매칭 미스가 만드는 `isError` 와는 다르다. 미스는 "표에 없다" 는 목의 안내문이고,
   * 이 필드는 "서버가 이렇게 거절한다" 는 설계된 계약이다. 본문으로 구분된다.
   *
   * `result` 에 `{ $error: ... }` 같은 특수 형태를 인식시키지 않고 별도 필드로 둔 이유는,
   * 데이터와 지시가 섞이면 매칭 키의 결정론적 직렬화가 탁해지기 때문이다.
   */
  isError?: boolean;
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
  on(tool: string, args: unknown, result: unknown, options: { isError?: boolean }): void;
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

/** 저장된 응답 하나. 알맹이와 거절 여부를 함께 둔다. */
interface StoredResponse {
  result: unknown;
  isError: boolean;
  /** 이 응답을 주입한 자리. 중복 주입을 거절할 때 **앞선 자리**를 지목하는 데 쓴다. */
  source: string;
}

/** 주입된 응답 저장소. 인자 지정본과 ANY 본을 따로 둔다. */
interface Registry {
  exact: Map<string, StoredResponse>;
  any: Map<string, StoredResponse>;
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
  isError = false,
): void {
  const stored: StoredResponse = { result, isError, source };
  // ANY 는 Symbol.for(...) 라서 assertKeyable 의 notJson 에 걸린다.
  // 검사를 이 분기보다 앞에 두면 정상 기능이 죽는다.
  if (args === ANY) {
    rejectDuplicate(registry.any.get(tool), source, `툴 '${tool}' 의 ANY 응답`);
    registry.any.set(tool, stored);
    return;
  }
  assertKeyable(args ?? {}, source);
  const key = stableKey(args ?? {});
  rejectDuplicate(registry.exact.get(`${tool}|${key}`), source, `툴 '${tool}' 의 인자 ${key}`);
  registry.exact.set(`${tool}|${key}`, stored);
}

/**
 * 같은 자리에 두 번째 응답이 오면 거절한다.
 *
 * 전에는 조용히 덮었다. 그러면 계약서 한 줄이 **아무 신호 없이** 사라지고, 사용자는 끝까지
 * 초록불만 본다. 오타 주입을 막은 것과 같은 이유다(#239) — 다만 오타는 결국 미스 진단문이라도
 * 뜨는데 중복은 그마저도 안 뜬다.
 */
function rejectDuplicate(existing: StoredResponse | undefined, source: string, what: string): void {
  if (existing === undefined) return;
  throw new Error(
    [
      // 변수 뒤에 조사를 붙이지 않는다. 앞이 코드 토큰(`mock.on('add', ...)`)이거나 JSON
      // 조각이라 은/는·이/가가 다 어색해진다. 콜론으로 끊어 그 문제를 없앤다.
      `→ 도달할 수 없는 주입입니다: ${source}`,
      `→ 앞선 선언: ${existing.source} — ${what}`,
      "→ 같은 자리에 응답이 둘이면 뒤엣것이 앞엣것을 가려 하나는 영원히 안 쓰입니다. 하나만 남기세요.",
    ].join("\n"),
  );
}

/**
 * 인자 지정본을 먼저 찾고, 없으면 ANY 로 떨어진다.
 *
 * **어느 쪽에서 나왔는지 구분해서 돌려준다.** 둘을 하나의 `hit` 으로 뭉치면 호출자가
 * 스키마 검사를 어디에 끼울지 정할 수 없다 — 인자 지정본은 검사보다 우선하고 ANY 는 뒤다
 * (ADR-0048 §2). ANY 가 위반 인자까지 먹는 것이 #181 이 지목한 결함 그 자체다.
 */
function lookup(
  registry: Registry,
  tool: string,
  args: unknown,
): { hit: "exact" | "any"; stored: StoredResponse } | { hit: false } {
  const key = `${tool}|${stableKey(args ?? {})}`;
  const exact = registry.exact.get(key);
  if (exact !== undefined) return { hit: "exact", stored: exact };
  const any = registry.any.get(tool);
  if (any !== undefined) return { hit: "any", stored: any };
  return { hit: false };
}

/**
 * `tools` 에 없는 이름으로 호출됐을 때의 문장.
 *
 * **주입 미스와 갈라 적는다.** 둘을 "주입된 응답이 없습니다" 하나로 뭉개면 진단문이 시키는
 * `mock.on('<없는툴>', ...)` 이 곧바로 거절당해(`declaredTools` 검사) 사용자가 막다른 길에
 * 선다. 고칠 자리가 다르다 — 이쪽은 `responses` 가 아니라 `tools` 다.
 */
function undeclaredToolMessage(tool: string, declared: readonly string[]): string {
  return [
    `→ 툴 '${tool}' 은(는) 이 목 서버가 선언한 툴이 아닙니다.`,
    declared.length > 0
      ? `→ 선언된 툴: ${declared.map((t) => `'${t}'`).join(", ")}`
      : "→ 선언된 툴이 하나도 없습니다.",
    "→ tools/list 로 광고하지 않은 이름이라 어떤 응답도 주입할 수 없습니다.",
    // 이 줄만 JSON.stringify 로 감싼다. 그대로 복사해 붙이는 조각이라 툴 이름에 따옴표나
    // 역슬래시가 있으면 유효하지 않은 JSON 이 된다. `tool` 은 클라이언트가 보낸 값이다.
    // 위 산문 줄들은 이 패키지 관례(`'${tool}'`)를 따른다 — 7군데가 같은 형태다.
    `→ 이 툴이 필요하면 정의의 tools 에 { "name": ${JSON.stringify(tool)}, "inputSchema": … } 를 먼저 추가하세요.`,
  ].join("\n");
}

/**
 * 주입된 응답이 없을 때 사용자가 읽을 문장을 만든다. 실패 메시지가 곧 제품이다.
 *
 * **진입점에 따라 고칠 자리가 다르다.** 정의 파일로 띄운 사람 화면에는 `mock.on` 이라는 코드가
 * 없다 — README 에도 안 나오는 API 다. 시키는 대로 할 수 없는 안내를 주면 안 된다.
 * `definitionPath` 가 있으면 stdio(정의 파일), 없으면 라이브러리(HTTP)다.
 */
function missMessage(
  tool: string,
  args: unknown,
  registry: Registry,
  definitionPath?: string,
): string {
  const lines = [
    `→ 툴 '${tool}' 을(를) 인자 ${stableKey(args ?? {})} 로 호출했지만 주입된 응답이 없습니다.`,
  ];
  const forTool = [...registry.exact.keys()]
    .filter((k) => k.startsWith(`${tool}|`))
    .map((k) => k.slice(tool.length + 1));

  if (forTool.length > 0) {
    lines.push(`→ 이 툴에 주입된 인자: ${forTool.join(", ")}`);
    lines.push(
      definitionPath === undefined
        ? "→ mock.on(툴이름, 인자, 응답) 의 인자가 호출과 일치하는지 확인하세요."
        : `→ ${definitionPath} 의 responses 에서 이 툴의 args 가 호출과 일치하는지 확인하세요.`,
    );
    lines.push(
      definitionPath === undefined
        ? "→ 인자를 가리지 않으려면 mock.on(툴이름, ANY, 응답) 을 쓰세요."
        : "→ 인자를 가리지 않으려면 그 항목에서 args 를 생략하세요.",
    );
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
    lines.push(
      definitionPath === undefined
        ? "→ mock.on(툴이름, 인자, 응답) 을 호출했는지 확인하세요."
        : `→ ${definitionPath} 의 responses 에 { "tool": "${tool}", "args": …, "result": … } 를 추가하세요.`,
    );
  }
  return lines.join("\n");
}

/** 범위 위반 한 건의 문장. keyword 가 값 기준인지 길이·개수 기준인지 가른다. */
function rangeSentence(violation: Extract<SchemaViolation, { kind: "rangeMismatch" }>): string {
  const { limit, found } = violation;
  switch (violation.keyword) {
    case "minimum":
      return `${limit} 이상이어야 합니다. 받은 값: ${found}`;
    case "maximum":
      return `${limit} 이하여야 합니다. 받은 값: ${found}`;
    case "exclusiveMinimum":
      return `${limit} 보다 커야 합니다. 받은 값: ${found}`;
    case "exclusiveMaximum":
      return `${limit} 보다 작아야 합니다. 받은 값: ${found}`;
    case "minLength":
      return `${limit}자 이상이어야 합니다. 받은 값의 길이: ${found}`;
    case "maxLength":
      return `${limit}자 이하여야 합니다. 받은 값의 길이: ${found}`;
    case "minItems":
      return `원소가 ${limit}개 이상이어야 합니다. 받은 개수: ${found}`;
    case "maxItems":
      return `원소가 ${limit}개 이하여야 합니다. 받은 개수: ${found}`;
  }
}

/** 위반 한 건을 한 줄로. 모든 kind 가 값을 돌려주므로 switch 가 빠지는 길이 없다. */
function violationLine(tool: string, args: unknown, violation: SchemaViolation): string {
  const head = `→ 툴 '${tool}' 의 '${violation.field}' 은(는)`;
  switch (violation.kind) {
    case "requiredMissing":
      return `→ 툴 '${tool}' 호출에 필수 필드 '${violation.field}' 이(가) 없습니다. 받은 인자: ${stableKey(args ?? {})}`;
    case "typeMismatch": {
      const received = JSON.stringify(plainArgs(args)[violation.field]) ?? "undefined";
      return `${head} ${violation.declared} 이어야 합니다. 받은 값: ${received} (${violation.found})`;
    }
    case "enumMismatch": {
      const allowed = violation.allowed.map((value) => JSON.stringify(value)).join(", ");
      return `${head} 선언된 값 중 하나여야 합니다: ${allowed}. 받은 값: ${JSON.stringify(violation.found)}`;
    }
    case "rangeMismatch":
      return `${head} ${rangeSentence(violation)}`;
  }
}

/**
 * 스키마 위반을 사용자가 읽을 문장으로 만든다. 실패 메시지가 곧 제품이다 (ADR-0048).
 *
 * 위반마다 한 줄씩 내고 안내 두 줄을 끝에 **한 번만** 붙인다. 위반이 셋인데 안내가 셋이면
 * 읽을 수 없다. 마지막 줄이 주입 우선 규칙으로 가는 길을 가리킨다 — 목이 막았는데 뚫는 법을
 * 모르는 상태를 만들지 않는다.
 */
function violationMessage(
  tool: string,
  args: unknown,
  violations: readonly SchemaViolation[],
): string {
  const lines = violations.map((violation) => violationLine(tool, args, violation));

  lines.push("→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.");
  lines.push("→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.");
  return lines.join("\n");
}

/** 문장에서 원래 값을 꺼내기 위한 것. 인자가 객체가 아니면 빈 객체로 본다. */
function plainArgs(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

/**
 * 해석할 수 없는 스키마를 가진 툴을 stderr 로 **한 번** 고지한다.
 *
 * `buildServer` 가 아니라 진입점에서 부른다 — HTTP 는 요청마다 `buildServer` 를 새로 부르므로
 * 거기 두면 호출마다 찍힌다. stdout 은 stdio 트랜스포트의 JSON-RPC 채널이라 쓸 수 없다.
 *
 * `mcpeak test` 의 성공 경로에서는 이 줄이 사용자에게 안 보일 수 있다(CLI 의 프로세스 진단은
 * 비정상 종료·연결 실패에서 렌더된다). 그래도 내는 이유는 ADR-0048 의 "결과" 에 적어 두었다.
 */
function noticeUnanalyzable(tools: ToolDef[]): void {
  const skipped = tools
    .map((tool) => ({ name: tool.name, reason: unanalyzableReason(tool.inputSchema) }))
    .filter((entry): entry is { name: string; reason: string } => entry.reason !== undefined);
  if (skipped.length === 0) return;
  process.stderr.write(
    `${[
      "→ 다음 툴은 inputSchema 를 해석할 수 없어 인자 검사를 건너뜁니다:",
      ...skipped.map((entry) => `   '${entry.name}' — ${entry.reason}`),
    ].join("\n")}\n`,
  );
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
      if ("isError" in res && typeof res.isError !== "boolean") {
        fail(
          `responses[${i}] 의 'isError' 가 boolean 이 아닙니다 (받은 값: ${typeof res.isError})`,
        );
      }
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
function seed(definition: MockDefinition, origin: string): Registry {
  const registry = createRegistry();
  const responses = definition.responses ?? [];
  for (const [index, r] of responses.entries()) {
    put(
      registry,
      r.tool,
      "args" in r ? r.args : ANY,
      r.result,
      `${origin}의 responses[${index}]`,
      r.isError === true,
    );
  }
  return registry;
}

/** 요청 핸들러를 등록한 MCP 서버를 만든다. HTTP·stdio 가 이것을 공유한다. */
function buildServer(tools: ToolDef[], registry: Registry, definitionPath?: string): Server {
  const server = new Server(
    { name: "mcpeak-mock", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  const schemas = new Map(tools.map((tool) => [tool.name, tool.inputSchema]));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    // 선언 여부를 주입 조회보다 **먼저** 본다. 주입 경로(`on`·정의 파일)는 이미 미지의 툴
    // 이름을 막는데(#239) 호출 경로만 그 지식을 안 썼다. 두 진입점이 같은 규칙을 쓴다는
    // 것이 이 패키지의 계약이다(README「응답 매칭 규칙」).
    if (!schemas.has(req.params.name)) {
      return {
        content: [
          { type: "text", text: undeclaredToolMessage(req.params.name, [...schemas.keys()]) },
        ],
        isError: true,
      };
    }
    let outcome: ReturnType<typeof lookup>;
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
    // 주입이 검사보다 우선한다 (ADR-0048 §2). 표는 사람이 손으로 쓰는 것이라, 스키마를 어기는
    // 인자를 적어 두었다면 그것이 의도다 — "잘못 부르면 서버가 이렇게 답한다" 를 설계에 넣는
    // 경로이고, 이 순서가 곧 검사를 끄는 스위치를 대신한다.
    // `isError` 는 참일 때만 싣는다. MCP 에서 생략과 false 는 같은 뜻이라, 성공 응답의 와이어
    // 모양을 이 기능 도입 전과 동일하게 유지한다.
    const respond = (stored: StoredResponse) => ({
      content: [{ type: "text" as const, text: JSON.stringify(stored.result) }],
      ...(stored.isError ? { isError: true as const } : {}),
    });
    if (outcome.hit === "exact") return respond(outcome.stored);

    const violations = findSchemaViolations(schemas.get(req.params.name), req.params.arguments);
    if (violations.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: violationMessage(req.params.name, req.params.arguments, violations),
          },
        ],
        isError: true,
      };
    }

    if (outcome.hit === "any") return respond(outcome.stored);

    return {
      content: [
        {
          type: "text",
          text: missMessage(req.params.name, req.params.arguments, registry, definitionPath),
        },
      ],
      isError: true,
    };
  });
  return server;
}

/**
 * 목 MCP 서버를 Streamable HTTP 로 띄운다.
 *
 * 실제 MCP 서버 없이, MCP 를 사용하는 프로그램을 테스트하기 위한 것이다.
 * 우리 도구로 목을 테스트하려면 `serveStdio` 를 쓴다 — `core.connect()` 는 HTTP 도
 * 알지만 (ADR-0020) CLI 가 `connectStdio` 로 고정돼 있기 때문이다 (#16).
 */
export async function createMockServer(options: MockOptions): Promise<MockServer> {
  const { tools, port = 0, host = "127.0.0.1" } = options;
  assertMockDefinition(options, "createMockServer 옵션");
  noticeUnanalyzable(tools);
  const registry = seed(options, "createMockServer 옵션");

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

  // 정의 파일 경로는 assertMockDefinition 이 미지의 툴 이름을 잡는다. on() 도 같은 자리를
  // 막는다 — 두 진입점이 같은 규칙을 쓴다는 것이 이 패키지의 계약이다(README「응답 매칭 규칙」).
  // 안 막으면 오타 주입이 성공한 것처럼 보이고, 사용자는 실제 호출이 미스로 떨어져 진단문을
  // 볼 때까지 아무 신호도 못 받는다.
  const declaredTools = new Set(tools.map((t) => t.name));

  return {
    url: `http://${host}:${addr.port}/mcp`,
    on(tool: string, args: unknown, result: unknown, options?: { isError?: boolean }) {
      if (!declaredTools.has(tool)) {
        throw new Error(
          `mock.on('${tool}', ...) 의 툴 '${tool}' 이 tools 에 없습니다. 있는 툴: ${[...declaredTools].join(", ")}`,
        );
      }
      put(registry, tool, args, result, `mock.on('${tool}', ...)`, options?.isError === true);
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
export async function serveStdio(
  definition: MockDefinition,
  definitionPath?: string,
): Promise<void> {
  assertMockDefinition(definition, definitionPath);
  noticeUnanalyzable(definition.tools);
  const origin = definitionPath === undefined ? "정의 파일" : `정의 파일 ${definitionPath}`;
  // `origin` 은 주입 오류의 출처 표기이고, 미스 진단문이 가리킬 파일은 `definitionPath` 다.
  // 여기에 `origin` 을 넘기면 경로 없이 부른 호출에서 "정의 파일 의 responses" 처럼 가리킬
  // 파일이 없는 문장이 나간다. 둘은 다른 값이다.
  const server = buildServer(definition.tools, seed(definition, origin), definitionPath);
  await server.connect(new StdioServerTransport());
}

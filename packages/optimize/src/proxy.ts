import { readFileSync } from "node:fs";
import { constants } from "node:os";
import type {
  ConnectOptions,
  HttpConnectOptions,
  McpHttpConnection,
  McpServerInfo,
  McpStdioConnection,
  ToolDef,
} from "@mcpeak/core";
import { connectHttp, connectStdio, McpClientError } from "@mcpeak/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { parseOverlay } from "./overlay.js";
import { OptimizeError, type OptimizeOverlay } from "./types.js";

export interface ProxyOptions {
  readonly overlay: OptimizeOverlay;
  readonly upstream: ConnectOptions;
  /** 상류 도구 목록이 오버레이와 다를 때. 기본 "fail". */
  readonly onMismatch?: "fail";
}

/**
 * 실패 문장(§7.3)의 "해결" 줄이 가리킬 오버레이 경로. `serveProxy` 는 파일이 아니라 파싱된
 * 오버레이를 받으므로 경로를 모른다. 공개 시그니처를 넓히지 않으려고 bin 진입점만 이 값을
 * 넘기는 내부 함수 `startProxy` 를 따로 둔다.
 */
interface ProxyContext {
  readonly overlayPath: string;
}

/** 이름 목록을 줄에 실을 때 최대 개수(§7.3). 넘으면 "외 N개". */
const MAX_LISTED_NAMES = 5;

/**
 * 상류 프로세스가 끝났는지 보는 간격. core 의 stdio 연결은 종료 이벤트를 내보내지 않고
 * 진단 스냅샷(`exitCode`·`signal`)만 준다. 그래서 읽어서 본다. 이 값은 "언제 알아채느냐" 만
 * 바꾸고 어떤 바이트를 내느냐는 바꾸지 않는다(결정론성).
 */
const UPSTREAM_POLL_MS = 100;

/** 오버레이를 tools/list 로 내보내고 tools/call 을 상류로 전달하는 stdio 서버를 띄운다. 계획서 §6. */
export async function serveProxy(options: ProxyOptions): Promise<void> {
  await startProxy(options, { overlayPath: "<overlay.json>" });
}

/**
 * `serveProxy` 의 본체. 시작에 실패하면 `OptimizeError` 를 던지고 **stdout 에는 한 바이트도
 * 쓰지 않는다**. stdio 서버는 상류 대조가 끝난 뒤에야 붙는다. 시작한 뒤의 종료(클라이언트가
 * stdin 을 닫음, 시그널, 상류 사망)는 이 함수가 프로세스 종료까지 책임진다. stdio 를 차지하는
 * 서버라 프로세스 수명이 곧 서버 수명이기 때문이다.
 */
export async function startProxy(options: ProxyOptions, context: ProxyContext): Promise<void> {
  const { overlay, upstream } = options;
  const connection = await openUpstream(upstream);

  let upstreamTools: ToolDef[];
  try {
    upstreamTools = await connection.client.listTools();
  } catch (error) {
    await closeQuietly(connection);
    throw new OptimizeError("UPSTREAM_UNAVAILABLE", upstreamUnavailableMessage(upstream, error));
  }

  const upstreamNames = upstreamTools.map((tool) => tool.name).sort();
  const overlayNames = [...overlay.source.toolNames].sort();
  if (!sameList(upstreamNames, overlayNames)) {
    // 낡은 오버레이로 서비스하지 않는다(§6.3). 상류를 먼저 정리하고 던진다. 남겨 두면 자식
    // 프로세스가 bin 의 종료를 붙잡는다.
    await closeQuietly(connection);
    throw new OptimizeError(
      "OVERLAY_UPSTREAM_MISMATCH",
      mismatchMessage(overlayNames, upstreamNames, context.overlayPath, upstream),
    );
  }

  const server = buildServer(overlay, connection, () => watcher.upstreamGone());
  const watcher = watchLifecycle(server, connection, upstream);
  await server.connect(new StdioServerTransport());
}

type UpstreamConnection = (McpStdioConnection | McpHttpConnection) & McpServerInfo;

async function openUpstream(upstream: ConnectOptions): Promise<UpstreamConnection> {
  try {
    return isHttp(upstream) ? await connectHttp(upstream) : await connectStdio(upstream);
  } catch (error) {
    throw new OptimizeError("UPSTREAM_UNAVAILABLE", upstreamUnavailableMessage(upstream, error));
  }
}

function buildServer(
  overlay: OptimizeOverlay,
  connection: UpstreamConnection,
  onUpstreamLost: () => void,
): Server {
  const server = new Server(
    { name: "mcpeak-optimize-proxy", version: "0.0.0" },
    {
      // tools 만 광고한다(§6.4). 프록시는 tools/list·tools/call 만 중계하므로, 상류가 가진
      // resources·prompts 를 광고하면 클라이언트가 부를 수 없는 메서드를 약속하게 된다.
      // listChanged 도 광고하지 않는다. 오버레이는 고정 파일이라 목록이 바뀔 일이 없다.
      capabilities: { tools: {} },
      // 빈 문자열은 "instructions 없음" 과 같다. 원본에 없던 빈 필드를 새로 싣지 않는다.
      ...(overlay.instructions === "" ? {} : { instructions: overlay.instructions }),
    },
  );

  // `changes`·`bytes` 는 내부 필드다(§6.4). 없는 필드는 키째 싣지 않는다. `undefined` 를 실으면
  // JSON 직렬화에서 사라지긴 하지만, 응답 객체의 모양을 원본 서버와 같은 규칙으로 맞춘다.
  const tools: Tool[] = overlay.tools.map((tool) => ({
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema as Tool["inputSchema"],
    ...(tool.outputSchema === undefined
      ? {}
      : { outputSchema: tool.outputSchema as Tool["outputSchema"] }),
  }));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // 인자를 검증하지 않는다(§6.5). 검증은 상류의 몫이고, 여기서 하면 "원본으로 전달" 이 거짓이
    // 된다. 오버레이에 없는 이름도 그대로 넘긴다. 모르는 도구라고 답하는 것도 상류의 몫이다.
    //
    // `arguments` 생략만은 `{}` 로 바꿔 넘긴다. core 의 `callTool` 이 객체를 요구하기 때문이고
    // (그 인터페이스는 동결이다), MCP 에서 인자 없는 호출은 빈 객체와 같은 뜻으로 쓰인다.
    const args = request.params.arguments ?? {};
    try {
      const result = await connection.client.callTool(request.params.name, args);
      // 상류가 보낸 결과를 그대로 돌려준다. `isError` 도, `structuredContent` 도, `_meta` 도
      // 그대로다. `content`·`isError` 로 다시 조립하면 그 밖의 필드가 조용히 사라진다.
      return result.raw as CallToolResult;
    } catch (error) {
      throw toJsonRpcError(error, onUpstreamLost);
    }
  });

  return server;
}

/**
 * 상류가 JSON-RPC 오류로 답했으면 **같은 code·message·data** 로 되돌려준다. 클라이언트가
 * 원본 서버에 직접 붙었을 때 받았을 오류와 같아야 하기 때문이다.
 *
 * SDK 는 받은 오류를 `McpError` 로 감싸며 message 앞에 `MCP error <code>: ` 를 붙인다. 그대로
 * 다시 던지면 SDK 서버가 그 message 를 싣고, 받는 쪽 SDK 가 또 붙여 접두어가 두 번 쌓인다.
 * 그래서 붙은 접두어를 떼어 원래 문장으로 되돌린다.
 *
 * 상류와의 연결 자체가 끊긴 경우(프로세스 종료, 트랜스포트 실패)는 전달할 원본 오류가 없다.
 * 내부 오류로 답하고, 프로세스가 죽은 것이면 종료 절차를 시작한다.
 */
function toJsonRpcError(error: unknown, onUpstreamLost: () => void): Error {
  if (error instanceof McpClientError) {
    const cause = error.cause as { code?: unknown; message?: unknown; data?: unknown } | undefined;
    if (
      error.code === "OPERATION_FAILED" &&
      cause !== undefined &&
      Number.isSafeInteger(cause.code) &&
      typeof cause.message === "string"
    ) {
      const code = cause.code as number;
      const prefix = `MCP error ${code}: `;
      const message = cause.message.startsWith(prefix)
        ? cause.message.slice(prefix.length)
        : cause.message;
      return rpcError(code, message, cause.data);
    }
    if (error.code === "PROCESS_EXITED") onUpstreamLost();
    return rpcError(ErrorCode.InternalError, `원본 서버 호출 실패: ${error.message}`);
  }
  return rpcError(
    ErrorCode.InternalError,
    `원본 서버 호출 실패: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** SDK 서버는 던진 값의 `code`·`message`·`data` 를 읽어 오류 응답을 만든다. */
function rpcError(code: number, message: string, data?: unknown): Error {
  return Object.assign(new Error(message), { code, ...(data === undefined ? {} : { data }) });
}

/**
 * 시작한 뒤의 종료 순서를 한 곳에서 정한다. 어느 쪽에서 끝나든 한 번만 돈다.
 *
 * - 클라이언트가 stdin 을 닫음: 정상 종료. 서버를 닫고, 상류를 정상 종료시킨 뒤 0.
 *   MCP stdio 규약에서 클라이언트가 서버를 끝내는 첫 수단이 입력 스트림을 닫는 것이다.
 * - SIGINT·SIGTERM: 같은 순서로 상류를 정리하고 128+시그널 번호. 정리를 안 하면 상류는
 *   stdin EOF 를 스스로 알아채야만 끝나는데, 모든 서버가 그렇게 짜여 있지는 않다.
 * - 상류 프로세스 사망(stdio 만): stderr 에 한 줄 남기고 상류와 같은 종료 코드(§6.7).
 *   상류가 없는 프록시는 모든 호출에 실패만 돌려주므로 살아 있을 이유가 없다.
 *
 * HTTP 상류에는 지켜볼 프로세스가 없다. 호출 실패는 그 호출의 오류로만 답하고 계속 돈다.
 */
function watchLifecycle(
  server: Server,
  connection: UpstreamConnection,
  upstream: ConnectOptions,
): { upstreamGone(): void } {
  let finishing = false;
  let timer: NodeJS.Timeout | undefined;

  const finish = (code: number, line?: string, closeUpstream = true): void => {
    if (finishing) return;
    finishing = true;
    if (timer !== undefined) clearInterval(timer);
    void (async () => {
      await server.close().catch(() => {});
      if (closeUpstream) await closeQuietly(connection);
      exitAfterWrite(code, line);
    })();
  };

  const upstreamGone = (): void => {
    if (!isStdioConnection(connection)) return;
    const diagnostics = connection.getDiagnostics();
    if (diagnostics.exitCode === null && diagnostics.signal === null) return;
    const code = diagnostics.exitCode ?? signalExitCode(diagnostics.signal);
    const how =
      diagnostics.exitCode !== null
        ? `종료 코드 ${diagnostics.exitCode}`
        : `시그널 ${diagnostics.signal}`;
    finish(
      code,
      `→ 원본 서버가 끝나서 프록시도 끝냅니다 (${how}): ${describeTarget(upstream)}`,
      false,
    );
  };

  if (isStdioConnection(connection)) {
    timer = setInterval(upstreamGone, UPSTREAM_POLL_MS);
    // 이 타이머가 프로세스를 붙잡으면 안 된다. 살려 두는 것은 stdin 과 상류 자식 프로세스다.
    timer.unref();
  }
  process.stdin.once("end", () => finish(0));
  process.once("SIGINT", () => finish(signalExitCode("SIGINT")));
  process.once("SIGTERM", () => finish(signalExitCode("SIGTERM")));

  return { upstreamGone };
}

/**
 * stderr 에 쓰고 나서 끝낸다. 파이프에 대한 쓰기는 플랫폼에 따라 비동기라, 쓰자마자
 * `process.exit` 하면 마지막 줄이 잘릴 수 있다.
 */
export function exitAfterWrite(code: number, line?: string): void {
  if (line === undefined) {
    process.exit(code);
  }
  process.stderr.write(`${line}\n`, () => process.exit(code));
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  const number = signal === null ? undefined : constants.signals[signal];
  return number === undefined ? 1 : 128 + number;
}

async function closeQuietly(connection: UpstreamConnection): Promise<void> {
  try {
    await connection.close();
  } catch {
    // 정상 종료에 실패했다. 자식이 남지 않게 강제로 끝낸다. 여기서 또 실패하면 더 할 수 있는
    // 것이 없다. 종료 경로에서 던지면 본래 알려야 할 문장이 그 오류에 가려진다.
    if (isStdioConnection(connection)) await connection.forceClose().catch(() => {});
  }
}

function isHttp(upstream: ConnectOptions): upstream is HttpConnectOptions {
  return "url" in upstream;
}

function isStdioConnection(
  connection: UpstreamConnection,
): connection is McpStdioConnection & McpServerInfo {
  return "forceClose" in connection;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// ── 오버레이 읽기 ──────────────────────────────────────────────────────────────

/**
 * 오버레이 파일을 읽어 형식을 검사한다. 실패하면 `OVERLAY_INVALID` 를 던지고 message 는
 * **원인 한 줄**이다. §7.3 의 나머지 줄은 `overlayUnreadableMessage` 가 붙인다.
 */
export function readOverlayFile(path: string): OptimizeOverlay {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new OptimizeError("OVERLAY_INVALID", firstLine(error));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new OptimizeError("OVERLAY_INVALID", `올바른 JSON 이 아닙니다. ${firstLine(error)}`);
  }
  // 이름표를 경로가 아니라 "오버레이" 로 준다. 경로는 §7.3 첫 줄이 이미 싣는다. 둘째 줄에
  // 또 실으면 긴 절대 경로가 두 번 찍혀 정작 원인이 줄 끝으로 밀린다.
  return parseOverlay(raw, "오버레이");
}

// ── 실패 문장 (§7.3, 글자 단위로 고정) ─────────────────────────────────────────

export function overlayUnreadableMessage(
  path: string,
  cause: string,
  upstream: ConnectOptions | undefined,
): string {
  return [
    `→ 오버레이 파일을 읽을 수 없습니다: ${path}`,
    // 원인이 이미 "→ " 로 시작하면 겹치지 않게 뗀다.
    `→ ${cause.replace(/^→ /, "")}`,
    `해결: mcpeak optimize --out ${path} ${rebuildTarget(upstream)} 으로 다시 만드세요.`,
  ].join("\n");
}

function mismatchMessage(
  overlayNames: readonly string[],
  upstreamNames: readonly string[],
  overlayPath: string,
  upstream: ConnectOptions,
): string {
  const inOverlay = new Set(overlayNames);
  const inUpstream = new Set(upstreamNames);
  const upstreamOnly = [...inUpstream].filter((name) => !inOverlay.has(name));
  const overlayOnly = [...inOverlay].filter((name) => !inUpstream.has(name));
  return [
    `→ 오버레이는 도구 ${overlayNames.length}개인데 서버는 ${upstreamNames.length}개를 냅니다.`,
    ...(upstreamOnly.length === 0 ? [] : [`→ 서버에만 있는 도구: ${listNames(upstreamOnly)}`]),
    ...(overlayOnly.length === 0 ? [] : [`→ 오버레이에만 있는 도구: ${listNames(overlayOnly)}`]),
    `해결: 서버가 바뀌었습니다. mcpeak optimize --out ${overlayPath} ${rebuildTarget(upstream)} 으로 오버레이를 다시 만드세요.`,
  ].join("\n");
}

function upstreamUnavailableMessage(upstream: ConnectOptions, error: unknown): string {
  return [
    `→ 원본 서버에 붙지 못했습니다: ${describeTarget(upstream)}`,
    `→ ${firstLine(error)}`,
    isHttp(upstream)
      ? "해결: 프록시 없이 같은 URL 로 서버에 붙는지 먼저 확인하세요."
      : "해결: 프록시 없이 같은 명령으로 서버가 뜨는지 먼저 확인하세요.",
  ].join("\n");
}

function listNames(names: readonly string[]): string {
  const shown = names
    .slice(0, MAX_LISTED_NAMES)
    .map((name) => `'${name}'`)
    .join(", ");
  const rest = names.length - MAX_LISTED_NAMES;
  return rest > 0 ? `${shown} 외 ${rest}개` : shown;
}

/** `cli` 의 `describeTarget` 과 같은 표기다. 같은 대상이 도구마다 다르게 적히지 않게 맞춘다. */
function describeTarget(upstream: ConnectOptions): string {
  return isHttp(upstream) ? upstream.url : [upstream.command, ...(upstream.args ?? [])].join(" ");
}

/** "해결" 줄에서 오버레이를 다시 만드는 명령의 대상 부분. */
function rebuildTarget(upstream: ConnectOptions | undefined): string {
  if (upstream === undefined) return "-- <서버 명령>";
  return isHttp(upstream) ? `--url ${upstream.url}` : `-- ${describeTarget(upstream)}`;
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? message;
}

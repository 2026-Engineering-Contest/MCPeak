import type { IncomingMessage, ServerResponse } from "node:http";
import { validateMcpSuite } from "@mcpeak/runner";
import type {
  AnswerRequest,
  ApiError,
  PutFileRequest,
  ServerMeta,
  StartRelayRequest,
  StartRelayResponse,
  StartRunRequest,
  StartRunResponse,
} from "../api-types.js";
import {
  ensureRepairBundleDir,
  listServerCandidates,
  listSessions,
  listSuites,
  readFileContent,
  resolveCandidateEnv,
  writeFileContent,
} from "./files.js";
import { resolveProjectPath } from "./paths.js";
import type { RelaySessionRegistry } from "./relay-session.js";
import type { RunIo, RunRegistry } from "./run-registry.js";
import { formatSseEvent, formatSseEvents, SSE_HEADERS } from "./sse.js";
import { serveStatic } from "./static.js";
import type { ExecuteFlowOverrides } from "./wiring.js";
import { executeFlow } from "./wiring.js";

export interface RouterOptions {
  readonly root: string;
  readonly webDist: string;
  readonly registry: RunRegistry;
  /** 중계 세션 레지스트리. run 과 별개다 — 중계기는 스스로 끝나지 않는 유일한 실행이다(설계 §2-8). */
  readonly relays: RelaySessionRegistry;
  /**
   * flow 실행기. 기본값은 `wiring.ts`의 실제 `executeFlow`다. 테스트가 실제 커맨드
   * 함수(서버 연결·프로세스 기동)를 돌리지 않고 fake로 바꿔치기할 수 있도록 연다.
   */
  readonly execute?: (
    request: StartRunRequest,
    io: RunIo,
    options?: ExecuteFlowOverrides,
  ) => Promise<number>;
}

const RUN_FLOWS = new Set<StartRunRequest["flow"]>(["test", "generate", "repair"]);

/**
 * 계획서 §4-4 HTTP 면 표를 전부 연결한다. 매칭되는 경로가 없으면 정적 서빙으로 넘긴다
 * (SPA는 `/` 아래 아무 경로나 받아 index.html로 fallback해야 하므로, `/api` 밖은
 * 전부 static.ts 몫이다).
 */
export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: RouterOptions,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  // health 를 확장하지 않고 라우트를 따로 둔다. `/api/health` 는 스캐폴드 검증용으로
  // `{ ok: true }` 를 완전 일치로 잠가 둔 자리이고(tests/scaffold.test.ts), 헬스 프로브에
  // 설정값을 얹으면 이름이 하는 일과 어긋난다. ADR-0071.
  if (method === "GET" && pathname === "/api/meta") {
    const meta: ServerMeta = { root: options.root };
    sendJson(response, 200, meta);
    return;
  }
  if (method === "GET" && pathname === "/api/suites") {
    sendJson(response, 200, await listSuites(options.root));
    return;
  }
  if (method === "GET" && pathname === "/api/servers") {
    sendJson(response, 200, await listServerCandidates(options.root));
    return;
  }
  if (method === "GET" && pathname === "/api/sessions") {
    sendJson(response, 200, await listSessions(options.root));
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/suites/")) {
    await handleGetFile(response, options.root, decodeParam(pathname, "/api/suites/"));
    return;
  }
  if (method === "PUT" && pathname.startsWith("/api/suites/")) {
    await handlePutFile(request, response, options.root, decodeParam(pathname, "/api/suites/"));
    return;
  }
  if (method === "POST" && pathname === "/api/relay") {
    await handleStartRelay(request, response, options.root, options.relays);
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/relay/") && pathname.endsWith("/events")) {
    handleRelayEvents(
      request,
      response,
      options.relays,
      extractId(pathname, "/api/relay/", "/events"),
    );
    return;
  }
  if (method === "DELETE" && pathname.startsWith("/api/relay/")) {
    await handleCloseRelay(response, options.relays, decodeParam(pathname, "/api/relay/") ?? "");
    return;
  }
  if (method === "POST" && pathname === "/api/runs") {
    await handleStartRun(
      request,
      response,
      options.root,
      options.registry,
      options.execute ?? executeFlow,
    );
    return;
  }
  if (method === "GET" && pathname === "/api/runs") {
    sendJson(response, 200, options.registry.list());
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/runs/") && pathname.endsWith("/events")) {
    handleRunEvents(
      request,
      response,
      options.registry,
      extractId(pathname, "/api/runs/", "/events"),
    );
    return;
  }
  if (method === "POST" && pathname.startsWith("/api/runs/") && pathname.endsWith("/answer")) {
    await handleAnswer(
      request,
      response,
      options.registry,
      extractId(pathname, "/api/runs/", "/answer"),
    );
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/runs/")) {
    handleGetRun(response, options.registry, pathname.slice("/api/runs/".length));
    return;
  }
  if (pathname.startsWith("/api/")) {
    const error: ApiError = { error: `그런 경로가 없습니다: ${method} ${pathname}` };
    sendJson(response, 404, error);
    return;
  }

  await serveStatic(request, response, options.webDist, pathname);
}

function decodeParam(pathname: string, prefix: string): string | null {
  const raw = pathname.slice(prefix.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** `/api/runs/<id>/events` 처럼 앞뒤가 고정된 경로에서 가운데 id 만 떼어낸다. */
function extractId(pathname: string, prefix: string, suffix: string): string {
  const raw = pathname.slice(prefix.length, pathname.length - suffix.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function handleGetFile(
  response: ServerResponse,
  root: string,
  relativeOrNull: string | null,
): Promise<void> {
  if (relativeOrNull === null) {
    sendJson(response, 400, { error: "경로를 해석할 수 없습니다." });
    return;
  }
  const absolute = resolveProjectPath(root, relativeOrNull);
  if (absolute === null) {
    sendJson(response, 400, { error: "허용되지 않는 경로입니다." });
    return;
  }
  try {
    const content = await readFileContent(root, absolute);
    sendJson(response, 200, content);
  } catch {
    sendJson(response, 404, { error: "파일을 찾을 수 없습니다." });
  }
}

async function handlePutFile(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  relativeOrNull: string | null,
): Promise<void> {
  if (relativeOrNull === null) {
    sendJson(response, 400, { error: "경로를 해석할 수 없습니다." });
    return;
  }
  const absolute = resolveProjectPath(root, relativeOrNull);
  if (absolute === null) {
    sendJson(response, 400, { error: "허용되지 않는 경로입니다." });
    return;
  }
  if (!relativeOrNull.toLowerCase().endsWith(".json")) {
    sendJson(response, 400, { error: "스위트는 .json 확장자 파일만 저장할 수 있습니다." });
    return;
  }
  const body = await readJsonBody<Partial<PutFileRequest>>(request);
  if (body === undefined) {
    sendJson(response, 400, { error: "본문이 올바른 JSON이 아닙니다." });
    return;
  }
  if (typeof body.content !== "string" || typeof body.baseMtimeMs !== "number") {
    sendJson(response, 400, { error: "content·baseMtimeMs가 필요합니다." });
    return;
  }
  const validationError = await validateFileContent(body.content);
  if (validationError !== null) {
    sendJson(response, 400, { error: validationError });
    return;
  }
  try {
    const result = await writeFileContent(absolute, body.content, body.baseMtimeMs);
    sendJson(response, 200, result);
  } catch (error) {
    const message = writeErrorMessage(error);
    if (message !== null) {
      sendJson(response, 400, { error: message });
      return;
    }
    throw error;
  }
}

function isStartRunRequest(value: unknown): value is StartRunRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.flow !== "string" || !RUN_FLOWS.has(record.flow as StartRunRequest["flow"])) {
    return false;
  }
  if (!Array.isArray(record.argv)) return false;
  if (!record.argv.every((item) => typeof item === "string")) return false;
  // 있으면 문자열이어야 한다. 없는 것은 정상이다(직접 입력 갈래).
  return record.serverId === undefined || typeof record.serverId === "string";
}

async function handleStartRun(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  registry: RunRegistry,
  execute: (request: StartRunRequest, io: RunIo, options?: ExecuteFlowOverrides) => Promise<number>,
): Promise<void> {
  const body = await readJsonBody<unknown>(request);
  if (body === undefined) {
    sendJson(response, 400, { error: "본문이 올바른 JSON이 아닙니다." });
    return;
  }
  if (!isStartRunRequest(body)) {
    sendJson(response, 400, { error: "flow·argv 형식이 올바르지 않습니다." });
    return;
  }
  const startRequest = body;
  // 후보를 골랐으면 그 후보의 `.mcp.json` env 를 **여기서** 값으로 바꾼다. 값은 이 프로세스
  // 안에서만 살고 argv 에도 응답에도 실리지 않는다(설계 §4.3).
  let candidateEnv: Readonly<Record<string, string>> | undefined;
  if (startRequest.serverId !== undefined) {
    candidateEnv = await resolveCandidateEnv(root, startRequest.serverId, process.env);
    if (candidateEnv === undefined) {
      sendJson(response, 400, {
        error: `서버 후보를 찾을 수 없습니다: ${startRequest.serverId}`,
      });
      return;
    }
  }
  // 홈의 test 실행은 항상 `--repair-bundle .mcpeak/repair/...` 를 붙인다(ADR-0080). CLI 는
  // 그 부모 디렉터리를 만들지 않으므로 여기서 만든다. 못 만들면 run 을 시작하지 않는다.
  if (startRequest.flow === "test") {
    try {
      await ensureRepairBundleDir(root);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: `.mcpeak/repair 디렉터리를 만들지 못했습니다: ${reason}` });
      return;
    }
  }
  const handle = registry.start(startRequest.flow, startRequest.argv, (io) =>
    execute(startRequest, io, candidateEnv === undefined ? undefined : { candidateEnv }),
  );
  const result: StartRunResponse = { runId: handle.runId };
  sendJson(response, 200, result);
}

function handleGetRun(response: ServerResponse, registry: RunRegistry, runId: string): void {
  let decodedRunId = runId;
  try {
    decodedRunId = decodeURIComponent(runId);
  } catch {
    // 그대로 조회를 시도한다. 못 찾으면 404다.
  }
  const handle = registry.get(decodedRunId);
  if (handle === undefined) {
    sendJson(response, 404, { error: "그런 run이 없습니다." });
    return;
  }
  sendJson(response, 200, handle.summary);
}

/**
 * SSE 구독. 과거 이벤트를 동기 구간에서 먼저 흘려보낸 뒤 바로 구독한다. 그 사이에는
 * `await`가 없어 다른 이벤트가 끼어들 여지가 없다(중복·누락 방지, 계획서 §5 T2 사양).
 */
function handleRunEvents(
  request: IncomingMessage,
  response: ServerResponse,
  registry: RunRegistry,
  runId: string,
): void {
  const handle = registry.get(runId);
  if (handle === undefined) {
    sendJson(response, 404, { error: "그런 run이 없습니다." });
    return;
  }
  const header = request.headers["last-event-id"];
  const lastEventId = parseLastEventId(Array.isArray(header) ? header[0] : header);
  response.writeHead(200, SSE_HEADERS);
  response.write(formatSseEvents(handle.events.filter((event) => event.id > lastEventId)));
  const unsubscribe = handle.subscribe((event) => {
    response.write(formatSseEvent(event));
  });
  response.on("close", unsubscribe);
}

function parseLastEventId(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return 0;
  return Number(value);
}

async function validateFileContent(content: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return "본문 content가 올바른 JSON이 아닙니다.";
  }
  return validateMcpSuite(parsed).valid ? null : "본문 content가 올바른 MCP 스위트가 아닙니다.";
}

function isErrno(error: unknown, code: "ENOENT" | "EISDIR" | "EACCES"): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function writeErrorMessage(error: unknown): string | null {
  if (isErrno(error, "ENOENT"))
    return "상위 디렉터리가 없습니다. 먼저 디렉터리를 만든 뒤 다시 저장하세요.";
  if (isErrno(error, "EISDIR")) return "저장 대상이 디렉터리입니다. 파일 경로를 선택하세요.";
  if (isErrno(error, "EACCES"))
    return "쓰기 권한이 없습니다. 파일 또는 상위 디렉터리의 쓰기 권한을 확인하세요.";
  return null;
}

async function handleAnswer(
  request: IncomingMessage,
  response: ServerResponse,
  registry: RunRegistry,
  runId: string,
): Promise<void> {
  const handle = registry.get(runId);
  if (handle === undefined) {
    sendJson(response, 404, { error: "그런 run이 없습니다." });
    return;
  }
  const body = await readJsonBody<Partial<AnswerRequest>>(request);
  if (body === undefined) {
    sendJson(response, 400, { error: "본문이 올바른 JSON이 아닙니다." });
    return;
  }
  if (typeof body.questionId !== "string") {
    sendJson(response, 400, { error: "questionId가 필요합니다." });
    return;
  }
  const answered =
    "action" in body && body.action === "back"
      ? handle.reviewIO.back(body.questionId)
      : "value" in body && typeof body.value === "string"
        ? handle.reviewIO.answer(body.questionId, body.value)
        : false;
  if (!answered) {
    sendJson(response, 409, {
      error: "대기 중인 질문이 없거나 questionId가 일치하지 않습니다.",
    });
    return;
  }
  response.writeHead(204);
  response.end();
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function isStartRelayRequest(value: unknown): value is StartRelayRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.suitePath === "string" &&
    typeof record.command === "string" &&
    typeof record.model === "string" &&
    Array.isArray(record.args) &&
    record.args.every((item) => typeof item === "string") &&
    Array.isArray(record.envNames) &&
    record.envNames.every((item) => typeof item === "string") &&
    (record.serverId === undefined || typeof record.serverId === "string")
  );
}

async function handleStartRelay(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  relays: RelaySessionRegistry,
): Promise<void> {
  const body = await readJsonBody<unknown>(request);
  if (body === undefined) {
    sendJson(response, 400, { error: "본문이 올바른 JSON이 아닙니다." });
    return;
  }
  if (!isStartRelayRequest(body)) {
    sendJson(response, 400, { error: "suitePath·command·args·envNames·model 이 필요합니다." });
    return;
  }
  // 경로 가드는 파일 라우트와 같은 한 곳을 쓴다. 두 벌이 되면 한쪽만 고쳐지는 사고가 난다.
  const absolute = resolveProjectPath(root, body.suitePath);
  if (absolute === null) {
    sendJson(response, 400, { error: "허용되지 않는 경로입니다." });
    return;
  }
  // 후보를 골랐으면 그 후보의 `.mcp.json` env 를 **여기서** 값으로 바꿔 중계기에 물린다.
  // 값은 이 프로세스 안에서만 살고 argv 에도 응답에도 실리지 않는다(설계 §4.3 과 같은 규칙).
  let candidateEnv: Readonly<Record<string, string>> | undefined;
  if (body.serverId !== undefined) {
    candidateEnv = await resolveCandidateEnv(root, body.serverId, process.env);
    if (candidateEnv === undefined) {
      sendJson(response, 400, { error: `서버 후보를 찾을 수 없습니다: ${body.serverId}` });
      return;
    }
  }
  const session = await relays.start(
    body,
    async () => (await readFileContent(root, absolute)).content,
    candidateEnv,
  );
  if ("error" in session) {
    sendJson(response, 400, session);
    return;
  }
  const result: StartRelayResponse = { relayId: session.relayId, cases: session.cases };
  sendJson(response, 200, result);
}

/** run 의 SSE 와 같은 모양이다 — 과거 이벤트를 동기 구간에서 흘리고 이어서 구독한다. */
function handleRelayEvents(
  request: IncomingMessage,
  response: ServerResponse,
  relays: RelaySessionRegistry,
  relayId: string,
): void {
  const session = relays.get(relayId);
  if (session === undefined) {
    sendJson(response, 404, { error: "그런 중계 세션이 없습니다." });
    return;
  }
  const header = request.headers["last-event-id"];
  const lastEventId = parseLastEventId(Array.isArray(header) ? header[0] : header);
  response.writeHead(200, SSE_HEADERS);
  response.write(formatSseEvents(session.events.filter((event) => event.id > lastEventId)));
  const unsubscribe = session.subscribe((event) => {
    response.write(formatSseEvent(event));
  });
  response.on("close", unsubscribe);
}

/**
 * **닫힌 것을 확인하고 나서 응답한다.** 브라우저의 `[실행 시작]` 이 이 응답을 기다렸다가
 * 판정 실행을 시작하므로(설계 §1), 여기서 먼저 답하면 같은 서버가 두 벌 뜬다.
 *
 * 못 닫은 것을 204 로 답하지 않는 것이 그 계약의 나머지 절반이다 — 브라우저는 닫기가
 * 실패하면 시작하지 않는데(`runAfterClose`), 서버가 실패를 **말해 주어야** 그럴 수 있다.
 * 500 인 이유는 대상이 없는 것(404)이 아니라 우리가 끝내지 못한 것이기 때문이다.
 */
async function handleCloseRelay(
  response: ServerResponse,
  relays: RelaySessionRegistry,
  relayId: string,
): Promise<void> {
  const result = await relays.close(relayId);
  if (result.kind === "notFound") {
    sendJson(response, 404, { error: "그런 중계 세션이 없습니다." });
    return;
  }
  if (result.kind === "failed") {
    sendJson(response, 500, { error: result.error });
    return;
  }
  response.writeHead(204);
  response.end();
}

import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AnswerRequest,
  ApiError,
  PutFileRequest,
  StartRunRequest,
  StartRunResponse,
} from "../api-types.js";
import {
  deleteFile,
  listCassettes,
  listSuites,
  readFileContent,
  writeFileContent,
} from "./files.js";
import { resolveProjectPath } from "./paths.js";
import type { RunIo, RunRegistry } from "./run-registry.js";
import { formatSseEvent, formatSseEvents, SSE_HEADERS } from "./sse.js";
import { serveStatic } from "./static.js";
import { executeFlow } from "./wiring.js";

export interface RouterOptions {
  readonly root: string;
  readonly webDist: string;
  readonly registry: RunRegistry;
  /**
   * flow 실행기. 기본값은 `wiring.ts`의 실제 `executeFlow`다. 테스트가 실제 커맨드
   * 함수(서버 연결·프로세스 기동)를 돌리지 않고 fake로 바꿔치기할 수 있도록 연다.
   */
  readonly execute?: (request: StartRunRequest, io: RunIo) => Promise<number>;
}

const RUN_FLOWS = new Set<StartRunRequest["flow"]>(["test", "generate", "replay", "repair"]);

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
  if (method === "GET" && pathname === "/api/suites") {
    sendJson(response, 200, await listSuites(options.root));
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
  if (method === "GET" && pathname === "/api/cassettes") {
    sendJson(response, 200, await listCassettes(options.root));
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/cassettes/")) {
    await handleGetFile(response, options.root, decodeParam(pathname, "/api/cassettes/"));
    return;
  }
  if (method === "PUT" && pathname.startsWith("/api/cassettes/")) {
    await handlePutFile(request, response, options.root, decodeParam(pathname, "/api/cassettes/"));
    return;
  }
  if (method === "DELETE" && pathname.startsWith("/api/cassettes/")) {
    await handleDeleteFile(response, options.root, decodeParam(pathname, "/api/cassettes/"));
    return;
  }
  if (method === "POST" && pathname === "/api/runs") {
    await handleStartRun(request, response, options.registry, options.execute ?? executeFlow);
    return;
  }
  if (method === "GET" && pathname === "/api/runs") {
    sendJson(response, 200, options.registry.list());
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/runs/") && pathname.endsWith("/events")) {
    handleRunEvents(response, options.registry, extractRunId(pathname, "/events"));
    return;
  }
  if (method === "POST" && pathname.startsWith("/api/runs/") && pathname.endsWith("/answer")) {
    await handleAnswer(request, response, options.registry, extractRunId(pathname, "/answer"));
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

function extractRunId(pathname: string, suffix: string): string {
  const prefix = "/api/runs/";
  const withoutSuffix = pathname.slice(0, pathname.length - suffix.length);
  const raw = withoutSuffix.slice(prefix.length);
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
  const body = await readJsonBody<Partial<PutFileRequest>>(request);
  if (body === undefined) {
    sendJson(response, 400, { error: "본문이 올바른 JSON이 아닙니다." });
    return;
  }
  if (typeof body.content !== "string" || typeof body.baseMtimeMs !== "number") {
    sendJson(response, 400, { error: "content·baseMtimeMs가 필요합니다." });
    return;
  }
  const result = await writeFileContent(absolute, body.content, body.baseMtimeMs);
  sendJson(response, 200, result);
}

async function handleDeleteFile(
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
    await deleteFile(absolute);
    response.writeHead(204);
    response.end();
  } catch {
    sendJson(response, 404, { error: "파일을 찾을 수 없습니다." });
  }
}

function isStartRunRequest(value: unknown): value is StartRunRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.flow !== "string" || !RUN_FLOWS.has(record.flow as StartRunRequest["flow"])) {
    return false;
  }
  if (!Array.isArray(record.argv)) return false;
  return record.argv.every((item) => typeof item === "string");
}

async function handleStartRun(
  request: IncomingMessage,
  response: ServerResponse,
  registry: RunRegistry,
  execute: (request: StartRunRequest, io: RunIo) => Promise<number>,
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
  const handle = registry.start(startRequest.flow, (io) => execute(startRequest, io));
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
 * SSE 구독. 과거 이벤트를 동기 구간에서 먼저 흘려보낸 뒤 바로 구독한다 — 그 사이에는
 * `await`가 없어 다른 이벤트가 끼어들 여지가 없다(중복·누락 방지, 계획서 §5 T2 사양).
 */
function handleRunEvents(response: ServerResponse, registry: RunRegistry, runId: string): void {
  const handle = registry.get(runId);
  if (handle === undefined) {
    sendJson(response, 404, { error: "그런 run이 없습니다." });
    return;
  }
  response.writeHead(200, SSE_HEADERS);
  response.write(formatSseEvents(handle.events));
  const unsubscribe = handle.subscribe((event) => {
    response.write(formatSseEvent(event));
  });
  response.on("close", unsubscribe);
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
  if (typeof body.questionId !== "string" || typeof body.value !== "string") {
    sendJson(response, 400, { error: "questionId·value가 필요합니다." });
    return;
  }
  const answered = handle.reviewIO.answer(body.questionId, body.value);
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

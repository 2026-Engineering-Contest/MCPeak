import type { IncomingMessage, ServerResponse } from "node:http";
import { assertMockDefinition } from "@mcpeak/mock";
import { parseOverlay } from "@mcpeak/optimize";
import { validateMcpSuite } from "@mcpeak/runner";
import type {
  AnalyzeSecurityRequest,
  AnalyzeTokensRequest,
  AnswerRequest,
  ApiError,
  FileContent,
  PutFileRequest,
  ServerMeta,
  SourceEditRequest,
  SourceEditResponse,
  StartRunRequest,
  StartRunResponse,
} from "../api-types.js";
import {
  type AnalyzeTokensOutcome,
  type AnalyzeTokensOverrides,
  analyzeTokens,
} from "./analyze.js";
import {
  type AnalyzeSecurityOutcome,
  analyzeSecurity,
  prepareSecurityRun,
} from "./analyze-security.js";
import {
  ensureRepairBundleDir,
  listMocks,
  listServerCandidates,
  listSessions,
  listSuites,
  readFileContent,
  readSessionInteractions,
  resolveCandidateEnv,
  writeFileContent,
} from "./files.js";
import { resolveProjectPath } from "./paths.js";
import type { RunHandle, RunIo, RunRegistry } from "./run-registry.js";
import { planSourceEdits, resolveSourceFile } from "./source-edits.js";
import { formatSseEvent, formatSseEvents, SSE_HEADERS } from "./sse.js";
import { serveStatic } from "./static.js";
import type { ExecuteFlowOverrides } from "./wiring.js";
import { executeFlow } from "./wiring.js";

export interface RouterOptions {
  readonly root: string;
  readonly webDist: string;
  readonly registry: RunRegistry;
  /**
   * flow 실행기. 기본값은 `wiring.ts`의 실제 `executeFlow`다. 테스트가 실제 커맨드
   * 함수(서버 연결·프로세스 기동)를 돌리지 않고 fake로 바꿔치기할 수 있도록 연다.
   */
  readonly execute?: (
    request: StartRunRequest,
    io: RunIo,
    options?: ExecuteFlowOverrides,
  ) => Promise<number>;
  /**
   * 토큰 분석 실행기. 기본값은 `analyze.ts` 의 `analyzeTokens`다. `execute` 와 같은 이유로
   * 연다(테스트가 실제 서버 접속 없이 fake 를 끼운다).
   */
  readonly analyze?: (
    argv: readonly string[],
    overrides?: AnalyzeTokensOverrides,
  ) => Promise<AnalyzeTokensOutcome>;
  /**
   * 보안 점검의 요청 가드와 실행기. 기본값은 `analyze-security.ts` 의 실제 함수다. `execute` 와
   * 같은 이유로 연다.
   */
  readonly prepareSecurity?: typeof prepareSecurityRun;
  readonly analyzeSecurity?: typeof analyzeSecurity;
}

/**
 * 점검 run 의 결과 자리. run 과 수명이 같다(run 이 사라지면 함께 사라진다). `RunRegistry` 가
 * flow 별 결과 타입을 알지 않게 여기 둔다(ADR-0110).
 */
interface SecuritySlot {
  outcome?: AnalyzeSecurityOutcome;
}
const securitySlots = new WeakMap<RunHandle, SecuritySlot>();

const SECURITY_PATH = "/api/analyze/security";
const PROBE_POLICIES = new Set(["readonly", "none", "all"]);

const RUN_FLOWS = new Set<StartRunRequest["flow"]>(["test", "generate", "repair", "verify"]);

const INTERACTIONS_SUFFIX = "/interactions";

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
  if (
    method === "GET" &&
    pathname.startsWith("/api/sessions/") &&
    pathname.endsWith(INTERACTIONS_SUFFIX)
  ) {
    await handleGetInteractions(
      response,
      options.root,
      decodeParam(pathname.slice(0, -INTERACTIONS_SUFFIX.length), "/api/sessions/"),
    );
    return;
  }
  if (method === "GET" && pathname === "/api/mocks") {
    sendJson(response, 200, await listMocks(options.root));
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/mocks/")) {
    await handleGetMock(response, options.root, decodeParam(pathname, "/api/mocks/"));
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/suites/")) {
    await handleGetFile(response, options.root, decodeParam(pathname, "/api/suites/"));
    return;
  }
  if (method === "PUT" && pathname.startsWith("/api/suites/")) {
    await handlePutFile(
      request,
      response,
      options.root,
      decodeParam(pathname, "/api/suites/"),
      SUITE_PUT_RULES,
    );
    return;
  }
  if (method === "PUT" && pathname.startsWith("/api/mocks/")) {
    await handlePutFile(
      request,
      response,
      options.root,
      decodeParam(pathname, "/api/mocks/"),
      MOCK_PUT_RULES,
    );
    return;
  }
  if (method === "PUT" && pathname.startsWith("/api/overlays/")) {
    await handlePutFile(
      request,
      response,
      options.root,
      decodeParam(pathname, "/api/overlays/"),
      OVERLAY_PUT_RULES,
    );
    return;
  }
  if (method === "POST" && pathname === "/api/analyze/tokens") {
    await handleAnalyzeTokens(request, response, options.root, options.analyze ?? analyzeTokens);
    return;
  }
  if (method === "POST" && pathname === "/api/analyze/source-edits") {
    await handleSourceEdits(request, response, options.root);
    return;
  }
  if (method === "POST" && pathname === SECURITY_PATH) {
    await handleAnalyzeSecurity(
      request,
      response,
      options.root,
      options.registry,
      options.prepareSecurity ?? prepareSecurityRun,
      options.analyzeSecurity ?? analyzeSecurity,
    );
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
  if (method === "GET" && pathname.startsWith(`${SECURITY_PATH}/`)) {
    handleGetSecurity(response, options.registry, decodeParam(pathname, `${SECURITY_PATH}/`));
    return;
  }
  if (method === "GET" && pathname === "/api/runs") {
    // 점검 run 은 목록에 싣지 않는다. 결과는 보안 탭이 보이고 실행 화면에는 진행 문장뿐이다(ADR-0110).
    sendJson(
      response,
      200,
      options.registry.list().filter((run) => run.flow !== "audit"),
    );
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/runs/") && pathname.endsWith("/events")) {
    handleRunEvents(request, response, options.registry, extractRunId(pathname, "/events"));
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

/**
 * 목 정의 파일 하나. 목록에는 유효한 것만 나오지만, 목록을 본 뒤 파일이 바뀌었을 수 있다.
 * 그때는 폼으로 옮길 수 없으므로 `assertMockDefinition` 문장 그대로 400 이다.
 */
async function handleGetMock(
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
  let content: FileContent;
  try {
    content = await readFileContent(root, absolute);
  } catch {
    sendJson(response, 404, { error: "파일을 찾을 수 없습니다." });
    return;
  }
  const problem = validateMockContent(content.content, relativeOrNull);
  if (problem !== null) {
    sendJson(response, 400, { error: problem });
    return;
  }
  sendJson(response, 200, content);
}

/**
 * 녹화본 하나의 외부 호출 목록. 녹화본은 읽기만 한다 — 서버를 띄우거나 재생하지 않는다.
 * 세션이 아닌 파일은 404 다. 목록(`/api/sessions`)에는 안 나오는 파일을 손으로 친 경우다.
 */
async function handleGetInteractions(
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
  const interactions = await readSessionInteractions(absolute);
  if (interactions === null) {
    sendJson(response, 404, {
      error: [
        `→ 이 녹화본을 읽을 수 없습니다 — ${relativeOrNull}`,
        "→ MCPeak 이 녹화한 세션 파일인지 확인하세요. 목록에는 읽을 수 있는 파일만 나옵니다.",
      ].join("\n"),
    });
    return;
  }
  sendJson(response, 200, interactions);
}

/**
 * 파일 PUT 의 종류별 규칙. 스위트와 목 정의가 **같은 저장 경로**(mtime 충돌 감지 · errno
 * 문장)를 쓴다 — 두 벌이면 한쪽만 고쳐지는 날이 온다. 다른 것은 확장자 안내와 내용 검증뿐이다.
 */
interface PutRules {
  readonly extensionError: string;
  /** 저장해도 되면 `null`, 아니면 사용자에게 그대로 보일 문장. */
  validate(content: string, relative: string): string | null;
}

const SUITE_PUT_RULES: PutRules = {
  extensionError: "스위트는 .json 확장자 파일만 저장할 수 있습니다.",
  validate: (content) => validateSuiteContent(content),
};

const MOCK_PUT_RULES: PutRules = {
  extensionError: "목 정의는 .json 확장자 파일만 저장할 수 있습니다.",
  validate: validateMockContent,
};

/**
 * 오버레이 검증은 `@mcpeak/optimize` 의 `parseOverlay` 에 맡긴다. 프록시가 같은 파일을 읽을 때
 * 내는 문장과 같아야 사용자가 둘을 잇는다(`validateMockContent` 와 같은 이유).
 */
const OVERLAY_PUT_RULES: PutRules = {
  extensionError: "오버레이는 .json 확장자 파일만 저장할 수 있습니다.",
  validate: validateOverlayContent,
};

async function handlePutFile(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  relativeOrNull: string | null,
  rules: PutRules,
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
    sendJson(response, 400, { error: rules.extensionError });
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
  const validationError = rules.validate(body.content, relativeOrNull);
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

function isAnalyzeTokensRequest(value: unknown): value is AnalyzeTokensRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.argv)) return false;
  if (!record.argv.every((item) => typeof item === "string")) return false;
  return record.serverId === undefined || typeof record.serverId === "string";
}

/**
 * 토큰 분석은 수 초 안에 끝나는 동기 요청이다(계획서 §3). run-registry·SSE 를 쓰지 않고
 * 결과를 한 번에 돌려준다. CLI 가 0 이 아니면 사유와 무관하게 400 이고, 문장은 CLI 것 그대로다.
 */
async function handleAnalyzeTokens(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  analyze: (
    argv: readonly string[],
    overrides?: AnalyzeTokensOverrides,
  ) => Promise<AnalyzeTokensOutcome>,
): Promise<void> {
  const body = await readJsonBody<unknown>(request);
  if (body === undefined) {
    sendJson(response, 400, { error: "본문이 올바른 JSON이 아닙니다." });
    return;
  }
  if (!isAnalyzeTokensRequest(body)) {
    sendJson(response, 400, { error: "argv 형식이 올바르지 않습니다." });
    return;
  }
  // 후보 env 는 handleStartRun 과 같은 규칙이다. 값은 이 프로세스 안에서만 산다(설계 §4.3).
  let candidateEnv: Readonly<Record<string, string>> | undefined;
  if (body.serverId !== undefined) {
    candidateEnv = await resolveCandidateEnv(root, body.serverId, process.env);
    if (candidateEnv === undefined) {
      sendJson(response, 400, { error: `서버 후보를 찾을 수 없습니다: ${body.serverId}` });
      return;
    }
  }
  const outcome = await analyze(
    body.argv,
    candidateEnv === undefined ? undefined : { candidateEnv },
  );
  if (outcome.ok) {
    sendJson(response, 200, outcome.body);
    return;
  }
  sendJson(response, 400, { error: outcome.error });
}

function isAnalyzeSecurityRequest(value: unknown): value is AnalyzeSecurityRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.argv)) return false;
  if (!record.argv.every((item) => typeof item === "string")) return false;
  if (record.serverId !== undefined && typeof record.serverId !== "string") return false;
  if (record.probe !== undefined) {
    if (typeof record.probe !== "string" || !PROBE_POLICIES.has(record.probe)) return false;
  }
  if (record.baselinePath !== undefined && typeof record.baselinePath !== "string") return false;
  if (record.updateBaseline !== undefined && typeof record.updateBaseline !== "boolean")
    return false;
  if (record.sandbox === undefined) return true;
  if (typeof record.sandbox !== "object" || record.sandbox === null) return false;
  const { compareHost, allowHosts } = record.sandbox as Record<string, unknown>;
  if (typeof compareHost !== "boolean" || !Array.isArray(allowHosts)) return false;
  return allowHosts.every((item) => typeof item === "string");
}

/**
 * 보안 점검은 run 으로 돈다(ADR-0110). 격리 이미지를 처음 만들 때 수 분이 걸리므로 runId 를 바로
 * 돌려주고, 진행은 기존 SSE 로, 결과는 `GET /api/analyze/security/<runId>` 로 받는다. 경로와 argv 는
 * run 을 시작하기 전에 가둔다. 거절하면 run 이 생기지 않는다.
 */
async function handleAnalyzeSecurity(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  registry: RunRegistry,
  prepare: typeof prepareSecurityRun,
  analyze: typeof analyzeSecurity,
): Promise<void> {
  const body = await readJsonBody<unknown>(request);
  if (body === undefined) {
    sendJson(response, 400, { error: "본문이 올바른 JSON이 아닙니다." });
    return;
  }
  if (!isAnalyzeSecurityRequest(body)) {
    sendJson(response, 400, { error: "요청 형식이 올바르지 않습니다." });
    return;
  }
  // 후보 env 는 handleStartRun 과 같은 규칙이다. 값은 이 프로세스 안에서만 산다(설계 §4.3).
  let candidateEnv: Readonly<Record<string, string>> | undefined;
  if (body.serverId !== undefined) {
    candidateEnv = await resolveCandidateEnv(root, body.serverId, process.env);
    if (candidateEnv === undefined) {
      sendJson(response, 400, { error: `서버 후보를 찾을 수 없습니다: ${body.serverId}` });
      return;
    }
  }
  const prepared = await prepare(root, body);
  if (!prepared.ok) {
    sendJson(response, 400, { error: prepared.error });
    return;
  }
  const slot: SecuritySlot = {};
  const handle = registry.start("audit", prepared.argv, async (io) => {
    const result = await analyze(
      prepared.argv,
      io,
      { root },
      candidateEnv === undefined ? undefined : { candidateEnv },
    );
    slot.outcome = result.outcome;
    return result.exitCode;
  });
  // `registry.start` 는 execute 를 다음 마이크로태스크로 미룬다. 이 set 이 항상 먼저다.
  securitySlots.set(handle, slot);
  const result: StartRunResponse = { runId: handle.runId };
  sendJson(response, 200, result);
}

/** 점검 결과. 본문에 시각·난수·runId 를 싣지 않는다. 같은 run 을 두 번 읽으면 바이트가 같다. */
function handleGetSecurity(
  response: ServerResponse,
  registry: RunRegistry,
  runId: string | null,
): void {
  const handle = runId === null ? undefined : registry.get(runId);
  const slot = handle === undefined ? undefined : securitySlots.get(handle);
  if (slot === undefined) {
    sendJson(response, 404, {
      error:
        "그런 점검이 없습니다.\n→ 대시보드는 점검 결과를 메모리에만 둡니다. 서버를 다시 시작했다면 다시 점검하세요.",
    });
    return;
  }
  if (slot.outcome === undefined) {
    sendJson(response, 409, { error: "점검이 아직 끝나지 않았습니다." });
    return;
  }
  if (slot.outcome.ok) {
    sendJson(response, 200, slot.outcome.body);
    return;
  }
  sendJson(response, 400, { error: slot.outcome.error });
}

function isSourceEditRequest(value: unknown): value is SourceEditRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.argv)) return false;
  if (!record.argv.every((item) => typeof item === "string")) return false;
  if (!Array.isArray(record.edits)) return false;
  const editsOk = record.edits.every((item: unknown) => {
    if (typeof item !== "object" || item === null) return false;
    const { tool, change } = item as Record<string, unknown>;
    if (typeof tool !== "string" || typeof change !== "object" || change === null) return false;
    const { kind, path } = change as Record<string, unknown>;
    return typeof kind === "string" && typeof path === "string";
  });
  if (!editsOk) return false;
  if (record.apply === undefined) return true;
  if (typeof record.apply !== "object" || record.apply === null) return false;
  return typeof (record.apply as Record<string, unknown>).baseMtimeMs === "number";
}

/**
 * 토큰 탭의 "MCP 수정하기"(ADR-0106). 실행 명령에서 찾은 소스 파일 하나에 압축 변경을 글자 치환으로
 * 반영한다. `apply` 가 없으면 계획만 돌려주고 파일을 쓰지 않는다. 쓸 때는 미리보기가 본 mtime 이
 * 지금과 같아야 한다. 다르면 사용자가 확인한 diff 가 이미 낡은 것이라 쓰지 않고 새 미리보기를 준다.
 */
async function handleSourceEdits(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
): Promise<void> {
  const body = await readJsonBody<unknown>(request);
  if (body === undefined) {
    sendJson(response, 400, { error: "본문이 올바른 JSON이 아닙니다." });
    return;
  }
  if (!isSourceEditRequest(body)) {
    sendJson(response, 400, { error: "요청 형식이 올바르지 않습니다." });
    return;
  }
  const located = await resolveSourceFile(root, body.argv);
  if (!located.ok) {
    sendJson(response, 400, { error: located.error });
    return;
  }
  const current = await readFileContent(root, located.absolute);
  const plan = planSourceEdits(current.content, body.edits);
  const preview: SourceEditResponse = {
    file: located.relative,
    mtimeMs: current.mtimeMs,
    before: current.content,
    after: plan.after,
    results: plan.results,
    readyCount: plan.readyCount,
    applied: false,
    conflict: false,
  };
  if (body.apply === undefined) {
    sendJson(response, 200, preview);
    return;
  }
  if (plan.readyCount === 0) {
    sendJson(response, 400, { error: "적용할 수 있는 변경이 없습니다." });
    return;
  }
  const conflict: SourceEditResponse = { ...preview, conflict: true };
  if (body.apply.baseMtimeMs !== current.mtimeMs) {
    sendJson(response, 200, conflict);
    return;
  }
  try {
    const written = await writeFileContent(located.absolute, plan.after, body.apply.baseMtimeMs);
    if (!written.saved) {
      // 읽은 뒤 쓰기 직전에 파일이 바뀌었다. 쓰지 않았으므로 위와 같은 충돌이다.
      sendJson(response, 200, conflict);
      return;
    }
    sendJson(response, 200, {
      ...preview,
      mtimeMs: written.mtimeMs,
      before: plan.after,
      applied: true,
    } satisfies SourceEditResponse);
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

function validateSuiteContent(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return "본문 content가 올바른 JSON이 아닙니다.";
  }
  return validateMcpSuite(parsed).valid ? null : "본문 content가 올바른 MCP 스위트가 아닙니다.";
}

/**
 * 목 정의 검증은 `@mcpeak/mock` 의 `assertMockDefinition` 에 맡기고 **문장을 새로 쓰지 않는다.**
 * 대시보드와 `mcpeak-mock` 이 같은 파일에 다른 말을 하면 사용자가 둘을 잇지 못한다.
 * `source` 로 경로를 넘겨 문장이 어느 파일인지 말하게 한다.
 *
 * 같은 도구 · 같은 args 응답이 두 줄인 것은 여기서 걸리지 않는다. 그 검사는 목이 뜰 때
 * (`seed`) 한다 — 계획서 "남는 위험".
 */
function validateMockContent(content: string, relative: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return "본문 content가 올바른 JSON이 아닙니다.";
  }
  try {
    assertMockDefinition(parsed, relative);
    return null;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

function validateOverlayContent(content: string, relative: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return "본문 content가 올바른 JSON이 아닙니다.";
  }
  try {
    parseOverlay(parsed, relative);
    return null;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
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

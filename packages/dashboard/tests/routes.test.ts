import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteSessionStore } from "@mcpeak/record/external";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalyzeTokensResponse, RunEvent, StartRunRequest } from "../src/api-types.js";
import { startDashboardServer } from "../src/index.js";
import type { AnalyzeTokensOutcome, AnalyzeTokensOverrides } from "../src/server/analyze.js";
import { handleRequest } from "../src/server/routes.js";
import type { RunIo } from "../src/server/run-registry.js";
import { RunRegistry } from "../src/server/run-registry.js";
import type { ExecuteFlowOverrides } from "../src/server/wiring.js";

/** 마이크로태스크·타이머 큐를 한 바퀴 비운다. 백그라운드 execute가 끝날 틈을 준다. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface TestServer {
  readonly baseUrl: string;
  readonly root: string;
  readonly registry: RunRegistry;
  close(): Promise<void>;
}

async function startTestServer(
  execute?: (
    request: StartRunRequest,
    io: RunIo,
    options?: ExecuteFlowOverrides,
  ) => Promise<number>,
  analyze?: (
    argv: readonly string[],
    overrides?: AnalyzeTokensOverrides,
  ) => Promise<AnalyzeTokensOutcome>,
): Promise<TestServer> {
  const root = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-routes-"));
  const registry = new RunRegistry();
  const server: Server = createServer((request, response) => {
    handleRequest(request, response, {
      root,
      webDist: join(root, "__no-web-dist__"),
      registry,
      execute,
      analyze,
    }).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    root,
    registry,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await rm(root, { recursive: true, force: true });
    },
  };
}

const VALID_SUITE = {
  schemaVersion: 1,
  id: "route-suite",
  name: "route suite",
  cases: [
    {
      id: "case-1",
      name: "case 1",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "tool" }],
    },
  ],
};

async function putFile(
  server: TestServer,
  path: string,
  content: string,
  baseMtimeMs = 0,
): Promise<Response> {
  return fetch(`${server.baseUrl}/api/suites/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, baseMtimeMs }),
  });
}

/** SSE 응답에서 `data:` 블록을 지정한 개수만큼 파싱해 돌려준다. */
async function collectSseEvents(
  url: string,
  expectedCount: number,
  headers?: Record<string, string>,
): Promise<RunEvent[]> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal, headers });
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("SSE 응답에 body가 없습니다.");
  const decoder = new TextDecoder();
  let buffer = "";
  const events: RunEvent[] = [];
  while (events.length < expectedCount) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const data = block.split("\n").find((line) => line.startsWith("data: "));
      if (data !== undefined) events.push(JSON.parse(data.slice("data: ".length)) as RunEvent);
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
  controller.abort();
  return events;
}

let server: TestServer | undefined;

afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
});

describe("routes.ts", () => {
  it("POST /api/runs가 runId를 주고 events가 스트림된다", async () => {
    server = await startTestServer(async (_request, io) => {
      io.writeStdout("첫 줄");
      io.writeStdout("둘째 줄");
      return 0;
    });

    const postResponse = await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "test", argv: ["x"] }),
    });
    expect(postResponse.status).toBe(200);
    const { runId } = (await postResponse.json()) as { runId: string };
    expect(typeof runId).toBe("string");
    await tick();

    const events = await collectSseEvents(`${server.baseUrl}/api/runs/${runId}/events`, 3);
    expect(events).toEqual([
      { kind: "stdout", html: "첫 줄", id: 1 },
      { kind: "stdout", html: "둘째 줄", id: 2 },
      { kind: "done", exitCode: 0, id: 3 },
    ]);
  });

  it("test 실행을 시작하면 root 아래 .mcpeak/repair 와 .mcpeak/.gitignore 가 생긴다", async () => {
    server = await startTestServer(async () => 0);

    const postResponse = await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "test", argv: ["x"] }),
    });
    expect(postResponse.status).toBe(200);

    expect((await stat(join(server.root, ".mcpeak", "repair"))).isDirectory()).toBe(true);
    expect(await readFile(join(server.root, ".mcpeak", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("verify 플로우를 받아 run 을 시작한다", async () => {
    let seenFlow: string | undefined;
    server = await startTestServer(async (request) => {
      seenFlow = request.flow;
      return 0;
    });
    const response = await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "verify", argv: ["--out", "s.json", "--command", "node"] }),
    });
    expect(response.status).toBe(200);
    expect(seenFlow).toBe("verify");
  });

  it("generate 실행은 .mcpeak 을 만들지 않는다", async () => {
    server = await startTestServer(async () => 0);

    await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "generate", argv: ["x"] }),
    });

    await expect(stat(join(server.root, ".mcpeak"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it(".mcpeak/.gitignore 가 이미 있으면 내용을 덮어쓰지 않는다", async () => {
    server = await startTestServer(async () => 0);
    await mkdir(join(server.root, ".mcpeak"), { recursive: true });
    await writeFile(join(server.root, ".mcpeak", ".gitignore"), "# 사용자가 고친 것\n", "utf8");

    await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "test", argv: ["x"] }),
    });

    expect(await readFile(join(server.root, ".mcpeak", ".gitignore"), "utf8")).toBe(
      "# 사용자가 고친 것\n",
    );
  });

  it("GET /api/runs 의 항목에 argv 가 있다", async () => {
    server = await startTestServer(async () => 0);
    const argv = ["suite.json", "--command", "node", "--repair-bundle", ".mcpeak/repair/s.json"];

    await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "test", argv }),
    });
    await tick();

    const list = (await (await fetch(`${server.baseUrl}/api/runs`)).json()) as { argv: unknown }[];
    expect(list.map((run) => run.argv)).toEqual([argv]);
  });

  it("question 이벤트 후 answer가 플로우를 재개한다", async () => {
    server = await startTestServer(async (_request, io) => {
      const confirmed = await io.reviewIO.confirm("계속할까요?");
      return confirmed ? 0 : 1;
    });

    const postResponse = await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "repair", argv: ["x"] }),
    });
    const { runId } = (await postResponse.json()) as { runId: string };
    await tick();

    const handle = server.registry.get(runId);
    expect(handle).toBeDefined();
    const question = handle?.events.find((event) => event.kind === "question");
    expect(question?.kind).toBe("question");
    const questionId = question?.kind === "question" ? question.question.id : undefined;
    expect(questionId).toBeDefined();

    const answerResponse = await fetch(`${server.baseUrl}/api/runs/${runId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId, value: "y" }),
    });
    expect(answerResponse.status).toBe(204);

    await tick();
    expect(handle?.summary.status).toBe("done");
    expect(handle?.summary.exitCode).toBe(0);
  });

  it("잘못된 questionId answer는 409다", async () => {
    server = await startTestServer(async (_request, io) => {
      await io.reviewIO.confirm("계속할까요?");
      return 0;
    });

    const postResponse = await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "repair", argv: ["x"] }),
    });
    const { runId } = (await postResponse.json()) as { runId: string };
    await tick();

    const answerResponse = await fetch(`${server.baseUrl}/api/runs/${runId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: "잘못된id", value: "y" }),
    });
    expect(answerResponse.status).toBe(409);
  });

  it("없는 runId는 404다", async () => {
    server = await startTestServer();
    const response = await fetch(`${server.baseUrl}/api/runs/no-such-run`);
    expect(response.status).toBe(404);
    // 이 문장은 그대로 화면에 나간다(#295). 발원지에서 못박지 않으면 아무 데서도
    // 고정되지 않는다 — 고치기 전에는 저장소 전체에 이 문자열 단언이 0건이었다.
    expect(await response.json()).toEqual({ error: "그런 run이 없습니다." });
  });

  it("GET /api/meta 가 스위트 탐색 루트를 준다", async () => {
    server = await startTestServer();
    const response = await fetch(`${server.baseUrl}/api/meta`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ root: server.root });
  });

  it("GET /api/servers 가 200 과 후보 배열을 준다", async () => {
    server = await startTestServer();
    await writeFile(
      join(server.root, ".mcp.json"),
      JSON.stringify({ mcpServers: { weather: { command: "node", args: ["server.mjs"] } } }),
      "utf8",
    );

    const response = await fetch(`${server.baseUrl}/api/servers`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: "mcp-config:.mcp.json:weather",
        name: "weather",
        command: "node",
        args: ["server.mjs"],
        source: "mcp-config",
        path: ".mcp.json",
        envNames: [],
      },
    ]);
  });

  it("serverId 가 문자열이 아니면 400 이다", async () => {
    server = await startTestServer();
    const response = await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "test", argv: ["suite.json"], serverId: 3 }),
    });
    expect(response.status).toBe(400);
  });

  it("없는 serverId 면 400 이고 본문 error 가 그 id 를 말한다", async () => {
    server = await startTestServer();
    const response = await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "test", argv: ["suite.json"], serverId: "mcp-config:x:없음" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toEqual({
      error: "서버 후보를 찾을 수 없습니다: mcp-config:x:없음",
    });
  });

  it("있는 serverId 면 execute 가 그 후보의 env 를 받는다", async () => {
    const seen: (Record<string, string> | undefined)[] = [];
    server = await startTestServer((_request, _io, options) => {
      seen.push(options?.candidateEnv as Record<string, string> | undefined);
      return Promise.resolve(0);
    });
    await writeFile(
      join(server.root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          weather: { command: "node", args: ["server.mjs"], env: { API_KEY: "from-file" } },
        },
      }),
      "utf8",
    );

    const response = await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        flow: "test",
        argv: ["suite.json", "--env", "API_KEY"],
        serverId: "mcp-config:.mcp.json:weather",
      }),
    });
    expect(response.status).toBe(200);
    await tick();
    expect(seen).toEqual([{ API_KEY: "from-file" }]);
  });

  it("serverId 가 없으면 execute 는 후보 env 를 받지 않는다", async () => {
    const seen: (Record<string, string> | undefined)[] = [];
    server = await startTestServer((_request, _io, options) => {
      seen.push(options?.candidateEnv as Record<string, string> | undefined);
      return Promise.resolve(0);
    });

    await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "test", argv: ["suite.json"] }),
    });
    await tick();
    expect(seen).toEqual([undefined]);
  });

  it("후보가 없으면 빈 배열이다", async () => {
    server = await startTestServer();
    const response = await fetch(`${server.baseUrl}/api/servers`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  /**
   * `/api/health` 는 스캐폴드 검증용으로 `{ ok: true }` 를 완전 일치로 잠가 둔 자리다
   * (tests/scaffold.test.ts). `/api/meta` 를 더하면서 여기에 root 가 새지 않았는지 못박는다.
   */
  it("GET /api/health 는 root 를 싣지 않는다", async () => {
    server = await startTestServer();
    const response = await fetch(`${server.baseUrl}/api/health`);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("경로 탈출 요청은 400이다", async () => {
    server = await startTestServer();
    const response = await fetch(`${server.baseUrl}/api/suites/..%2F..%2Fetc%2Fpasswd`);
    expect(response.status).toBe(400);
  });

  it("본문이 JSON이 아니면 400이다", async () => {
    server = await startTestServer();
    const response = await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "이것은 JSON이 아닙니다",
    });
    expect(response.status).toBe(400);
  });

  it("SSE 재연결은 Last-Event-ID 뒤의 이벤트만 보낸다", async () => {
    server = await startTestServer(async (_request, io) => {
      io.writeStdout("stdout");
      io.writeStderr("stderr");
      await io.reviewIO.confirm("계속할까요?");
      return 0;
    });
    const started = await fetch(`${server.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "repair", argv: [] }),
    });
    const { runId } = (await started.json()) as { runId: string };
    await tick();

    const events = await collectSseEvents(`${server.baseUrl}/api/runs/${runId}/events`, 3);
    expect(events.map((event) => event.kind)).toEqual(["stdout", "stderr", "question"]);

    const resumed = await collectSseEvents(`${server.baseUrl}/api/runs/${runId}/events`, 2, {
      "Last-Event-ID": "1",
    });
    expect(resumed.map((event) => event.kind)).toEqual(["stderr", "question"]);
  });

  it("스위트 PUT은 실제 스위트 JSON만 저장하고 일반 JSON은 원본을 보존한다", async () => {
    server = await startTestServer();
    const target = join(server.root, "package.json");
    const original = '{"name":"keep"}\n';
    await writeFile(target, original, "utf8");
    const before = await stat(target);

    const response = await putFile(
      server,
      "package.json",
      JSON.stringify({ name: "replace" }),
      before.mtimeMs,
    );
    expect(response.status).toBe(400);
    await expect(readFile(target, "utf8")).resolves.toBe(original);
  });

  it("스위트 PUT은 JSON 확장자가 아닌 경로를 거절하고 파일을 만들지 않는다", async () => {
    server = await startTestServer();

    const response = await putFile(server, "suite.txt", JSON.stringify(VALID_SUITE));
    expect(response.status).toBe(400);
    await expect(stat(join(server.root, "suite.txt"))).rejects.toThrow();
  });

  it("저장 대상의 부모 디렉터리가 없으면 고칠 방법을 알리는 4xx를 준다", async () => {
    server = await startTestServer();

    const response = await putFile(server, "missing/suite.json", JSON.stringify(VALID_SUITE));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining("상위 디렉터리"),
    });
  });

  it("디렉터리에 저장하려 하면 고칠 방법을 알리는 4xx를 준다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "suite.json"));
    const before = await stat(join(server.root, "suite.json"));

    const response = await putFile(
      server,
      "suite.json",
      JSON.stringify(VALID_SUITE),
      before.mtimeMs,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: expect.stringContaining("디렉터리") });
  });

  /**
   * **Windows 에서는 이 상황을 만들 수 없다.** NTFS 는 POSIX mode bit 를 무시하므로
   * `chmod(0o500)` 을 걸어도 파일이 그대로 써져 200 이 온다 — 검증하려는 `EACCES` 분류에
   * 닿기 전에 전제가 성립하지 않는다(#304). 제품 코드는 그 환경에서도 정상이며, 여기서
   * 건너뛰는 것은 **재현 수단이 없다는 사실**이다.
   */
  it.skipIf(process.platform === "win32")(
    "쓰기 권한이 없으면 고칠 방법을 알리는 4xx를 준다",
    async () => {
      server = await startTestServer();
      const locked = join(server.root, "locked");
      await mkdir(locked);
      await chmod(locked, 0o500);

      try {
        const response = await putFile(server, "locked/suite.json", JSON.stringify(VALID_SUITE));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          error: expect.stringContaining("쓰기 권한"),
        });
      } finally {
        await chmod(locked, 0o700);
      }
    },
  );

  /**
   * **errno 가 플랫폼마다 다르다.** 300자 파일명은 Linux 에서 `ENAMETOOLONG`(우리가 분류하지
   * 않는 코드 → 500)이지만 Windows 는 다른 errno 를 내 400 분기에 잡힌다(#304). "분류하지
   * 않은 오류" 라는 전제를 그 환경에서 만들 수단이 없다.
   */
  it.skipIf(process.platform === "win32")(
    "분류하지 않은 파일 시스템 오류는 상위 generic 500 응답으로 전파한다",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-generic-error-"));
      const dashboard = await startDashboardServer({ port: 0, root });
      const tooLongName = `${"a".repeat(300)}.json`;

      try {
        const response = await fetch(
          `http://127.0.0.1:${dashboard.port}/api/suites/${encodeURIComponent(tooLongName)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: JSON.stringify(VALID_SUITE), baseMtimeMs: 0 }),
          },
        );

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
          error: expect.stringContaining("서버 내부 오류:"),
        });
      } finally {
        await dashboard.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

/** 완료된 응답 하나짜리 세션을 만든다. */
function writeOneResponseSession(path: string): void {
  const store = createSqliteSessionStore({ path });
  store.createSession("default");
  const reservation = store.reserve({
    sessionId: "default",
    request: {
      protocol: "http",
      interactionSchemaVersion: 1,
      matchKey: "a",
      display: {
        method: "GET",
        url: "https://api.open-meteo.com/<redacted>?city=Seoul",
        headers: {},
        body: { kind: "none" },
      },
    },
  });
  store.complete({
    sessionId: "default",
    interactionId: reservation.interactionId,
    outcome: {
      kind: "response",
      status: 200,
      statusText: "OK",
      headers: [],
      url: "https://api.open-meteo.com/v1/forecast?city=Seoul",
      body: { temperature: 21.5 },
    },
  });
  store.finish("default", "completed");
  store.close();
}

describe("GET /api/sessions/<path>/interactions", () => {
  it("녹화본의 외부 호출 목록을 준다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "recordings"));
    writeOneResponseSession(join(server.root, "recordings", "weather.session.db"));

    const response = await fetch(
      `${server.baseUrl}/api/sessions/${encodeURIComponent("recordings/weather.session.db")}/interactions`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        ordinal: 0,
        method: "GET",
        url: "https://api.open-meteo.com/<redacted>?city=Seoul",
        outcome: { kind: "response", status: 200, body: { temperature: 21.5 } },
      },
    ]);
  });

  it("세션이 아닌 파일이면 404 와 고칠 방법을 말하는 문장 전문을 준다", async () => {
    server = await startTestServer();
    await writeFile(join(server.root, "weather.session.db"), "not a database", "utf8");

    const response = await fetch(
      `${server.baseUrl}/api/sessions/${encodeURIComponent("weather.session.db")}/interactions`,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: [
        "→ 이 녹화본을 읽을 수 없습니다 — weather.session.db",
        "→ MCPeak 이 녹화한 세션 파일인지 확인하세요. 목록에는 읽을 수 있는 파일만 나옵니다.",
      ].join("\n"),
    });
  });

  it("경로 탈출은 400 이다", async () => {
    server = await startTestServer();
    const response = await fetch(
      `${server.baseUrl}/api/sessions/${encodeURIComponent("../outside.db")}/interactions`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "허용되지 않는 경로입니다." });
  });
});

async function putMock(
  server: TestServer,
  path: string,
  content: string,
  baseMtimeMs = 0,
): Promise<Response> {
  return fetch(`${server.baseUrl}/api/mocks/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, baseMtimeMs }),
  });
}

const VALID_MOCK = {
  tools: [
    {
      name: "get_weather",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  ],
  responses: [{ tool: "get_weather", args: { city: "Seoul" }, result: { temperature: 21.5 } }],
};

/** `responses[0]` 의 도구가 tools 에 없는 정의와, 그것을 `path` 로 저장할 때의 문장 전문. */
const INVALID_MOCK = { tools: VALID_MOCK.tools, responses: [{ tool: "nope", result: {} }] };
const invalidMockMessage = (path: string): string =>
  [
    `→ 올바르지 않은 목 정의입니다 — ${path}: responses[0] 의 툴 'nope' 이 tools 에 없습니다. 있는 툴: get_weather`,
    '→ 형식: { "tools": [ { "name": ..., "inputSchema": ... } ], "responses": [ { "tool": ..., "result": ... } ] }',
  ].join("\n");

describe("PUT /api/mocks/<path>", () => {
  it("올바른 목 정의를 content 바이트 그대로 저장한다", async () => {
    server = await startTestServer();
    const content = `${JSON.stringify(VALID_MOCK, null, 2)}\n`;

    const response = await putMock(server, "weather.mock.json", content);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true });
    await expect(readFile(join(server.root, "weather.mock.json"), "utf8")).resolves.toBe(content);
  });

  it("잘못된 정의면 400 과 assertMockDefinition 문장 전문을 주고 파일을 만들지 않는다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "mocks"));

    const response = await putMock(server, "mocks/bad.mock.json", JSON.stringify(INVALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: invalidMockMessage("mocks/bad.mock.json") });
    await expect(stat(join(server.root, "mocks", "bad.mock.json"))).rejects.toThrow();
  });

  it("content 가 JSON 이 아니면 400 이다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "weather.mock.json", "{ tools: ");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "본문 content가 올바른 JSON이 아닙니다." });
  });

  it("이미 있는 파일은 baseMtimeMs 가 현재 mtime 과 같을 때만 덮어쓴다", async () => {
    server = await startTestServer();
    const target = join(server.root, "weather.mock.json");
    const original = '{"tools":[]}\n';
    await writeFile(target, original, "utf8");
    const before = await stat(target);
    const content = `${JSON.stringify(VALID_MOCK, null, 2)}\n`;

    // 새 목은 0 을 보낸다. 있는 파일이면 충돌로 돌아와야 확인을 받을 수 있다.
    const first = await putMock(server, "weather.mock.json", content, 0);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      saved: false,
      reason: "conflict",
      mtimeMs: before.mtimeMs,
    });
    await expect(readFile(target, "utf8")).resolves.toBe(original);

    const second = await putMock(server, "weather.mock.json", content, before.mtimeMs);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ saved: true });
    await expect(readFile(target, "utf8")).resolves.toBe(content);
  });

  it(".json 이 아니면 거절하고 파일을 만들지 않는다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "weather.mock.txt", JSON.stringify(VALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "목 정의는 .json 확장자 파일만 저장할 수 있습니다.",
    });
    await expect(stat(join(server.root, "weather.mock.txt"))).rejects.toThrow();
  });

  it("경로 탈출을 거절한다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "../outside.mock.json", JSON.stringify(VALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "허용되지 않는 경로입니다." });
    await expect(stat(join(server.root, "..", "outside.mock.json"))).rejects.toThrow();
  });
});

describe("GET /api/mocks", () => {
  it("유효한 목 정의만 경로순으로 도구 · 응답 수와 함께 싣는다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "mocks"));
    await writeFile(join(server.root, "mocks", "weather.mock.json"), JSON.stringify(VALID_MOCK));
    await writeFile(
      join(server.root, "a-tools-only.json"),
      JSON.stringify({ tools: VALID_MOCK.tools }),
    );
    await writeFile(join(server.root, "bad.mock.json"), JSON.stringify(INVALID_MOCK));
    await writeFile(join(server.root, "broken.json"), "{");
    await writeFile(join(server.root, "package.json"), '{"name":"x"}');

    const response = await fetch(`${server.baseUrl}/api/mocks`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { path: "a-tools-only.json", toolCount: 1, responseCount: 0 },
      { path: "mocks/weather.mock.json", toolCount: 1, responseCount: 1 },
    ]);
  });
});

describe("GET /api/mocks/<path>", () => {
  it("파일 하나를 내용 · mtime 과 함께 준다", async () => {
    server = await startTestServer();
    const content = `${JSON.stringify(VALID_MOCK, null, 2)}\n`;
    const target = join(server.root, "weather.mock.json");
    await writeFile(target, content, "utf8");
    const stats = await stat(target);

    const response = await fetch(
      `${server.baseUrl}/api/mocks/${encodeURIComponent("weather.mock.json")}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: "weather.mock.json",
      content,
      mtimeMs: stats.mtimeMs,
    });
  });

  it("목 정의가 아니면 400 과 assertMockDefinition 문장 전문을 준다", async () => {
    server = await startTestServer();
    await writeFile(join(server.root, "bad.mock.json"), JSON.stringify(INVALID_MOCK));

    const response = await fetch(
      `${server.baseUrl}/api/mocks/${encodeURIComponent("bad.mock.json")}`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: invalidMockMessage("bad.mock.json") });
  });

  it("없는 파일은 404 다", async () => {
    server = await startTestServer();
    const response = await fetch(`${server.baseUrl}/api/mocks/${encodeURIComponent("none.json")}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "파일을 찾을 수 없습니다." });
  });

  it("경로 탈출은 400 이다", async () => {
    server = await startTestServer();
    const response = await fetch(
      `${server.baseUrl}/api/mocks/${encodeURIComponent("../outside.mock.json")}`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "허용되지 않는 경로입니다." });
  });
});

async function postAnalyze(server: TestServer, body: string): Promise<Response> {
  return fetch(`${server.baseUrl}/api/analyze/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/** 분석 fake. 받은 argv·overrides 를 남기고 정해 둔 결과를 돌려준다. */
function fakeAnalyze(outcome: AnalyzeTokensOutcome) {
  const calls: { argv: readonly string[]; overrides?: AnalyzeTokensOverrides }[] = [];
  const analyze = (argv: readonly string[], overrides?: AnalyzeTokensOverrides) => {
    calls.push({ argv, overrides });
    return Promise.resolve(outcome);
  };
  return { analyze, calls };
}

const ANALYZE_BODY = {
  overlay: { schemaVersion: 1 },
  overlayText: "t",
  report: "r",
} as unknown as AnalyzeTokensResponse;

describe("POST /api/analyze/tokens", () => {
  it("ok 결과를 200 으로 그대로 돌려주고 argv 를 그대로 넘긴다", async () => {
    const { analyze, calls } = fakeAnalyze({ ok: true, body: ANALYZE_BODY });
    server = await startTestServer(undefined, analyze);
    const argv = ["--command", "node", "--arg", "server.mjs"];

    const response = await postAnalyze(server, JSON.stringify({ argv }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ANALYZE_BODY);
    expect(calls.map((call) => call.argv)).toEqual([argv]);
  });

  it("ok:false 면 400 과 error 문장 그대로다", async () => {
    const { analyze } = fakeAnalyze({ ok: false, error: "오류 [X]: a\n해결: b" });
    server = await startTestServer(undefined, analyze);

    const response = await postAnalyze(server, JSON.stringify({ argv: ["--command", "node"] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "오류 [X]: a\n해결: b" });
  });

  it("본문이 JSON 이 아니면 400 이다", async () => {
    const { analyze, calls } = fakeAnalyze({ ok: true, body: ANALYZE_BODY });
    server = await startTestServer(undefined, analyze);

    const response = await postAnalyze(server, "{ argv: ");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "본문이 올바른 JSON이 아닙니다." });
    expect(calls).toHaveLength(0);
  });

  it("argv 가 문자열 배열이 아니면 400 이다", async () => {
    const { analyze, calls } = fakeAnalyze({ ok: true, body: ANALYZE_BODY });
    server = await startTestServer(undefined, analyze);

    const response = await postAnalyze(server, JSON.stringify({ argv: "x" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "argv 형식이 올바르지 않습니다." });
    expect(calls).toHaveLength(0);
  });

  it("모르는 serverId 는 400 이고 analyze 를 부르지 않는다", async () => {
    const { analyze, calls } = fakeAnalyze({ ok: true, body: ANALYZE_BODY });
    server = await startTestServer(undefined, analyze);

    const response = await postAnalyze(server, JSON.stringify({ argv: [], serverId: "nope" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "서버 후보를 찾을 수 없습니다: nope" });
    expect(calls).toHaveLength(0);
  });

  it("아는 serverId 면 .mcp.json 의 env 값이 candidateEnv 로 넘어가고 응답에는 실리지 않는다", async () => {
    const { analyze, calls } = fakeAnalyze({ ok: true, body: ANALYZE_BODY });
    server = await startTestServer(undefined, analyze);
    await writeFile(
      join(server.root, ".mcp.json"),
      JSON.stringify({
        mcpServers: { w: { command: "node", args: [], env: { API_KEY: `\${API_KEY}` } } },
      }),
      "utf8",
    );
    const previous = process.env.API_KEY;
    process.env.API_KEY = "secret";
    try {
      const response = await postAnalyze(
        server,
        JSON.stringify({
          argv: ["--command", "node", "--env", "API_KEY"],
          serverId: "mcp-config:.mcp.json:w",
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("secret");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.overrides?.candidateEnv?.API_KEY).toBe("secret");
    } finally {
      if (previous === undefined) delete process.env.API_KEY;
      else process.env.API_KEY = previous;
    }
  });
});

async function putOverlay(server: TestServer, path: string, content: string): Promise<Response> {
  return fetch(`${server.baseUrl}/api/overlays/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, baseMtimeMs: 0 }),
  });
}

/** `parseOverlay` 를 통과하는 오버레이. optimize 패키지의 기대값 픽스처를 읽기만 한다. */
function validOverlayText(): Promise<string> {
  return readFile(
    new URL("../../optimize/tests/fixtures/synthetic.expected.overlay.json", import.meta.url),
    "utf8",
  );
}

describe("PUT /api/overlays/<path>", () => {
  it("parseOverlay 를 통과하는 내용을 저장하고 saved:true 를 준다", async () => {
    server = await startTestServer();
    const content = await validOverlayText();

    const response = await putOverlay(server, "server.optimize.json", content);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true });
    await expect(readFile(join(server.root, "server.optimize.json"), "utf8")).resolves.toBe(
      content,
    );
  });

  it("두 번째 PUT(baseMtimeMs 0)은 conflict 다", async () => {
    server = await startTestServer();
    const content = await validOverlayText();

    await putOverlay(server, "server.optimize.json", content);
    const second = await putOverlay(server, "server.optimize.json", content);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ saved: false, reason: "conflict" });
  });

  it("오버레이 형식이 아니면 400 이고 문장은 parseOverlay 의 것이다", async () => {
    server = await startTestServer();

    const response = await putOverlay(server, "bad.json", JSON.stringify({ schemaVersion: 2 }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("'schemaVersion' 값이 형식에 맞지 않습니다");
    await expect(stat(join(server.root, "bad.json"))).rejects.toThrow();
  });

  it(".json 이 아니면 400 이다", async () => {
    server = await startTestServer();

    const response = await putOverlay(server, "o.txt", await validOverlayText());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "오버레이는 .json 확장자 파일만 저장할 수 있습니다.",
    });
  });

  it("루트 밖 경로는 400 이다", async () => {
    server = await startTestServer();

    const response = await putOverlay(server, "../o.json", await validOverlayText());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "허용되지 않는 경로입니다." });
  });
});

import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunEvent, StartRunRequest } from "../src/api-types.js";
import { startDashboardServer } from "../src/index.js";
import { handleRequest } from "../src/server/routes.js";
import type { RunIo } from "../src/server/run-registry.js";
import { RunRegistry } from "../src/server/run-registry.js";

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
  execute?: (request: StartRunRequest, io: RunIo) => Promise<number>,
): Promise<TestServer> {
  const root = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-routes-"));
  const registry = new RunRegistry();
  const server: Server = createServer((request, response) => {
    handleRequest(request, response, {
      root,
      webDist: join(root, "__no-web-dist__"),
      registry,
      execute,
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

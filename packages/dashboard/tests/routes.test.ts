import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunEvent, StartRunRequest } from "../src/api-types.js";
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
  readonly registry: RunRegistry;
  close(): Promise<void>;
}

async function startTestServer(
  execute?: (request: StartRunRequest, io: RunIo) => Promise<number>,
): Promise<TestServer> {
  const root = await mkdtemp(join(tmpdir(), "ohmymcp-dashboard-routes-"));
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

/** SSE 응답에서 `data:` 블록을 지정한 개수만큼 파싱해 돌려준다. */
async function collectSseEvents(url: string, expectedCount: number): Promise<RunEvent[]> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
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
      if (block.startsWith("data: "))
        events.push(JSON.parse(block.slice("data: ".length)) as RunEvent);
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
  controller.abort();
  return events;
}

let server: TestServer;

afterEach(async () => {
  await server.close();
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
      { kind: "stdout", html: "첫 줄" },
      { kind: "stdout", html: "둘째 줄" },
      { kind: "done", exitCode: 0 },
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
});

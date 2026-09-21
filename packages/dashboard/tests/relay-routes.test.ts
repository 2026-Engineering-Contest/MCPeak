import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startDashboardServer } from "../src/index.js";

const SUITE = JSON.stringify({
  cases: [
    { id: "a", operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } } },
  ],
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function server() {
  const root = await mkdtemp(join(tmpdir(), "relay-routes-"));
  await writeFile(join(root, "s.suite.json"), SUITE, "utf8");
  const handle = await startDashboardServer({ port: 0, root });
  close = handle.close;
  return { base: `http://127.0.0.1:${handle.port}`, root };
}

describe("중계 통로", () => {
  it("본문이 모자라면 무엇이 빠졌는지 말한다", async () => {
    const { base } = await server();
    const response = await fetch(`${base}/api/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suitePath: "s.suite.json" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "suitePath·command·args·envNames·model 이 필요합니다.",
    });
  });

  it("없는 중계 세션의 SSE 는 404 다", async () => {
    const { base } = await server();
    const response = await fetch(`${base}/api/relay/nope/events`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "그런 중계 세션이 없습니다." });
  });

  it("없는 중계 세션을 닫아도 404 다", async () => {
    const { base } = await server();
    const response = await fetch(`${base}/api/relay/nope`, { method: "DELETE" });
    expect(response.status).toBe(404);
  });

  it("스위트에 부를 툴이 없으면 400 으로 거절한다", async () => {
    const { base, root } = await server();
    await writeFile(join(root, "empty.suite.json"), JSON.stringify({ cases: [] }), "utf8");
    const response = await fetch(`${base}/api/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        suitePath: "empty.suite.json",
        command: "node",
        args: [],
        envNames: [],
        model: "sonnet",
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain(
      "툴을 부르는 케이스가 없습니다",
    );
  });

  it("허용되지 않는 경로의 스위트는 거절한다", async () => {
    const { base } = await server();
    const response = await fetch(`${base}/api/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        suitePath: "../../etc/passwd",
        command: "node",
        args: [],
        envNames: [],
        model: "sonnet",
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "허용되지 않는 경로입니다." });
  });
});

// 위 다섯은 프로세스를 띄우지 않는다 — 전부 중계기 기동 **전에** 거절되는 갈래다.
// 진짜 중계기를 띄우는 성공 경로는 Task 7 의 E2E 가 본다(직렬 웨이브).

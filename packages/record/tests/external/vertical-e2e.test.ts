import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { connectStdio } from "@mcpeak/core";
import { afterEach, describe, expect, it } from "vitest";
import { startExternalCoordinator } from "../../src/external/coordinator.js";
import { createMemorySessionStore } from "../../src/external/session-store.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(
    cleanups
      .splice(0)
      .reverse()
      .map((cleanup) => cleanup()),
  );
});

describe("external Record/Replay vertical", () => {
  it("실제 MCP 서버를 다시 실행하면서 Replay에서는 origin을 한 번도 호출하지 않는다", async () => {
    let originCalls = 0;
    const origin = createServer((request, response) => {
      originCalls += 1;
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.writeHead(200, {
        "content-type": "application/json",
        "x-origin-fixture": "yes",
      });
      response.end(JSON.stringify({ city: url.searchParams.get("city"), weather: "sunny" }));
    });
    await new Promise<void>((resolve, reject) => {
      origin.once("error", reject);
      origin.listen(0, "127.0.0.1", resolve);
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          origin.close((error) => (error === undefined ? resolve() : reject(error))),
        ),
    );
    const address = origin.address();
    if (address === null || typeof address === "string") throw new Error("origin address missing");
    const originUrl = `http://127.0.0.1:${address.port}/weather`;
    const fixture = fileURLToPath(
      new URL("../fixtures/external/fetch-mcp-server.mjs", import.meta.url),
    );
    const store = createMemorySessionStore();

    const record = await startExternalCoordinator({ mode: "record", sessionId: "vertical", store });
    cleanups.push(() => record.finish("failed").then(() => undefined));
    const recordConnection = await connectStdio({
      command: process.execPath,
      args: [fixture],
      env: { ...record.childEnvironment, MCPEAK_TEST_ORIGIN_URL: originUrl },
    });
    const recorded = await recordConnection.client.callTool("fetch_weather", { city: "seoul" });
    await recordConnection.close();
    await record.finish("completed");
    expect(originCalls).toBe(1);

    const replay = await startExternalCoordinator({
      mode: "replay",
      sourceSessionId: "vertical",
      store,
    });
    cleanups.push(() => replay.finish("failed").then(() => undefined));
    const replayConnection = await connectStdio({
      command: process.execPath,
      args: [fixture],
      env: { ...replay.childEnvironment, MCPEAK_TEST_ORIGIN_URL: originUrl },
    });
    const replayed = await replayConnection.client.callTool("fetch_weather", { city: "seoul" });

    // status·header·body 는 기록과 동일하다. `url` 만 다르다 — 저장된 응답의 pathname 은
    // ADR-0053 이 지운다. 그래서 여기서만 recorded 와 replayed 가 벌어지고, 그 벌어짐이
    // 정확히 pathname 자리인지를 아래에서 직접 확인한다.
    const recordedText = (
      recorded.content as readonly { readonly type: string; readonly text: string }[]
    )[0]?.text;
    const replayText = (
      replayed.content as readonly { readonly type: string; readonly text: string }[]
    )[0]?.text;
    const recordedBody = JSON.parse(recordedText ?? "null");
    const replayBody = JSON.parse(replayText ?? "null");

    expect(recordedBody).toEqual({
      status: 200,
      url: `${originUrl}?city=seoul&requestId=fixture-value`,
      header: "yes",
      body: { city: "seoul", weather: "sunny" },
    });
    expect(replayBody).toEqual({
      status: 200,
      url: `http://127.0.0.1:${address.port}/<redacted>?city=seoul&requestId=fixture-value`,
      header: "yes",
      body: { city: "seoul", weather: "sunny" },
    });
    expect(originCalls).toBe(1);
    // miss 가 네트워크로 새지 않는 것이 Replay 의 존재 이유다. 그런데 `toThrow()` 만으로는
    // 그것을 증명하지 못한다 — 자식이 크래시해도 호출은 실패하고 카운터도 그대로다.
    // 그래서 실패의 정체까지 본다. 이 문장이 부모의 REPLAY_MISS 에서 출발해 Coordinator 와
    // 자식 어댑터, JSON-RPC 를 지나 호출자까지 살아 돌아왔다면 경로가 lookup 에서 끊긴 것이다.
    //
    // `cause` 를 보는 이유: `core` 는 최상위 message 를 안정된 카탈로그 문장으로 고정하고
    // (`OPERATION_FAILED`), 서버가 준 원문은 `cause` 에 남긴다. 진단은 그쪽에 있다.
    const missed = await replayConnection.client.callTool("fetch_weather", { city: "busan" }).then(
      () => undefined,
      (error: unknown) => error as { code?: string; cause?: { message?: string } },
    );
    expect(missed?.code).toBe("OPERATION_FAILED");
    expect(missed?.cause?.message).toContain("저장된 외부 응답을 찾지 못했습니다");
    expect(missed?.cause?.message).toContain("실제 네트워크는 호출하지 않았습니다");
    expect(originCalls).toBe(1);

    await replayConnection.close();
    expect(await replay.finish("completed")).toMatchObject({
      consumedCount: 1,
      unusedCount: 0,
    });
  }, 20_000);

  /**
   * ADR-0062. 자식이 body 에서 URL 을 찾아 지문을 만들고, 그것이 부모의 종료 요약까지
   * 닿는지를 **실제 자식 프로세스로** 확인한다. 단위 테스트는 두 층을 따로 보지만, 그 층이
   * 실제로 이어져 있는지는 여기서만 드러난다.
   *
   * origin 이 자기 요청 URL 을 body 로 되돌려 담게 한다 — pagination `next` 가 하는 일이고,
   * 경로가 자격증명인 endpoint 에서 ADR-0053 이 지운 값이 되돌아오는 바로 그 모양이다.
   */
  it("body 로 되돌아온 요청 경로를 세어 종료 요약에 싣는다", async () => {
    const origin = createServer((request, response) => {
      const requested = new URL(request.url ?? "/", "http://127.0.0.1");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          city: requested.searchParams.get("city"),
          // 요청 경로를 그대로 되돌려 담는다(echoed). query 만 다르다.
          next: `http://127.0.0.1:${(origin.address() as { port: number }).port}${requested.pathname}?page=2`,
          // 경로가 다른 URL 은 약한 갈래로 간다(other).
          docs: "https://docs.example.com/guide",
        }),
      );
    });
    await new Promise<void>((resolve, reject) => {
      origin.once("error", reject);
      origin.listen(0, "127.0.0.1", resolve);
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          origin.close((error) => (error === undefined ? resolve() : reject(error))),
        ),
    );
    const address = origin.address();
    if (address === null || typeof address === "string") throw new Error("origin address missing");
    const originUrl = `http://127.0.0.1:${address.port}/weather`;
    const fixture = fileURLToPath(
      new URL("../fixtures/external/fetch-mcp-server.mjs", import.meta.url),
    );

    const handle = await startExternalCoordinator({
      mode: "record",
      sessionId: "bodyurl",
      store: createMemorySessionStore(),
    });
    cleanups.push(() => handle.finish("failed").then(() => undefined));
    const connection = await connectStdio({
      command: process.execPath,
      args: [fixture],
      env: { ...handle.childEnvironment, MCPEAK_TEST_ORIGIN_URL: originUrl },
    });
    await connection.client.callTool("fetch_weather", { city: "seoul" });
    await connection.close();
    const summary = await handle.finish("completed");

    if (summary.mode !== "record") throw new Error("record 요약이어야 한다");
    expect(summary.bodyUrls).toEqual({ echoed: 1, other: 1, truncated: false });
    // 값은 요약에 실리지 않는다 — 사용자에게 가는 것은 개수뿐이다(ADR-0062 결정 3).
    expect(JSON.stringify(summary)).not.toContain("127.0.0.1");
    expect(JSON.stringify(summary)).not.toContain("docs.example.com");
  }, 30_000);
});

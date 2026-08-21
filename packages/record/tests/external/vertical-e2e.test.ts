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

    expect(replayed).toEqual(recorded);
    const replayText = (
      replayed.content as readonly { readonly type: string; readonly text: string }[]
    )[0]?.text;
    expect(JSON.parse(replayText ?? "null")).toEqual({
      status: 200,
      url: `${originUrl}?city=seoul&requestId=fixture-value`,
      header: "yes",
      body: { city: "seoul", weather: "sunny" },
    });
    expect(originCalls).toBe(1);
    await expect(
      replayConnection.client.callTool("fetch_weather", { city: "busan" }),
    ).rejects.toThrow();
    expect(originCalls).toBe(1);

    await replayConnection.close();
    expect(await replay.finish("completed")).toMatchObject({
      consumedCount: 1,
      unusedCount: 0,
    });
  }, 20_000);
});

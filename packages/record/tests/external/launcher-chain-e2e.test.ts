import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { connectStdio } from "@mcpeak/core";
import { afterEach, describe, expect, it } from "vitest";
import { startExternalCoordinator } from "../../src/external/coordinator.js";
import { createMemorySessionStore, type SessionStore } from "../../src/external/session-store.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(
    cleanups
      .splice(0)
      .reverse()
      .map((cleanup) => cleanup()),
  );
});

const FIXTURE = fileURLToPath(
  new URL("../fixtures/external/fetch-mcp-server.mjs", import.meta.url),
);
const LAUNCHER = fileURLToPath(new URL("../fixtures/external/stdio-launcher.mjs", import.meta.url));

/** origin 은 요청 수를 세는 것이 일이다. 재생에서 0 이어야 한다는 단언이 여기에 기댄다. */
const startOrigin = async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1;
    const requested = new URL(request.url ?? "/", "http://127.0.0.1");
    response.writeHead(200, { "content-type": "application/json", "x-origin-fixture": "yes" });
    response.end(JSON.stringify({ city: requested.searchParams.get("city"), weather: "sunny" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      ),
  );
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("origin address missing");
  return { url: `http://127.0.0.1:${address.port}/weather`, calls: () => calls };
};

const textOf = (result: { readonly content: unknown }): string =>
  (result.content as readonly { readonly type: string; readonly text: string }[])[0]?.text ?? "";

/**
 * 한 번 녹화한다. **연결 하나에 세션 하나다.**
 *
 * 같은 Coordinator 에 직접 연결과 런처 연결을 함께 붙이면 나중에 온 쪽이 기록자 판정에
 * 거절당해, 이 파일이 재려던 "런처를 거쳐도 녹화되는가" 가 사라진다(설계 §7.2).
 */
const recordOnce = async (options: {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly args: readonly string[];
  readonly originUrl: string;
  readonly dumpEnv?: boolean;
}) => {
  const handle = await startExternalCoordinator({
    mode: "record",
    sessionId: options.sessionId,
    store: options.store,
  });
  cleanups.push(() => handle.finish("failed").then(() => undefined));
  const connection = await connectStdio({
    command: process.execPath,
    args: [...options.args],
    env: {
      ...handle.childEnvironment,
      MCPEAK_TEST_ORIGIN_URL: options.originUrl,
      ...(options.dumpEnv === true ? { MCPEAK_TEST_DUMP_ENV: "1" } : {}),
    },
  });
  const called = await connection.client.callTool("fetch_weather", { city: "seoul" });
  const stderr = connection.getDiagnostics().stderr;
  await connection.close();
  const summary = await handle.finish("completed");
  return { summary, called, stderr };
};

const firstMatchKey = (store: SessionStore, sessionId: string): string => {
  const matchKey = store.read(sessionId)?.interactions[0]?.request.matchKey;
  if (matchKey === undefined) throw new Error(`세션 '${sessionId}' 에 녹화된 호출이 없다`);
  return matchKey;
};

describe("런처 체인 녹화 (ADR-0095)", () => {
  it("중간에 Node 런처가 끼어도 직접 실행과 같은 호출이 같은 키로 녹화된다", async () => {
    const origin = await startOrigin();
    const store = createMemorySessionStore();

    const direct = await recordOnce({
      store,
      sessionId: "direct",
      args: [FIXTURE],
      originUrl: origin.url,
    });
    const viaLauncher = await recordOnce({
      store,
      sessionId: "launcher",
      args: [LAUNCHER, FIXTURE],
      originUrl: origin.url,
    });

    expect(direct.summary.interactionCount).toBe(1);
    expect(viaLauncher.summary.interactionCount).toBe(1);
    expect(viaLauncher.summary.otherProcessCalls).toBe(0);
    // 개수만 보면 "무언가 녹화됐다" 까지만 안다. 재생이 찾는 키까지 같아야 판정이 끝난다.
    expect(firstMatchKey(store, "launcher")).toBe(firstMatchKey(store, "direct"));
    expect(origin.calls()).toBe(2);
  }, 30_000);

  it("런처 경유로 녹화한 세션을 런처 경유로 재생하면 origin 을 부르지 않는다", async () => {
    const origin = await startOrigin();
    const store = createMemorySessionStore();
    const recorded = await recordOnce({
      store,
      sessionId: "launcher-replay",
      args: [LAUNCHER, FIXTURE],
      originUrl: origin.url,
    });
    const recordedBody = JSON.parse(textOf(recorded.called)).body;
    const callsAfterRecord = origin.calls();

    const replay = await startExternalCoordinator({
      mode: "replay",
      sourceSessionId: "launcher-replay",
      store,
    });
    cleanups.push(() => replay.finish("failed").then(() => undefined));
    const connection = await connectStdio({
      command: process.execPath,
      args: [LAUNCHER, FIXTURE],
      env: { ...replay.childEnvironment, MCPEAK_TEST_ORIGIN_URL: origin.url },
    });
    const replayed = await connection.client.callTool("fetch_weather", { city: "seoul" });
    await connection.close();
    const summary = await replay.finish("completed");

    // `url` 은 저장본에서 pathname 이 지워져 다르다(ADR-0053). 응답 body 는 그대로여야 한다.
    expect(JSON.parse(textOf(replayed)).body).toEqual(recordedBody);
    expect(origin.calls() - callsAfterRecord).toBe(0);
    expect(summary.consumedCount).toBe(1);
    expect(summary.otherProcessCalls).toBe(0);
  }, 30_000);

  it("런처는 설정을 보고도 삼키지 않는다", async () => {
    const origin = await startOrigin();
    const store = createMemorySessionStore();

    const viaLauncher = await recordOnce({
      store,
      sessionId: "launcher-sees",
      args: [LAUNCHER, FIXTURE],
      originUrl: origin.url,
      dumpEnv: true,
    });

    // 런처가 설정을 본다. 예전에는 여기서 보고 **지웠기 때문에** 진짜 서버가 빈손으로 떴다.
    expect(viaLauncher.stderr).toContain('LAUNCHER_SEES_MODE="record"');
    // 보고도 삼키지 않았다는 증거는 같은 실행의 녹화가 남는 것이다.
    expect(viaLauncher.summary.interactionCount).toBe(1);
  }, 30_000);
});

/**
 * 설계 §4.1 표의 세 줄을 그대로 판정한다. 소비 시점이 **가로챈 첫 호출**이라는 것은, 그
 * 전에 태어난 자식은 설정을 물려받고 그 뒤에 태어난 자식은 빈손이라는 뜻이다.
 */
describe("첫 호출이 설정을 소비한다 (ADR-0095)", () => {
  it("첫 호출 앞에 태어난 자식은 설정을 보고, 뒤에 태어난 자식은 못 본다", async () => {
    const origin = await startOrigin();
    const handle = await startExternalCoordinator({
      mode: "record",
      sessionId: "consume",
      store: createMemorySessionStore(),
    });
    cleanups.push(() => handle.finish("failed").then(() => undefined));
    const connection = await connectStdio({
      command: process.execPath,
      args: [FIXTURE],
      env: { ...handle.childEnvironment, MCPEAK_TEST_ORIGIN_URL: origin.url },
    });

    const before = await connection.client.callTool("spawn_and_dump", {});
    await connection.client.callTool("fetch_weather", { city: "seoul" });
    const after = await connection.client.callTool("spawn_and_dump", {});
    await connection.close();
    const summary = await handle.finish("completed");

    expect(JSON.parse(textOf(before))).toEqual({ mode: "record" });
    expect(summary.interactionCount).toBe(1);
    expect(JSON.parse(textOf(after))).toEqual({ mode: null });
  }, 30_000);
});

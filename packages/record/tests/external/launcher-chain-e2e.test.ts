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

/**
 * 재생을 한 번 돌린다. 런처 경유·직접 실행 둘 다 같은 모양으로 띄운다.
 *
 * `launcherPing` 을 주면 런처가 자식을 띄우기 전에 그 URL 로 `node:http` 요청을 한 번 낸다 —
 * `npx` 의 레지스트리 트래픽을 흉내 낸 것이다. 그 호출은 서버가 한 일이 아니므로 기록자의
 * 보고만 세는 규칙이 걸러야 한다(ADR-0096).
 */
const replayOnce = async (options: {
  readonly store: SessionStore;
  readonly sourceSessionId: string;
  readonly args: readonly string[];
  readonly originUrl: string;
  readonly launcherPing?: string;
  readonly drive: (client: {
    callTool(name: string, args: unknown): Promise<unknown>;
  }) => Promise<void>;
}) => {
  const handle = await startExternalCoordinator({
    mode: "replay",
    sourceSessionId: options.sourceSessionId,
    store: options.store,
  });
  cleanups.push(() => handle.finish("failed").then(() => undefined));
  const connection = await connectStdio({
    command: process.execPath,
    args: [...options.args],
    env: {
      ...handle.childEnvironment,
      MCPEAK_TEST_ORIGIN_URL: options.originUrl,
      ...(options.launcherPing === undefined
        ? {}
        : { MCPEAK_TEST_LAUNCHER_PING: options.launcherPing }),
    },
  });
  await options.drive(connection.client as never);
  await connection.close();
  const summary = await handle.finish("completed");
  // `outOfScope` 는 재생 요약에만 있다. 유니온을 손으로 복제하지 않고 여기서 한 번 좁힌다.
  if (summary.mode !== "replay") throw new Error("replay 요약이어야 한다");
  return summary;
};

/** 재생 원본 하나. `fetch_weather` 한 건만 담긴다. */
const recordedSource = async (store: SessionStore, sessionId: string, originUrl: string) => {
  await recordOnce({ store, sessionId, args: [FIXTURE], originUrl });
};

/**
 * ADR-0096. 관측이 세는 것을 **이 세션의 기록자가 낸 호출**로 좁힌다.
 *
 * 고치기 전에는 관측 사이드카가 체인의 첫 Node 프로세스 하나에만 설치됐고, `npx` 를 쓰면 그것이
 * 런처였다. 그래서 서버가 낸 범위 밖 호출은 아예 못 세고 런처 자신의 레지스트리 트래픽만 세어,
 * 재현 가능한 재생에 "재현 가능하지 않습니다" 가 붙었다.
 */
describe("범위 밖 관측은 기록자의 것만 센다 (ADR-0096)", () => {
  it("런처 자신의 호출은 세지 않는다", async () => {
    const origin = await startOrigin();
    const store = createMemorySessionStore();
    await recordedSource(store, "obs-launcher-only", origin.url);

    const summary = await replayOnce({
      store,
      sourceSessionId: "obs-launcher-only",
      args: [LAUNCHER, FIXTURE],
      originUrl: origin.url,
      launcherPing: origin.url,
      drive: async (client) => {
        await client.callTool("fetch_weather", { city: "seoul" });
      },
    });

    // 런처가 실제로 한 건 냈지만 그것은 서버가 한 일이 아니다. 고치기 전에는 이 값이 1이었다.
    expect(summary.outOfScope).toBe(0);
  });

  it("서버가 낸 범위 밖 호출은 런처가 껴 있어도 그대로 센다", async () => {
    const origin = await startOrigin();
    const store = createMemorySessionStore();
    await recordedSource(store, "obs-mixed", origin.url);

    const summary = await replayOnce({
      store,
      sourceSessionId: "obs-mixed",
      args: [LAUNCHER, FIXTURE],
      originUrl: origin.url,
      launcherPing: origin.url,
      drive: async (client) => {
        await client.callTool("http_ping", {});
        await client.callTool("http_ping", {});
        await client.callTool("fetch_weather", { city: "seoul" });
      },
    });

    expect(summary.outOfScope).toBe(2);
  });

  it("직접 실행도 같은 숫자다 — 런처가 있든 없든 서버가 한 일은 같게 보여야 한다", async () => {
    const origin = await startOrigin();
    const store = createMemorySessionStore();
    await recordedSource(store, "obs-direct", origin.url);

    const summary = await replayOnce({
      store,
      sourceSessionId: "obs-direct",
      args: [FIXTURE],
      originUrl: origin.url,
      drive: async (client) => {
        await client.callTool("http_ping", {});
        await client.callTool("http_ping", {});
        await client.callTool("fetch_weather", { city: "seoul" });
      },
    });

    expect(summary.outOfScope).toBe(2);
  });

  /**
   * 폴백 갈래다. 서버가 `node:http` 만 쓰면 어댑터를 한 번도 지나지 않아 **아무도 기록자가
   * 아니다.** 그때는 읽을 수 있는 보고를 전부 세므로 런처 것이 다시 섞인다.
   *
   * **정확한 값을 단언하지 않는 것이 의도다.** 이 갈래가 부정확하다는 것은 설계가 이미 적었고
   * (§4.2 · §8.1), 테스트가 그 부정확을 고정하면 나중에 고칠 때 테스트가 방해한다. 여기서
   * 지켜야 하는 것은 "서버가 낸 2건을 잃지 않는다" 하나다 — 오늘은 그 2건을 통째로 놓친다.
   */
  it("아무도 기록자가 아니면 전부 센다 — 서버가 낸 것을 잃지 않는다", async () => {
    const origin = await startOrigin();
    const store = createMemorySessionStore();
    await recordedSource(store, "obs-fallback", origin.url);

    const summary = await replayOnce({
      store,
      sourceSessionId: "obs-fallback",
      args: [LAUNCHER, FIXTURE],
      originUrl: origin.url,
      launcherPing: origin.url,
      drive: async (client) => {
        await client.callTool("http_ping", {});
        await client.callTool("http_ping", {});
      },
    });

    expect(summary.outOfScope).toBeGreaterThanOrEqual(2);
  });
});

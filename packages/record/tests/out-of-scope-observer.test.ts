import { channel, hasSubscribers } from "node:diagnostics_channel";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, get, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installOutOfScopeObserver,
  observerChannelName,
} from "../src/external/child/out-of-scope-observer.mjs";

/**
 * ADR-0067. 재생 중 범위 밖으로 나간 호출을 **세기만** 하는 관측기다.
 *
 * 여기서 보는 것은 셋이다 — 세야 할 것을 세는가, **세면 안 되는 것을 안 세는가**, 그리고
 * 애초에 이 Node 에서 관측이 가능한가.
 */

const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const startServer = async (): Promise<{ readonly host: string }> => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  return { host: `127.0.0.1:${port}` };
};

const reportPath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "mcpeak-observer-test-"));
  directories.push(directory);
  return join(directory, "out-of-scope.json");
};

const httpGet = (host: string, path: string): Promise<void> =>
  new Promise((resolve, reject) => {
    get(`http://${host}${path}`, (response) => {
      response.resume();
      response.on("end", () => resolve());
    }).on("error", reject);
  });

/**
 * **이 테스트가 이 기능의 하한선이다.**
 *
 * `subscribe` 는 존재하지 않는 채널 이름에도 조용히 성공한다. 채널이 없는 Node 에서는 콜백이
 * 영원히 안 불려 개수가 늘 0 이 되는데, 그 0 은 "안 나갔다" 로 보고되어 이 기능이 없애려던
 * 거짓 안심을 되살린다 — 게다가 아무 테스트도 빨개지지 않는다.
 *
 * 그래서 채널의 **존재와 발행**을 직접 단언한다. 지원 하한(Node 22.18)에서 이것이 성립하지
 * 않으면 CI 의 `verify (22.18.0)` 잡이 그 사실을 알려 준다. 추측으로 답할 수 없는 질문이라
 * 테스트에게 묻는다.
 */
describe("관측 채널 자체", () => {
  it("이 Node 에서 http.client.request.created 가 실제로 발행된다", async () => {
    const { host } = await startServer();
    const published: unknown[] = [];
    const target = channel(observerChannelName());
    const listener = (message: unknown): void => {
      published.push(message);
    };
    target.subscribe(listener);
    expect(hasSubscribers(observerChannelName())).toBe(true);

    try {
      await httpGet(host, "/probe");
    } finally {
      target.unsubscribe(listener);
    }

    expect(published.length).toBeGreaterThan(0);
  });
});

describe("범위 밖 호출 관측", () => {
  it("node:http 호출을 센다", async () => {
    const { host } = await startServer();
    const observer = installOutOfScopeObserver({
      coordinatorHostHeader: "127.0.0.1:1",
      reportPath: await reportPath(),
    });

    try {
      await httpGet(host, "/a");
      await httpGet(host, "/b");
    } finally {
      observer.uninstall();
    }

    expect(observer.count()).toBe(2);
  });

  /**
   * **필터가 없으면 이 기능이 매 실행 거짓 경고를 낸다.** 어댑터의 Coordinator 클라이언트가
   * `node:http` 를 쓰기 때문이다(`child/coordinator-client.mjs`) — 재생에서 in-scope 호출을
   * 하나 처리할 때마다 우리 왕복이 "범위 밖 호출" 로 잡힌다.
   */
  it("Coordinator 왕복은 세지 않는다", async () => {
    const { host } = await startServer();
    const observer = installOutOfScopeObserver({
      coordinatorHostHeader: host,
      reportPath: await reportPath(),
    });

    try {
      await httpGet(host, "/lookup");
      await httpGet(host, "/complete");
    } finally {
      observer.uninstall();
    }

    expect(observer.count()).toBe(0);
  });

  it("fetch 는 세지 않는다 — 어댑터가 이미 처리하는 갈래다", async () => {
    const { host } = await startServer();
    const observer = installOutOfScopeObserver({
      coordinatorHostHeader: "127.0.0.1:1",
      reportPath: await reportPath(),
    });

    try {
      await (await fetch(`http://${host}/via-fetch`)).text();
    } finally {
      observer.uninstall();
    }

    // 두 번 세면 어댑터가 처리한 호출이 유출로 보고된다 — 정반대의 거짓 경고다.
    expect(observer.count()).toBe(0);
  });

  it("uninstall 뒤에는 세지 않는다", async () => {
    const { host } = await startServer();
    const observer = installOutOfScopeObserver({
      coordinatorHostHeader: "127.0.0.1:1",
      reportPath: await reportPath(),
    });
    observer.uninstall();

    await httpGet(host, "/after");

    expect(observer.count()).toBe(0);
  });

  /**
   * 종료 훅을 직접 뛰울 수 없으므로 `process.emit("exit")` 로 대신한다. 훅이 붙어 있고
   * 그것이 개수를 파일로 남긴다는 사실만 본다 — 실제 자식 종료 경로는 e2e 가 본다.
   */
  it("종료 시 개수를 파일에 남긴다", async () => {
    const { host } = await startServer();
    const path = await reportPath();
    const observer = installOutOfScopeObserver({
      coordinatorHostHeader: "127.0.0.1:1",
      reportPath: path,
    });

    try {
      await httpGet(host, "/a");
      (process as unknown as { emit(name: string, code: number): boolean }).emit("exit", 0);
    } finally {
      observer.uninstall();
    }

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ outOfScope: 1 });
  });
});

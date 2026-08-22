import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";

vi.mock("@mcpeak/core", async () => import("../../core/src/index.js"));
vi.mock("@mcpeak/runner", async () => import("../../runner/src/index.js"));

/**
 * P9 의 실질 목표를 본다 — **별개 실행에서 Record → Replay 가 성립하는가.**
 *
 * 단계 B 의 수직 e2e 는 한 프로세스 안에서 Coordinator 를 두 번 열어 확인했다. 여기서는
 * `test` 를 두 번 돌린다. 그 사이에 남는 것은 세션 파일 하나뿐이고, 두 번째 실행은 첫 번째가
 * 무엇을 했는지 파일로만 안다.
 *
 * 판정은 **origin 호출 카운터**다. 재생이 실제로 됐다면 두 번째 실행에서 카운터가 움직이지
 * 않는다. 결과만 같은지 보면 서버가 외부를 다시 불러 같은 답을 받은 경우와 구분되지 않는다.
 *
 * 빌드 산출물이 아니라 `../src/index.js` 의 `run` 을 부른다. dist CLI 쪽 검증은 `build` 잡의
 * `dist-cli-e2e.mjs` 가 따로 한다.
 */

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const server = join(here, "fixtures/external-fetch-server.mjs");
const suite = join(here, "fixtures/external-fetch.suite.json");

const directories: string[] = [];
const servers: Server[] = [];

// 정리는 훅에서 한다. 본문 마지막 줄에 두면 앞선 단언이 실패했을 때 도달하지 않아, 열린
// 서버 핸들이 남고 다음 테스트가 그 영향을 받는다. 첫 실패가 원인인데 두 번째 증상만 보인다.
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((instance) => new Promise<void>((done) => instance.close(() => done()))),
  );
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

/** 호출 횟수를 세는 origin. 카운터는 호출자가 읽는다. */
const startOrigin = async (): Promise<{
  readonly url: (path: string) => string;
  readonly calls: () => number;
}> => {
  let calls = 0;
  const origin = createServer((request, response) => {
    calls += 1;
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ city: url.searchParams.get("city"), weather: "sunny" }));
  });
  servers.push(origin);
  await new Promise<void>((done) => origin.listen(0, "127.0.0.1", done));
  const { port } = origin.address() as { port: number };
  return { url: (path) => `http://127.0.0.1:${port}${path}`, calls: () => calls };
};

const newSessionPath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "mcpeak-cli-session-"));
  directories.push(directory);
  return join(directory, "session.db");
};

/**
 * origin 을 `--arg` 로 넘긴다. 자식은 부모 env 를 상속하지 않으므로(SDK 의 spawn env 가
 * `{...getDefaultEnvironment(), ...options.env}` 다) 환경 변수로는 전달되지 않는다.
 */
const runTest = (extra: readonly string[], originUrl: string): Promise<number> =>
  run([
    "test",
    suite,
    "--command",
    process.execPath,
    "--arg",
    server,
    "--arg",
    originUrl,
    ...extra,
  ]);

describe("mcpeak test 의 External 세션", () => {
  it("녹화한 뒤 다른 실행에서 재생하면 외부 API 를 다시 부르지 않는다", async () => {
    const origin = await startOrigin();
    const sessionPath = await newSessionPath();

    const recorded = await runTest(["--record-session", sessionPath], origin.url("/weather"));
    expect(recorded).toBe(0);
    expect(origin.calls()).toBe(1);

    // 두 번째 실행은 세션 파일 말고는 첫 실행과 아무것도 공유하지 않는다.
    const replayed = await runTest(["--session", sessionPath], origin.url("/weather"));

    expect(replayed).toBe(0);
    expect(origin.calls()).toBe(1);
  }, 30_000);

  it("녹화에 없는 호출을 만나면 네트워크로 새지 않고 실패한다", async () => {
    const origin = await startOrigin();
    const sessionPath = await newSessionPath();

    // 다른 경로로 녹화한다 — 재생 때의 요청과 URL 이 달라 matchKey 가 어긋난다.
    const recorded = await runTest(["--record-session", sessionPath], origin.url("/recorded"));
    // 녹화가 성공했고 origin 을 실제로 한 번 불렀다는 것을 먼저 고정한다. 이게 없으면 녹화가
    // 어떤 이유로든 실패했을 때 카운터가 0 인 채로 아래 단언이 전부 통과해, 테스트가 아무것도
    // 증명하지 못한 채 초록이 된다.
    expect(recorded).toBe(0);
    expect(origin.calls()).toBe(1);

    const replayed = await runTest(["--session", sessionPath], origin.url("/other"));

    expect(replayed).not.toBe(0);
    // 실패하더라도 외부로 나가지 않는 것이 Replay 의 존재 이유다.
    expect(origin.calls()).toBe(1);
  }, 30_000);
});

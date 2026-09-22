import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

const RELAY = fileURLToPath(new URL("../src/relay.ts", import.meta.url));
const CHILD = fileURLToPath(new URL("./fixtures/relay-child.mjs", import.meta.url));
const WEATHER = fileURLToPath(
  new URL("../../../examples/weather-server/server.mjs", import.meta.url),
);
/**
 * `src/` 는 형제 모듈을 ".js" 로 부르는데 Node 의 ESM 리졸버는 그것을 ".ts" 로 매핑하지
 * 않는다. 이 훅이 그 한 칸을 메운다 (ADR-0055). `--import` 에는 원시 경로가 아니라 URL 을
 * 넘긴다 — Windows 절대경로를 그대로 주면 드라이브 문자를 스킴으로 읽어 자식이 시작조차
 * 못 한다 (#246).
 */
const tsResolve = new URL("./fixtures/register-ts-resolve.mjs", import.meta.url).href;

const spawned: ReturnType<typeof spawn>[] = [];
afterEach(() => {
  for (const child of spawned.splice(0)) child.kill("SIGKILL");
});

/** 중계기를 띄우고 기동 줄에서 URL 을 읽어 돌려준다. */
function startRelayProcess(
  args: readonly string[],
): Promise<{ child: ReturnType<typeof spawn>; url: string; stderr: () => string }> {
  const child = spawn(process.execPath, ["--import", tsResolve, RELAY, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  spawned.push(child);
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`중계기가 기동 줄을 내지 않았습니다:\n${stderr}`)),
      10_000,
    );
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      const match = /중계기 대기 중 (\S+)/.exec(stderr);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve({ child, url: match[1], stderr: () => stderr });
      }
    });
    child.on("error", reject);
  });
}

async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`파일이 제한 시간 안에 생기지 않았습니다: ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function roundTrip(url: string, message: JSONRPCMessage): Promise<JSONRPCMessage> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const received = new Promise<JSONRPCMessage>((resolve) => {
    transport.onmessage = resolve;
  });
  await transport.start();
  await transport.send(message);
  const response = await received;
  await transport.close();
  return response;
}

describe("mcpeak-relay — 배포되는 진입점", () => {
  it("§8-12 결정론적 예제 서버를 중계하고 HTTP 로 왕복한다", async () => {
    const { url } = await startRelayProcess(["--port", "0", "--", process.execPath, WEATHER]);

    const initialized = await roundTrip(url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "relay-bin-test", version: "0.0.0" },
      },
    } as JSONRPCMessage);
    expect(initialized).toMatchObject({
      id: 1,
      result: { serverInfo: { name: "example-weather-server" } },
    });

    const listed = await roundTrip(url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    } as JSONRPCMessage);
    expect(listed).toMatchObject({
      id: 2,
      result: { tools: [{ name: "get_weather" }, { name: "add" }] },
    });
  }, 30_000);

  it("§8-13 SIGINT 에 자식까지 종료된다", async () => {
    const pidfile = join(mkdtempSync(join(tmpdir(), "mcpeak-relay-")), "child.pid");
    // pid 는 argv 로 건넨다 — 중계기는 부모 환경을 자식에게 통째로 물려주지 않는다.
    // 자세한 이유는 `fixtures/relay-child.mjs` 머리말에 적어 두었다.
    const { child } = await startRelayProcess([
      "--port",
      "0",
      "--",
      process.execPath,
      CHILD,
      "--pidfile",
      pidfile,
      // stdin 닫힘에 반응하지 않는 자식이라야 이 테스트가 중계기를 검사한다.
      // 기본 자식은 중계기가 아무것도 안 해도 파이프가 닫히면 스스로 끝난다.
      "--ignore-stdin-close",
    ]);
    // 자식이 파일을 쓰는 것은 중계기의 기동 줄과 순서가 정해져 있지 않다.
    await waitForFile(pidfile);
    const childPid = Number(readFileSync(pidfile, "utf8"));
    expect(childPid).toBeGreaterThan(0);

    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGINT");
    await exited;

    // 프로세스 수가 아니라 **이 pid 하나**를 본다. 프로세스 수는 병렬 실행에서 남의 서버를 센다.
    await new Promise((resolve) => setTimeout(resolve, 200));
    let alive = true;
    try {
      process.kill(childPid, 0);
    } catch {
      alive = false;
    }
    // 이 테스트가 실패하면 자식이 고아로 남는다. 다음 실행을 흔들지 않게 직접 거둔다.
    if (alive) process.kill(childPid, "SIGKILL");
    expect(alive).toBe(false);
  }, 30_000);
});

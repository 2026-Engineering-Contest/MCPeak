import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relayBinPath } from "@mcpeak/mock";
import { afterEach, describe, expect, it } from "vitest";
import type { RelayEvent, StartRelayRequest } from "../src/api-types.js";
import { RelaySessionRegistry } from "../src/server/relay-session.js";

/**
 * 중계 세션의 **배선**을 한 번 진짜로 본다. 여기까지의 모든 테스트는 중계기도 AI 도
 * 주입받은 가짜였다 — 이 파일에서 진짜인 것은 중계기(`mcpeak-relay`)와 사용자 서버
 * (`examples/weather-server`)이고, **AI 자리만 가짜다.**
 *
 * AI 를 가짜로 두는 것은 타협이 아니라 설계다(설계 §8). 진짜 `claude` 는 같은 입력에 같은
 * 결과를 주지 않아 이 테스트가 무엇을 봤는지 말할 수 없게 된다 — 결정론성이 이 저장소의
 * 핵심 가치다(`CLAUDE.md`). 가짜 AI 는 **자기 꼬리표가 붙은 URL 로 툴을 한 번 부르는**
 * 일만 한다. 그 URL 은 우리가 지어내지 않고 `buildRelayAiArgs` 가 만든 `--mcp-config`
 * 에서 꺼내 쓴다 — 그래야 argv 조립부터 stderr 기록까지가 한 줄로 이어진 것을 본다.
 *
 * MCP 왕복은 **맨 `fetch`** 로 친다. SDK `Client` 를 끼우면 그것이 응답을 한 번 더 검증해
 * 무엇이 깨진 것인지 흐려진다(`packages/mock/tests/relay-e2e.test.ts` 가 같은 이유로
 * 트랜스포트만 쓴다). 중계기는 stateless 모드라(`relay-server.ts`, `sessionIdGenerator:
 * undefined`) 세션 헤더를 주고받을 필요가 없어 맨 fetch 로 충분하다.
 *
 * **파일명이 `-e2e.test.ts` 인 것이 중요하다.** 루트 `vitest.config.ts` 의 `E2E_GLOB` 이
 * 이 이름으로 직렬 갈래를 가른다 — 실프로세스 스펙이 유닛과 같은 웨이브에서 돌면 포트와
 * 종료 타이밍이 서로를 흔든다.
 *
 * **이 파일은 `@mcpeak/mock` 의 빌드 산출물을 문다.** 운영 경로(`relay-session.ts` 의
 * `systemDeps.spawnRelay`)가 `relayBinPath()` → `packages/mock/dist/relay.mjs` 를 띄우기
 * 때문이고, 그게 진짜 배선이라 여기서도 그대로 둔다. 즉 `pnpm build` 를 건너뛰면 낡은
 * 중계기를 물어 여기서 빨개진다(실측: 꼬리표를 모르는 옛 산출물이 남아 `case` 가 통째로
 * 빠졌다). 고치는 법은 소스가 아니라 빌드다.
 */

const SUITE_PATH = fileURLToPath(
  new URL("../../../examples/weather-server/server.suite.json", import.meta.url),
);
const SERVER_PATH = fileURLToPath(
  new URL("../../../examples/weather-server/server.mjs", import.meta.url),
);

/**
 * 스위트의 **첫 두 케이스**다. `planRelayCases` 는 `callTool` 케이스에 파일 순서대로
 * `c1`·`c2`… 를 매기고, 이 스위트는 여덟 케이스가 모두 `callTool` 이라 꼬리표가 파일
 * 순서와 그대로 맞는다. 값을 여기 적어 두는 이유는 스위트가 바뀌면 이 테스트가 조용히
 * 다른 것을 보는 일이 없게 하려는 것이다 — 아래 첫 단언이 그 확인이다.
 */
const C1 = { id: "get-weather-success", tool: "get_weather", input: { city: "서울" } } as const;
const C2 = { id: "get-weather-missing-city", tool: "get_weather", input: {} } as const;
/** 예제 서버의 고정 응답. 외부 API 를 부르지 않으므로 몇 번 돌려도 같은 바이트다. */
const C1_BODY = {
  content: [{ type: "text", text: JSON.stringify({ city: "서울", temp: 21, condition: "맑음" }) }],
};

const START: StartRelayRequest = {
  suitePath: SUITE_PATH,
  command: process.execPath,
  args: [SERVER_PATH],
  envNames: [],
  model: "sonnet",
};

const closers: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  // 실패 경로에서도 반드시 닫힌다. 남은 중계기는 자식 서버까지 함께 남긴다.
  for (const close of closers.splice(0)) await close();
});

/** `--mcp-config` 에 실린 URL. AI 가 실제로 받는 값을 그대로 쓴다(꼬리표 포함). */
function urlFromAiArgs(args: readonly string[]): string {
  const index = args.indexOf("--mcp-config");
  const config = JSON.parse(args[index + 1] ?? "") as {
    mcpServers: { target: { url: string } };
  };
  return config.mcpServers.target.url;
}

/**
 * MCP 왕복 한 번. 응답은 SSE 프레임으로 오지만 우리는 본문을 해석하지 않는다 — 스트림이
 * 끝날 때까지 기다리는 것으로 "중계기가 응답 줄을 이미 적었다" 를 보장하는 것이 목적이다.
 */
async function callTool(url: string, tool: string, args: unknown): Promise<void> {
  const send = async (body: unknown): Promise<void> => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`→ 중계기가 ${response.status} 로 답했습니다: ${text}`);
    }
  };
  await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "relay-e2e", version: "0.0.0" },
    },
  });
  await send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: tool, arguments: args },
  });
}

/**
 * `parent` 의 자식 중 명령줄에 `needle` 이 든 것들. 프로세스 **수**를 세지 않는다 —
 * 그러면 병렬로 도는 남의 서버를 센다.
 *
 * 명령줄까지 보는 이유는 `ps` 자신이 이 호출의 자식으로 자기 출력에 잡히기 때문이다
 * (실측: `pid,ppid` 만 뽑으면 중계기와 `ps` 두 개가 나온다).
 */
function childPidsOf(parent: number, needle: string): number[] {
  const table = execFileSync("ps", ["-Ao", "pid=,ppid=,command="], { encoding: "utf8" });
  return table.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (match === null) return [];
    const [, pid, ppid, command] = match;
    return Number(ppid) === parent && (command ?? "").includes(needle) ? [Number(pid)] : [];
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("조건이 제한 시간 안에 참이 되지 않았습니다.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function caseOf(event: RelayEvent): string | undefined {
  return (event as { readonly case?: string }).case;
}

describe.sequential("중계 세션 E2E — 진짜 중계기 · 가짜 AI", () => {
  it("꼬리표 붙은 호출이 제 케이스의 이벤트로 갈리고 응답 본문이 실린다", async () => {
    const registry = new RelaySessionRegistry({
      readSuite: (path) => readFile(path, "utf8"),
      // AI 자리를 우리가 대신한다. `c1` 만 툴을 부르고, 나머지는 아무것도 하지 않는다.
      runAi: async (spec) => {
        if (spec.tag === "c1") {
          await callTool(urlFromAiArgs(spec.args), C1.tool, C1.input);
        }
        return { ok: true };
      },
    });

    const session = await registry.start(START);
    if ("error" in session) throw new Error(session.error);
    closers.push(() => registry.close(session.relayId));

    // 꼬리표가 우리가 아는 그 케이스에 붙었는지 먼저 본다. 이게 어긋나면 아래 단언은
    // 엉뚱한 케이스를 보고 통과할 수 있다.
    expect(session.cases.slice(0, 2)).toEqual([
      { id: C1.id, tag: "c1", tool: C1.tool, input: C1.input },
      { id: C2.id, tag: "c2", tool: C2.tool, input: C2.input },
    ]);

    await session.settled;

    const calls = session.events.filter(
      (event) => event.kind === "call" && event.method === "tools/call",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ case: "c1", tool: C1.tool, args: C1.input });

    const results = session.events.filter(
      (event) => event.kind === "result" && caseOf(event) === "c1",
    );
    const last = results.at(-1);
    expect(last).toMatchObject({ ok: true, tool: C1.tool });
    // **본문이 실려 있어야 한다.** 이것이 4 단계의 존재 이유다 — AI 경유로는 오지 않는 값이
    // 중계기 경로로는 살아서 브라우저까지 간다(설계 §3).
    expect((last as { readonly body?: unknown } | undefined)?.body).toEqual(C1_BODY);

    // 툴을 안 부른 케이스에는 칸을 채울 이벤트가 없다. 접속조차 하지 않았으므로
    // `initialize` 줄도 없다.
    expect(session.events.filter((event) => caseOf(event) === "c2")).toEqual([]);

    // 케이스마다 하나씩, 그리고 마지막은 언제나 `done` 이다.
    expect(session.events.filter((event) => event.kind === "aiDone")).toHaveLength(
      session.cases.length,
    );
    expect(session.events.at(-1)?.kind).toBe("done");
  }, 60_000);

  it("닫으면 중계기와 자식 서버가 실제로 끝나고, 두 번 닫아도 걸리지 않는다", async () => {
    const registry = new RelaySessionRegistry({
      readSuite: (path) => readFile(path, "utf8"),
      // 이 테스트는 수명만 본다. AI 자리는 아무 일도 하지 않는다.
      runAi: () => Promise.resolve({ ok: true }),
    });

    const session = await registry.start(START);
    if ("error" in session) throw new Error(session.error);
    closers.push(() => registry.close(session.relayId));
    await session.settled;

    // 중계기는 이 프로세스의 자식이고, 사용자 서버는 그 중계기의 자식이다.
    const relayPids = childPidsOf(process.pid, relayBinPath());
    expect(relayPids).toHaveLength(1);
    const relayPid = relayPids[0] as number;
    const serverPids = childPidsOf(relayPid, SERVER_PATH);
    expect(serverPids).toHaveLength(1);
    const serverPid = serverPids[0] as number;
    expect(isAlive(relayPid)).toBe(true);
    expect(isAlive(serverPid)).toBe(true);

    await session.close();

    await waitFor(() => !isAlive(relayPid) && !isAlive(serverPid));
    expect(isAlive(relayPid)).toBe(false);
    expect(isAlive(serverPid)).toBe(false);

    // 두 번 닫아도 걸리지 않는다. 화면 이탈과 `[실행 시작]` 이 둘 다 부를 수 있다.
    await expect(session.close()).resolves.toBeUndefined();
  }, 60_000);
});

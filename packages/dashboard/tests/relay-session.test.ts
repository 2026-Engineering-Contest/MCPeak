import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { RelayEvent } from "../src/api-types.js";
import { RelaySessionRegistry } from "../src/server/relay-session.js";

const SUITE = JSON.stringify({
  cases: [
    { id: "a", operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } } },
    { id: "b", operation: { type: "callTool", tool: "add", input: { a: 1, b: 2 } } },
  ],
});

/**
 * 진짜 자식의 `stderr` 는 Readable 이라 `on("data")` 가 붙기 전에 온 바이트도 버퍼에 남았다가
 * 리스너가 붙는 순간 흐른다. 맨 `EventEmitter` 는 그것을 버려서, 기동 줄이 리스너보다 먼저
 * 오면 없던 일이 된다. 가짜가 진짜보다 까다로우면 안 되므로 같은 버퍼링을 흉내 낸다.
 */
class BufferedStderr {
  private listener: ((chunk: Buffer) => void) | undefined;
  private readonly pending: Buffer[] = [];

  on(_event: "data", listener: (chunk: Buffer) => void): this {
    this.listener = listener;
    for (const chunk of this.pending.splice(0)) listener(chunk);
    return this;
  }

  write(chunk: Buffer): void {
    if (this.listener === undefined) this.pending.push(chunk);
    else this.listener(chunk);
  }
}

/** 중계기 자리에 세울 가짜. stderr 로 줄을 흘리고 kill 을 기록한다. */
class FakeRelay extends EventEmitter {
  readonly stderr = new BufferedStderr();
  readonly signals: string[] = [];
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    // 실제 중계기는 SIGTERM 에 닫히고 close 를 낸다.
    queueMicrotask(() => this.emit("close"));
    return true;
  }
  line(text: string): void {
    this.stderr.write(Buffer.from(`${text}\n`, "utf8"));
  }
}

function harness(options: { readonly onAi?: (tag: string) => Promise<{ ok: boolean }> } = {}) {
  const relay = new FakeRelay();
  const aiArgs: (readonly string[])[] = [];
  const order: string[] = [];
  const registry = new RelaySessionRegistry({
    readSuite: () => Promise.resolve(SUITE),
    spawnRelay: (args) => {
      order.push(`relay:${args.join(" ")}`);
      return relay;
    },
    runAi: (spec) => {
      aiArgs.push(spec.args);
      order.push(`ai:${spec.tag}`);
      return (options.onAi?.(spec.tag) ?? Promise.resolve({ ok: true })).then((r) => r);
    },
  });
  return { relay, aiArgs, order, registry };
}

const START = {
  suitePath: "s.json",
  command: "node",
  args: ["server.mjs"],
  envNames: ["API_KEY"],
  model: "sonnet",
} as const;

describe("중계 세션", () => {
  it("기동 줄을 읽고 나서야 AI 를 띄운다", async () => {
    const { relay, order, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    expect(order[0]).toMatch(/^relay:/);
    expect(order.slice(1).sort()).toEqual(["ai:c1", "ai:c2"]);
  });

  it("케이스마다 자기 꼬리표가 붙은 URL 을 받는다", async () => {
    const { relay, aiArgs, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    await started;
    const urls = aiArgs
      .map((args) => JSON.parse(args[args.indexOf("--mcp-config") + 1] as string))
      .map((config: { mcpServers: { target: { url: string } } }) => config.mcpServers.target.url)
      .sort();
    expect(urls).toEqual(["http://127.0.0.1:1/mcp?case=c1", "http://127.0.0.1:1/mcp?case=c2"]);
  });

  it("중계기 --env 에 서버 후보의 환경변수 이름이 실린다", async () => {
    const { relay, order, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    await started;
    expect(order[0]).toContain("--env API_KEY");
    expect(order[0]).toContain("-- node server.mjs");
  });

  it("기록 줄이 이벤트로 흐른다", async () => {
    const { relay, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    const seen: RelayEvent[] = [];
    session.subscribe((event) => seen.push(event));
    relay.line(
      '{"dir":"res","id":3,"tool":"get_weather","ok":true,"bytes":97,"ms":2,"body":{"x":1},"case":"c1"}',
    );
    expect(seen).toEqual([
      {
        id: expect.any(Number) as unknown as number,
        kind: "result",
        case: "c1",
        tool: "get_weather",
        ok: true,
        bytes: 97,
        ms: 2,
        body: { x: 1 },
      },
    ]);
  });

  it("AI 가 끝나면 케이스마다 aiDone 이 나간다", async () => {
    const { relay, registry } = harness({
      onAi: (tag) => Promise.resolve({ ok: tag === "c1" }),
    });
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    await session.settled;
    const kinds = session.events.filter((event) => event.kind === "aiDone");
    expect(kinds).toHaveLength(2);
    expect(session.events.at(-1)?.kind).toBe("done");
  });

  it("닫기는 중계기에 SIGTERM 을 보내고 닫힐 때까지 기다린다", async () => {
    const { relay, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    await session.close();
    expect(relay.signals).toEqual(["SIGTERM"]);
  });

  it("두 번 닫아도 신호는 한 번만 간다", async () => {
    const { relay, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    await Promise.all([session.close(), session.close()]);
    expect(relay.signals).toEqual(["SIGTERM"]);
  });

  it("스위트에 callTool 케이스가 없으면 중계기를 띄우지 않는다", async () => {
    const relay = new FakeRelay();
    let spawned = 0;
    const registry = new RelaySessionRegistry({
      readSuite: () => Promise.resolve(JSON.stringify({ cases: [] })),
      spawnRelay: () => {
        spawned += 1;
        return relay;
      },
      runAi: () => Promise.resolve({ ok: true }),
    });
    const result = await registry.start(START);
    expect("error" in result).toBe(true);
    expect(spawned).toBe(0);
  });

  it("건너뛴 케이스가 있으면 안내 이벤트로 알린다", async () => {
    const relay = new FakeRelay();
    const registry = new RelaySessionRegistry({
      readSuite: () =>
        Promise.resolve(
          JSON.stringify({
            cases: [
              { id: "a", operation: { type: "callTool", tool: "t", input: {} } },
              { id: "only-list", operation: { type: "listTools" } },
            ],
          }),
        ),
      spawnRelay: () => relay,
      runAi: () => Promise.resolve({ ok: true }),
    });
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    const notice = session.events.find((event) => event.kind === "notice");
    expect(notice).toMatchObject({
      message: "→ 툴을 부르지 않는 케이스 1 건은 띄우지 않았습니다: only-list",
    });
  });
});

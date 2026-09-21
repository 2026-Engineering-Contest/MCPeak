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
  const spawnEnvs: NodeJS.ProcessEnv[] = [];
  const registry = new RelaySessionRegistry({
    readSuite: () => Promise.resolve(SUITE),
    spawnRelay: (args, env) => {
      order.push(`relay:${args.join(" ")}`);
      spawnEnvs.push(env);
      return relay;
    },
    runAi: (spec) => {
      aiArgs.push(spec.args);
      order.push(`ai:${spec.tag}`);
      return (options.onAi?.(spec.tag) ?? Promise.resolve({ ok: true })).then((r) => r);
    },
  });
  return { relay, aiArgs, order, spawnEnvs, registry };
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

  it("후보 env 값이 중계기 자식 환경에 실제로 실린다", async () => {
    const { relay, spawnEnvs, registry } = harness();
    const started = registry.start(START, undefined, { API_KEY: "secret-value" });
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    await started;
    expect(spawnEnvs).toHaveLength(1);
    // 병합이지 덮어쓰기가 아니다: 후보 값과 기본 환경(PATH 등)이 같이 실려야 한다.
    expect(spawnEnvs[0]?.API_KEY).toBe("secret-value");
    expect(spawnEnvs[0]?.PATH).toBe(process.env.PATH);
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

  it("aiDone 의 case 는 꼬리표가 아니라 케이스 id 다", async () => {
    // 스위트의 케이스 id 는 a·b 이고 AI 에 실리는 꼬리표는 c1·c2 다(SUITE·buildRelayAiArgs).
    // 이 구분이 관찰 가능해야 `case: relayCase.tag` 로 바꿔치기해도 여기서 빨갛게 잡힌다.
    const { relay, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    await session.settled;
    const aiDoneCases = session.events
      .filter((event) => event.kind === "aiDone")
      .map((event) => (event as { readonly case: string }).case)
      .sort();
    expect(aiDoneCases).toEqual(["a", "b"]);
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

  it("레지스트리의 close 는 닫고 나서 등록을 지운다 — 누수·재-close 의미 둘 다를 고친다", async () => {
    const { relay, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);

    expect(registry.get(session.relayId)).toBe(session);
    const closed = await registry.close(session.relayId);
    expect(closed).toBe(true);
    // 지워졌으니 더는 조회되지 않는다 — accumulated 이벤트 배열도 여기서 놓는다.
    expect(registry.get(session.relayId)).toBeUndefined();
    // 이미 없는 것을 또 닫으면 false 다. 라우트가 이 값으로 404·204 를 가른다.
    expect(await registry.close(session.relayId)).toBe(false);
  });

  it("없는 relayId 를 닫으면 false 다", async () => {
    const { registry } = harness();
    expect(await registry.close("nope")).toBe(false);
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

  it("자식이 up 줄 전에 죽으면 15초 타임아웃을 기다리지 않고 바로 실패한다", {
    timeout: 3_000,
  }, async () => {
    const relay = new FakeRelay();
    const registry = new RelaySessionRegistry({
      readSuite: () => Promise.resolve(SUITE),
      spawnRelay: () => relay,
      runAi: () => Promise.resolve({ ok: true }),
    });
    const started = registry.start(START);
    relay.line("→ 중계기를 띄우지 못했습니다.");
    relay.line("→ spawn nosuchbinary ENOENT");
    // `close` 리스너는 `readSuite` 를 기다린 뒤에 붙는다 — 한 틱 기다렸다가 낸다
    // (`line()` 은 리스너가 없어도 버퍼링되지만 EventEmitter 의 `close` 는 아니다).
    await new Promise((resolve) => setTimeout(resolve, 0));
    relay.emit("close");
    const result = await started;
    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("실패했어야 합니다.");
    expect(result.error).toContain("중계기가 기동 줄을 내지 않았습니다");
    // 기존 세 줄은 그대로 남고 뒤에 관찰된 stderr 가 붙는다.
    expect(result.error).toContain("→ 중계기를 띄우지 못했습니다.");
    expect(result.error).toContain("→ spawn nosuchbinary ENOENT");
  });

  it("기동 실패 진단에 후보 env 값이 그대로 실리면 가린다", { timeout: 3_000 }, async () => {
    const relay = new FakeRelay();
    const registry = new RelaySessionRegistry({
      readSuite: () => Promise.resolve(SUITE),
      spawnRelay: () => relay,
      runAi: () => Promise.resolve({ ok: true }),
    });
    // 마스킹 최소 길이(`MIN_MASK_VALUE_LENGTH`) 이상인 값으로 골라야 이 테스트가 그 문턱에
    // 걸려 우연히 통과하는 일이 없다.
    const started = registry.start(START, undefined, { API_KEY: "secret-value-0123456789" });
    relay.line("→ 중계기를 띄우지 못했습니다.");
    relay.line("→ env API_KEY=secret-value-0123456789 로 접속을 시도했으나 실패했습니다.");
    await new Promise((resolve) => setTimeout(resolve, 0));
    relay.emit("close");
    const result = await started;
    if (!("error" in result)) throw new Error("실패했어야 합니다.");
    expect(result.error).toContain("중계기가 남긴 마지막 줄:");
    expect(result.error).not.toContain("secret-value-0123456789");
    expect(result.error).toContain("***");
  });

  it("candidateEnv 가 아니라 자식이 물려받은 나머지 환경의 값이 찍혀도 가린다", {
    timeout: 3_000,
  }, async () => {
    const relay = new FakeRelay();
    const registry = new RelaySessionRegistry({
      readSuite: () => Promise.resolve(SUITE),
      spawnRelay: () => relay,
      runAi: () => Promise.resolve({ ok: true }),
    });
    // process.env 를 실제로 건드리지 않고, 가짜 baseEnv 를 주입한다(4번째 인자). 값은
    // candidateEnv 의 "candidate-only-value" 와 겹치는 부분 문자열이 없어야
    // 한다 — 우연히 겹치면 candidateEnv 만 보는 낡은 구현도 통과해 버려서 이 테스트가
    // 아무것도 증명하지 못한다.
    const fakeBaseEnv = { ANTHROPIC_API_KEY: "zzz-unrelated-inherited-env-value-9988776655" };
    const started = registry.start(
      START,
      undefined,
      { API_KEY: "candidate-only-value" },
      fakeBaseEnv,
    );
    relay.line("→ 중계기를 띄우지 못했습니다.");
    relay.line(
      "→ env ANTHROPIC_API_KEY=zzz-unrelated-inherited-env-value-9988776655 로 접속을 시도했으나 실패했습니다.",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    relay.emit("close");
    const result = await started;
    if (!("error" in result)) throw new Error("실패했어야 합니다.");
    expect(result.error).toContain("중계기가 남긴 마지막 줄:");
    expect(result.error).not.toContain("zzz-unrelated-inherited-env-value-9988776655");
    expect(result.error).toContain("***");
  });

  it("짧은 env 값은 마스킹 대상이 아니라 무관한 글자가 온전히 남는다", {
    timeout: 3_000,
  }, async () => {
    const relay = new FakeRelay();
    const registry = new RelaySessionRegistry({
      readSuite: () => Promise.resolve(SUITE),
      spawnRelay: () => relay,
      runAi: () => Promise.resolve({ ok: true }),
    });
    // candidateEnv 를 통해 넣는다 — 그래야 마스킹 대상 구성이 candidateEnv 뿐이던 낡은
    // 구현에서도 이 값이 후보에 들어가, 길이 문턱이 없으면 실제로 과잉 마스킹이 재현된다.
    const started = registry.start(START, undefined, { PORT: "1" });
    relay.line("→ 중계기를 띄우지 못했습니다.");
    // 짧은 값 "1" 이 마스킹 대상이면 "127.0.0.1" 같은 무관한 문자열까지 "***" 로 잘린다.
    relay.line("→ connect ECONNREFUSED 127.0.0.1:5432 에 실패했습니다.");
    await new Promise((resolve) => setTimeout(resolve, 0));
    relay.emit("close");
    const result = await started;
    if (!("error" in result)) throw new Error("실패했어야 합니다.");
    expect(result.error).toContain("connect ECONNREFUSED 127.0.0.1:5432 에 실패했습니다.");
    expect(result.error).not.toContain("***");
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

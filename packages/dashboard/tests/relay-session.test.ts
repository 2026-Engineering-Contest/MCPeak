import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { RelayEvent } from "../src/api-types.js";
import type { RelaySession, Schedule } from "../src/server/relay-session.js";
import { RelaySessionRegistry } from "../src/server/relay-session.js";

const SUITE = JSON.stringify({
  cases: [
    { id: "a", operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } } },
    { id: "b", operation: { type: "callTool", tool: "add", input: { a: 1, b: 2 } } },
  ],
});

/** 케이스 `n` 개짜리 스위트. 상한(6) 을 넘겨 봐야 동시성을 잴 수 있다. */
const suiteOf = (count: number): string =>
  JSON.stringify({
    cases: Array.from({ length: count }, (_, index) => ({
      id: `case-${index + 1}`,
      operation: { type: "callTool", tool: "get_weather", input: { city: `city-${index + 1}` } },
    })),
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

/**
 * 신호를 받아도 **절대 `close` 를 내지 않는** 자식. SIGTERM 을 무시하는 MCP 서버를 물고
 * 있는 중계기가 이 모양이다 — 「닫혔다」를 타이머로 판정하던 구현이 조용히 틀리던 자리.
 */
class DeafRelay extends FakeRelay {
  override kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }
}

/**
 * 손으로 굴리는 시계. 테스트가 **실제로 기다리지 않게** 한다(결정론성, ADR-0072).
 * `advance` 가 그 시각까지의 타이머만 실행한다 — 콜백이 건 다음 타이머는 다음 `advance` 몫이다.
 */
function manualClock() {
  let current = 0;
  const pending: { readonly at: number; readonly run: () => void }[] = [];
  const schedule: Schedule = (ms, run) => {
    const entry = { at: current + ms, run };
    pending.push(entry);
    return () => {
      const index = pending.indexOf(entry);
      if (index >= 0) pending.splice(index, 1);
    };
  };
  return {
    schedule,
    now: () => current,
    advance(ms: number): void {
      current += ms;
      for (const entry of [...pending]) {
        if (entry.at > current) continue;
        const index = pending.indexOf(entry);
        if (index >= 0) pending.splice(index, 1);
        entry.run();
      }
    },
  };
}

/** 마이크로태스크 큐를 한 바퀴 비운다. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 손으로 푸는 약속. 태그마다 하나씩 쥐고 원하는 순간에 푼다. */
function aiGates() {
  const gates = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  let running = 0;
  let peak = 0;
  const onAi = (tag: string): Promise<{ ok: boolean }> => {
    running += 1;
    peak = Math.max(peak, running);
    return new Promise<{ ok: boolean }>((resolve, reject) => {
      gates.set(tag, {
        resolve: () => {
          running -= 1;
          resolve({ ok: true });
        },
        reject: (e: Error) => {
          running -= 1;
          reject(e);
        },
      });
    });
  };
  return {
    onAi,
    get peak() {
      return peak;
    },
    releaseAll: (): void => {
      for (const gate of [...gates.values()]) gate.resolve();
    },
    release: (tag: string): void => gates.get(tag)?.resolve(),
    reject: (tag: string, error: Error): void => gates.get(tag)?.reject(error),
    has: (tag: string): boolean => gates.has(tag),
  };
}

/** 기동 줄을 흘려 세션을 연다. 실패면 던진다. */
async function startSession(h: ReturnType<typeof harness>): Promise<RelaySession> {
  const started = h.registry.start(START);
  h.relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
  const session = await started;
  if ("error" in session) throw new Error(session.error);
  return session;
}

function harness(
  options: {
    readonly onAi?: (tag: string) => Promise<{ ok: boolean }>;
    /** 자식을 갈아 끼운다. 기본은 SIGTERM 에 얌전히 닫히는 `FakeRelay`. */
    readonly child?: FakeRelay;
    /** 스위트를 갈아 끼운다. 기본은 2 케이스짜리 `SUITE`. */
    readonly suite?: string;
    readonly clock?: ReturnType<typeof manualClock>;
  } = {},
) {
  const relay = options.child ?? new FakeRelay();
  const clock = options.clock ?? manualClock();
  const aiArgs: (readonly string[])[] = [];
  const aiSignals: (AbortSignal | undefined)[] = [];
  const order: string[] = [];
  const spawnEnvs: NodeJS.ProcessEnv[] = [];
  const registry = new RelaySessionRegistry({
    schedule: clock.schedule,
    now: clock.now,
    readSuite: () => Promise.resolve(options.suite ?? SUITE),
    spawnRelay: (args, env) => {
      order.push(`relay:${args.join(" ")}`);
      spawnEnvs.push(env);
      return relay;
    },
    runAi: (spec) => {
      aiArgs.push(spec.args);
      order.push(`ai:${spec.tag}`);
      aiSignals.push(spec.signal);
      return (options.onAi?.(spec.tag) ?? Promise.resolve({ ok: true })).then((r) => r);
    },
  });
  return { relay, aiArgs, aiSignals, order, spawnEnvs, registry, clock };
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
    // 닫힌 것을 **확인했다**는 뜻으로 true 다. 타이머가 이긴 것은 true 가 아니다.
    expect(await session.close()).toBe(true);
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
    expect(closed).toEqual({ kind: "closed" });
    // 지워졌으니 더는 조회되지 않는다 — accumulated 이벤트 배열도 여기서 놓는다.
    expect(registry.get(session.relayId)).toBeUndefined();
    // 이미 없는 것을 또 닫으면 notFound 다. 라우트가 이 값으로 404·204 를 가른다.
    expect(await registry.close(session.relayId)).toEqual({ kind: "notFound" });
  });

  it("없는 relayId 를 닫으면 notFound 다", async () => {
    const { registry } = harness();
    expect(await registry.close("nope")).toEqual({ kind: "notFound" });
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
    expect(result.error).toContain("중계기가 남긴 줄:");
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
    expect(result.error).toContain("중계기가 남긴 줄:");
    expect(result.error).not.toContain("zzz-unrelated-inherited-env-value-9988776655");
    expect(result.error).toContain("***");
  });

  it("줄이 많으면 첫 줄(원인)과 마지막 줄이 둘 다 남고 생략을 표시한다", {
    timeout: 3_000,
  }, async () => {
    const relay = new FakeRelay();
    const clock = manualClock();
    const registry = new RelaySessionRegistry({
      schedule: clock.schedule,
      now: clock.now,
      readSuite: () => Promise.resolve(SUITE),
      spawnRelay: () => relay,
      runAi: () => Promise.resolve({ ok: true }),
    });
    // 머리 줄에도 마스킹이 걸려야 한다 — 자식은 자기 환경을 처음에 되찍는 일이 흔하다.
    const started = registry.start(START, undefined, { API_KEY: "secret-value-0123456789" });
    relay.line("Error: Cannot find module '/x/dist/relay.mjs'"); // ← 이것이 원인이다
    relay.line("→ env API_KEY=secret-value-0123456789 로 띄웠습니다.");
    for (let i = 0; i < 12; i += 1) relay.line(`    at frame${i} (/x/node_modules/y.js:${i}:1)`);
    relay.line("    at lastFrame (/x/index.js:1:1)");
    await new Promise((resolve) => setTimeout(resolve, 0));
    relay.emit("close");
    const result = await started;
    if (!("error" in result)) throw new Error("실패했어야 합니다.");

    // 원인(첫 줄)이 살아 있어야 한다. 꼬리만 남기던 구현에서는 여기서 밀려 나갔다.
    expect(result.error).toContain("Error: Cannot find module '/x/dist/relay.mjs'");
    // 마지막 줄도 함께 남는다 — 어느 쪽에 원인이 있는지 미리 알 수 없다.
    expect(result.error).toContain("at lastFrame (/x/index.js:1:1)");
    // 생략은 보여야 한다. 조용히 자르면 남은 줄이 이어진 것처럼 읽힌다.
    expect(result.error).toMatch(/→ \(중간 \d+ 줄 생략\)/);
    // 머리 줄의 env 값도 가려진다.
    expect(result.error).not.toContain("secret-value-0123456789");
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

  it("기동 줄이 두 번 와도 up 이벤트는 하나다", async () => {
    // 발행자는 세션 생성 뒤의 `emit` 하나뿐이다. stderr 처리기에도 `emit` 이 있으면 첫
    // 줄에서는 세션이 없어 no-op 이고, 둘째 줄에서 중복 이벤트가 된다.
    const { relay, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    expect(session.events.filter((event) => event.kind === "up")).toHaveLength(1);
  });

  it("SIGTERM 에 안 닫히면 SIGKILL 로 올리고, 그래도 안 닫히면 닫기를 실패로 답한다", async () => {
    // 이 기능이 막으려던 상태가 조용히 나던 자리다 — 타이머로 풀고 「닫혔다」고 답하면
    // 살아 있는 중계기 위에서 판정 실행이 시작돼 같은 사용자 서버가 두 벌 뜬다.
    const { relay, registry, clock } = harness({ child: new DeafRelay() });
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);

    const closing = registry.close(session.relayId);
    await tick();
    expect(relay.signals).toEqual(["SIGTERM"]);

    // SIGTERM 유예가 지나면 승격한다.
    clock.advance(5_000);
    expect(relay.signals).toEqual(["SIGTERM", "SIGKILL"]);

    // SIGKILL 유예까지 지나도 close 가 없으면 **실패**다. 여기서 성공을 말하면 안 된다.
    clock.advance(2_000);
    const result = await closing;
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("실패했어야 합니다.");
    expect(result.error).toContain("중계기를 닫지 못했습니다");
    expect(result.error).toContain("판정 실행을 시작하지 않았습니다");

    // 못 닫은 세션은 **지우지 않는다.** 지우면 그 중계기의 유일한 핸들을 잃는다.
    expect(registry.get(session.relayId)).toBe(session);
  });

  it("닫기에 실패한 세션은 다음 DELETE 가 신호를 다시 보낸다", async () => {
    const { relay, registry, clock } = harness({ child: new DeafRelay() });
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);

    const first = registry.close(session.relayId);
    await tick();
    clock.advance(5_000);
    clock.advance(2_000);
    expect((await first).kind).toBe("failed");

    // 실패한 약속을 캐시해 두면 재시도가 아무것도 하지 않는다. 신호가 다시 가야 한다.
    const second = registry.close(session.relayId);
    await tick();
    expect(relay.signals).toEqual(["SIGTERM", "SIGKILL", "SIGTERM"]);
    clock.advance(5_000);
    clock.advance(2_000);
    expect((await second).kind).toBe("failed");
  });

  it("구독자 없이 오래 남은 세션은 수거된다 — 주입한 시계로 잰다", async () => {
    // 브라우저가 새로고침되면 아무도 이 세션을 DELETE 할 수 없다. 서버가 스스로 집는다.
    const { relay, registry, clock } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);

    // 아직 유휴 시간이 안 찼다. 실제로 기다리지 않고 시계만 민다.
    clock.advance(9 * 60_000);
    expect(await registry.reapIdle()).toEqual([]);
    expect(registry.get(session.relayId)).toBe(session);
    expect(relay.signals).toEqual([]);

    clock.advance(60_000);
    expect(await registry.reapIdle()).toEqual([session.relayId]);
    expect(relay.signals).toEqual(["SIGTERM"]);
    expect(registry.get(session.relayId)).toBeUndefined();
  });

  it("구독자가 붙어 있는 세션은 아무리 오래 돼도 수거하지 않는다", async () => {
    const { relay, registry, clock } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    const unsubscribe = session.subscribe(() => undefined);

    clock.advance(60 * 60_000);
    expect(await registry.reapIdle()).toEqual([]);
    expect(relay.signals).toEqual([]);

    // 구독이 끊긴 그 시각부터 다시 잰다. 끊자마자 수거되면 새로고침 중인 화면을 죽인다.
    unsubscribe();
    expect(await registry.reapIdle()).toEqual([]);
    clock.advance(10 * 60_000);
    expect(await registry.reapIdle()).toEqual([session.relayId]);
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
  it("동시에 뜨는 AI 가 상한 6 을 넘지 않는다", async () => {
    const gates = aiGates();
    const h = harness({ suite: suiteOf(12), onAi: gates.onAi });
    const session = await startSession(h);
    await tick();
    // 12 케이스인데 여섯 대만 떠 있어야 한다.
    expect(h.aiArgs.length).toBe(6);
    expect(gates.peak).toBe(6);
    for (let round = 0; round < 12; round += 1) {
      await tick();
      gates.releaseAll();
    }
    await session.settled;
    expect(gates.peak).toBe(6);
  });

  it("상한을 둬도 케이스가 하나도 빠지지 않고 done 은 한 번만 나간다", async () => {
    const gates = aiGates();
    const h = harness({ suite: suiteOf(12), onAi: gates.onAi });
    const session = await startSession(h);
    for (let round = 0; round < 12; round += 1) {
      await tick();
      gates.releaseAll();
    }
    await session.settled;
    expect(h.aiArgs.length).toBe(12);
    const aiDone = session.events.filter((event: RelayEvent) => event.kind === "aiDone");
    expect(aiDone.length).toBe(12);
    // `case` 는 꼬리표가 아니라 케이스 id 다.
    expect(aiDone.map((event) => (event as { case: string }).case).sort()).toEqual(
      Array.from({ length: 12 }, (_, index) => `case-${index + 1}`).sort(),
    );
    expect(session.events.filter((event: RelayEvent) => event.kind === "done").length).toBe(1);
  });

  it("runAi 하나가 reject 해도 나머지가 돌고 done 이 나간다", async () => {
    const gates = aiGates();
    const h = harness({ suite: suiteOf(12), onAi: gates.onAi });
    const session = await startSession(h);
    await tick();
    gates.reject("c1", new Error("boom"));
    for (let round = 0; round < 12; round += 1) {
      await tick();
      gates.releaseAll();
    }
    await session.settled;
    expect(h.aiArgs.length).toBe(12);
    const aiDone = session.events.filter((event: RelayEvent) => event.kind === "aiDone");
    expect(aiDone.length).toBe(12);
    expect(session.events.filter((event: RelayEvent) => event.kind === "done").length).toBe(1);
  });

  it("닫으면 대기열이 멈추고 진행 중인 AI 는 중단 신호를 받는다", async () => {
    const gates = aiGates();
    const h = harness({ suite: suiteOf(12), onAi: gates.onAi });
    const session = await startSession(h);
    await tick();
    expect(h.aiArgs.length).toBe(6);
    const closed = session.close();
    // 닫는 순간 진행 중이던 여섯 대에 중단이 서 있어야 한다.
    expect(h.aiSignals.filter((signal) => signal?.aborted === true).length).toBe(6);
    // 진행 중이던 것을 풀어도 일곱 번째가 새로 뜨지 않는다.
    gates.releaseAll();
    for (let round = 0; round < 12; round += 1) await tick();
    expect(h.aiArgs.length).toBe(6);
    expect(await closed).toBe(true);
    // 닫힌 뒤에도 done 과 settled 는 결국 풀린다 — 안 그러면 기다리는 쪽이 매달린다.
    await session.settled;
    expect(session.events.filter((event: RelayEvent) => event.kind === "done").length).toBe(1);
  });
});

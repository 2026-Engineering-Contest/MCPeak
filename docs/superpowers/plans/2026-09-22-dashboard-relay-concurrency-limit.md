# 중계 AI 동시 실행 상한 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4 단계 화면이 케이스마다 띄우는 `claude` 프로세스를 동시 6 대로 막고, 화면을 떠나면 대기열과 진행 중인 AI 를 함께 중단한다.

**Architecture:** 순수 모듈 `run-with-limit.ts` 에 일꾼 풀을 두고, `relay-session.ts` 의 `Promise.all` 을 그것으로 바꾼다. `RelaySession` 이 `AbortController` 를 소유해 `close()` 가 대기열 중단과 진행 중 AI 중단을 동시에 건다. `runProviderProcess` 는 `spec.signal` 을 이미 받으므로 `generate` 는 건드리지 않는다.

**Tech Stack:** TypeScript (ESM, `.js` 확장자 import), vitest, pnpm workspace + turbo, biome.

설계 원문: `docs/superpowers/specs/2026-09-22-dashboard-relay-concurrency-limit-design.md`

## Global Constraints

- **패키지는 `dashboard` 하나만 건드린다.** `generate` · `mock` · `core` 등 다른 오너의 패키지를 수정하지 마라(`CLAUDE.md`). 필요해 보이면 멈추고 사용자에게 알려라.
- **의존성을 추가하지 마라.** 동시성 라이브러리(p-limit 등)를 넣지 않는다. 표준 Promise 로 짠다.
- **`core/src/types.ts` 의 `McpClient` · `ToolResult` 를 바꾸지 마라.**
- import 는 확장자 `.js` 를 붙인다(ESM). 예: `import { runWithLimit } from "./run-with-limit.js";`
- 실패 메시지는 무엇이 왜 다른지 · 어떻게 고치는지가 보여야 한다(`CLAUDE.md`).
- 타임스탬프 · 랜덤 · 실행 순서에 의존하는 코드를 넣지 마라. **테스트가 실제로 기다리게 하지 마라** — 수동으로 푸는 deferred 로 순서를 통제한다.
- 상한 상수 값은 **6**, 이름은 `RELAY_AI_CONCURRENCY`, 코어 수에서 유도하지 않는다.
- 커밋 scope 는 `dashboard`(ADR 커밋만 `adr`). Conventional Commits, scope 필수.
- 커밋할 때 `git add -A` 를 쓰지 마라. 경로를 하나씩 지정한다. **`packages/mock/tests/stdio-e2e.test.ts` 는 사용자의 미커밋 파일이니 절대 커밋 범위에 넣지 마라.**
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` 를 넣는다.
- push · merge · rebase 는 하지 마라. 사람이 한다.
- 종료 코드는 파이프 없이 읽는다. `pnpm vitest run ... ; echo $?` (`| head` 뒤에서 `$?` 를 읽으면 `head` 의 값이다).

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `packages/dashboard/src/server/run-with-limit.ts` | 상한 있는 일꾼 풀. 순수 함수 하나. 프로세스 · 시계 · 도메인 지식 없음 | 새로 만듦 |
| `packages/dashboard/tests/run-with-limit.test.ts` | 위 모듈의 동시성 계약 4 건 | 새로 만듦 |
| `packages/dashboard/src/server/relay-session.ts` | 중계기 · AI 수명. 상한 상수, `AbortController` 소유, `runWithLimit` 사용 | 수정 |
| `packages/dashboard/tests/relay-session.test.ts` | 세션 수준 회귀 4 건 + 12 케이스 스위트 하네스 | 수정 |
| `docs/adr/0106-*.md` | 고정 상한과 실행 중 중단을 고른 이유 | 새로 만듦 |
| `.changeset/*.md` | dashboard patch | 새로 만듦 |

---

### Task 1: 상한 있는 일꾼 풀 (`runWithLimit`)

프로세스도 시계도 없는 순수 모듈이다. 이 태스크만으로 동시성 규칙이 전부 검증된다.

**Files:**
- Create: `packages/dashboard/src/server/run-with-limit.ts`
- Test: `packages/dashboard/tests/run-with-limit.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `export async function runWithLimit<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void>` — Task 2 가 이것을 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/dashboard/tests/run-with-limit.test.ts` 를 새로 만든다:

```ts
import { describe, expect, it } from "vitest";
import { runWithLimit } from "../src/server/run-with-limit.js";

/**
 * 손으로 푸는 약속. 테스트가 **실제로 기다리지 않게** 진행 순서를 직접 통제한다
 * (결정론성, ADR-0072). `relay-session.test.ts` 의 `manualClock` 과 같은 계열이다.
 */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve: () => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 마이크로태스크 큐를 한 바퀴 비운다. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 항목마다 손으로 푸는 약속을 주는 일꾼. 진행 중 최대치를 기록한다. */
function tracker() {
  const gates = new Map<number, ReturnType<typeof deferred>>();
  const started: number[] = [];
  let running = 0;
  let peak = 0;
  const worker = (item: number): Promise<void> => {
    started.push(item);
    running += 1;
    peak = Math.max(peak, running);
    const gate = deferred();
    gates.set(item, gate);
    return gate.promise.finally(() => {
      running -= 1;
    });
  };
  return {
    worker,
    started,
    get peak() {
      return peak;
    },
    release: (item: number): void => gates.get(item)?.resolve(),
    fail: (item: number, error: Error): void => gates.get(item)?.reject(error),
  };
}

const items = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);

describe("runWithLimit", () => {
  it("동시에 도는 일꾼이 상한을 넘지 않는다", async () => {
    const t = tracker();
    const done = runWithLimit(items(12), 6, t.worker);
    await tick();
    expect(t.started.length).toBe(6);
    expect(t.peak).toBe(6);
    // 하나를 풀면 정확히 하나가 새로 들어온다.
    t.release(1);
    await tick();
    expect(t.started.length).toBe(7);
    expect(t.peak).toBe(6);
    for (const item of items(12)) t.release(item);
    await done;
    expect(t.peak).toBe(6);
  });

  it("항목을 하나도 빠뜨리지 않는다", async () => {
    const t = tracker();
    const done = runWithLimit(items(12), 6, t.worker);
    for (let round = 0; round < 12; round += 1) {
      await tick();
      for (const item of items(12)) t.release(item);
    }
    await done;
    expect([...t.started].sort((a, b) => a - b)).toEqual(items(12));
  });

  it("일꾼이 던져도 나머지가 돌고 resolve 한다", async () => {
    const t = tracker();
    const done = runWithLimit(items(12), 6, t.worker);
    await tick();
    t.fail(1, new Error("boom"));
    for (let round = 0; round < 12; round += 1) {
      await tick();
      for (const item of items(12)) t.release(item);
    }
    await expect(done).resolves.toBeUndefined();
    expect(t.started.length).toBe(12);
  });

  it("중단하면 새 항목을 집지 않고, 진행 중이던 것이 끝나면 resolve 한다", async () => {
    const t = tracker();
    const controller = new AbortController();
    const done = runWithLimit(items(12), 6, t.worker, controller.signal);
    await tick();
    expect(t.started.length).toBe(6);
    controller.abort();
    // 진행 중이던 6 개를 풀어도 7번째가 들어오지 않는다.
    for (const item of items(6)) t.release(item);
    await done;
    expect(t.started.length).toBe(6);
  });
});
```

- [ ] **Step 2: 빨간 것을 확인한다**

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm vitest run packages/dashboard/tests/run-with-limit.test.ts ; echo "exit=$?"
```

기대: `Failed to resolve import "../src/server/run-with-limit.js"` 로 4 건 모두 실패, `exit=1`.

- [ ] **Step 3: 최소 구현을 쓴다**

`packages/dashboard/src/server/run-with-limit.ts` 를 새로 만든다:

```ts
/**
 * 항목을 일꾼 `limit` 명이 앞에서부터 하나씩 집어가며 처리한다. 계약 넷:
 *
 * - 동시에 진행 중인 `worker` 는 절대 `limit` 을 넘지 않는다.
 * - `worker` 가 던져도 풀은 멈추지 않고 남은 항목을 마저 돈다. **실패를 판단하지도, 모아
 *   두지도 않는다** — 보고는 `worker` 안의 몫이다. 삼킴이 숨는 것을 걱정하지 않아도 되는
 *   이유는, 이 자리의 소비자가 항목마다 자기 실패를 따로 알리기 때문이다.
 * - `signal?.aborted` 면 **새 항목을 집지 않는다.** 이미 진행 중인 것은 기다린다.
 * - 전부 끝나면(중단된 경우 진행 중이던 것이 끝나면) resolve 한다. **절대 reject 하지 않는다.**
 *
 * 프로세스도 시계도 쓰지 않는다. 동시성 규칙을 단독으로 돌려볼 수 있는 것이 이 모듈을
 * 따로 둔 이유다.
 */
export async function runWithLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  const pull = async (): Promise<void> => {
    while (next < items.length) {
      if (signal?.aborted === true) return;
      const item = items[next] as T;
      next += 1;
      try {
        await worker(item);
      } catch {
        // 한 항목의 실패로 풀을 멈추지 않는다. 보고는 worker 안에서 한다.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => pull()));
}
```

- [ ] **Step 4: 초록인지 확인한다**

```bash
pnpm vitest run packages/dashboard/tests/run-with-limit.test.ts ; echo "exit=$?"
```

기대: `Test Files  1 passed`, `Tests  4 passed`, `exit=0`.

- [ ] **Step 5: 상한을 빼고 돌려 빨간 것을 본다 (회귀 증명)**

`run-with-limit.ts` 의 `Math.min(limit, items.length)` 를 `items.length` 로 잠깐 바꾸고 다시 돌린다.

```bash
pnpm vitest run packages/dashboard/tests/run-with-limit.test.ts ; echo "exit=$?"
```

기대: 「동시에 도는 일꾼이 상한을 넘지 않는다」가 **실패**(`expected 12 to be 6`). `exit=1`.
확인했으면 `Math.min(limit, items.length)` 로 **되돌린다**. 되돌린 뒤 Step 4 를 다시 돌려 초록을 본다.

- [ ] **Step 6: 커밋**

```bash
cd /Users/cheonjamin/projects/mcptest
git add packages/dashboard/src/server/run-with-limit.ts packages/dashboard/tests/run-with-limit.test.ts
git commit -F - <<'EOF'
feat(dashboard): 상한 있는 일꾼 풀 runWithLimit 을 더한다

일꾼 limit 명이 목록을 하나씩 집어간다. 일꾼이 던져도 풀이 멈추지 않고,
AbortSignal 이 서면 새 항목을 집지 않되 진행 중인 것은 기다린 뒤 resolve 한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: 중계 세션에 상한과 중단을 붙인다

**Files:**
- Modify: `packages/dashboard/src/server/relay-session.ts`
- Test: `packages/dashboard/tests/relay-session.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `runWithLimit(items, limit, worker, signal?)`.
- Produces: `RelayAiSpec` 에 `readonly signal?: AbortSignal` 필드. `RelaySession` 에 `readonly aiSignal: AbortSignal` 접근자. 상수 `RELAY_AI_CONCURRENCY = 6`(모듈 내부, export 하지 않는다).

참고 — 이 파일의 현재 모양:
- `RelayAiSpec` 은 `{ tag, args, stdin }` (relay-session.ts 상단 근처).
- `RelaySessionDeps.runAi` 는 `(spec: RelayAiSpec) => Promise<{ ok: boolean; failure?: string }>`.
- `RelaySession.close()` 는 `this.closing ??= (...)` 로 시작하는 멱등 메서드.
- `start()` 끝의 `void Promise.all(plan.cases.map(async (relayCase) => {...})).then(...)` 가 바꿀 자리.
- `RelayCase` 는 `{ id, tag, tool, input }`, `plan.prompts` 는 **tag** 로 키가 잡혀 있다.
- `aiDone` 이벤트의 `case` 는 케이스 **id** 다(`relayCase.id`, 꼬리표가 아니다).

- [ ] **Step 1: 하네스에 스위트 주입구를 연다**

`packages/dashboard/tests/relay-session.test.ts` 의 `harness` 는 지금 2 케이스짜리 `SUITE` 로 고정돼 있다. 12 케이스가 필요하다.

`SUITE` 정의 바로 아래에 더한다:

```ts
/** 케이스 `n` 개짜리 스위트. 상한(6) 을 넘겨 봐야 동시성을 잴 수 있다. */
const suiteOf = (count: number): string =>
  JSON.stringify({
    cases: Array.from({ length: count }, (_, index) => ({
      id: `case-${index + 1}`,
      operation: { type: "callTool", tool: "get_weather", input: { city: `city-${index + 1}` } },
    })),
  });
```

`harness` 의 options 타입에 한 줄 더한다:

```ts
    /** 스위트를 갈아 끼운다. 기본은 2 케이스짜리 `SUITE`. */
    readonly suite?: string;
```

그리고 `harness` 안의 `readSuite` 를 바꾼다:

```ts
    readSuite: () => Promise.resolve(options.suite ?? SUITE),
```

또 `harness` 의 `runAi` 가 `spec.signal` 을 기록하도록 바꾼다(테스트 4 가 본다). `aiArgs` 선언 근처에 더하고:

```ts
  const aiSignals: (AbortSignal | undefined)[] = [];
```

`runAi` 안 `order.push(...)` 다음 줄에 더한 뒤:

```ts
      aiSignals.push(spec.signal);
```

`harness` 의 반환에 `aiSignals` 를 끼운다:

```ts
  return { relay, aiArgs, aiSignals, order, spawnEnvs, registry, clock };
```

- [ ] **Step 2: 회귀 테스트 4 건을 쓴다**

같은 파일의 `describe("중계 세션", ...)` 블록 **맨 끝**에 붙인다. 하네스의 `onAi` 는 `tag` 를 받고 약속을 돌려주므로, 손으로 푸는 약속으로 진행을 통제한다.

파일 상단(`tick` 정의 아래)에 도우미를 더한다:

```ts
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

/**
 * 기동 줄을 흘려 세션을 연다. 실패면 던진다.
 *
 * `RelaySession` 타입이 필요하므로 파일 상단 import 를 이렇게 고친다:
 * `import { RelaySession, RelaySessionRegistry } from "../src/server/relay-session.js";`
 * (`Schedule` 은 지금처럼 `import type` 으로 둔다.)
 */
async function startSession(h: ReturnType<typeof harness>): Promise<RelaySession> {
  const started = h.registry.start(START);
  h.relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
  const session = await started;
  if ("error" in session) throw new Error(session.error);
  return session;
}
```

테스트 본문:

```ts
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
```

- [ ] **Step 3: 빨간 것을 확인한다**

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm vitest run packages/dashboard/tests/relay-session.test.ts ; echo "exit=$?"
```

기대: 새 4 건이 실패한다. 각각 이렇게 실패해야 맞다 —
- 상한: `expected 12 to be 6` (전부 동시에 떠서)
- 케이스 누락 없음: **통과할 수도 있다**(지금도 전부 돈다). 통과해도 그대로 둔다 — 상한을 넣은 뒤에도 지켜지는지가 이 테스트의 값이다.
- reject: `session.settled` 가 안 풀려 타임아웃, 또는 `done` 이 0 건
- 닫기: `expected 0 to be 6` (signal 을 아무도 안 받아서)

`exit=1` 이어야 한다. **통과한 것이 있으면 그 테스트가 무엇을 재는지 다시 본다.**

- [ ] **Step 4: 구현 — 상수와 signal 배관**

`packages/dashboard/src/server/relay-session.ts` 의 `RELAY_IDLE_REAP_MS` 상수 아래에 더한다:

```ts
/**
 * 동시에 띄우는 AI 수의 상한.
 *
 * 케이스마다 `claude` 를 한 대씩 띄우는데, 82 케이스 스위트를 켜자 82 대가 한꺼번에 떠
 * 12 코어 머신의 부하 평균이 73 까지 올라갔다(개당 약 0.9). 6 을 골라 개발 머신에서 체감
 * 대기를 줄이되 부하는 코어 수 안쪽에 둔다.
 *
 * **코어 수에서 유도하지 않는다.** 머신마다 값이 달라지면 같은 조작의 부하·타이밍 진단이
 * 재현되지 않는다(결정론성, ADR-0106). 고정 상수로 두고, 바꿀 때는 이 주석도 같이 고친다.
 */
const RELAY_AI_CONCURRENCY = 6;
```

파일 상단 import 에 더한다:

```ts
import { runWithLimit } from "./run-with-limit.js";
```

`RelayAiSpec` 에 필드를 더한다:

```ts
export interface RelayAiSpec {
  readonly tag: string;
  readonly args: readonly string[];
  readonly stdin: string;
  /** 세션이 닫히면 서는 중단 신호. 진행 중인 `claude` 를 정리한다. */
  readonly signal?: AbortSignal;
}
```

`systemDeps.runAi` 에서 넘긴다 — `maxOutputBytes: AI_MAX_OUTPUT_BYTES,` 다음 줄에:

```ts
      ...(spec.signal === undefined ? {} : { signal: spec.signal }),
```

- [ ] **Step 5: 구현 — `RelaySession` 이 중단을 소유한다**

`RelaySession` 클래스의 `private subscribers = 0;` 근처에 필드를 더한다:

```ts
  /**
   * AI 쪽 중단 신호. `close()` 가 세운다 — 대기열이 새 `claude` 를 뱉는 것을 막고, 이미
   * 떠 있는 것은 `runProviderProcess` 가 SIGTERM → SIGKILL 로 정리한다.
   */
  private readonly aiAbort = new AbortController();
```

접근자를 `get events()` 아래에 더한다:

```ts
  get aiSignal(): AbortSignal {
    return this.aiAbort.signal;
  }
```

`close()` 의 **첫 줄**에 중단을 세운다. `this.closing ??=` 보다 **앞**이어야 한다 — 멱등 캐시에 들어가면 두 번째 호출에서 안 서고, 중계기를 먼저 닫으면 그 사이에 대기열이 새 프로세스를 뱉는다:

```ts
  close(): Promise<boolean> {
    // 중계기에 신호를 보내기 **전에** 대기열을 세운다. 순서가 반대면 중계기가 닫히는
    // 사이에 대기열이 새 `claude` 를 뱉는다.
    this.aiAbort.abort();
    this.closing ??= (
```

- [ ] **Step 6: 구현 — `Promise.all` 을 풀로 바꾼다**

`start()` 끝의 블록을 통째로 바꾼다. 바꾸기 전 모양(`// **동시에 띄운다**(설계 §2-3)...` 주석부터 `.then(() => { ... settleAll(); });` 까지)을 다음으로 교체한다:

```ts
    const current = session;
    // 동시에 뜨는 수를 `RELAY_AI_CONCURRENCY` 로 막는다. 상한이 없을 때 82 케이스가 82 대를
    // 한꺼번에 띄운 것이 이 자리의 결함이었다.
    void runWithLimit(
      plan.cases,
      RELAY_AI_CONCURRENCY,
      async (relayCase) => {
        let result: { readonly ok: boolean; readonly failure?: string };
        try {
          result = await deps.runAi({
            tag: relayCase.tag,
            args: buildRelayAiArgs({ model: request.model, url, tag: relayCase.tag }),
            stdin: plan.prompts[relayCase.tag] ?? "",
            signal: current.aiSignal,
          });
        } catch {
          // `runAi` 가 reject 해도 이 케이스만 실패로 답한다. 여기서 새면 `done` 이 영영
          // 안 나가고 화면이 끝나지 않는다.
          result = { ok: false, failure: "internal" };
        }
        current.emit({
          kind: "aiDone",
          case: relayCase.id,
          ok: result.ok,
          ...(result.failure === undefined ? {} : { failure: result.failure }),
        });
      },
      current.aiSignal,
    ).then(() => {
      current.emit({ kind: "done" });
      settleAll();
    });
```

- [ ] **Step 7: 초록인지 확인한다**

```bash
pnpm vitest run packages/dashboard ; echo "exit=$?"
```

기대: `Test Files ... passed` 줄이 보이고 기존 196 건 + 새 8 건이 전부 통과, `exit=0`.
**초록만 보고 넘기지 마라** — 출력에 `Test Files`/`Tests` 줄과 건수가 실제로 찍혔는지 눈으로 본다.

- [ ] **Step 8: 수정을 빼고 돌려 빨간 것을 본다 (회귀 증명 3 건)**

하나씩 되돌리고 돌린 뒤 **그 테스트가** 실패하는지 본다. 매번 즉시 복구한다.

1. 상한: `RELAY_AI_CONCURRENCY` 를 `plan.cases.length` 로 바꿔 돌린다 → 「동시에 뜨는 AI 가 상한 6 을 넘지 않는다」가 실패해야 한다. 복구.
2. reject 내성: Step 6 의 `try`/`catch` 를 빼고 `result = await deps.runAi({...})` 만 남겨 돌린다 → 「runAi 하나가 reject 해도…」가 실패해야 한다. 복구.
3. 닫기: `close()` 첫 줄의 `this.aiAbort.abort();` 를 지우고 돌린다 → 「닫으면 대기열이 멈추고…」가 실패해야 한다. 복구.

매번:

```bash
pnpm vitest run packages/dashboard/tests/relay-session.test.ts ; echo "exit=$?"
```

셋 다 확인하고 복구한 뒤 Step 7 을 다시 돌려 초록을 본다.

- [ ] **Step 9: 타입체크 · 린트**

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm typecheck ; echo "exit=$?"
npx biome check . ; echo "exit=$?"
```

기대: 둘 다 `exit=0`. **검사한 파일 수가 출력에 찍히는지 본다** — 새 파일이 검사 대상에서 빠지면 초록이 거짓 신호다(`CLAUDE.local.md` §2).

- [ ] **Step 10: 커밋**

```bash
cd /Users/cheonjamin/projects/mcptest
git add packages/dashboard/src/server/relay-session.ts packages/dashboard/tests/relay-session.test.ts
git commit -F - <<'EOF'
fix(dashboard): 중계 AI 를 동시 6 대로 막고 닫을 때 함께 중단한다

82 케이스 스위트가 claude 82 대를 한꺼번에 띄워 12 코어 머신 부하가 73 까지
올라갔다. runWithLimit 으로 동시 실행을 6 으로 막고, close() 가 대기열과
진행 중인 AI 를 함께 중단한다. Promise.all 이 reject 하나에 done 을 영영
안 내보내던 결함도 케이스별 catch 로 막는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: 실제 프로세스로 확인하고 ADR · changeset 을 남긴다

**Files:**
- Create: `docs/adr/0106-중계-AI-는-고정-상한으로-띄우고-닫을-때-함께-중단한다.md`
- Create: `.changeset/dashboard-relay-ai-concurrency.md`

**Interfaces:**
- Consumes: Task 2 의 `RELAY_AI_CONCURRENCY` 와 `close()` 중단 동작.
- Produces: 없음 (마지막 태스크)

- [ ] **Step 1: 빌드하고 E2E 를 돌린다**

`test:e2e` 는 **빌드 뒤에만** 의미가 있다(`relayBinPath()` 가 `packages/mock/dist/relay.mjs` 를 띄운다). `corepack pnpm` 이 아니라 `pnpm` 이다 — corepack 아래서는 turbo 하위 빌드가 `ERR_PNPM_BAD_PM_VERSION` 으로 터진다.

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm build ; echo "exit=$?"
pnpm --filter @mcpeak/dashboard test:e2e ; echo "exit=$?"
```

기대: 둘 다 `exit=0`, E2E 는 2 건 통과.

빌드했는데도 옛 동작이 보이면 **turbo 캐시가 낡은 dist 를 복원한 것**이다. 확인:

```bash
grep -c "RELAY_AI_CONCURRENCY\|runWithLimit" packages/dashboard/dist/*.mjs ; echo "exit=$?"
```

0 건이면 그 패키지에서 `npx tsdown --config-loader native` 로 직접 빌드한다. (`grep -c` 는 0 건일 때 exit 1 이다 — 건수는 stdout, 종료 코드는 `$?` 다. 둘을 섞지 마라.)

- [ ] **Step 2: 사용자에게 손으로 확인할 절차를 안내하고 멈춘다**

제품 실행은 사람이 한다. 다음을 그대로 전한다:

```bash
cd /Users/cheonjamin/projects/mcptest
node packages/dashboard/dist/dashboard-cli.mjs --port 7357
```

저장소 루트에서 띄워야 `examples/` 가 보인다. 1 단계 `weather` → 2 단계
`examples/live-weather-server/server.suite.json`(82 케이스) → 3 단계 체크박스 → 다음.

볼 것:
- 다른 터미널에서 `ps aux | grep -c "[c]laude"` 가 **6 을 안 넘는지**
- `uptime` 의 부하 평균이 코어 수 안쪽인지(전에는 73 이었다)
- 「이전」·「실행 시작」·화면 이탈 직후 `ps aux | grep "[c]laude"` 가 **비는지**
- 82 개 칸이 결국 다 채워지는지(2~5 분)

- [ ] **Step 3: ADR 을 쓴다**

`docs/adr/0106-중계-AI-는-고정-상한으로-띄우고-닫을-때-함께-중단한다.md`:

```markdown
# ADR-0106: 중계 AI 는 고정 상한으로 띄우고, 닫을 때 진행 중인 것까지 중단한다

## 배경

4 단계 「실제 응답」 화면은 스위트 케이스마다 `claude` 를 한 대씩 띄운다. 초기 구현은
`Promise.all(plan.cases.map(...))` 로 전부 동시에 띄웠고 상한이 없었다. 82 케이스짜리
스위트(`examples/live-weather-server`)를 켜자 82 대가 한꺼번에 떠 12 코어 머신의 부하
평균이 73 까지 올라갔다(정상 3~4). 개발 중 쓰던 예제는 8 케이스, E2E 는 2 케이스라
계획서·설계·리뷰 8 회가 전부 놓쳤다.

## 선택지

1. 고정 상수로 동시 실행 수를 막는다.
2. 상한 + UI 로 건수·비용을 고지하고 케이스를 고르게 한다.
3. 상한을 코어 수에서 유도한다(`os.cpus().length` 기반).

중단 범위도 갈렸다: 대기열만 멈출지, 이미 떠 있는 AI 까지 죽일지.

## 결정

**1 번 + 진행 중인 AI 까지 중단.** 상한은 `RELAY_AI_CONCURRENCY = 6` 고정 상수이고,
`RelaySession` 이 `AbortController` 를 소유해 `close()` 가 대기열과 진행 중인 `claude` 를
함께 세운다.

## 이유

- **코어 수에서 유도하지 않는 이유는 재현성이다.** 머신마다 값이 달라지면 같은 조작의
  부하·타이밍 진단이 재현되지 않는다. 결정론성을 값으로 두는 저장소에서 스스로 재현성을
  깎는 선택이다. 값 6 은 실측(개당 부하 약 0.9)에서 골랐고 근거를 상수 주석에 적었다.
- **UI 고지·케이스 선택을 지금 넣지 않는 이유는 범위다.** 비용 문제는 실재하지만 화면과
  상호작용 설계가 따로 필요하고, 부하 결함은 지금 사용자를 막고 있다. 별건으로 남긴다.
- **진행 중인 AI 까지 중단하는 이유는 상한이 새로 연 위험 때문이다.** 상한을 두면 대기열이
  생기고, 세션이 닫힌 뒤에도 대기열이 프로세스를 계속 뱉는 길이 열린다. 대기열만 멈추면
  이탈 뒤에도 최대 6 건의 유료 호출이 끝까지 돈다. `runProviderProcess` 가 이미
  `spec.signal` 을 받아 SIGTERM → SIGKILL 로 정리하므로 배관이 깔끔히 붙었다.

## 결과

- 동시 `claude` 프로세스가 6 을 넘지 않는다. 82 케이스는 14 배치, 2.3~4.6 분.
- 화면을 떠나면 살아남는 AI 프로세스가 0 이다.
- `runAi` 가 reject 해도 `done` 이 나간다 — `Promise.all` 이 하나의 reject 로 `.then` 을
  건너뛰어 화면이 영영 안 끝나던 결함을 케이스별 `catch` 로 막았다.
- **비용은 그대로다.** 82 케이스면 여전히 유료 호출 82 건이 클릭 한 번에 나간다. 건수 고지와
  케이스 선택은 별건으로 남는다.
- 중단돼서 한 번도 안 돈 케이스에는 `aiDone` 이 나가지 않아 그 칸은 「기다리는 중」에 남는다.
  중단은 사용자가 화면을 떠난 경우뿐이라 볼 사람이 없다고 보고 받아들였다.
```

- [ ] **Step 4: changeset 을 쓴다**

`.changeset/dashboard-relay-ai-concurrency.md`:

```markdown
---
"@mcpeak/dashboard": patch
---

4 단계 실제 응답 화면이 띄우는 AI 를 동시 6 대로 막는다. 케이스가 많은 스위트에서 케이스
수만큼의 `claude` 프로세스가 한꺼번에 떠 머신 부하가 치솟던 문제를 고친다. 화면을 떠나면
대기열과 진행 중인 AI 가 함께 멈추고, AI 실행 하나가 실패해도 화면이 끝까지 진행된다.
```

패키지 이름이 `@mcpeak/dashboard` 가 맞는지 먼저 확인한다:

```bash
grep '"name"' packages/dashboard/package.json
```

다르면 그 이름으로 고친다.

- [ ] **Step 5: 커밋**

```bash
cd /Users/cheonjamin/projects/mcptest
git add docs/adr/0106-중계-AI-는-고정-상한으로-띄우고-닫을-때-함께-중단한다.md
git commit -F - <<'EOF'
docs(adr): ADR-0106 중계 AI 고정 상한과 닫을 때의 중단

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
git add .changeset/dashboard-relay-ai-concurrency.md
git commit -F - <<'EOF'
chore(release): 중계 AI 동시 실행 상한에 changeset 을 넣는다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: 커밋 범위에 남의 파일이 안 섞였는지 본다**

```bash
git log --name-only --oneline -5
git status --short
```

기대: 커밋 목록에 `packages/dashboard/**`, `docs/adr/0106-*`, `.changeset/*` 만 보인다.
`git status` 에는 `packages/mock/tests/stdio-e2e.test.ts` 가 **미커밋으로 그대로 남아 있어야** 한다 — 사용자 것이다.

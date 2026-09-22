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
    // 한 번만 풀면 안 된다 — 지금 gate 를 쥔 것은 1~7 뿐이고, 8~12 는 이 해제 뒤
    // 마이크로태스크에서 일꾼이 집으면서 gate 가 새로 생긴다. 라운드로 돌아야 한다.
    for (let round = 0; round < 12; round += 1) {
      await tick();
      for (const item of items(12)) t.release(item);
    }
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

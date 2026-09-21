import { describe, expect, it } from "vitest";
import { installUnloadClose } from "../src/relay/unload-close.js";

/** `window` 자리에 세울 가짜. 등록된 리스너를 손으로 발화한다. */
function fakeTarget() {
  const listeners = new Set<() => void>();
  return {
    addEventListener(_type: "pagehide", listener: () => void): void {
      listeners.add(listener);
    },
    removeEventListener(_type: "pagehide", listener: () => void): void {
      listeners.delete(listener);
    },
    count: () => listeners.size,
    pagehide(): void {
      for (const listener of [...listeners]) listener();
    },
  };
}

interface Sent {
  readonly path: string;
  readonly init: RequestInit;
}

function fakeFetch(sent: Sent[], fail = false) {
  return (path: string, init: RequestInit): Promise<unknown> => {
    sent.push({ path, init });
    return fail ? Promise.reject(new Error("사라지는 중")) : Promise.resolve(undefined);
  };
}

describe("화면 이탈 시 중계기 닫기", () => {
  it("pagehide 에서 그 중계기로 DELETE 를 보낸다", () => {
    // 새로고침은 언마운트 정리를 돌리지 않는다. 여기서 안 보내면 그 세션은 영영 못 닫는다.
    const target = fakeTarget();
    const sent: Sent[] = [];
    installUnloadClose(target, () => "relay 1/2", fakeFetch(sent));

    target.pagehide();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe("/api/relay/relay%201%2F2");
    expect(sent[0]?.init.method).toBe("DELETE");
    // `keepalive` 가 없으면 문서가 사라지는 순간 요청이 취소된다 — 보냈는데 안 닿는다.
    expect(sent[0]?.init.keepalive).toBe(true);
  });

  it("들고 있는 중계기가 없으면 아무것도 보내지 않는다", () => {
    const target = fakeTarget();
    const sent: Sent[] = [];
    installUnloadClose(target, () => null, fakeFetch(sent));
    target.pagehide();
    expect(sent).toEqual([]);
  });

  it("등록 뒤에 뜬 중계기도 닫는다", () => {
    // id 를 값으로 받으면 등록 시점에 묶여, 4 단계에 들어서며 뜬 중계기를 놓친다.
    const target = fakeTarget();
    const sent: Sent[] = [];
    let relayId: string | null = null;
    installUnloadClose(target, () => relayId, fakeFetch(sent));
    relayId = "later";
    target.pagehide();
    expect(sent.map((one) => one.path)).toEqual(["/api/relay/later"]);
  });

  it("해제하면 더는 보내지 않는다", () => {
    // 리스너가 쌓이면 한 번 떠날 때 DELETE 가 여러 번 나간다.
    const target = fakeTarget();
    const sent: Sent[] = [];
    const release = installUnloadClose(target, () => "r1", fakeFetch(sent));
    release();
    expect(target.count()).toBe(0);
    target.pagehide();
    expect(sent).toEqual([]);
  });

  it("보내기가 실패해도 던지지 않는다", async () => {
    // 문서가 사라지는 중이라 보여 줄 화면이 없다. 미처리 rejection 을 남기면 안 된다.
    const target = fakeTarget();
    const sent: Sent[] = [];
    installUnloadClose(target, () => "r1", fakeFetch(sent, true));
    expect(() => target.pagehide()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toHaveLength(1);
  });
});

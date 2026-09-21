import { describe, expect, it } from "vitest";
import { runAfterClose } from "../src/relay/close-first.js";

describe("닫기 먼저", () => {
  it("닫기가 끝난 뒤에 다음 동작을 시작한다", async () => {
    const order: string[] = [];
    await runAfterClose(
      () =>
        new Promise<void>((resolve) => {
          order.push("close:start");
          setTimeout(() => {
            order.push("close:end");
            resolve();
          }, 5);
        }),
      () => {
        order.push("start");
        return Promise.resolve();
      },
    );
    expect(order).toEqual(["close:start", "close:end", "start"]);
  });

  it("닫기가 실패하면 다음 동작을 시작하지 않는다", async () => {
    // 안 닫힌 중계기가 남은 채 판정 실행이 시작되면 같은 서버가 두 벌 뜬다(설계 §1).
    let started = false;
    await expect(
      runAfterClose(
        () => Promise.reject(new Error("닫지 못했습니다")),
        () => {
          started = true;
          return Promise.resolve();
        },
      ),
    ).rejects.toThrow(new Error("닫지 못했습니다"));
    expect(started).toBe(false);
  });
});

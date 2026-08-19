import { describe, expect, it } from "vitest";
import type { RunEventInput } from "../src/api-types.js";
import { WebReviewIO } from "../src/server/review-bridge.js";

/** 마이크로태스크·타이머 큐를 한 바퀴 비운다. 답변 뒤 후속 질문이 나갈 틈을 준다. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function make(): { io: WebReviewIO; events: RunEventInput[] } {
  const events: RunEventInput[] = [];
  const io = new WebReviewIO((event) => {
    events.push(event);
  });
  return { io, events };
}

describe("WebReviewIO", () => {
  it("input이 question 이벤트를 내고 answer로 resolve된다", async () => {
    const { io, events } = make();
    const answered = io.input("이름은?");
    expect(events).toEqual([
      { kind: "question", question: { id: "q1", kind: "input", message: "이름은?" } },
    ]);
    expect(io.pendingQuestion).toEqual({ id: "q1", kind: "input", message: "이름은?" });
    expect(io.answer("q1", "홍길동")).toBe(true);
    await expect(answered).resolves.toBe("홍길동");
    expect(io.pendingQuestion).toBeNull();
  });

  it("confirm은 y만 true다", async () => {
    const yes = make();
    const yesAnswer = yes.io.confirm("저장할까요?");
    expect(yes.io.answer("q1", "y")).toBe(true);
    await expect(yesAnswer).resolves.toBe(true);

    const no = make();
    const noAnswer = no.io.confirm("저장할까요?");
    expect(no.io.answer("q1", "n")).toBe(true);
    await expect(noAnswer).resolves.toBe(false);
  });

  it("id가 다른 answer는 거부된다", async () => {
    const { io } = make();
    let resolved = false;
    const answered = io.input("이름은?").then((value) => {
      resolved = true;
      return value;
    });
    expect(io.answer("잘못된id", "x")).toBe(false);
    await tick();
    expect(resolved).toBe(false);
    expect(io.pendingQuestion?.id).toBe("q1");

    // 미해결 promise를 그대로 두면 테스트가 끝난 뒤에도 매달린다. 제대로 답해 닫는다.
    expect(io.answer("q1", "홍길동")).toBe(true);
    await expect(answered).resolves.toBe("홍길동");
  });

  it("pending 없이 answer하면 false다", () => {
    const { io } = make();
    expect(io.answer("q1", "x")).toBe(false);
  });

  it("pending 중복 질문은 throw한다", async () => {
    const { io } = make();
    const answered = io.input("첫 질문");
    expect(() => io.input("둘째 질문")).toThrow(
      "이미 대기 중인 질문이 있습니다. CLI 플로우 계약 위반입니다.",
    );

    expect(io.answer("q1", "값")).toBe(true);
    await expect(answered).resolves.toBe("값");
  });

  it("answer 콜백 안에서 다음 질문을 던져도 동작한다", async () => {
    const { io, events } = make();
    const flow = (async () => {
      const first = await io.input("첫 질문");
      const second = await io.choose("둘째 질문", ["a", "b"]);
      return `${first}/${second}`;
    })();

    expect(io.answer("q1", "하나")).toBe(true);
    await tick();
    expect(io.pendingQuestion).toEqual({
      id: "q2",
      kind: "choose",
      message: "둘째 질문",
      choices: ["a", "b"],
    });
    expect(io.answer("q2", "b")).toBe(true);
    await expect(flow).resolves.toBe("하나/b");
    expect(events.map((event) => event.kind)).toEqual(["question", "question"]);
  });
});

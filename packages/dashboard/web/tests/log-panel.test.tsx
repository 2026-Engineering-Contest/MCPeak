// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RunEvent } from "../../src/api-types.js";
import { LogPanel } from "../src/components/LogPanel.js";

describe("LogPanel", () => {
  afterEach(cleanup);

  it("stdout·stderr 이벤트가 수신 순서 그대로 렌더된다", () => {
    const events: readonly RunEvent[] = [
      { id: 1, kind: "stdout", html: "첫째 줄" },
      { id: 2, kind: "stderr", html: "둘째 줄" },
      { id: 3, kind: "stdout", html: "셋째 줄" },
    ];
    const { container } = render(<LogPanel title="터미널 출력" events={events} />);
    const lines = Array.from(container.querySelectorAll("div[class] > div")).map(
      (node) => node.textContent,
    );
    expect(lines).toEqual(["첫째 줄", "둘째 줄", "셋째 줄"]);
  });

  it("question·done 이벤트는 본문에 렌더되지 않는다", () => {
    const events: readonly RunEvent[] = [
      { id: 4, kind: "stdout", html: "출력 한 줄" },
      {
        id: 5,
        kind: "question",
        question: { id: "q1", kind: "confirm", message: "계속할까요?" },
      },
      { id: 6, kind: "done", exitCode: 0 },
    ];
    render(<LogPanel title="터미널 출력" events={events} />);
    expect(screen.getByText("출력 한 줄")).toBeTruthy();
    expect(screen.queryByText("계속할까요?")).toBeNull();
    expect(screen.queryByText(/exitCode|0/)).toBeNull();
  });

  it("html이 마크업으로 해석된다", () => {
    const events: readonly RunEvent[] = [
      { id: 6, kind: "stdout", html: '<span class="ansi-31">x</span>' },
    ];
    const { container } = render(<LogPanel title="터미널 출력" events={events} />);
    const span = container.querySelector("span.ansi-31");
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe("x");
  });

  it("AI 대화를 별도 카드로 복제하지 않고 이벤트 위치에 이어서 렌더한다", () => {
    const events: readonly RunEvent[] = [
      { id: 1, kind: "stdout", html: "요청 전 출력" },
      {
        id: 2,
        kind: "question",
        question: { id: "q1", kind: "input", message: "AI 요청:" },
      },
      {
        id: 3,
        kind: "question",
        question: { id: "q2", kind: "confirm", message: "이 요청을 전송할까요?" },
      },
      { id: 4, kind: "stdout", html: "provider 응답" },
      { id: 5, kind: "stdout", html: "후속 CLI 출력" },
    ];
    const { container } = render(
      <LogPanel
        title="터미널 출력"
        events={events}
        conversations={[
          {
            question: "서울로 바꿔줘",
            questionEventId: 2,
            firstResponseEventId: 4,
            waiting: false,
          },
        ]}
      />,
    );

    expect(screen.getAllByText("provider 응답")).toHaveLength(1);
    const text = container.textContent ?? "";
    expect(text.indexOf("요청 전 출력")).toBeLessThan(text.indexOf("사용자 질문"));
    expect(text.indexOf("사용자 질문")).toBeLessThan(text.indexOf("AI 응답"));
    expect(text.indexOf("AI 응답")).toBeLessThan(text.indexOf("provider 응답"));
    expect(text.indexOf("provider 응답")).toBeLessThan(text.indexOf("후속 CLI 출력"));
  });

  /**
   * 본문은 높이가 묶인 자체 스크롤 영역이라, 새 출력을 따라가지 않으면 답변할 때마다 그
   * 출력이 화면 밖 아래에 쌓인다 — 검토 메뉴를 한 번 고를 때마다 사용자가 다시 내려야 했다.
   *
   * jsdom 은 레이아웃이 없어 `scrollHeight`·`clientHeight` 가 늘 0 이다. 그래서 그 셋을
   * 직접 정의해 "넘치는 본문" 을 흉내내고, 컴포넌트가 `scrollTop` 에 무엇을 쓰는지 본다.
   */
  describe("새 출력 따라가기", () => {
    /** 본문 div 에 레이아웃 값을 심는다. `scrollTop` 은 쓰기가 기록되도록 진짜 속성으로 둔다. */
    function stubLayout(
      body: HTMLElement,
      sizes: { readonly scrollHeight: number; readonly clientHeight: number },
    ): void {
      Object.defineProperty(body, "scrollHeight", {
        value: sizes.scrollHeight,
        configurable: true,
      });
      Object.defineProperty(body, "clientHeight", {
        value: sizes.clientHeight,
        configurable: true,
      });
    }

    const line = (id: number): RunEvent => ({ id, kind: "stdout", html: `줄 ${id}` });

    it("바닥에 있던 사용자는 새 출력이 와도 바닥에 남는다", () => {
      const { container, rerender } = render(<LogPanel title="터미널 출력" events={[line(1)]} />);
      const body = container.querySelector<HTMLElement>(".overflow-auto");
      if (body === null) throw new Error("본문을 찾지 못했습니다.");

      stubLayout(body, { scrollHeight: 1000, clientHeight: 400 });
      rerender(<LogPanel title="터미널 출력" events={[line(1), line(2)]} />);

      expect(body.scrollTop).toBe(1000);
    });

    /** 지난 출력을 확인하려고 올린 사람을 새 줄이 올 때마다 바닥으로 던지면 더 나쁘다. */
    it("위로 올려 읽는 중이면 끌어내리지 않는다", () => {
      const { container, rerender } = render(<LogPanel title="터미널 출력" events={[line(1)]} />);
      const body = container.querySelector<HTMLElement>(".overflow-auto");
      if (body === null) throw new Error("본문을 찾지 못했습니다.");

      stubLayout(body, { scrollHeight: 1000, clientHeight: 400 });
      // 사용자가 중간까지 올린다 — 바닥까지 400px 남았으므로 "붙어 있음" 이 아니다.
      body.scrollTop = 200;
      fireEvent.scroll(body);
      rerender(<LogPanel title="터미널 출력" events={[line(1), line(2)]} />);

      expect(body.scrollTop).toBe(200);
    });

    it("바닥 근처(반올림 오차)면 여전히 따라간다", () => {
      const { container, rerender } = render(<LogPanel title="터미널 출력" events={[line(1)]} />);
      const body = container.querySelector<HTMLElement>(".overflow-auto");
      if (body === null) throw new Error("본문을 찾지 못했습니다.");

      stubLayout(body, { scrollHeight: 1000, clientHeight: 400 });
      // 바닥은 600. 590 이면 10px 떠 있지만 사용자에게는 바닥이다.
      body.scrollTop = 590;
      fireEvent.scroll(body);
      rerender(<LogPanel title="터미널 출력" events={[line(1), line(2)]} />);

      expect(body.scrollTop).toBe(1000);
    });
  });
});

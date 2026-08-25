// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
});

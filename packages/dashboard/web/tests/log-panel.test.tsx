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
});

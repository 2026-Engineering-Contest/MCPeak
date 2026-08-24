// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEventInput } from "../../src/api-types.js";
import { RepairReview } from "../src/screens/RepairReview.js";

/** run-view.test.tsx와 같은 방식의 EventSource fake. 네트워크·서버 없음. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  #nextId = 1;

  /** 서버 RunRecord처럼 발생 순서대로 id를 붙인다(run-stream의 id 중복 제거 대응). */
  emit(event: RunEventInput & { readonly id?: number }): void {
    const withId = { id: this.#nextId++, ...event };
    this.onmessage?.({ data: JSON.stringify(withId) } as MessageEvent<string>);
  }

  close(): void {
    this.closed = true;
  }
}

function lastSource(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (source === undefined) {
    throw new Error("EventSource가 만들어지지 않았습니다.");
  }
  return source;
}

describe("RepairReview", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  it("stdout의 diff 텍스트가 재구성 없이 그대로 렌더된다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    // 마운트 summary GET(#295)을 받아 줄 스텁. 없으면 상대경로 fetch 가 실제로 나간다.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const { container } = render(<RepairReview runId="repair-1" />);
    act(() => {
      lastSource().emit({ kind: "stdout", html: "→ args.city 가 스키마와 다릅니다" });
      lastSource().emit({ kind: "stdout", html: '- "city": "seoul"' });
      lastSource().emit({ kind: "stdout", html: '+ "city": "busan"' });
    });
    const text = container.textContent ?? "";
    const order = [
      text.indexOf("→ args.city 가 스키마와 다릅니다"),
      text.indexOf('- "city": "seoul"'),
      text.indexOf('+ "city": "busan"'),
    ];
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("confirm 질문의 예/아니오가 answer로 POST된다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    /** 마운트 summary GET(#295)을 빼고 answer POST 만 센다. */
    const posts = (): readonly RequestInit[] =>
      fetchMock.mock.calls
        .map((call) => call[1] as RequestInit | undefined)
        .filter((init): init is RequestInit => (init?.method ?? "GET") !== "GET");

    render(<RepairReview runId="repair-1" />);
    act(() => {
      lastSource().emit({
        kind: "question",
        question: { id: "q1", kind: "confirm", message: "이 수정을 적용할까요?" },
      });
    });
    fireEvent.click(screen.getByText("예"));
    await waitFor(() => {
      expect(posts()).toHaveLength(1);
    });
    expect(
      fetchMock.mock.calls
        .filter((call) => ((call[1] as RequestInit | undefined)?.method ?? "GET") !== "GET")
        .map((call) => String(call[0])),
    ).toEqual(["/api/runs/repair-1/answer"]);
    expect(JSON.parse(String(posts()[0]?.body))).toEqual({
      questionId: "q1",
      value: "y",
    });

    act(() => {
      lastSource().emit({
        kind: "question",
        question: { id: "q2", kind: "confirm", message: "다음 수정을 적용할까요?" },
      });
    });
    fireEvent.click(screen.getByText("아니오"));
    await waitFor(() => {
      expect(posts()).toHaveLength(2);
    });
    expect(JSON.parse(String(posts()[1]?.body))).toEqual({
      questionId: "q2",
      value: "n",
    });
  });
});

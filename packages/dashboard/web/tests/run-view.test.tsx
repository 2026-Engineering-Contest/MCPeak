// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "../../src/api-types.js";
import { RunView } from "../src/screens/RunView.js";

/** run-stream.test.ts와 같은 방식의 EventSource fake. 네트워크·서버 없음. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  emit(event: RunEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
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

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ runId: "repair-1" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("RunView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
    window.location.hash = "";
  });

  it("이벤트가 순서 그대로 렌더된다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    const { container } = render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "stdout", html: "표준 출력 1" });
      lastSource().emit({ kind: "stderr", html: "표준 오류 1" });
      lastSource().emit({ kind: "stdout", html: "표준 출력 2" });
    });
    const text = container.textContent ?? "";
    const order = [
      text.indexOf("표준 출력 1"),
      text.indexOf("표준 오류 1"),
      text.indexOf("표준 출력 2"),
    ];
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("pendingQuestion이 있으면 QuestionPanel이 보이고 응답이 answer로 POST된다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({
        kind: "question",
        question: { id: "q1", kind: "confirm", message: "저장할까요?" },
      });
    });
    expect(screen.getByText("저장할까요?")).toBeTruthy();
    fireEvent.click(screen.getByText("예"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/runs/run-1/answer");
    expect(JSON.parse(String(init?.body))).toEqual({ questionId: "q1", value: "y" });
    // 답변 후 패널은 사라진다.
    await waitFor(() => {
      expect(screen.queryByText("저장할까요?")).toBeNull();
    });
  });

  it('status가 failed면 repair 시작 버튼이 있고 클릭 시 flow:"repair"를 POST한다', async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = stubFetch();
    const prompts = ["bundle.json", "claude", "claude-sonnet-5"];
    vi.stubGlobal(
      "prompt",
      vi.fn(() => prompts.shift() ?? null),
    );

    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    const button = screen.getByRole("button", { name: "repair 시작" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(window.location.hash).toBe("#/repair/repair-1");
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/runs");
    expect(JSON.parse(String(init?.body))).toEqual({
      flow: "repair",
      argv: ["bundle.json", "--provider", "claude", "--model", "claude-sonnet-5"],
    });
  });

  it("status가 done이면 repair 버튼이 없다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 0 });
    });
    expect(screen.getByText("완료 · exit 0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "repair 시작" })).toBeNull();
  });
});

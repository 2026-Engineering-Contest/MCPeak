// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "../../src/api-types.js";
import { useRunEvents } from "../src/run-stream.js";

/**
 * 실제 EventSource 대신 쓰는 fake. `onmessage`에 콜백이 꽂히면 테스트가
 * `emit`으로 SSE 메시지를 흉내낸다. 네트워크·서버 없음.
 */
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

describe("useRunEvents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  it("stdout 이벤트가 events에 순서대로 쌓인다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];
    expect(source).toBeDefined();

    act(() => {
      source?.emit({ kind: "stdout", html: "첫 줄" });
    });
    act(() => {
      source?.emit({ kind: "stdout", html: "둘째 줄" });
    });

    expect(result.current.events).toEqual([
      { kind: "stdout", html: "첫 줄" },
      { kind: "stdout", html: "둘째 줄" },
    ]);
  });

  it("question 이벤트가 pendingQuestion을 세운다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.emit({
        kind: "question",
        question: { id: "q1", kind: "confirm", message: "계속할까요?" },
      });
    });

    expect(result.current.pendingQuestion).toEqual({
      id: "q1",
      kind: "confirm",
      message: "계속할까요?",
    });

    // T4에서 바뀐 규칙: stdout/stderr는 pendingQuestion을 비우지 않는다. question과
    // answer 사이에 낀 출력 한 줄이 패널을 지워 응답 불가 상태로 만드는 문제가 있었기
    // 때문이다(answer 이후 패널을 감추는 책임은 QuestionPanel의 로컬 state로 옮겼다).
    act(() => {
      source?.emit({ kind: "stdout", html: "답변 이전에 낀 출력" });
    });

    expect(result.current.pendingQuestion).toEqual({
      id: "q1",
      kind: "confirm",
      message: "계속할까요?",
    });

    // 새 question 이벤트가 오면 이전 것을 교체한다.
    act(() => {
      source?.emit({
        kind: "question",
        question: { id: "q2", kind: "confirm", message: "정말요?" },
      });
    });

    expect(result.current.pendingQuestion).toEqual({
      id: "q2",
      kind: "confirm",
      message: "정말요?",
    });

    // done 이벤트가 오면 비운다.
    act(() => {
      source?.emit({ kind: "done", exitCode: 0 });
    });

    expect(result.current.pendingQuestion).toBeNull();
  });

  it("done 이벤트가 status를 done으로 바꾼다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.emit({ kind: "done", exitCode: 0 });
    });

    expect(result.current.status).toBe("done");
  });

  it("runId가 null이면 구독하지 않는다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    renderHook(() => useRunEvents(null));

    expect(FakeEventSource.instances).toHaveLength(0);
  });
});

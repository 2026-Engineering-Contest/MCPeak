// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent, RunSummary } from "../../src/api-types.js";
import { useRunEvents } from "../src/run-stream.js";

/**
 * 실제 EventSource 대신 쓰는 fake. `onmessage`에 콜백이 꽂히면 테스트가
 * `emit`으로 SSE 메시지를 흉내낸다. 네트워크·서버 없음.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  /** 기본값은 OPEN(1). 테스트가 CLOSED(2)·CONNECTING(0)으로 바꿔 실패를 흉내낸다. */
  readyState = 1;
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

/** `GET /api/runs/:id`(summary seed·onerror 재조회)가 받는 응답을 정한다. */
function stubSummaryFetch(response: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function summaryResponse(status: RunSummary["status"]): Response {
  const summary: RunSummary = { runId: "run-1", flow: "test", status, exitCode: null };
  return new Response(JSON.stringify(summary), { status: 200 });
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
      source?.emit({ kind: "stdout", html: "첫 줄", id: 1 });
    });
    act(() => {
      source?.emit({ kind: "stdout", html: "둘째 줄", id: 2 });
    });

    expect(result.current.events).toEqual([
      { kind: "stdout", html: "첫 줄", id: 1 },
      { kind: "stdout", html: "둘째 줄", id: 2 },
    ]);
  });

  it("재연결로 같은 stdout 커서가 다시 오면 한 번만 렌더한다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.emit({ kind: "stdout", html: "첫 줄", id: 1 });
      source?.emit({ kind: "stdout", html: "첫 줄", id: 1 });
      source?.emit({ kind: "stdout", html: "둘째 줄", id: 2 });
    });

    expect(result.current.events).toEqual([
      { kind: "stdout", html: "첫 줄", id: 1 },
      { kind: "stdout", html: "둘째 줄", id: 2 },
    ]);
  });

  it("재연결로 같은 stderr 커서가 다시 오면 한 번만 렌더한다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.emit({ kind: "stderr", html: "오류", id: 1 });
      source?.emit({ kind: "stderr", html: "오류", id: 1 });
    });

    expect(result.current.events).toEqual([{ kind: "stderr", html: "오류", id: 1 }]);
  });

  it("재연결로 같은 question 커서가 다시 오면 한 번만 렌더한다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    const event: RunEvent = {
      kind: "question",
      id: 1,
      question: { id: "q1", kind: "confirm", message: "계속할까요?" },
    };
    act(() => {
      source?.emit(event);
      source?.emit(event);
    });

    expect(result.current.events).toEqual([event]);
    expect(result.current.pendingQuestion).toEqual(event.question);
  });

  it("question 이벤트가 pendingQuestion을 세운다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.emit({
        kind: "question",
        id: 1,
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
      source?.emit({ kind: "stdout", html: "답변 이전에 낀 출력", id: 2 });
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
        id: 3,
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
      source?.emit({ kind: "done", exitCode: 0, id: 4 });
    });

    expect(result.current.pendingQuestion).toBeNull();
  });

  it("done 이벤트가 status를 done으로 바꾼다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.emit({ kind: "done", exitCode: 0, id: 1 });
    });

    expect(result.current.status).toBe("done");
  });

  it("runId가 null이면 구독하지 않는다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    renderHook(() => useRunEvents(null));

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("첫 이벤트가 오기 전에는 summary의 status로 공백을 메운다 (#295)", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubSummaryFetch(async () => summaryResponse("running"));
    const { result } = renderHook(() => useRunEvents("run-1"));

    await waitFor(() => {
      expect(result.current.status).toBe("running");
    });
    expect(result.current.error).toBeNull();
  });

  it("늦게 도착한 summary가 SSE가 이미 정한 status를 덮어쓰지 않는다 (#295)", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let resolveSummary!: (value: Response) => void;
    stubSummaryFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveSummary = resolve;
        }),
    );
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.emit({ kind: "done", exitCode: 0, id: 1 });
    });
    expect(result.current.status).toBe("done");

    // run은 summary 응답 시점엔 아직 running이었다는 시나리오.
    resolveSummary(summaryResponse("running"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.status).toBe("done");
  });

  it("스트림이 닫히고 run 조회가 404면 서버 메시지와 휘발성 안내를 error로 노출한다 (#295)", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubSummaryFetch(
      async () => new Response(JSON.stringify({ error: "그런 run이 없습니다." }), { status: 404 }),
    );
    const { result } = renderHook(() => useRunEvents("does-not-exist"));
    const source = FakeEventSource.instances[0];

    act(() => {
      if (source !== undefined) source.readyState = 2;
      source?.onerror?.();
    });

    await waitFor(() => {
      expect(result.current.error).toContain("그런 run이 없습니다.");
    });
    expect(result.current.error).toContain("메모리에만 있어 서버를 재시작하면 사라집니다");
  });

  it("run은 있는데 스트림만 닫혔으면 새로고침 안내를 노출한다 (#295)", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubSummaryFetch(async () => summaryResponse("running"));
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      if (source !== undefined) source.readyState = 2;
      source?.onerror?.();
    });

    await waitFor(() => {
      expect(result.current.error).toContain("페이지를 새로 고치면");
    });
  });

  it("일시 단절(자동 재접속 중)에는 error를 세우지 않는다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubSummaryFetch(async () => summaryResponse("running"));
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      if (source !== undefined) source.readyState = 0;
      source?.onerror?.();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.error).toBeNull();
  });
});

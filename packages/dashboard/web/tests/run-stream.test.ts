// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  /** 0=CONNECTING · 1=OPEN · 2=CLOSED. 훅이 이 값으로 영구 실패와 재연결을 가른다. */
  readyState = 1;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  emit(event: RunEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  }

  /** 200 이 아닌 응답 — 스펙상 연결을 실패시키고 재시도하지 않는다. */
  failClosed(): void {
    this.readyState = 2;
    this.onerror?.();
  }

  /** 끊김 — 브라우저가 알아서 다시 붙는다. 사람에게 알릴 일이 아니다. */
  failReconnecting(): void {
    this.readyState = 0;
    this.onerror?.();
  }

  close(): void {
    this.closed = true;
  }
}

const RUNNING: RunSummary = { runId: "run-1", flow: "test", status: "running", exitCode: null };

/**
 * 훅이 마운트마다 `GET /api/runs/:id` 를 한 번 부른다. 스텁이 없으면 상대경로 fetch 가
 * 실제로 나가 `Failed to parse URL` 로 떨어지고, 그 setState 가 `act()` 밖에서 일어난다.
 * 기존 케이스 7건이 전부 그 경로를 지나므로 **기본 스텁이 반드시 있어야 한다.**
 */
function stubFetch(summary: RunSummary | null = RUNNING): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () =>
    summary === null
      ? new Response(JSON.stringify({ error: "그런 run이 없습니다." }), { status: 404 })
      : new Response(JSON.stringify(summary), { status: 200 }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** 404 가 아닌 실패. run 이 없다는 뜻이 아니므로 안내가 달라야 한다. */
function stubFetchFailing(status: number, message: string): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => new Response(JSON.stringify({ error: message }), { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("useRunEvents", () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    cleanup();
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

  /**
   * #295 의 첫 증상. `mcpeak test` 는 끝날 때까지 stdout 을 뱉지 않으므로 SSE 이벤트가
   * 0건이고, 고치기 전에는 실행 내내 status 가 null 이었다. 서버는 그동안 계속
   * `status:"running"` 을 주고 있었다.
   */
  it("이벤트가 한 건도 없어도 서버 summary 로 status 를 채운다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));

    await waitFor(() => {
      expect(result.current.status).toBe("running");
    });
    expect(result.current.events).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  /**
   * #295 의 둘째 증상. 없는 run 을 열면 서버가 404 본문에 문장을 실어 보내는데
   * 화면이 그것을 버렸다. `EventSource` 는 본문을 주지 않으므로 `apiGet` 이 가져온다.
   */
  it("없는 run 이면 서버가 준 문장과 메모리 한계 안내를 함께 싣는다", async () => {
    stubFetch(null);
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("does-not-exist"));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error).toContain("그런 run이 없습니다.");
    expect(result.current.error).toContain("메모리에만");
    expect(result.current.status).toBeNull();
  });

  /**
   * 화면 컨트롤 이름을 부르지 않는다. 이 패널을 `RepairReview` 도 쓰는데 그 화면에는
   * `← Runs` 링크가 없어서, 없는 버튼을 누르라고 하는 안내가 된다.
   */
  it("안내가 없는 화면 컨트롤을 지목하지 않는다", async () => {
    stubFetch(null);
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("does-not-exist"));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error).not.toContain("← Runs");
  });

  /**
   * 도착 순서에 결과가 좌우되면 안 된다. SSE 이벤트가 먼저 상태를 세웠으면 그쪽이 더
   * 새 정보이므로 늦게 온 summary 가 덮지 않는다.
   */
  it("SSE 가 먼저 세운 status 를 늦게 온 summary 가 덮지 않는다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.emit({ kind: "done", exitCode: 0, id: 1 });
    });
    expect(result.current.status).toBe("done");

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
    });
    expect(result.current.status).toBe("done");
  });

  /** 영구 실패(CLOSED)일 때만 다시 물어본다. */
  it("스트림이 영구 실패하면 서버에 다시 물어 사라진 run 을 알린다", async () => {
    const mock = stubFetch();
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    await waitFor(() => {
      expect(result.current.status).toBe("running");
    });

    stubFetch(null);
    await act(async () => {
      FakeEventSource.instances[0]?.failClosed();
    });

    await waitFor(() => {
      expect(result.current.error).toContain("그런 run이 없습니다.");
    });
    expect(mock).toHaveBeenCalled();
  });

  /** 재연결 중(CONNECTING)에는 아무 말도 하지 않는다. 브라우저가 알아서 다시 붙는다. */
  it("재연결 중인 끊김은 사람에게 알리지 않는다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    await waitFor(() => {
      expect(result.current.status).toBe("running");
    });

    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      FakeEventSource.instances[0]?.failReconnecting();
    });

    expect(result.current.error).toBeNull();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });

  /**
   * `apiGet` 은 **모든** non-OK 에서 reject 한다. 상태를 안 보고 묶으면 5xx·네트워크 오류에도
   * "그런 run이 없습니다" 안내가 붙어 **살아 있는 run 에 거짓을 말한다.**
   */
  it("404 가 아닌 조회 실패에는 run-없음 안내를 붙이지 않는다", async () => {
    stubFetchFailing(500, "내부 오류가 발생했습니다.");
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error).toContain("내부 오류가 발생했습니다.");
    expect(result.current.error).not.toContain("메모리에만");
    expect(result.current.error).toContain("run 이 없다는 뜻은 아닙니다");
  });

  /** 이벤트가 흐른다는 것이 곧 run 이 있다는 증거다. 앞선 조회 실패 안내는 걷어야 한다. */
  it("SSE 이벤트가 도착하면 앞선 조회 실패 안내를 해제한다", async () => {
    stubFetchFailing(500, "내부 오류가 발생했습니다.");
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useRunEvents("run-1"));
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    act(() => {
      FakeEventSource.instances[0]?.emit({ kind: "stdout", html: "살아 있다", id: 1 });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("running");
  });
});

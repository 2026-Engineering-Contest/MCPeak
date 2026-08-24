// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEventInput } from "../../src/api-types.js";
import { RunView } from "../src/screens/RunView.js";

/** run-stream.test.ts와 같은 방식의 EventSource fake. 네트워크·서버 없음. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  /** 기본값은 OPEN(1). 테스트가 CLOSED(2)로 바꿔 스트림 실패를 흉내낸다. */
  readyState = 1;
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

/**
 * POST(run 시작·answer)는 runId 응답, 그 외 GET은 run-stream의 summary seed가 읽는
 * `GET /api/runs/:id` 응답을 준다(#295 이후 마운트마다 이 GET이 한 번 나간다).
 */
function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ runId: "repair-1" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ runId: "run-1", flow: "test", status: "running", exitCode: null }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** summary seed GET을 건너뛰고 POST 호출만 본다. */
function postCalls(fetchMock: ReturnType<typeof vi.fn>): Array<[RequestInfo | URL, RequestInit?]> {
  return (fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit?]>).filter(
    ([, init]) => init?.method === "POST",
  );
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
      expect(postCalls(fetchMock)).toHaveLength(1);
    });
    const [url, init] = postCalls(fetchMock)[0] ?? [];
    expect(url).toBe("/api/runs/run-1/answer");
    expect(JSON.parse(String(init?.body))).toEqual({ questionId: "q1", value: "y" });
    // 답변 후 패널은 사라진다.
    await waitFor(() => {
      expect(screen.queryByText("저장할까요?")).toBeNull();
    });
  });

  it('status가 failed면 repair 폼을 열어 flow:"repair"를 POST한다', async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = stubFetch();
    // window.prompt 를 아예 없앤다. 남아 있으면 옛 경로가 살아 있어도 통과한다(#223).
    vi.stubGlobal("prompt", undefined);

    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(screen.getByRole("button", { name: "repair 시작" }));

    fireEvent.change(screen.getByLabelText("repair 번들 경로"), {
      target: { value: "bundle.json" },
    });
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "claude-sonnet-5" } });
    fireEvent.click(screen.getByRole("button", { name: "시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/repair/repair-1");
    });
    const [url, init] = postCalls(fetchMock)[0] ?? [];
    expect(url).toBe("/api/runs");
    expect(JSON.parse(String(init?.body))).toEqual({
      flow: "repair",
      argv: ["bundle.json", "--provider", "claude", "--model", "claude-sonnet-5"],
    });
  });

  it("repair 폼의 provider 는 자유 입력이 아니라 codex·claude 둘뿐이다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(screen.getByRole("button", { name: "repair 시작" }));

    const select = screen.getByLabelText("provider") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["claude", "codex"]);
  });

  it("repair 폼은 값이 덜 찼으면 시작 버튼이 비활성이고, 취소하면 닫힌다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(screen.getByRole("button", { name: "repair 시작" }));

    // 예전에는 prompt 세 번을 다 통과한 뒤에야 실패를 알았다.
    expect(screen.getByRole("button", { name: "시작" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("repair 번들 경로"), { target: { value: "b.json" } });
    expect(screen.getByRole("button", { name: "시작" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "m" } });
    expect(screen.getByRole("button", { name: "시작" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByLabelText("repair 번들 경로")).toBeNull();
  });

  it("첫 이벤트가 오기 전에도 summary가 running이면 '실행 중' 배지를 단다 (#295)", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);

    // 이벤트를 하나도 emit하지 않는다 — mcpeak test는 끝날 때까지 stdout이 없다.
    expect(await screen.findByText("실행 중")).toBeTruthy();
    expect(screen.queryByText("대기")).toBeNull();
  });

  it("없는 run이면 서버의 404 메시지와 휘발성 안내가 보인다 (#295)", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "그런 run이 없습니다." }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<RunView runId="does-not-exist" />);

    act(() => {
      const source = lastSource();
      source.readyState = 2;
      source.onerror?.();
    });

    expect(await screen.findByText(/그런 run이 없습니다\./)).toBeTruthy();
    expect(screen.getByText(/서버를 재시작하면 사라집니다/)).toBeTruthy();
    expect(screen.queryByText("대기")).toBeNull();
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

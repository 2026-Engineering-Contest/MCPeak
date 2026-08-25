// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEventInput } from "../../src/api-types.js";
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
 * 훅이 마운트마다 `GET /api/runs/:id` 로 summary 를 읽는다(#295). URL 로 갈라 주지 않으면
 * 그 요청이 `{runId:"repair-1"}` 로 파싱돼 `status: undefined` 인 RunSummary 가 되고,
 * StatusBadge 가 정의되지 않은 상태로 렌더된다.
 */
const BUNDLE = ".mcpeak/repair/x.repair-bundle.json";
/** 홈이 만든 test run 의 argv. 끝의 `--repair-bundle` 을 실행 뷰가 되읽는다(ADR-0080). */
const ARGV_WITH_BUNDLE = ["suite.json", "--command", "node", "--repair-bundle", BUNDLE];

function stubFetch(argv: readonly string[] = ARGV_WITH_BUNDLE): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET" && /^\/api\/runs\/[^/]+$/.test(String(input))) {
      return new Response(
        JSON.stringify({ runId: "run-1", flow: "test", status: "running", exitCode: null, argv }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ runId: "repair-1" }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 마운트 summary GET 을 빼고 테스트가 노리는 쓰기 요청만 고른다. */
function writeCalls(
  mock: ReturnType<typeof vi.fn>,
): Array<readonly [string, RequestInit | undefined]> {
  return mock.mock.calls
    .map((call) => [String(call[0]), call[1] as RequestInit | undefined] as const)
    .filter(([, init]) => (init?.method ?? "GET") !== "GET");
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
    const [url, init] = writeCalls(fetchMock)[0] ?? [];
    expect(url).toBe("/api/runs/run-1/answer");
    expect(JSON.parse(String(init?.body))).toEqual({ questionId: "q1", value: "y" });
    // 답변 후 패널은 사라진다.
    await waitFor(() => {
      expect(screen.queryByText("저장할까요?")).toBeNull();
    });
  });

  it("AI 질문과 응답을 구분하고 provider 응답을 기다리는 동안 진행 상태를 보인다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);

    act(() => {
      lastSource().emit({
        kind: "question",
        question: { id: "q1", kind: "input", message: "AI 요청: " },
      });
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "서울 날씨 실패 케이스를 추가해줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "제출" }));

    const conversation = await screen.findByRole("region", { name: "AI 대화" });
    expect(within(conversation).getByText("사용자 질문")).toBeTruthy();
    expect(within(conversation).getByText("서울 날씨 실패 케이스를 추가해줘")).toBeTruthy();

    act(() => {
      lastSource().emit({
        kind: "question",
        question: { id: "q2", kind: "confirm", message: "이 요청을 전송할까요?" },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "예" }));

    expect(await within(conversation).findByText("AI가 답변 중입니다...")).toBeTruthy();

    act(() => {
      lastSource().emit({ kind: "stdout", html: "<strong>실패 케이스를 추가했습니다.</strong>" });
    });
    expect(await within(conversation).findByText("AI 응답")).toBeTruthy();
    expect(within(conversation).getByText("실패 케이스를 추가했습니다.")).toBeTruthy();
    expect(within(conversation).queryByText("AI가 답변 중입니다...")).toBeNull();
  });

  it("AI 입력에서 뒤로가기를 누르면 현재 질문을 검토 메뉴 복귀 요청으로 끝낸다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = stubFetch();
    render(<RunView runId="run-1" />);

    act(() => {
      lastSource().emit({
        kind: "question",
        question: { id: "q1", kind: "input", message: "AI 요청: " },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "검토 메뉴로 돌아가기" }));

    await waitFor(() => {
      const [, init] = writeCalls(fetchMock)[0] ?? [];
      expect(JSON.parse(String(init?.body))).toEqual({ questionId: "q1", action: "back" });
    });
    expect(screen.queryByText("AI 요청:")).toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: "repair 시작" }));

    // 경로는 치지 않는다. 이 run 의 argv 에서 채워져 있어야 한다(ADR-0080).
    expect(screen.getByLabelText("repair 번들 경로")).toHaveProperty("value", BUNDLE);
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "claude-sonnet-5" } });
    fireEvent.click(screen.getByRole("button", { name: "시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/repair/repair-1");
    });
    const [url, init] = writeCalls(fetchMock)[0] ?? [];
    expect(url).toBe("/api/runs");
    expect(JSON.parse(String(init?.body))).toEqual({
      flow: "repair",
      argv: [BUNDLE, "--provider", "claude", "--model", "claude-sonnet-5"],
    });
  });

  it("argv 에 --repair-bundle 이 없으면 repair 버튼 대신 안내 문장이 나온다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch(["suite.json", "--command", "node"]);

    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });

    await screen.findByText(/이 실행은 repair 번들 없이 시작됐습니다/);
    expect(screen.queryByRole("button", { name: "repair 시작" })).toBeNull();
  });

  it("run 이 바뀌면 앞 run 의 번들 경로가 남지 않는다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    // run 마다 다른 번들. 같은 패널 인스턴스가 A 에서 B 로 바뀔 때 A 의 경로를 보내면 안 된다.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const match = /^\/api\/runs\/([^/]+)$/.exec(String(input));
        if ((init?.method ?? "GET") === "GET" && match !== null) {
          const argv = ["s.json", "--repair-bundle", `.mcpeak/repair/${match[1]}.json`];
          return new Response(
            JSON.stringify({
              runId: match[1],
              flow: "test",
              status: "running",
              exitCode: null,
              argv,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ runId: "repair-1" }), { status: 200 });
      }),
    );

    const { rerender } = render(<RunView runId="run-a" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "repair 시작" }));
    expect(screen.getByLabelText("repair 번들 경로")).toHaveProperty(
      "value",
      ".mcpeak/repair/run-a.json",
    );

    rerender(<RunView runId="run-b" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "repair 시작" }));
    await waitFor(() => {
      expect(screen.getByLabelText("repair 번들 경로")).toHaveProperty(
        "value",
        ".mcpeak/repair/run-b.json",
      );
    });
  });

  it("채워진 번들 경로를 고치면 고친 값이 POST 된다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = stubFetch();

    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "repair 시작" }));
    fireEvent.change(screen.getByLabelText("repair 번들 경로"), {
      target: { value: "other/bundle.json" },
    });
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: "시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/repair/repair-1");
    });
    const [, init] = writeCalls(fetchMock)[0] ?? [];
    expect(JSON.parse(String(init?.body)).argv[0]).toBe("other/bundle.json");
  });

  it("repair 폼의 provider 는 자유 입력이 아니라 codex·claude 둘뿐이다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "repair 시작" }));

    const select = screen.getByLabelText("provider") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["claude", "codex"]);
  });

  it("repair 폼은 값이 덜 찼으면 시작 버튼이 비활성이고, 취소하면 닫힌다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "repair 시작" }));

    // 예전에는 prompt 세 번을 다 통과한 뒤에야 실패를 알았다.
    expect(screen.getByRole("button", { name: "시작" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("repair 번들 경로"), { target: { value: "b.json" } });
    expect(screen.getByRole("button", { name: "시작" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "m" } });
    expect(screen.getByRole("button", { name: "시작" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByLabelText("repair 번들 경로")).toBeNull();
  });

  it("repair 폼은 시작 버튼이 꺼진 이유를 버튼 옆에 말한다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "repair 시작" }));

    // 버튼이 꺼진 이유가 침묵하면 사용자는 폼 전체를 다시 의심한다(#354).
    // 경로는 채워져 오므로(ADR-0080) 먼저 지워서 그 갈래를 밟는다.
    expect(screen.getByText("model 을 입력하세요.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("repair 번들 경로"), { target: { value: "" } });
    expect(screen.getByText("repair 번들 경로를 입력하세요.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("repair 번들 경로"), { target: { value: "b.json" } });
    expect(screen.queryByText("repair 번들 경로를 입력하세요.")).toBeNull();
    expect(screen.getByText("model 을 입력하세요.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "m" } });
    expect(screen.queryByText("model 을 입력하세요.")).toBeNull();
  });

  it("repair 의 model 칸은 필수임을 표시한다 — generate 의 '모델 (선택)' 과 다르다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "repair 시작" }));

    expect(screen.getByText("repair 는 모델 지정이 필수입니다.")).toBeTruthy();
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

  /**
   * #295. 고치기 전에는 이 화면과 "도는 run" 화면이 **글자 하나 다르지 않았다** — 둘 다
   * "대기" 였다. `RunStatus` 에 "대기" 라는 값은 없다. 모르는 것을 아는 척한 문구였다.
   */
  it("없는 run 이면 서버가 준 문장을 화면에 낸다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "그런 run이 없습니다." }), { status: 404 }),
      ),
    );
    render(<RunView runId="does-not-exist" />);

    await waitFor(() => {
      expect(screen.getByText(/그런 run이 없습니다/)).toBeTruthy();
    });
    expect(screen.getByText("상태를 확인할 수 없음")).toBeTruthy();
    expect(screen.queryByText("대기")).toBeNull();
  });

  /** 이벤트가 오기 전에도 서버가 아는 상태를 뱃지로 낸다. */
  it("이벤트가 없어도 서버 status 를 뱃지로 낸다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);

    await waitFor(() => {
      expect(screen.queryByText("상태를 확인하는 중...")).toBeNull();
    });
    expect(screen.queryByText("대기")).toBeNull();
  });
});

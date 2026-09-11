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

  it("후속 AI 질문은 스위트 생성 상태 없이 질문 답변 상태만 보인다", async () => {
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

    expect(await screen.findByText("사용자 질문")).toBeTruthy();
    expect(screen.getByText("서울 날씨 실패 케이스를 추가해줘")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "AI 대화" })).toBeNull();

    act(() => {
      lastSource().emit({
        kind: "question",
        question: { id: "q2", kind: "confirm", message: "이 요청을 전송할까요?" },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "예" }));

    expect(await screen.findByText("질문 답변중...")).toBeTruthy();
    expect(screen.queryByText("스위트 생성중...")).toBeNull();

    act(() => {
      lastSource().emit({ kind: "stdout", html: "<strong>실패 케이스를 추가했습니다.</strong>" });
    });
    expect(await screen.findByText("AI 응답")).toBeTruthy();
    // provider stdout은 별도 대화 카드에 복제하지 않고 터미널 흐름에 한 번만 그린다.
    expect(screen.getAllByText("실패 케이스를 추가했습니다.")).toHaveLength(1);
    expect(screen.queryByText("질문 답변중...")).toBeNull();
  });

  it("전송 승인 뒤 검토 메뉴가 도착할 때까지 스위트 생성중 상태를 보인다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);

    act(() => {
      lastSource().emit({
        kind: "question",
        question: { id: "q1", kind: "confirm", message: "이 요청을 전송할까요?" },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "예" }));

    const loading = await screen.findByText("스위트 생성중...");
    expect(loading.getAttribute("role")).toBe("status");

    act(() => {
      lastSource().emit({
        kind: "question",
        question: {
          id: "q2",
          kind: "choose",
          message: "검토 메뉴",
          choices: ["show", "save", "cancel"],
        },
      });
    });

    expect(await screen.findByText("검토 메뉴")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("스위트 생성중...")).toBeNull();
    });
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
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "sonnet" } });
    fireEvent.click(screen.getByRole("button", { name: "시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/repair/repair-1");
    });
    const [url, init] = writeCalls(fetchMock)[0] ?? [];
    expect(url).toBe("/api/runs");
    expect(JSON.parse(String(init?.body))).toEqual({
      flow: "repair",
      argv: [BUNDLE, "--provider", "claude", "--model", "sonnet"],
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
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "sonnet" } });
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

  it("repair 모델은 provider별 generate 모델 목록에서 선택하고 provider를 바꾸면 초기화한다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "repair 시작" }));

    const model = screen.getByLabelText("model") as HTMLSelectElement;
    expect(model.tagName).toBe("SELECT");
    expect(Array.from(model.options).map((option) => [option.value, option.text])).toEqual([
      ["", "모델을 선택하세요"],
      ["sonnet", "Sonnet"],
      ["haiku", "Haiku"],
      ["opus", "Opus"],
    ]);

    fireEvent.change(model, { target: { value: "sonnet" } });
    fireEvent.change(screen.getByLabelText("provider"), { target: { value: "codex" } });
    expect(model.value).toBe("");
    expect(Array.from(model.options).map((option) => [option.value, option.text])).toEqual([
      ["", "모델을 선택하세요"],
      ["gpt-5.6-sol", "Sol"],
      ["gpt-5.6-terra", "Terra"],
      ["gpt-5.6-luna", "Luna"],
    ]);
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
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "sonnet" } });
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
    expect(screen.getByText("model 을 선택하세요.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("repair 번들 경로"), { target: { value: "" } });
    expect(screen.getByText("repair 번들 경로를 입력하세요.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("repair 번들 경로"), { target: { value: "b.json" } });
    expect(screen.queryByText("repair 번들 경로를 입력하세요.")).toBeNull();
    expect(screen.getByText("model 을 선택하세요.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "sonnet" } });
    expect(screen.queryByText("model 을 선택하세요.")).toBeNull();
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

  /** run 은 runId 로 구별되지 않는다. 어느 스위트를 어느 서버로 돌렸는지가 목록에 있어야 한다. */
  it("목록 행이 스위트와 서버 명령을 함께 보여준다", async () => {
    const runs = [
      {
        runId: "run-1",
        flow: "test",
        status: "done",
        exitCode: 0,
        argv: [
          "examples/weather-server/server.suite.json",
          "--command",
          "node",
          "--arg",
          "examples/weather-server/server.mjs",
        ],
      },
      {
        runId: "run-2",
        flow: "test",
        status: "done",
        exitCode: 0,
        argv: ["b.suite.json", "--url", "https://example.test/mcp"],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(runs), { status: 200 })),
    );
    render(<RunView runId={null} />);

    expect(await screen.findByText("examples/weather-server/server.suite.json")).toBeTruthy();
    expect(screen.getByText("node examples/weather-server/server.mjs")).toBeTruthy();
    expect(screen.getByText("https://example.test/mcp")).toBeTruthy();
  });

  it("대상을 모르면 그 칸을 비운다", async () => {
    const runs = [{ runId: "run-1", flow: "repair", status: "running", exitCode: null, argv: [] }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(runs), { status: 200 })),
    );
    render(<RunView runId={null} />);

    // 행 자체는 나온다. 없는 값을 "알 수 없음" 으로 지어내지 않는다.
    expect(await screen.findByText("run-1")).toBeTruthy();
    expect(screen.queryByTitle(/·/)).toBeNull();
  });

  it("상세 화면 머리에도 같은 대상 줄이 붙는다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);

    expect(await screen.findByText("suite.json")).toBeTruthy();
    expect(screen.getByText("node")).toBeTruthy();
  });
});

/**
 * #459 — 실행 화면의 리듬. 제목 위계·집계 칸·터미널 카드·빈 상태.
 *
 * 집계 칸이 지키는 약속은 하나다: **요약 줄이 오기 전에는 숫자를 그리지 않는다.**
 * `mcpeak test` 는 끝에 한 번 출력하므로 그 전의 숫자는 전부 지어낸 것이다.
 */
describe("RunView — 실행 화면 (#459)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
    window.location.hash = "";
    Reflect.deleteProperty(navigator, "clipboard");
  });

  /** jsdom 에는 `navigator.clipboard` 가 없다. 쓰기만 기록하는 가짜를 단다. */
  function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  }

  function tile(label: string): string | null | undefined {
    return screen.getByText(label).closest("div")?.querySelector("dd")?.textContent;
  }

  it("제목은 run 의 flow 로 정하고 page 제목 크기를 쓴다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);

    const heading = await screen.findByRole("heading", { level: 1, name: "테스트 실행" });
    expect(heading.classList.contains("text-display")).toBe(true);
    expect(screen.getByText("run-1")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Runs 목록/ }).getAttribute("href")).toBe("#/runs");
  });

  /**
   * 진행률은 그리지 않는다(#459 피드백). 실행 중에는 몇 건째인지 알 수 없어 막대가 새로 알려
   * 주는 것이 없었다. 남은 것은 세 칸뿐이고, 모르는 동안은 `—` 다.
   */
  it("실행 중에는 진행 막대 없이 세 칸만 비어 있다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "stdout", html: "▸ 시험 실행 중...\n" });
    });

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(tile("통과")).toBe("—");
    expect(tile("실패")).toBe("—");
    expect(tile("미실행")).toBe("—");
  });

  /** 한 줄을 따로 쓰면 그만큼 터미널이 준다. 실행 화면의 주인공은 터미널이다(#459 피드백). */
  it("세 칸은 따로 한 줄을 쓰지 않고 화면 머리 안에 선다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);

    const heading = await screen.findByRole("heading", { level: 1, name: "테스트 실행" });
    expect(screen.getByText("통과").closest("header")).toBe(heading.closest("header"));
  });

  it("요약 줄이 오면 세 칸을 채운다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({
        kind: "stdout",
        html: 'S  (4 cases)\n\n<span class="ansi-32">✓</span> a\n\n2 passed, 1 failed, 1 not run  (4 total)\n',
      });
      lastSource().emit({ kind: "done", exitCode: 1 });
    });

    expect(tile("통과")).toBe("2");
    expect(tile("실패")).toBe("1");
    expect(tile("미실행")).toBe("1");
  });

  it("요약 줄 없이 끝난 run 은 숫자를 지어내지 않는다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "stdout", html: "스위트를 저장했습니다.\n" });
      lastSource().emit({ kind: "done", exitCode: 0 });
    });

    expect(tile("통과")).toBe("—");
    expect(tile("실패")).toBe("—");
  });

  /** 생성 흐름은 요약 줄을 내지 않는다. 영영 채워지지 않을 칸을 그려 기다리게 하지 않는다. */
  it("생성 run 은 집계 칸을 그리지 않는다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              runId: "gen-1",
              flow: "generate",
              status: "running",
              exitCode: null,
              argv: ["--command", "node"],
            }),
            { status: 200 },
          ),
      ),
    );
    render(<RunView runId="gen-1" />);

    await screen.findByRole("heading", { level: 1, name: "생성 실행" });
    expect(screen.queryByText("통과")).toBeNull();
    expect(screen.getByRole("heading", { name: "터미널 출력" })).toBeTruthy();
  });

  it("입력 대기면 상태 아래에 할 일을 말하고 질문은 터미널 카드 밖에 선다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "stdout", html: "출력\n" });
      lastSource().emit({
        kind: "question",
        question: { id: "q1", kind: "confirm", message: "저장할까요?" },
      });
    });

    expect(screen.getByText("아래 질문에 답하면 이어서 진행합니다.")).toBeTruthy();
    const terminal = screen.getByRole("heading", { name: "터미널 출력" }).closest("section");
    expect(terminal?.textContent).toContain("출력");
    // 다크 터미널 안 바닥에 끼어 있으면 로그와 같은 무게로 읽힌다.
    expect(terminal?.textContent).not.toContain("저장할까요?");
    expect(screen.getByText("저장할까요?")).toBeTruthy();
  });

  it("없다고 확인된 run 은 빈 터미널 대신 다음 행동 링크를 준다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "그런 run이 없습니다." }), { status: 404 }),
      ),
    );
    render(<RunView runId="does-not-exist" />);

    await screen.findByText("그런 run이 없습니다.");
    expect(screen.queryByRole("heading", { name: "터미널 출력" })).toBeNull();
    expect(screen.queryByText("통과")).toBeNull();
    expect(screen.getByRole("link", { name: /Runs 목록으로/ }).getAttribute("href")).toBe("#/runs");
    expect(screen.getByRole("link", { name: "새 테스트 실행" }).getAttribute("href")).toBe(
      "#/home",
    );
  });

  /** 조회만 실패한 run 은 살아 있을 수 있다. 터미널을 거두면 오는 출력을 볼 자리가 없다. */
  it("404 가 아닌 조회 실패에는 터미널을 계속 그린다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "내부 오류가 발생했습니다." }), { status: 500 }),
      ),
    );
    render(<RunView runId="run-1" />);

    await screen.findByText(/내부 오류가 발생했습니다/);
    expect(screen.getByRole("heading", { name: "터미널 출력" })).toBeTruthy();
  });

  it("복사는 색 태그를 벗긴 평문을 클립보드에 넣고, 새 출력이 오면 라벨을 되돌린다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    const writeText = stubClipboard();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "stdout", html: '<span class="ansi-31">✗</span> a &lt;b&gt;\n' });
    });

    fireEvent.click(screen.getByRole("button", { name: "복사" }));
    await screen.findByRole("button", { name: "복사됨" });
    expect(writeText).toHaveBeenCalledWith("✗ a <b>\n");

    act(() => {
      lastSource().emit({ kind: "stdout", html: "다음 줄\n" });
    });
    expect(screen.getByRole("button", { name: "복사" })).toBeTruthy();
  });

  it("클립보드를 못 쓰면 이유와 대안을 말한다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "stdout", html: "출력\n" });
    });

    fireEvent.click(screen.getByRole("button", { name: "복사" }));
    expect(await screen.findByText(/터미널 출력을\(를\) 클립보드에 넣지 못했습니다/)).toBeTruthy();
    expect(screen.getByText(/직접 선택해 복사하세요/)).toBeTruthy();
  });

  it("Run ID 를 복사할 수 있다", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    const writeText = stubClipboard();
    render(<RunView runId="run-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Run ID 복사" }));
    await screen.findByRole("button", { name: "Run ID 복사됨" });
    expect(writeText).toHaveBeenCalledWith("run-1");
  });

  it("지우기는 화면에서만 가린다 — 요약 칸은 그대로 남는다", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubFetch();
    render(<RunView runId="run-1" />);
    act(() => {
      lastSource().emit({ kind: "stdout", html: "첫 출력\n1 passed  (1 total)\n" });
      lastSource().emit({ kind: "done", exitCode: 0 });
    });

    fireEvent.click(screen.getByRole("button", { name: "지우기" }));

    expect(screen.queryByText(/첫 출력/)).toBeNull();
    expect(screen.getByText("0줄")).toBeTruthy();
    expect(tile("통과")).toBe("1");
  });

  it("Runs 목록이 비면 Test 로 가는 링크를 준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    render(<RunView runId={null} />);

    expect(await screen.findByText("아직 실행이 없습니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Test 로 가서 실행하기/ }).getAttribute("href")).toBe(
      "#/home",
    );
  });
});

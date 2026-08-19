// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CassetteBrowser } from "../src/screens/CassetteBrowser.js";

const CASSETTE_PATH = "cassettes/weather.json";
const CASSETTE_CONTENT = JSON.stringify({
  version: 1,
  interactions: [
    {
      key: "k1",
      request: { toolName: "get_weather", args: { city: "seoul" } },
      response: { content: [{ type: "text", text: "맑음" }], isError: false, raw: {} },
    },
  ],
});

/** PUT 응답만 테스트별로 갈아끼우는 fetch fake. 실서버 없음. */
function stubFetch(putBody: unknown = { saved: true, mtimeMs: 2000 }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST") {
      return new Response(JSON.stringify({ runId: "run-9" }), { status: 200 });
    }
    if (method === "PUT") {
      return new Response(JSON.stringify(putBody), { status: 200 });
    }
    if (method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (url === "/api/cassettes") {
      return new Response(JSON.stringify([{ path: CASSETTE_PATH }]), { status: 200 });
    }
    if (url === "/api/suites") {
      return new Response(JSON.stringify([{ path: "examples/weather/suite.json" }]), {
        status: 200,
      });
    }
    if (url === `/api/cassettes/${encodeURIComponent(CASSETTE_PATH)}`) {
      return new Response(
        JSON.stringify({ path: CASSETTE_PATH, content: CASSETTE_CONTENT, mtimeMs: 1000 }),
        { status: 200 },
      );
    }
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CassetteBrowser", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("목록 선택 시 GET /api/cassettes/:path를 부르고 타임라인을 그린다", async () => {
    const fetchMock = stubFetch();
    const { rerender } = render(<CassetteBrowser path={null} />);
    const link = await screen.findByText(CASSETTE_PATH);
    expect(link.getAttribute("href")).toBe(`#/cassettes/${encodeURIComponent(CASSETTE_PATH)}`);

    // App이 해시 변경을 받아 path prop으로 다시 렌더하는 것을 재현한다.
    rerender(<CassetteBrowser path={CASSETTE_PATH} />);
    await screen.findByText("get_weather");
    expect(
      fetchMock.mock.calls.some(
        ([input]) => String(input) === `/api/cassettes/${encodeURIComponent(CASSETTE_PATH)}`,
      ),
    ).toBe(true);
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("저장이 PUT에 baseMtimeMs를 실어 보낸다", async () => {
    const fetchMock = stubFetch();
    render(<CassetteBrowser path={CASSETTE_PATH} />);
    // 타임라인 항목을 선택해야 원문 textarea와 저장이 활성화된다(PR #199 리뷰 반영).
    fireEvent.click(await screen.findByText("get_weather"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
    });
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(String(put?.[0])).toBe(`/api/cassettes/${encodeURIComponent(CASSETTE_PATH)}`);
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      content: CASSETTE_CONTENT,
      baseMtimeMs: 1000,
    });
  });

  it("conflict 응답이 경고를 띄우고 재저장하지 않는다", async () => {
    const fetchMock = stubFetch({ saved: false, reason: "conflict", mtimeMs: 3000 });
    render(<CassetteBrowser path={CASSETTE_PATH} />);
    fireEvent.click(await screen.findByText("get_weather"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await screen.findByText("다른 곳에서 파일이 바뀌었습니다. 새로고침 후 다시 시도하세요.");
    const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(1);
  });

  it('replay 버튼이 flow:"replay"와 --cassette argv를 POST한다', async () => {
    const fetchMock = stubFetch();
    render(<CassetteBrowser path={CASSETTE_PATH} />);
    const select = await screen.findByLabelText("재생할 스위트");
    await screen.findByText("examples/weather/suite.json");
    fireEvent.change(select, { target: { value: "examples/weather/suite.json" } });
    fireEvent.click(screen.getByRole("button", { name: "replay 실행" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-9");
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(String(post?.[0])).toBe("/api/runs");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      flow: "replay",
      argv: ["examples/weather/suite.json", "--cassette", CASSETTE_PATH],
    });
  });

  it("삭제가 DELETE 후 목록을 갱신한다", async () => {
    const fetchMock = stubFetch();
    render(<CassetteBrowser path={CASSETTE_PATH} />);
    fireEvent.click(await screen.findByRole("button", { name: "삭제" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
    });
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(String(del?.[0])).toBe(`/api/cassettes/${encodeURIComponent(CASSETTE_PATH)}`);
    // 목록 GET이 삭제 후 한 번 더 나간다.
    await waitFor(() => {
      const listGets = fetchMock.mock.calls.filter(
        ([input, init]) => String(input) === "/api/cassettes" && (init?.method ?? "GET") === "GET",
      );
      expect(listGets).toHaveLength(2);
    });
    expect(window.location.hash).toBe("#/cassettes");
  });

  it("타임라인 항목을 선택하기 전에는 저장이 비활성이다", async () => {
    stubFetch();
    render(<CassetteBrowser path={CASSETTE_PATH} />);
    await screen.findByText("get_weather");
    expect(screen.getByRole("button", { name: "저장" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByText("get_weather"));
    expect(screen.getByRole("button", { name: "저장" })).toHaveProperty("disabled", false);
  });

  // origin f9198e0의 회귀 테스트 이식: 경로 전환 뒤 늦게 도착한 이전 카세트 응답이
  // 현재 화면의 초안·mtime을 덮어쓰면 안 된다(key={path}가 이전 인스턴스를 분리한다).
  it("늦은 A 응답 뒤 B를 저장해도 B의 내용과 mtime만 전송한다", async () => {
    const aPath = "/api/cassettes/cassettes%2Fa.json";
    const bPath = "/api/cassettes/cassettes%2Fb.json";
    let resolveA: ((response: Response) => void) | undefined;
    const aResponse = new Promise<Response>((resolve) => {
      resolveA = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === aPath) return aResponse;
      if (url === bPath && method === "GET") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ path: "cassettes/b.json", content: "B 원본", mtimeMs: 200 }),
            { status: 200 },
          ),
        );
      }
      if (url === bPath && method === "PUT") {
        return Promise.resolve(
          new Response(JSON.stringify({ saved: true, mtimeMs: 201 }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<CassetteBrowser path="cassettes/a.json" />);
    view.rerender(<CassetteBrowser path="cassettes/b.json" />);
    const draft = await screen.findByDisplayValue("B 원본");

    resolveA?.(
      new Response(JSON.stringify({ path: "cassettes/a.json", content: "A 원본", mtimeMs: 100 }), {
        status: 200,
      }),
    );
    await Promise.resolve();

    fireEvent.change(draft, { target: { value: "B 수정" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
    });
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(String(put?.[0])).toBe(bPath);
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ content: "B 수정", baseMtimeMs: 200 });
    expect(
      screen.queryByText("다른 곳에서 파일이 바뀌었습니다. 새로고침 후 다시 시도하세요."),
    ).toBeNull();
  });
});

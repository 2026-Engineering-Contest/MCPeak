// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileContent, MockFileEntry } from "../../src/api-types.js";
import { type LoadedMock, MockStart } from "../src/mock-builder/MockStart.js";

const LIST: MockFileEntry[] = [
  { path: "examples/weather.mock.json", toolCount: 1, responseCount: 3 },
  { path: "mocks/search.mock.json", toolCount: 2, responseCount: 5 },
];

const FILE: FileContent = {
  path: "examples/weather.mock.json",
  content: JSON.stringify({
    tools: [
      { name: "get_weather", description: "도시의 현재 날씨", inputSchema: { type: "object" } },
    ],
    responses: [],
  }),
  mtimeMs: 7,
};

function mockApi(list: MockFileEntry[], file: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/api/mocks")) return new Response(JSON.stringify(list));
      if (url.startsWith("/api/mocks/")) return file();
      throw new Error(`예상하지 못한 요청: ${url}`);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MockStart", () => {
  it("새로 만들기를 누르면 onNew 다", async () => {
    mockApi(LIST, () => new Response(JSON.stringify(FILE)));
    const onNew = vi.fn();
    render(<MockStart onNew={onNew} onOpen={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("기존 목 목록을 도구 · 응답 수와 함께 보이고, 열면 초안으로 옮겨 넘긴다", async () => {
    mockApi(LIST, () => new Response(JSON.stringify(FILE)));
    const opened: LoadedMock[] = [];
    render(<MockStart onNew={() => undefined} onOpen={(mock) => opened.push(mock)} />);

    expect(await screen.findByText("도구 2 · 응답 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "examples/weather.mock.json 열기" }));

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]?.path).toBe("examples/weather.mock.json");
    expect(opened[0]?.mtimeMs).toBe(7);
    expect(opened[0]?.draft.tools[0]).toMatchObject({
      name: "get_weather",
      description: "도시의 현재 날씨",
    });
  });

  it("열 수 없으면 서버 문장을 줄 그대로 보여준다", async () => {
    const message =
      "→ 올바르지 않은 목 정의입니다 — examples/weather.mock.json: 객체가 아닙니다\n→ 형식: …";
    mockApi(LIST, () => new Response(JSON.stringify({ error: message }), { status: 400 }));
    render(<MockStart onNew={() => undefined} onOpen={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "examples/weather.mock.json 열기" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("목 정의 파일이 없으면 그렇게 말한다", async () => {
    mockApi([], () => new Response("{}"));
    render(<MockStart onNew={() => undefined} onOpen={() => undefined} />);
    expect(
      await screen.findByText(
        "이 디렉터리 아래에 목 정의 파일이 없습니다. 새로 만들기로 시작하세요.",
      ),
    ).toBeTruthy();
  });
});

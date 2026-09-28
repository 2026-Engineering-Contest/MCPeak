// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

const LEAVE = "→ 저장하지 않은 목을 버리고 다른 화면으로 이동합니다.";

/** GET 은 전부 빈 목록, PUT 은 저장 성공. */
function fakeFetch(): typeof fetch {
  return vi.fn(async (_input: unknown, init?: { method?: string }) =>
    init?.method === "PUT"
      ? new Response(JSON.stringify({ saved: true, mtimeMs: 1 }))
      : new Response("[]"),
  ) as unknown as typeof fetch;
}

async function editMock(): Promise<void> {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "시작" }));
  fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
}

function unloadPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("목 만들기 이탈 확인", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fakeFetch());
    window.location.hash = "#/mock";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("고친 뒤 해시가 바뀌면 되돌리고 묻는다. 버리고 이동하면 간다", async () => {
    await editMock();
    window.location.hash = "#/runs";
    expect(await screen.findByText(LEAVE)).toBeTruthy();
    expect(window.location.hash).toBe("#/mock");
    expect(screen.getByLabelText("도구 이름")).toBeTruthy(); // 폼이 남아 있다

    fireEvent.click(screen.getByRole("button", { name: "버리고 이동" }));
    await waitFor(() => expect(window.location.hash).toBe("#/runs"));
    await waitFor(() => expect(screen.queryByLabelText("도구 이름")).toBeNull());
  });

  it("취소하면 확인 줄만 닫고 그대로 있는다", async () => {
    await editMock();
    window.location.hash = "#/runs";
    fireEvent.click(await screen.findByRole("button", { name: "취소" }));
    expect(screen.queryByText(LEAVE)).toBeNull();
    expect(window.location.hash).toBe("#/mock");
    expect(screen.getByLabelText("도구 이름")).toBeTruthy();
  });

  it("고치지 않았으면 묻지 않고 간다", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "시작" }));
    window.location.hash = "#/runs";
    await waitFor(() => expect(screen.queryByRole("button", { name: "도구 추가" })).toBeNull());
    expect(screen.queryByText(LEAVE)).toBeNull();
  });

  it("저장하면 다시 묻지 않는다", async () => {
    await editMock();
    fireEvent.change(screen.getByLabelText("도구 이름"), { target: { value: "ping" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("저장했습니다 — mock.json");
    window.location.hash = "#/runs";
    await waitFor(() => expect(screen.queryByLabelText("도구 이름")).toBeNull());
    expect(screen.queryByText(LEAVE)).toBeNull();
  });

  it("고친 동안만 새로고침 · 탭 닫기를 막는다", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "시작" }));
    expect(unloadPrevented()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
    expect(unloadPrevented()).toBe(true);
  });

  it("처음으로 확인 중에 해시가 바뀌면 이동 확인 하나만 남는다", async () => {
    await editMock();
    fireEvent.click(screen.getByRole("button", { name: "← 처음으로" }));
    expect(await screen.findByText("→ 지금 폼의 내용을 버리고 처음으로 돌아갑니다.")).toBeTruthy();

    window.location.hash = "#/runs";
    expect(await screen.findByText(LEAVE)).toBeTruthy();

    expect(screen.queryByText("→ 지금 폼의 내용을 버리고 처음으로 돌아갑니다.")).toBeNull();
    expect(screen.getAllByRole("button", { name: "취소" })).toHaveLength(1);
  });

  it("이동 확인 중에 처음으로를 누르면 처음으로 확인 하나만 남는다", async () => {
    await editMock();
    window.location.hash = "#/runs";
    expect(await screen.findByText(LEAVE)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "← 처음으로" }));
    expect(await screen.findByText("→ 지금 폼의 내용을 버리고 처음으로 돌아갑니다.")).toBeTruthy();

    expect(screen.queryByText(LEAVE)).toBeNull();
    expect(screen.getAllByRole("button", { name: "취소" })).toHaveLength(1);
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CassetteBrowser } from "../src/screens/CassetteBrowser.js";

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CassetteBrowser", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("conflict 응답이 경고를 띄우고 재저장하지 않는다", async () => {
    const fetchMock = vi
      .fn()
      // GET /api/cassettes/:path
      .mockResolvedValueOnce(
        fakeResponse(200, {
          path: "cassettes/weather.json",
          content: '{"interactions":[]}',
          mtimeMs: 1000,
        }),
      )
      // PUT /api/cassettes/:path → 충돌
      .mockResolvedValueOnce(
        fakeResponse(200, { saved: false, reason: "conflict", mtimeMs: 2000 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(CassetteBrowser, { path: "cassettes/weather.json" }));

    const saveButton = await screen.findByText("저장");
    fireEvent.click(saveButton);

    const warning = await screen.findByText(
      "다른 곳에서 파일이 바뀌었습니다. 새로고침 후 다시 시도하세요.",
    );
    expect(warning).toBeDefined();

    // GET 1회 + PUT 1회만 나가야 한다(재저장 없음).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("늦은 A 응답 뒤 B를 저장해도 B의 내용과 mtime만 전송한다", async () => {
    const bPath = "/api/cassettes/cassettes%2Fb.json";
    const bSaveRequest = { content: "B 수정", baseMtimeMs: 200 };
    const conflictMessage = "다른 곳에서 파일이 바뀌었습니다. 새로고침 후 다시 시도하세요.";
    let resolveA: ((response: Response) => void) | undefined;
    const aResponse = new Promise<Response>((resolve) => {
      resolveA = resolve;
    });
    const fetchMock = vi.fn((url: string, options?: RequestInit): Promise<Response> => {
      if (url === "/api/cassettes/cassettes%2Fa.json") return aResponse;
      if (url === bPath && options === undefined) {
        return Promise.resolve(
          fakeResponse(200, { path: "cassettes/b.json", content: "B 원본", mtimeMs: 200 }),
        );
      }
      if (
        url === bPath &&
        options?.method === "PUT" &&
        options.body === JSON.stringify(bSaveRequest)
      ) {
        return Promise.resolve(fakeResponse(200, { saved: true, mtimeMs: 201 }));
      }
      return Promise.resolve(fakeResponse(200, { saved: false, reason: "conflict", mtimeMs: 201 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(React.createElement(CassetteBrowser, { path: "cassettes/a.json" }));
    view.rerender(React.createElement(CassetteBrowser, { path: "cassettes/b.json" }));

    const draft = await screen.findByDisplayValue("B 원본");
    await act(async () => {
      resolveA?.(fakeResponse(200, { path: "cassettes/a.json", content: "A 원본", mtimeMs: 100 }));
      await Promise.resolve();
    });
    fireEvent.change(draft, { target: { value: "B 수정" } });
    const saveButton = screen.getByText("저장");
    fireEvent.click(saveButton);

    expect(saveButton).toHaveProperty("disabled", true);
    await waitFor(() => {
      expect(saveButton).toHaveProperty("disabled", false);
    });
    expect(screen.queryByText(conflictMessage)).toBeNull();
  });
});

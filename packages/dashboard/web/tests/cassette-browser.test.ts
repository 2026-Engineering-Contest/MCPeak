// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    let resolveA: ((response: Response) => void) | undefined;
    const aResponse = new Promise<Response>((resolve) => {
      resolveA = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(aResponse)
      .mockResolvedValueOnce(
        fakeResponse(200, { path: "cassettes/b.json", content: "B 원본", mtimeMs: 200 }),
      )
      .mockResolvedValueOnce(fakeResponse(200, { saved: true, mtimeMs: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const view = render(React.createElement(CassetteBrowser, { path: "cassettes/a.json" }));
    view.rerender(React.createElement(CassetteBrowser, { path: "cassettes/b.json" }));

    const draft = await screen.findByDisplayValue("B 원본");
    await act(async () => {
      resolveA?.(fakeResponse(200, { path: "cassettes/a.json", content: "A 원본", mtimeMs: 100 }));
      await Promise.resolve();
    });
    fireEvent.change(draft, { target: { value: "B 수정" } });
    fireEvent.click(screen.getByText("저장"));

    await screen.findByDisplayValue("B 수정");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/cassettes/cassettes%2Fb.json", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "B 수정", baseMtimeMs: 200 }),
    });
  });
});

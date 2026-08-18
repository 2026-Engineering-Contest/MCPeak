// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiSend } from "../src/api.js";

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("apiGet이 JSON을 돌려준다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiGet<{ ok: boolean }>("/api/health");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/health");
  });

  it("4xx면 ApiError.error 메시지로 throw한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fakeResponse(400, { error: "경로 탈출 요청입니다." }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("/api/suites/..%2Fetc")).rejects.toThrow("경로 탈출 요청입니다.");
  });

  it("apiSend가 4xx면 ApiError.error 메시지로 throw한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(409, { error: "충돌입니다." }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiSend("POST", "/api/runs", { flow: "test", argv: [] })).rejects.toThrow(
      "충돌입니다.",
    );
  });
});

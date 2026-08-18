// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerateWizard } from "../src/screens/GenerateWizard.js";

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fillRequiredFields(): void {
  fireEvent.change(screen.getByLabelText("명령어 *"), { target: { value: "node server.js" } });
  fireEvent.change(screen.getByLabelText("스위트 ID *"), { target: { value: "suite-1" } });
  fireEvent.change(screen.getByLabelText("스위트 이름 *"), { target: { value: "테스트 스위트" } });
  fireEvent.change(screen.getByLabelText("출력 경로 *"), {
    target: { value: "suites/weather.json" },
  });
}

describe("GenerateWizard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("record 체크 시 argv에 --record가 들어간다", () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { runId: "run-1" }));
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(GenerateWizard));
    fillRequiredFields();
    fireEvent.click(screen.getByLabelText("--record (카세트를 새로 녹화)"));
    fireEvent.click(screen.getByText("생성 시작"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { flow: string; argv: string[] };
    expect(body.flow).toBe("generate");
    expect(body.argv).toContain("--record");
  });

  it("카세트 경로 입력 시 --cassette <경로>가 들어간다", () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { runId: "run-1" }));
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(GenerateWizard));
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("카세트 경로"), {
      target: { value: "cassettes/weather.json" },
    });
    fireEvent.click(screen.getByText("생성 시작"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { flow: string; argv: string[] };
    const cassetteIndex = body.argv.indexOf("--cassette");
    expect(cassetteIndex).toBeGreaterThanOrEqual(0);
    expect(body.argv[cassetteIndex + 1]).toBe("cassettes/weather.json");
  });

  it("빈 필수 필드는 제출 버튼을 비활성화한다", () => {
    render(React.createElement(GenerateWizard));

    const submit = screen.getByText("생성 시작") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fillRequiredFields();

    expect(submit.disabled).toBe(false);
  });
});

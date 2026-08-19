// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionPanel } from "../src/components/QuestionPanel.js";

function fakeResponse(status: number): Response {
  return new Response(undefined, { status });
}

describe("QuestionPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("choose가 선택지 수만큼 버튼을 그리고 클릭 값이 answer로 간다", () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(204));
    vi.stubGlobal("fetch", fetchMock);

    render(
      React.createElement(QuestionPanel, {
        runId: "run-1",
        question: {
          id: "q1",
          kind: "choose",
          message: "다음 중 하나를 고르세요",
          choices: ["a", "b", "c"],
        },
      }),
    );

    expect(screen.getAllByRole("button")).toHaveLength(3);

    fireEvent.click(screen.getByText("b"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/answer",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ questionId: "q1", value: "b" }),
      }),
    );
  });

  it('confirm 예가 value "y"로 간다', () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(204));
    vi.stubGlobal("fetch", fetchMock);

    render(
      React.createElement(QuestionPanel, {
        runId: "run-1",
        question: { id: "q1", kind: "confirm", message: "계속할까요?" },
      }),
    );

    fireEvent.click(screen.getByText("예"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/answer",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ questionId: "q1", value: "y" }),
      }),
    );
  });

  it("input 제출이 입력 문자열 그대로 간다", () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(204));
    vi.stubGlobal("fetch", fetchMock);

    render(
      React.createElement(QuestionPanel, {
        runId: "run-1",
        question: { id: "q1", kind: "input", message: "이름을 입력하세요" },
      }),
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "hello world" } });
    fireEvent.click(screen.getByText("제출"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/answer",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ questionId: "q1", value: "hello world" }),
      }),
    );
  });
});

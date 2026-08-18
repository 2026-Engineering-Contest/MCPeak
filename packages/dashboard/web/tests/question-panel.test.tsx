// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionPanel } from "../src/components/QuestionPanel.js";

describe("QuestionPanel", () => {
  afterEach(cleanup);

  it("choose가 선택지 수만큼 버튼을 그리고 클릭 값이 onAnswer로 간다", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionPanel
        question={{
          id: "q1",
          kind: "choose",
          message: "다음 중 하나를 고르세요",
          choices: ["a", "b", "c"],
        }}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    fireEvent.click(screen.getByText("b"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("b");
  });

  it('confirm 예가 "y", 아니오가 "n"으로 간다', () => {
    const onAnswer = vi.fn();
    render(
      <QuestionPanel
        question={{ id: "q1", kind: "confirm", message: "계속할까요?" }}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByText("예"));
    expect(onAnswer).toHaveBeenLastCalledWith("y");
    fireEvent.click(screen.getByText("아니오"));
    expect(onAnswer).toHaveBeenLastCalledWith("n");
  });

  it("input 제출이 입력 문자열 그대로 간다", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionPanel
        question={{ id: "q1", kind: "input", message: "값을 입력하세요" }}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  그대로 전달 " } });
    fireEvent.click(screen.getByText("제출"));
    expect(onAnswer).toHaveBeenCalledWith("  그대로 전달 ");
  });
});

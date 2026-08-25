// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionPanel } from "../src/components/QuestionPanel.js";

describe("QuestionPanel", () => {
  afterEach(cleanup);

  it("choose가 선택지 수만큼 버튼을 그리고 클릭 값이 onAnswer로 간다", () => {
    const onAnswer = vi.fn(async () => {});
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

  it("검토 메뉴와 AI 입력은 연보라 배경과 그에 맞는 글자색을 쓴다", () => {
    const onAnswer = vi.fn(async () => {});
    const { container, rerender } = render(
      <QuestionPanel
        question={{
          id: "q1",
          kind: "choose",
          message: "검토 메뉴",
          choices: ["show", "save"],
        }}
        onAnswer={onAnswer}
      />,
    );

    expect(container.firstElementChild?.classList.contains("bg-accent-soft")).toBe(true);
    expect(screen.getByText("검토 메뉴").classList.contains("text-ink")).toBe(true);
    expect(screen.getByRole("button", { name: "show" }).classList.contains("bg-surface")).toBe(
      true,
    );

    rerender(
      <QuestionPanel
        question={{ id: "q2", kind: "choose", message: "다른 선택", choices: ["a"] }}
        onAnswer={onAnswer}
      />,
    );
    expect(container.firstElementChild?.classList.contains("bg-accent-soft")).toBe(false);

    rerender(
      <QuestionPanel
        question={{ id: "q3", kind: "input", message: "AI 요청: " }}
        onAnswer={onAnswer}
      />,
    );
    expect(container.firstElementChild?.classList.contains("bg-accent-soft")).toBe(true);
    expect(screen.getByText("AI 요청:").classList.contains("text-ink")).toBe(true);
    expect(screen.getByRole("textbox").classList.contains("bg-surface")).toBe(true);
  });

  it('confirm 예가 "y", 아니오가 "n"으로 간다', async () => {
    const onAnswer = vi.fn(async () => {});
    render(
      <QuestionPanel
        question={{ id: "q1", kind: "confirm", message: "계속할까요?" }}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByText("예"));
    expect(onAnswer).toHaveBeenLastCalledWith("y");
    // 첫 응답이 끝나 컨트롤이 다시 활성화된 뒤에야 다음 클릭이 전달된다.
    await waitFor(() => {
      expect(screen.getByText("아니오")).toHaveProperty("disabled", false);
    });
    fireEvent.click(screen.getByText("아니오"));
    expect(onAnswer).toHaveBeenLastCalledWith("n");
  });

  it("input 제출이 입력 문자열 그대로 간다", () => {
    const onAnswer = vi.fn(async () => {});
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

  it("뒤로갈 수 있는 입력 질문은 테마 안의 뒤로가기 버튼을 제공한다", () => {
    const onAnswer = vi.fn(async () => {});
    const onBack = vi.fn(async () => {});
    render(
      <QuestionPanel
        question={{ id: "q1", kind: "input", message: "AI 요청: " }}
        onAnswer={onAnswer}
        onBack={onBack}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "검토 메뉴로 돌아가기" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("응답이 진행 중이면 컨트롤이 비활성화되고 중복 전송되지 않는다", async () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    render(
      <QuestionPanel
        question={{ id: "q1", kind: "confirm", message: "계속할까요?" }}
        onAnswer={onAnswer}
      />,
    );
    const yes = screen.getByRole("button", { name: "예" });
    fireEvent.click(yes);
    fireEvent.click(yes);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(yes).toHaveProperty("disabled", true);
    await act(async () => {
      resolveAnswer?.();
      await Promise.resolve();
    });
    expect(yes).toHaveProperty("disabled", false);
  });
});

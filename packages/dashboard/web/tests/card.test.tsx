// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "../src/components/Card.js";

describe("Card", () => {
  afterEach(cleanup);

  it("감싸는 요소 없이 div 하나만 낸다", () => {
    const { container } = render(<Card>내용</Card>);
    expect(container.childNodes).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe("DIV");
  });

  it("면·테두리·모서리·그림자를 함께 갖는다", () => {
    // 그림자가 이 컴포넌트의 존재 이유 중 하나다. 예전에는 저장소 전체에 그림자가
    // 0개라 카드와 페이지 배경이 같은 평면에 있었다.
    const { container } = render(<Card>내용</Card>);
    const classes = container.firstElementChild?.className ?? "";
    for (const token of ["bg-surface", "border-line", "rounded-lg", "shadow-card"]) {
      expect(classes).toContain(token);
    }
  });

  it("className 을 덮지 않고 뒤에 붙인다", () => {
    // 여백을 기본값으로 두지 않았으므로 호출부가 p-6 · overflow-hidden 을 얹는다.
    const { container } = render(<Card className="overflow-hidden p-6">내용</Card>);
    const classes = container.firstElementChild?.className ?? "";
    expect(classes).toContain("overflow-hidden");
    expect(classes).toContain("p-6");
    expect(classes).toContain("bg-surface");
  });

  it("children 과 div 속성을 그대로 전달한다", () => {
    render(
      <Card aria-label="실행 목록" id="runs">
        <span>행</span>
      </Card>,
    );
    const card = screen.getByLabelText("실행 목록");
    expect(card.id).toBe("runs");
    expect(card.textContent).toBe("행");
  });
});

// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Stepper } from "../src/components/Stepper.js";

describe("Stepper", () => {
  afterEach(cleanup);

  it("current 이전은 체크 아이콘, current는 강조, 이후는 번호다", () => {
    const { container } = render(
      <Stepper steps={["서버", "스위트", "생성 방식", "확인"]} current={2} />,
    );
    const circles = Array.from(container.querySelectorAll("[data-step-state]"));
    expect(circles.map((c) => c.getAttribute("data-step-state"))).toEqual([
      "done",
      "done",
      "current",
      "todo",
    ]);
    // 이전 두 단계: 숫자 대신 체크 아이콘(svg).
    expect(circles[0]?.querySelector("svg")).not.toBeNull();
    expect(circles[1]?.querySelector("svg")).not.toBeNull();
    expect(circles[0]?.textContent).not.toContain("1");
    // current: accent 채움 강조 + aria-current="step".
    expect(circles[2]?.className).toContain("bg-accent");
    expect(circles[2]?.textContent).toBe("3");
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("생성 방식");
    // 이후: 테두리만 있는 번호.
    expect(circles[3]?.querySelector("svg")).toBeNull();
    expect(circles[3]?.textContent).toBe("4");
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Field, INPUT_CLASS, INPUT_ON_ACCENT_CLASS } from "../src/components/Field.js";

describe("Field", () => {
  afterEach(cleanup);

  it("라벨이 htmlFor 로 컨트롤과 묶인다", () => {
    render(
      <Field label="라벨" htmlFor="x">
        <input id="x" />
      </Field>,
    );
    expect(screen.getByLabelText("라벨")).toBe(screen.getByRole("textbox"));
  });

  it("hint 가 없으면 설명 문단을 그리지 않는다", () => {
    const { container } = render(
      <Field label="라벨" htmlFor="x">
        <input id="x" />
      </Field>,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("hint 는 컨트롤 뒤에 온다", () => {
    const { container } = render(
      <Field label="라벨" htmlFor="x" hint="힌트">
        <input id="x" />
      </Field>,
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("라벨")).toBeLessThan(text.indexOf("힌트"));

    const input = screen.getByRole("textbox");
    expect(input.nextElementSibling?.tagName).toBe("P");
    expect(input.nextElementSibling?.textContent).toBe("힌트");
  });

  it("두 입력칸 갈래가 같은 바탕을 쓴다", () => {
    /*
     * 예전에 RunView 가 이 문자열을 손으로 베껴 REPAIR_INPUT_CLASS 를 만들면서
     * disabled:opacity-50 을 빠뜨렸다 — 비활성인데 흐려지지 않는 칸이 repair 폼에만
     * 생겼고, 그것을 알려 주는 것이 아무것도 없었다. 두 갈래가 여기서 갈라지지 않게
     * 같은 바탕에서 나오는 것을 이 테스트가 지킨다.
     */
    for (const token of ["disabled:opacity-50", "bg-surface", "px-3", "py-1.5", "text-sm"]) {
      expect(INPUT_CLASS).toContain(token);
      expect(INPUT_ON_ACCENT_CLASS).toContain(token);
    }
  });

  it("두 갈래의 테두리 색과 폭만 다르다", () => {
    const base = INPUT_CLASS.split(" ");
    const onAccent = INPUT_ON_ACCENT_CLASS.split(" ");

    expect(base).toContain("w-full");
    expect(base).toContain("border-line");
    expect(base).not.toContain("flex-1");
    expect(base).not.toContain("border-accent-border");

    expect(onAccent).toContain("flex-1");
    expect(onAccent).toContain("border-accent-border");
    expect(onAccent).not.toContain("w-full");
    expect(onAccent).not.toContain("border-line");
  });

  it("입력칸에도 Button 과 같은 포커스 링이 있다", () => {
    expect(INPUT_CLASS).toContain("focus-visible:outline-focus-ring");
    expect(INPUT_ON_ACCENT_CLASS).toContain("focus-visible:outline-focus-ring");
  });
});

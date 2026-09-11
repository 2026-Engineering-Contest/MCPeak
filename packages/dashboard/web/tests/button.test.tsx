// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ButtonSize, ButtonVariant } from "../src/components/Button.js";
import { Button } from "../src/components/Button.js";

const VARIANTS: readonly ButtonVariant[] = ["primary", "secondary", "ghost"];
const SIZES: readonly ButtonSize[] = ["xs", "sm", "md"];

function classesOf(name: string): string {
  return screen.getByRole("button", { name }).className;
}

describe("Button", () => {
  afterEach(cleanup);

  it("감싸는 요소 없이 button 하나만 낸다", () => {
    /*
     * QuestionPanel 의 버튼들이 LogPanel 푸터 안에 있고, log-panel.test.tsx 가 그 안을
     * `div[class] > div` 로 센다. 여기서 래퍼가 하나라도 생기면 이 버튼과 상관없는
     * 그 테스트가 깨진다 — 그때 원인을 여기서 바로 알 수 있게 못 박아 둔다.
     */
    const { container } = render(<Button>확인</Button>);
    expect(container.childNodes).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe("BUTTON");
  });

  it("type 기본값이 button 이다", () => {
    // HTML 기본값은 submit 이다. 폼 안에 놓인 버튼이 기본값을 물려받으면 누를 때마다
    // 폼이 제출된다 — 예전에는 34곳이 각자 type="button" 을 손으로 적어 막고 있었다.
    render(<Button>확인</Button>);
    expect(screen.getByRole("button", { name: "확인" }).getAttribute("type")).toBe("button");
  });

  it("type 을 넘기면 그 값이 이긴다", () => {
    render(<Button type="submit">제출</Button>);
    expect(screen.getByRole("button", { name: "제출" }).getAttribute("type")).toBe("submit");
  });

  it("variant 셋이 서로 다른 클래스를 낸다", () => {
    render(
      <div>
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
      </div>,
    );
    const seen = VARIANTS.map((variant) => classesOf(variant));
    expect(new Set(seen).size).toBe(VARIANTS.length);
  });

  it("size 셋이 서로 다른 클래스를 낸다", () => {
    render(
      <div>
        {SIZES.map((size) => (
          <Button key={size} size={size}>
            {size}
          </Button>
        ))}
      </div>,
    );
    const seen = SIZES.map((size) => classesOf(size));
    expect(new Set(seen).size).toBe(SIZES.length);
  });

  it("className 을 덮지 않고 뒤에 붙인다", () => {
    // 호출부가 shrink-0 · whitespace-nowrap 같은 배치 클래스를 얹는다. 덮으면
    // 그 자리들이 조용히 무너지는데, 화면을 봐야만 알 수 있는 종류의 고장이다.
    render(
      <Button variant="primary" className="shrink-0 whitespace-nowrap">
        추가
      </Button>,
    );
    const classes = classesOf("추가");
    expect(classes).toContain("shrink-0");
    expect(classes).toContain("whitespace-nowrap");
    expect(classes).toContain("bg-accent");
  });

  it("세 variant 모두 focus-visible 스타일을 갖는다", () => {
    // 키보드로 쓰는 도구다. 저장소 전체에 focus-visible 이 0개이던 것이 이 PR 이
    // 고치려는 것이므로, variant 를 더할 때 빠뜨리지 않게 여기서 막는다.
    render(
      <div>
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
      </div>,
    );
    for (const variant of VARIANTS) {
      expect(classesOf(variant)).toContain("focus-visible:outline-focus-ring");
    }
  });

  it("disabled · aria-* · title 을 그대로 전달한다", () => {
    render(
      <Button disabled aria-expanded={false} title="설명" onClick={() => {}}>
        열기
      </Button>,
    );
    const button = screen.getByRole("button", { name: "열기" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("title")).toBe("설명");
  });

  it("aria-label 이 접근 가능한 이름을 정한다", () => {
    // ThemeToggle 이 이 방식을 쓴다. 111곳의 테스트가 버튼을 이름으로 찾으므로
    // 이 통로가 막히면 그 테스트들이 한꺼번에 버튼을 못 찾는다.
    render(<Button aria-label="테마: 다크 — 라이트 모드로 바꾸기">테마: 다크</Button>);
    expect(screen.getByRole("button", { name: "테마: 다크 — 라이트 모드로 바꾸기" })).toBeTruthy();
  });

  it("disabled 면 클릭이 핸들러에 닿지 않는다", () => {
    let clicks = 0;
    render(
      <Button
        disabled
        onClick={() => {
          clicks += 1;
        }}
      >
        실행
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(clicks).toBe(0);
  });
});

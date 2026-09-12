// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "../src/components/SegmentedControl.js";

type Mode = "off" | "record" | "replay";

const OPTIONS = [
  { value: "off", label: "사용 안 함" },
  { value: "record", label: "외부 호출 녹화" },
  { value: "replay", label: "재생" },
] as const satisfies readonly { value: Mode; label: string }[];

describe("SegmentedControl", () => {
  afterEach(cleanup);

  it("선택지마다 버튼 하나를 라벨 그대로 낸다", () => {
    render(<SegmentedControl options={OPTIONS} value="off" onChange={() => {}} />);
    const labels = screen.getAllByRole("button").map((button) => button.textContent);
    expect(labels).toEqual(["사용 안 함", "외부 호출 녹화", "재생"]);
  });

  it("고른 쪽만 aria-pressed 가 true 다", () => {
    render(<SegmentedControl options={OPTIONS} value="record" onChange={() => {}} />);
    const pressed = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-pressed"));
    expect(pressed).toEqual(["false", "true", "false"]);
  });

  it("누르면 그 값이 onChange 로 간다", () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="off" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "외부 호출 녹화" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("record");
  });

  it("fieldset 하나와 그 직계 button 들만 낸다", () => {
    /*
     * 래퍼를 만들면 이 컨트롤과 상관없는 구조 검사가 깨진다 — log-panel.test.tsx 가
     * 푸터 안을 `div[class] > div` 로 세는 것이 그런 검사다. Button·Card 와 같은 규율을
     * 여기서도 못 박아, 래퍼가 생긴 날 원인을 이 파일에서 바로 알 수 있게 한다.
     */
    const { container } = render(
      <SegmentedControl options={OPTIONS} value="off" onChange={() => {}} />,
    );
    expect(container.childNodes).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe("FIELDSET");
    expect(container.querySelectorAll("div")).toHaveLength(0);
    expect(container.querySelectorAll("fieldset > button")).toHaveLength(OPTIONS.length);
  });

  it("전체 disabled 가 모든 선택지를 끈다", () => {
    render(<SegmentedControl options={OPTIONS} value="off" disabled onChange={() => {}} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveProperty("disabled", true);
    }
  });

  it("선택지별 disabled 가 그 하나만 끈다", () => {
    /*
     * home.test.tsx 의 「Node 스크립트」 가 이 동작에 의존한다 — StepRunOptions 는 세그먼트
     * 전체가 아니라 선택지마다 다르게 끈다(`http || (mode !== "off" && determinism)`).
     * 전체 disabled 한 갈래만 두면 그 호출부가 자기 map 을 다시 적게 된다.
     */
    render(
      <SegmentedControl
        options={[
          { value: "off", label: "사용 안 함" },
          { value: "record", label: "외부 호출 녹화", disabled: true },
          { value: "replay", label: "재생" },
        ]}
        value="off"
        onChange={() => {}}
      />,
    );
    const disabled = screen
      .getAllByRole("button")
      .map((button) => (button as HTMLButtonElement).disabled);
    expect(disabled).toEqual([false, true, false]);
  });

  it("type 이 button 이다", () => {
    // 폼 안에 놓였을 때 누를 때마다 제출되지 않게. HTML 기본값은 submit 이다.
    render(<SegmentedControl options={OPTIONS} value="off" onChange={() => {}} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("잘리지 않는 포커스 링을 쓴다", () => {
    /*
     * `<fieldset>` 에 `overflow-hidden` 이 있고 버튼이 그 상자를 꽉 채운다. 바깥으로 2px
     * 띄우는 `outline-offset-2` 를 쓰면 조상이 링을 네 면 다 잘라 **테스트는 초록인데 화면에는
     * 아무것도 안 보인다.** jsdom 은 CSS 를 읽지 않아 잘림 자체를 볼 수 없으므로, 여기서는
     * 음수 offset 이라는 낱말이 남아 있는지만 지킨다.
     */
    render(<SegmentedControl options={OPTIONS} value="off" onChange={() => {}} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("focus-visible:outline-focus-ring");
      expect(button.className).toContain("focus-visible:-outline-offset-2");
    }
  });
});

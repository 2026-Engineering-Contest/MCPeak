// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionMode, TestOptions } from "../src/build-test-argv.js";
import { DEFAULT_TEST_OPTIONS } from "../src/build-test-argv.js";
import { TestOptionsPanel } from "../src/components/TestOptionsPanel.js";

/**
 * 테스트 옵션 패널(설계 §5-5). **비활성과 그 사유가 함께 보이는가** 가 이 파일의 요점이다.
 * CLI 가 거절하는 조합은 폼에서 만들 수 없어야 하고, 왜 못 만드는지는 컨트롤 옆에 있어야 한다.
 */

/** 옵션을 실제로 바꿔 보는 케이스용 껍데기. 패널 자체는 controlled 다. */
function Harness(props: {
  initial?: Partial<TestOptions>;
  sessionMode?: SessionMode;
  open?: boolean;
}): ReturnType<typeof TestOptionsPanel> {
  const [options, setOptions] = useState<TestOptions>({
    ...DEFAULT_TEST_OPTIONS,
    ...props.initial,
  });
  const [open, setOpen] = useState(props.open ?? true);
  return (
    <TestOptionsPanel
      suitePath="s.json"
      options={options}
      sessionMode={props.sessionMode ?? "off"}
      open={open}
      onToggle={() => setOpen((previous) => !previous)}
      onChange={(patch) => setOptions((previous) => ({ ...previous, ...patch }))}
    />
  );
}

afterEach(cleanup);

describe("테스트 옵션 패널", () => {
  it('접힌 상태에서 요약이 "기본값 · 바꾼 것 없음" 이다', () => {
    render(
      <TestOptionsPanel
        suitePath="s.json"
        options={DEFAULT_TEST_OPTIONS}
        sessionMode="off"
        open={false}
        onToggle={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("기본값 · 바꾼 것 없음")).toBeTruthy();
    expect(screen.getByRole("button", { name: /테스트 옵션/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    // 접혀 있으면 컨트롤은 그리지 않는다.
    expect(screen.queryByLabelText("결정론 검사")).toBeNull();
  });

  it('determinism 과 junit 을 바꾸면 요약이 "2개 바꿈" 이다', () => {
    render(
      <TestOptionsPanel
        suitePath="s.json"
        options={{ ...DEFAULT_TEST_OPTIONS, determinism: true, junitPath: "out/j.xml" }}
        sessionMode="off"
        open={false}
        onToggle={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("2개 바꿈")).toBeTruthy();
  });

  /**
   * 접속 방식은 이 패널에 없다. 마법사 1단계로 올라갔다(`StepRunServer`) — 명령이 비면
   * 1단계를 통과할 수 없어, 접속이 3단계에 있으면 HTTP 사용자가 갇힌다.
   */
  it("접속 컨트롤은 이 패널에 없다", () => {
    render(<Harness />);

    expect(screen.queryByRole("button", { name: "HTTP URL" })).toBeNull();
    expect(screen.queryByLabelText("URL")).toBeNull();
  });

  it("HTTP 대상이면 stderr 줄 수가 비활성이고 그 사유가 옆에 있다", () => {
    render(<Harness initial={{ transport: "http", url: "https://example.test/mcp" }} />);

    expect(screen.getByLabelText("서버 stderr 줄 수")).toHaveProperty("disabled", true);
    expect(screen.getByText("원격 서버에는 stderr 를 읽을 프로세스가 없습니다.")).toBeTruthy();
  });

  it("세션이 켜져 있으면 결정론 검사가 비활성이고 힌트가 보인다", () => {
    render(<Harness sessionMode="record" />);

    expect(screen.getByLabelText("결정론 검사")).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        "결정론 검사는 서버에 2회 연결하지만 세션은 연결 하나에 묶여 있어 함께 쓸 수 없습니다.",
      ),
    ).toBeTruthy();
  });
});

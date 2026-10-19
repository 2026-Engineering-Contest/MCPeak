// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { installFakeEventSource, runAll, stubFetch } from "./analyze-fixtures.js";

describe("App", () => {
  afterEach(() => {
    cleanup();
    window.location.hash = "#/";
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  // origin f9198e0의 회귀 계승: 잘못된 percent encoding이 화면을 깨뜨리면 안 된다.
  // 라우트가 #/runs 체계로 바뀌어 단언 대상만 새 라벨로 옮겼다.
  it.each([
    ["#/runs/%", "Runs"],
    ["#/repair/%ZZ", "Repair"],
  ])("잘못된 percent encoding 해시 %s를 식별자 없이 표시한다", (hash, label) => {
    window.location.hash = hash;

    render(React.createElement(App));

    const active = screen.getByRole("link", { name: label });
    expect(active.getAttribute("aria-current")).toBe("page");
  });

  it("#/analyze 는 분석 화면을 서버 선택 단계로 열고 카드·상세가 없다", () => {
    window.location.hash = "#/analyze";

    render(React.createElement(App));

    expect(screen.getByRole("heading", { name: "분석" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "분석하기" })).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.getByRole("link", { name: "Analyze" }).getAttribute("aria-current")).toBe("page");
  });

  it.each(["#/analyze/security", "#/analyze/tokens", "#/analyze/performance"])(
    "서버 선택 단계에서 %s 여도 상세가 없고 주소는 그대로다",
    (hash) => {
      window.location.hash = hash;

      render(React.createElement(App));

      expect(screen.getByRole("button", { name: "분석하기" })).toBeTruthy();
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(screen.queryByRole("tabpanel")).toBeNull();
      // 리다이렉트하지 않는다. 주소는 그대로다.
      expect(window.location.hash).toBe(hash);
    },
  );

  it("결과 단계에서 #/analyze/security 로 가면 보안 상세가 카드 아래 펼쳐진다", async () => {
    stubFetch();
    installFakeEventSource();
    window.location.hash = "#/analyze";
    render(React.createElement(App));
    await runAll();
    await screen.findByRole("tablist", { name: "분석 축" });
    expect(screen.queryByRole("tabpanel")).toBeNull();

    window.location.hash = "#/analyze/security";

    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "보안 상세" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^보안/ }).getAttribute("aria-selected")).toBe("true");

    // 성능 효율성은 상세가 없는 축이다. 주소는 그대로 두고 상세를 닫는다.
    window.location.hash = "#/analyze/performance";
    await waitFor(() => expect(screen.queryByRole("tabpanel")).toBeNull());
    expect(window.location.hash).toBe("#/analyze/performance");
  });
});

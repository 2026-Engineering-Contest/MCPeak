// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

describe("App", () => {
  afterEach(() => {
    cleanup();
    window.location.hash = "#/";
    window.localStorage.clear();
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

  it("#/analyze 는 분석 화면을 열고 상세 없이 축 카드 셋을 보인다", () => {
    window.location.hash = "#/analyze";

    render(React.createElement(App));

    expect(screen.getByRole("heading", { name: "분석" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.getByRole("link", { name: "Analyze" }).getAttribute("aria-current")).toBe("page");
  });

  it("#/analyze/security 는 보안 상세를 연다", () => {
    window.location.hash = "#/analyze/security";

    render(React.createElement(App));

    expect(screen.getByRole("tab", { name: /^보안/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "보안 상세" })).toBeTruthy();
  });

  it("#/analyze/tokens 는 비용 상세를 연다", () => {
    window.location.hash = "#/analyze/tokens";

    render(React.createElement(App));

    expect(screen.getByRole("tab", { name: /^비용 최적화/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: /^보안/ }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "비용 최적화 상세" })).toBeTruthy();
  });

  it("#/analyze/performance 는 개요로 연다", () => {
    window.location.hash = "#/analyze/performance";

    render(React.createElement(App));

    expect(screen.queryByRole("tabpanel")).toBeNull();
    // 리다이렉트하지 않는다. 주소는 그대로다.
    expect(window.location.hash).toBe("#/analyze/performance");
  });
});

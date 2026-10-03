// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

describe("App", () => {
  afterEach(() => {
    cleanup();
    window.location.hash = "#/";
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

  it("#/analyze 는 분석 화면과 토큰 탭을 연다", () => {
    window.location.hash = "#/analyze";

    render(React.createElement(App));

    expect(screen.getByRole("heading", { name: "분석" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "토큰" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("link", { name: "Analyze" }).getAttribute("aria-current")).toBe("page");
  });

  it("#/analyze/security 는 보안 탭을 연다", () => {
    window.location.hash = "#/analyze/security";

    render(React.createElement(App));

    expect(screen.getByRole("tab", { name: "보안" }).getAttribute("aria-selected")).toBe("true");
  });
});

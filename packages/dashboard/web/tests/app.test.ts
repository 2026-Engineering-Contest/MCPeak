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

  it.each([
    ["#/run/%", "실행"],
    ["#/repair/%ZZ", "수리 검토"],
    ["#/cassettes/foo/%", "카세트"],
  ])("잘못된 percent encoding 해시 %s를 식별자 없이 표시한다", (hash, heading) => {
    window.location.hash = hash;

    render(React.createElement(App));

    expect(screen.getByRole("heading", { name: heading })).toBeDefined();
  });
});

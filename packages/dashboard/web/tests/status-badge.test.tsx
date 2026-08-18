// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge } from "../src/components/StatusBadge.js";

describe("StatusBadge", () => {
  afterEach(cleanup);

  it("4상태의 라벨이 사양과 일치한다", () => {
    render(
      <>
        <StatusBadge status="running" exitCode={null} />
        <StatusBadge status="waiting-input" exitCode={null} />
        <StatusBadge status="done" exitCode={0} />
        <StatusBadge status="failed" exitCode={1} />
      </>,
    );
    expect(screen.getByText("실행 중")).toBeTruthy();
    expect(screen.getByText("입력 대기")).toBeTruthy();
    expect(screen.getByText("완료 · exit 0")).toBeTruthy();
    expect(screen.getByText("실패 · exit 1")).toBeTruthy();
  });
});

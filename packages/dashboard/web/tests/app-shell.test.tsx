// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

/** 화면들이 마운트 시 부르는 GET을 전부 빈 목록으로 응답하는 fetch fake. */
function fakeFetch(): typeof fetch {
  return vi.fn(async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
}

const NAV_LABELS = ["Test", "Runs", "Generate", "Replay", "Repair"];
/** 사이드바 아래쪽 보조 링크(#459). 주 메뉴 뒤에 따로 선다. */
const SECONDARY_LABELS = ["Settings", "Help & Docs"];

/** 링크의 보이는 이름. 화면 읽기 전용 꼬리("새 탭에서 열림")는 뺀다. */
function visibleLabel(link: HTMLAnchorElement): string | undefined {
  const copy = link.cloneNode(true) as HTMLAnchorElement;
  for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
  return copy.textContent?.trim();
}

describe("app shell", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fakeFetch());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("사이드바 라벨이 순서대로 Test, Runs, Generate, Replay, Repair 이고 그 뒤에 Settings, Help & Docs 가 온다", async () => {
    window.location.hash = "#/home";
    render(<App />);
    const nav = await screen.findByRole("navigation");
    const links = Array.from(nav.querySelectorAll("a")).map(visibleLabel);
    expect(links).toEqual([...NAV_LABELS, ...SECONDARY_LABELS]);
  });

  it("사이드바 로고가 제품명 MCPeak 과 부제 MCP Dashboard 를 쓴다", async () => {
    window.location.hash = "#/home";
    render(<App />);
    const nav = await screen.findByRole("navigation");
    // 개명(ADR-0050) 이후 남아 있던 옛 이름이 화면에 노출되던 자리다.
    expect(nav.textContent).toContain("MCPeak");
    expect(nav.textContent).not.toContain("OhMyMCP");
    expect(screen.getByText("MCP Dashboard")).toBeTruthy();
    expect(nav.textContent).not.toContain("MCP Test Dashboard");
  });

  /** 대시보드 밖으로 나가는 유일한 링크다. 같은 탭으로 가면 보던 실행 화면을 잃는다. */
  it("Help & Docs 는 README 를 새 탭으로 연다", async () => {
    window.location.hash = "#/home";
    render(<App />);
    const help = await screen.findByRole("link", { name: /Help & Docs/ });
    expect(help.getAttribute("href")).toBe(
      "https://github.com/2026-Engineering-Contest/MCPeak#readme",
    );
    expect(help.getAttribute("target")).toBe("_blank");
    expect(help.getAttribute("rel")).toContain("noreferrer");
  });

  it("Settings 는 준비 중 화면을 열고 사이드바에서 활성으로 표시된다", async () => {
    window.location.hash = "#/settings";
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "설정" })).toBeTruthy();
    expect(screen.getByText("설정 화면은 준비 중입니다.")).toBeTruthy();
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent?.trim()).toBe("Settings");
  });

  it("해시가 비어 있으면 #/home으로 온다", async () => {
    window.location.hash = "";
    render(<App />);
    await waitFor(() => {
      expect(window.location.hash).toBe("#/home");
    });
    expect(await screen.findByRole("heading", { name: "테스트" })).toBeTruthy();
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent?.trim()).toBe("Test");
  });

  /**
   * #459. 예전에는 헤더 스트립이 `Test`(영), 본문 h1 이 `테스트`(한)로 **같은 뜻을 두 번**
   * 말했다. 화면 이름은 내비와 본문 제목에만 있어야 한다.
   */
  it("내비 밖에서 화면 이름을 한 번 더 말하지 않는다", async () => {
    window.location.hash = "#/home";
    render(<App />);
    const nav = await screen.findByRole("navigation");
    await screen.findByRole("heading", { name: "테스트" });

    const repeated = Array.from(document.body.querySelectorAll("*")).filter(
      (element) =>
        element.children.length === 0 &&
        element.textContent?.trim() === "Test" &&
        !nav.contains(element),
    );
    expect(repeated).toHaveLength(0);
    // 스트립이 사라져도 테마 토글은 남는다.
    expect(screen.getByRole("group", { name: "테마" })).toBeTruthy();
  });

  it("화면 제목은 본문보다 두 단 큰 display 크기를 쓴다", async () => {
    window.location.hash = "#/home";
    render(<App />);
    const heading = await screen.findByRole("heading", { level: 1, name: "테스트" });
    expect(heading.classList.contains("text-display")).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

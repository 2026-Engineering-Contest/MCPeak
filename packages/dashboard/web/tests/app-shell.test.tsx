// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

/** 화면들이 마운트 시 부르는 GET을 전부 빈 목록으로 응답하는 fetch fake. */
function fakeFetch(): typeof fetch {
  return vi.fn(async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
}

const NAV_LABELS = ["Test", "Runs", "Generate", "Replay", "Mock", "Repair", "Analyze"];
/** 사이드바 아래쪽 보조 링크(#459). 주 메뉴 뒤에 따로 선다. */
const SECONDARY_LABELS = ["Switch to User", "Settings", "Help & Docs"];

/** 링크의 보이는 이름. 화면 읽기 전용 꼬리("새 탭에서 열림")는 뺀다. */
function visibleLabel(link: HTMLAnchorElement): string | undefined {
  const copy = link.cloneNode(true) as HTMLAnchorElement;
  for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
  return copy.textContent?.trim();
}

describe("app shell", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fakeFetch());
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("사이드바 라벨이 순서대로 Test, Runs, Generate, Replay, Mock, Repair, Analyze 이고 그 뒤에 Switch to User, Settings, Help & Docs 가 온다", async () => {
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

  it("저장된 모드가 없고 해시가 비어 있으면 #/welcome 으로 온다", async () => {
    window.location.hash = "";
    render(<App />);
    await waitFor(() => {
      expect(window.location.hash).toBe("#/welcome");
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "MCPeak 을 어떻게 쓰시나요?" }),
    ).toBeTruthy();
    expect(document.querySelector("nav")).toBeNull();
  });

  it("저장된 모드가 developer 면 빈 해시가 #/home 으로 온다", async () => {
    window.localStorage.setItem("mcpeak-mode", "developer");
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

  it("저장된 모드가 user 면 빈 해시가 #/user/check 로 온다", async () => {
    window.localStorage.setItem("mcpeak-mode", "user");
    window.location.hash = "";
    render(<App />);
    await waitFor(() => {
      expect(window.location.hash).toBe("#/user/check");
    });
    expect(await screen.findByRole("heading", { level: 1, name: "사전 점검" })).toBeTruthy();
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent?.trim()).toBe("Check");
  });

  it("선택 화면의 두 링크는 #/home 과 #/user/check 를 가리킨다", async () => {
    window.location.hash = "#/welcome";
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "MCPeak 을 어떻게 쓰시나요?" });
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["#/home", "#/user/check"]);
    // 카드 전체가 링크 하나이고, 접근 이름은 제목과 설명을 이은 글자다.
    expect(
      screen
        .getByRole("link", {
          name: "개발자 MCP 서버를 만들고 테스트합니다. 테스트 실행, 생성, 녹화·재생, 목, 분석을 씁니다.",
        })
        .getAttribute("href"),
    ).toBe("#/home");
    expect(
      screen
        .getByRole("link", { name: "사용자 쓰려는 MCP 서버를 등록하기 전에 점검합니다." })
        .getAttribute("href"),
    ).toBe("#/user/check");
    expect(screen.getByText("사이드바 아래에서 언제든 바꿀 수 있습니다.")).toBeTruthy();
  });

  it("#/home 에 도착하면 mcpeak-mode 가 developer 로 저장된다", async () => {
    window.location.hash = "#/home";
    render(<App />);
    await waitFor(() => {
      expect(window.localStorage.getItem("mcpeak-mode")).toBe("developer");
    });
  });

  it("#/user/check 에 도착하면 user 로 저장된다", async () => {
    window.location.hash = "#/user/check";
    render(<App />);
    await waitFor(() => {
      expect(window.localStorage.getItem("mcpeak-mode")).toBe("user");
    });
  });

  it.each(["#/welcome", "#/settings"])(
    "#/welcome 과 #/settings 는 저장된 모드를 바꾸지 않는다: %s",
    async (hash) => {
      window.localStorage.setItem("mcpeak-mode", "user");
      window.location.hash = hash;
      render(<App />);
      await screen.findByRole("heading", { level: 1 });
      expect(window.localStorage.getItem("mcpeak-mode")).toBe("user");
    },
  );

  it("사용자 모드 사이드바는 Check, Switch to Developer, Settings, Help & Docs 다", async () => {
    window.location.hash = "#/user/check";
    render(<App />);
    const nav = await screen.findByRole("navigation");
    const links = Array.from(nav.querySelectorAll("a")).map(visibleLabel);
    expect(links).toEqual(["Check", "Switch to Developer", "Settings", "Help & Docs"]);
  });

  it.each([
    ["#/home", "Switch to User", "#/user/check"],
    ["#/user/check", "Switch to Developer", "#/home"],
  ])("전환 링크는 반대 모드의 첫 화면을 가리킨다: %s", async (hash, label, target) => {
    window.location.hash = hash;
    render(<App />);
    const link = await screen.findByRole("link", { name: label });
    expect(link.getAttribute("href")).toBe(target);
    expect(link.hasAttribute("aria-current")).toBe(false);
  });

  it("#/settings 는 저장된 모드의 사이드바로 그린다", async () => {
    window.localStorage.setItem("mcpeak-mode", "user");
    window.location.hash = "#/settings";
    const first = render(<App />);
    await screen.findByRole("heading", { level: 1, name: "설정" });
    expect(screen.getByRole("link", { name: "Check" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Test" })).toBeNull();
    first.unmount();

    // 저장값이 없으면 개발자 사이드바다.
    window.localStorage.clear();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "설정" });
    expect(screen.getByRole("link", { name: "Test" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Check" })).toBeNull();
  });

  it("저장된 모드가 없어도 #/runs/abc 는 선택 화면을 거치지 않는다", async () => {
    // 실행 화면은 run 요약을 읽고 구독한다. 요약은 끝난 run 하나로 답하고, jsdom 에 없는
    // EventSource 는 아무 일도 하지 않는 것으로 세운다.
    const summary = { runId: "abc", flow: "test", status: "done", exitCode: 0, argv: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) =>
        String(input).endsWith("/api/runs/abc")
          ? new Response(JSON.stringify(summary), { status: 200 })
          : new Response("[]", { status: 200 }),
      ),
    );
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener(): void {}
        close(): void {}
      },
    );
    window.location.hash = "#/runs/abc";
    render(<App />);
    const nav = await screen.findByRole("navigation");
    expect(window.location.hash).toBe("#/runs/abc");
    const current = nav.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent?.trim()).toBe("Runs");
  });

  it("#/user/unknown 은 저장된 모드의 첫 화면으로 간다", async () => {
    // 도착 전이라 저장값이 없으면 선택 화면이다. 해시의 `user` 를 저장하지 않는다.
    window.location.hash = "#/user/unknown";
    const first = render(<App />);
    await waitFor(() => {
      expect(window.location.hash).toBe("#/welcome");
    });
    expect(window.localStorage.getItem("mcpeak-mode")).toBeNull();
    first.unmount();

    window.localStorage.setItem("mcpeak-mode", "developer");
    window.location.hash = "#/user/unknown";
    render(<App />);
    await waitFor(() => {
      expect(window.location.hash).toBe("#/home");
    });
    expect(window.localStorage.getItem("mcpeak-mode")).toBe("developer");
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

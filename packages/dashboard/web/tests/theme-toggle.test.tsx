// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../src/components/ThemeToggle.js";

/** localStorage와 같은 인터페이스의 인메모리 저장소. */
function stubStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

/**
 * jsdom 의 matchMedia 는 언제나 `matches: false` 고 값을 바꿀 수단이 없다. OS 변경을 흉내 내려면
 * 직접 세워야 한다. 구독 해제까지 보려고 listenerCount 도 연다.
 */
function stubMatchMedia(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const list = {
    matches: dark,
    addEventListener: (_type: string, fn: (event: MediaQueryListEvent) => void) => {
      listeners.add(fn);
    },
    removeEventListener: (_type: string, fn: (event: MediaQueryListEvent) => void) => {
      listeners.delete(fn);
    },
  };
  vi.stubGlobal("matchMedia", () => list);
  return {
    emit(next: boolean) {
      list.matches = next;
      act(() => {
        for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent);
      });
    },
    listenerCount: () => listeners.size,
  };
}

/** 지금 눌려 있는 쪽의 라벨. 둘 다 눌려 있거나 하나도 없으면 테스트가 드러낸다. */
function pressed(): string[] {
  return screen
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent ?? "");
}

describe("ThemeToggle", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
  });

  it("두 선택지가 테마 묶음 안에 나란히 보인다", () => {
    stubStorage();
    stubMatchMedia(false);
    render(<ThemeToggle />);
    const group = screen.getByRole("group", { name: "테마" });
    expect(Array.from(group.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Light",
      "Dark",
    ]);
  });

  it("고른 적이 없으면 OS 선호 쪽이 눌려 있다", () => {
    stubStorage();
    stubMatchMedia(true);
    render(<ThemeToggle />);
    expect(pressed()).toEqual(["Dark"]);
  });

  it("저장된 선택이 OS 선호를 이긴다", () => {
    stubStorage({ "mcpeak-theme": "light" });
    stubMatchMedia(true);
    render(<ThemeToggle />);
    expect(pressed()).toEqual(["Light"]);
  });

  it("누른 모드가 화면과 저장소에 함께 적용된다", () => {
    const storage = stubStorage();
    stubMatchMedia(false);
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(pressed()).toEqual(["Dark"]);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(storage.getItem("mcpeak-theme")).toBe("dark");
  });

  /** OS 를 따라가던 상태에서 "지금 이대로 고정" 하는 유일한 방법이다. */
  it("이미 눌린 쪽을 눌러도 그 값으로 고정된다", () => {
    const storage = stubStorage();
    stubMatchMedia(true);
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(storage.getItem("mcpeak-theme")).toBe("dark");
  });

  it("접근 가능한 이름이 보이는 글자와 같다 (WCAG 2.5.3)", () => {
    stubStorage();
    stubMatchMedia(false);
    render(<ThemeToggle />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("aria-label")).toBeNull();
    }
  });

  it("고른 적이 없으면 OS 가 바뀔 때 눌린 쪽이 따라간다", () => {
    stubStorage();
    const media = stubMatchMedia(false);
    render(<ThemeToggle />);
    expect(pressed()).toEqual(["Light"]);
    media.emit(true);
    expect(pressed()).toEqual(["Dark"]);
  });

  it("한 번 고르고 나면 OS 가 바뀌어도 따라가지 않는다", () => {
    stubStorage();
    const media = stubMatchMedia(false);
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" })); // 다크로 명시 선택
    expect(media.listenerCount()).toBe(0); // 구독을 끊는다
    media.emit(false); // OS 는 라이트로 남아 있어도
    expect(pressed()).toEqual(["Dark"]); // 고른 값이 유지된다
  });

  it("matchMedia 가 없는 환경에서도 뜨고 동작한다", () => {
    stubStorage();
    vi.stubGlobal("matchMedia", undefined);
    render(<ThemeToggle />);
    expect(pressed()).toEqual(["Light"]);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

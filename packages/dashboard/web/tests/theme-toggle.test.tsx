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

describe("ThemeToggle", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
  });

  it("고른 적이 없으면 OS 선호를 라벨에 그대로 보여준다", () => {
    stubStorage();
    stubMatchMedia(true);
    render(<ThemeToggle />);
    expect(screen.getByRole("button").textContent).toBe("테마: 다크");
  });

  it("저장된 선택이 OS 선호를 이긴다", () => {
    stubStorage({ "mcpeak-theme": "light" });
    stubMatchMedia(true);
    render(<ThemeToggle />);
    expect(screen.getByRole("button").textContent).toBe("테마: 라이트");
  });

  it("누르면 반대 모드가 화면과 저장소에 함께 적용된다", () => {
    const storage = stubStorage();
    stubMatchMedia(false);
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("테마: 다크");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(storage.getItem("mcpeak-theme")).toBe("dark");
  });

  it("라벨은 현재 상태고, 누르면 무엇이 되는지는 aria-label 이 말한다", () => {
    stubStorage({ "mcpeak-theme": "dark" });
    stubMatchMedia(false);
    render(<ThemeToggle />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("라이트 모드로 바꾸기");
  });

  it("고른 적이 없으면 OS 가 바뀔 때 라벨이 따라간다", () => {
    stubStorage();
    const media = stubMatchMedia(false);
    render(<ThemeToggle />);
    expect(screen.getByRole("button").textContent).toBe("테마: 라이트");
    media.emit(true);
    expect(screen.getByRole("button").textContent).toBe("테마: 다크");
  });

  it("한 번 고르고 나면 OS 가 바뀌어도 따라가지 않는다", () => {
    stubStorage();
    const media = stubMatchMedia(false);
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button")); // 다크로 명시 선택
    expect(media.listenerCount()).toBe(0); // 구독을 끊는다
    media.emit(false); // OS 는 라이트로 남아 있어도
    expect(screen.getByRole("button").textContent).toBe("테마: 다크"); // 고른 값이 유지된다
  });

  it("matchMedia 가 없는 환경에서도 뜨고 동작한다", () => {
    stubStorage();
    vi.stubGlobal("matchMedia", undefined);
    render(<ThemeToggle />);
    expect(screen.getByRole("button").textContent).toBe("테마: 라이트");
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

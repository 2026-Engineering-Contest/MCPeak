// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThemeMode } from "../src/theme.js";
import { applyMode, getStoredMode, resolveMode, systemMode, themeStorage } from "../src/theme.js";

/** localStorage와 같은 인터페이스의 인메모리 저장소. */
function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function makeRoot() {
  return document.createElement("div");
}

/** matchMedia 를 흉내 낸다. `dark` 가 true 면 OS 가 다크를 선호하는 상태다. */
function makeHost(dark: boolean) {
  return { matchMedia: (query: string) => ({ matches: dark && query.includes("dark") }) };
}

describe("systemMode", () => {
  it("OS 가 다크를 선호하면 dark", () => {
    expect(systemMode(makeHost(true))).toBe("dark");
  });

  it("OS 가 다크를 선호하지 않으면 light", () => {
    expect(systemMode(makeHost(false))).toBe("light");
  });

  it("matchMedia 가 없으면 light", () => {
    // theme.css 의 기본값(`:root`)이 라이트다. 여기서 dark 를 돌려주면 화면은 라이트인데
    // 라벨만 "다크"가 된다.
    expect(systemMode({})).toBe("light");
  });

  it("matchMedia 가 던져도 light 로 살아난다", () => {
    expect(
      systemMode({
        matchMedia: () => {
          throw new Error("SecurityError");
        },
      }),
    ).toBe("light");
  });
});

describe("getStoredMode", () => {
  it("저장값이 없으면 null(=아직 안 고름)", () => {
    expect(getStoredMode(makeStorage())).toBeNull();
  });

  it("저장된 light/dark 를 그대로 돌려준다", () => {
    expect(getStoredMode(makeStorage({ "mcpeak-theme": "dark" }))).toBe("dark");
    expect(getStoredMode(makeStorage({ "mcpeak-theme": "light" }))).toBe("light");
  });

  it("알 수 없는 저장값은 null 로 취급한다", () => {
    expect(getStoredMode(makeStorage({ "mcpeak-theme": "sepia" }))).toBeNull();
  });

  it('이전 버전이 남긴 "system" 저장값도 null 로 읽힌다', () => {
    // 3값이던 시절 "system" 은 키를 지우는 방식이라 사실 이 값이 저장될 일은 없었다.
    // 그래도 손으로 넣어 둔 값이 있으면 미선택으로 흘러가야 한다.
    expect(getStoredMode(makeStorage({ "mcpeak-theme": "system" }))).toBeNull();
  });
});

describe("resolveMode", () => {
  it("미선택이면 시스템을 따른다", () => {
    expect(resolveMode(null, "dark")).toBe("dark");
    expect(resolveMode(null, "light")).toBe("light");
  });

  it("저장된 선택이 시스템을 이긴다", () => {
    expect(resolveMode("light", "dark")).toBe("light");
    expect(resolveMode("dark", "light")).toBe("dark");
  });
});

describe("applyMode", () => {
  it.each<ThemeMode>(["dark", "light"])("%s 적용 시 data-theme 와 저장값이 남는다", (mode) => {
    const storage = makeStorage();
    const root = makeRoot();
    applyMode(mode, root, storage);
    expect(root.getAttribute("data-theme")).toBe(mode);
    expect(storage.getItem("mcpeak-theme")).toBe(mode);
  });

  it("저장 후 재초기화하면 그 값이 복원된다", () => {
    const storage = makeStorage();
    applyMode("light", makeRoot(), storage);
    // 재초기화: 같은 저장소로 getStoredMode 를 다시 부른다(새 세션 시뮬레이션).
    const restored = getStoredMode(storage);
    expect(restored).toBe("light");
    const root = makeRoot();
    if (restored !== null) applyMode(restored, root, storage);
    expect(root.getAttribute("data-theme")).toBe("light");
  });
});

describe("themeStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("쓸 수 있는 저장소는 그대로 돌려준다", () => {
    const real = makeStorage({ "mcpeak-theme": "dark" });
    vi.stubGlobal("localStorage", real);
    expect(themeStorage()).toBe(real);
    expect(getStoredMode(themeStorage())).toBe("dark");
  });

  it("메서드가 없는 껍데기면(Node 25) 던지지 않고 미선택으로 시작한다", () => {
    vi.stubGlobal("localStorage", {});
    const storage = themeStorage();
    expect(getStoredMode(storage)).toBeNull();
    expect(() => applyMode("dark", makeRoot(), storage)).not.toThrow();
  });

  it("getItem 만 있는 반쪽 저장소도 통과시키지 않는다", () => {
    // 통과시키면 probe 정리(removeItem)에서 죽고, 그 자리가 React 마운트 전이다 (#251 리뷰).
    vi.stubGlobal("localStorage", { getItem: () => null });
    const storage = themeStorage();
    expect(getStoredMode(storage)).toBeNull();
    expect(() => applyMode("dark", makeRoot(), storage)).not.toThrow();
  });

  it("메서드는 있는데 쓰기가 던지는 저장소도 통과시키지 않는다", () => {
    // 용량 초과·정책 차단이 이 모양이다. typeof 검사로는 걸러지지 않는다.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    });
    const storage = themeStorage();
    expect(getStoredMode(storage)).toBeNull();
    expect(() => applyMode("dark", makeRoot(), storage)).not.toThrow();
  });

  it("읽기가 던지는 저장소도 통과시키지 않고, probe 키도 남기지 않는다", () => {
    // 쓰기만 확인하면 getStoredMode 의 첫 getItem 에서 죽는다 (#251 리뷰).
    // 쓰기가 성공한 뒤 읽기가 던지는 경우라 probe 정리 경로까지 함께 본다.
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    });
    expect(getStoredMode(themeStorage())).toBeNull();
    expect([...map.keys()]).toEqual([]);
  });

  it("정상 저장소에는 probe 키를 남기지 않는다", () => {
    const real = makeStorage();
    vi.stubGlobal("localStorage", real);
    expect(themeStorage()).toBe(real);
    expect(real.getItem("__mcpeak_theme_probe__")).toBeNull();
  });

  it("접근 자체가 던지면(저장소 차단) 던지지 않고 미선택으로 시작한다", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get(): never {
        throw new Error("SecurityError: storage is disabled");
      },
    });
    try {
      expect(getStoredMode(themeStorage())).toBeNull();
    } finally {
      if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, "localStorage", original);
    }
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyThemeChoice, getThemeChoice, themeStorage } from "../src/theme.js";

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

describe("theme", () => {
  it("저장값이 없으면 system이고 data-theme 속성이 없다", () => {
    const storage = makeStorage();
    const root = makeRoot();
    const choice = getThemeChoice(storage);
    expect(choice).toBe("system");
    applyThemeChoice(choice, root, storage);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it('dark 적용 시 data-theme="dark"와 저장값이 남는다', () => {
    const storage = makeStorage();
    const root = makeRoot();
    applyThemeChoice("dark", root, storage);
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(storage.getItem("mcpeak-theme")).toBe("dark");
  });

  it("light 저장 후 재초기화하면 light가 복원된다", () => {
    const storage = makeStorage();
    applyThemeChoice("light", makeRoot(), storage);
    // 재초기화: 같은 저장소로 getThemeChoice를 다시 부른다(새 세션 시뮬레이션).
    const restored = getThemeChoice(storage);
    expect(restored).toBe("light");
    const root = makeRoot();
    applyThemeChoice(restored, root, storage);
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("system 적용 시 속성과 저장값이 제거된다", () => {
    const storage = makeStorage();
    const root = makeRoot();
    applyThemeChoice("dark", root, storage);
    applyThemeChoice("system", root, storage);
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(storage.getItem("mcpeak-theme")).toBeNull();
  });

  it("알 수 없는 저장값은 system으로 취급한다", () => {
    const storage = makeStorage({ "mcpeak-theme": "sepia" });
    expect(getThemeChoice(storage)).toBe("system");
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
    expect(getThemeChoice(themeStorage())).toBe("dark");
  });

  it("메서드가 없는 껍데기면(Node 25) 던지지 않고 system으로 시작한다", () => {
    vi.stubGlobal("localStorage", {});
    const storage = themeStorage();
    expect(getThemeChoice(storage)).toBe("system");
    expect(() => applyThemeChoice("dark", makeRoot(), storage)).not.toThrow();
  });

  it("접근 자체가 던지면(저장소 차단) 던지지 않고 system으로 시작한다", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get(): never {
        throw new Error("SecurityError: storage is disabled");
      },
    });
    try {
      expect(getThemeChoice(themeStorage())).toBe("system");
    } finally {
      if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, "localStorage", original);
    }
  });
});

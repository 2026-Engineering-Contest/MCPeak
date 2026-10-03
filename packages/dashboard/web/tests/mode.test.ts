import { describe, expect, it, vi } from "vitest";
import { getStoredAppMode, MODE_HOME, modeOfHash, saveAppMode } from "../src/mode.js";

describe("mode", () => {
  it.each([
    "#/home",
    "#/runs",
    "#/runs/abc",
    "#/generate",
    "#/replay",
    "#/mock",
    "#/repair/x",
    "#/analyze/security",
  ])("modeOfHash 는 개발자 화면의 해시에 developer 를 낸다: %s", (hash) => {
    expect(modeOfHash(hash)).toBe("developer");
  });

  it.each(["#/user/check", "#/user/unknown"])(
    "modeOfHash 는 #/user/ 아래 해시에 user 를 낸다: %s",
    (hash) => {
      expect(modeOfHash(hash)).toBe("user");
    },
  );

  it.each(["#/settings", "#/welcome", "", "#", "#/", "#/nope"])(
    "modeOfHash 는 공통·선택·빈·모르는 해시에 null 을 낸다: '%s'",
    (hash) => {
      expect(modeOfHash(hash)).toBeNull();
    },
  );

  it("getStoredAppMode 는 저장된 두 값만 읽는다", () => {
    const stored = (value: string | null) => ({ getItem: vi.fn(() => value) });

    const developer = stored("developer");
    expect(getStoredAppMode(developer)).toBe("developer");
    expect(developer.getItem).toHaveBeenCalledWith("mcpeak-mode");

    expect(getStoredAppMode(stored("user"))).toBe("user");
    expect(getStoredAppMode(stored(null))).toBeNull();
    expect(getStoredAppMode(stored("admin"))).toBeNull();
  });

  it("saveAppMode 는 mcpeak-mode 에 쓴다", () => {
    const storage = { setItem: vi.fn() };
    saveAppMode("user", storage);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith("mcpeak-mode", "user");
  });

  it("saveAppMode 는 저장소가 던져도 던지지 않는다", () => {
    const storage = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveAppMode("developer", storage)).not.toThrow();
  });

  it("MODE_HOME 은 #/home 과 #/user/check 다", () => {
    expect(MODE_HOME).toEqual({ developer: "#/home", user: "#/user/check" });
  });
});

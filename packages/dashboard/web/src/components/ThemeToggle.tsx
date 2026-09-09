import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { ThemeMode } from "../theme.js";
import { applyMode, getStoredMode, resolveMode, systemMode, themeStorage } from "../theme.js";

const LABELS: Record<ThemeMode, string> = {
  light: "테마: 라이트",
  dark: "테마: 다크",
};

/** 누르면 무엇이 되는지. 라벨은 현재 상태를 말하므로 동작은 aria-label 로 따로 준다. */
const ACTIONS: Record<ThemeMode, string> = {
  light: "다크 모드로 바꾸기",
  dark: "라이트 모드로 바꾸기",
};

/**
 * 라이트·다크 2값 토글. 라벨은 **지금 보이는 모드**를 말한다 — 이전의 3값 순환은 "테마:
 * 시스템"이 정작 무엇이 켜져 있는지 알려주지 않았다.
 *
 * 저장값이 없는 동안에는 OS 를 따라가므로 `matchMedia` 변화를 구독해 라벨을 맞춘다. 화면 색은
 * CSS 가 이미 알아서 바꾸지만, 구독하지 않으면 라벨만 옛 값에 남는다. 한 번 고르고 나면
 * 구독할 이유가 없다.
 */
export function ThemeToggle(): JSX.Element {
  const [stored, setStored] = useState<ThemeMode | null>(() => getStoredMode(themeStorage()));
  const [system, setSystem] = useState<ThemeMode>(() => systemMode(globalThis));

  useEffect(() => {
    if (stored !== null) return;
    // matchMedia 가 없는 환경이 있다. 없으면 systemMode 가 라이트로 고정해 두고 여기서는
    // 구독만 건너뛴다 — 던지게 두면 헤더가 통째로 안 뜬다.
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (query === undefined || typeof query.addEventListener !== "function") return;
    const onChange = (event: MediaQueryListEvent): void => {
      setSystem(event.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [stored]);

  const mode = resolveMode(stored, system);

  const toggle = (): void => {
    const next: ThemeMode = mode === "dark" ? "light" : "dark";
    applyMode(next, document.documentElement, themeStorage());
    setStored(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={ACTIONS[mode]}
      className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line-subtle hover:text-ink"
    >
      {LABELS[mode]}
    </button>
  );
}

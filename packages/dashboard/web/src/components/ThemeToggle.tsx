import { useState } from "react";
import type { JSX } from "react";
import { applyThemeChoice, getThemeChoice } from "../theme.js";
import type { ThemeChoice } from "../theme.js";

const CYCLE: readonly ThemeChoice[] = ["system", "light", "dark"];

const LABELS: Record<ThemeChoice, string> = {
  system: "테마: 시스템",
  light: "테마: 라이트",
  dark: "테마: 다크",
};

/**
 * light/dark/system 3값 순환 버튼. 클릭마다 다음 값으로 넘어가며
 * applyThemeChoice로 data-theme 속성과 localStorage 저장을 함께 처리한다.
 */
export function ThemeToggle(): JSX.Element {
  const [choice, setChoice] = useState<ThemeChoice>(() => getThemeChoice(window.localStorage));

  const cycle = (): void => {
    const next = CYCLE[(CYCLE.indexOf(choice) + 1) % CYCLE.length]!;
    applyThemeChoice(next, document.documentElement, window.localStorage);
    setChoice(next);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line-subtle hover:text-ink"
    >
      {LABELS[choice]}
    </button>
  );
}

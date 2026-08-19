export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "ohmymcp-theme";

/** 저장된 선택을 읽는다. 없거나 알 수 없는 값이면 "system". */
export function getThemeChoice(storage: Pick<Storage, "getItem">): ThemeChoice {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

/**
 * 선택을 적용하고 저장한다. "system"은 data-theme 속성과 저장값을 제거해
 * prefers-color-scheme에 위임한다(theme.css의 media 블록이 받는다).
 */
export function applyThemeChoice(
  choice: ThemeChoice,
  root: Pick<HTMLElement, "setAttribute" | "removeAttribute">,
  storage: Pick<Storage, "setItem" | "removeItem">,
): void {
  if (choice === "system") {
    root.removeAttribute("data-theme");
    storage.removeItem(STORAGE_KEY);
    return;
  }
  root.setAttribute("data-theme", choice);
  storage.setItem(STORAGE_KEY, choice);
}

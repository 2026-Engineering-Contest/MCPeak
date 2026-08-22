export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "mcpeak-theme";

/** 테마가 쓰는 저장소의 최소 면. `Storage` 전체를 요구할 이유가 없다. */
export type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 아무것도 기억하지 않는 대체 저장소. 테마는 매번 "system" 으로 시작한다. */
const FORGETFUL: ThemeStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * 브라우저 저장소를 쓸 수 있는 형태로 돌려준다. 못 쓰면 대체품이다.
 *
 * **`localStorage` 가 있다고 쓸 수 있는 것이 아니다.** Node 25 는 `--localstorage-file` 없이도
 * 전역을 만들어 두는데 메서드가 없는 껍데기고(#212), 브라우저에서도 저장소가 차단돼 있으면
 * 접근 자체가 던진다. 둘 다 여기서 막지 않으면 테마 버튼 하나 때문에 화면 전체가 죽는다.
 * **테마를 기억하지 못하는 것은 불편이고, 대시보드가 안 뜨는 것은 고장이다.**
 */
export function themeStorage(): ThemeStorage {
  try {
    const store = globalThis.localStorage as ThemeStorage | undefined;
    return typeof store?.getItem === "function" ? store : FORGETFUL;
  } catch {
    return FORGETFUL;
  }
}

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

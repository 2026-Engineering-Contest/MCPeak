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
  const probe = "__mcpeak_theme_probe__";
  try {
    const store = globalThis.localStorage as ThemeStorage | undefined;
    // 세 메서드를 다 본다. getItem 만 보면 안 되는 이유는 이 모듈의 첫 호출자가
    // main.tsx 이고, 거기서 기본값 "system" 이 removeItem 을 부르기 때문이다.
    // getItem 만 있는 저장소를 통과시키면 그 줄에서 죽는다 (#251 리뷰).
    if (
      typeof store?.getItem !== "function" ||
      typeof store.setItem !== "function" ||
      typeof store.removeItem !== "function"
    )
      return FORGETFUL;
    // 있다고 되는 것도 아니다. 저장소가 가득 찼거나 정책으로 막히면 던진다 —
    // 메서드는 멀쩡히 있다. 실제로 한 번씩 불러 보는 것 말고 확인할 방법이 없다.
    //
    // **셋을 다 불러야 한다.** getThemeChoice 가 곧바로 getItem 을 부르므로,
    // 쓰기만 확인하고 통과시키면 읽기에서 던지는 저장소가 그대로 나간다 (#251 리뷰).
    store.setItem(probe, "1");
    store.getItem(probe);
    store.removeItem(probe);
    return store;
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

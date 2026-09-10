/**
 * 화면에 보이는 테마는 라이트·다크 둘뿐이다. "시스템"은 **선택지가 아니라 아직 고르지 않은
 * 상태**다 — 저장값이 없으면 `data-theme` 을 쓰지 않고 theme.css 의 `prefers-color-scheme`
 * 블록에 맡긴다. 그래서 한 번도 안 건드린 사용자는 OS 가 해 질 녘에 다크로 넘어가면 그대로
 * 따라간다. 버튼을 한 번이라도 누르면 그 값이 저장되고, 그 뒤로는 OS 를 따르지 않는다.
 *
 * 되돌리는 경로를 UI 에 두지 않은 것은 의도다. 그것은 곧 없앤 세 번째 값("시스템")을 다시
 * 들이는 일이다. 저장소를 지우면 미선택으로 돌아간다.
 */
export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "mcpeak-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** 테마가 쓰는 저장소의 최소 면. `Storage` 전체를 요구할 이유가 없다. */
export type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * `matchMedia` 를 가진 무언가. `Pick<Window, "matchMedia">` 로 적으면 **없는 경우**를
 * 표현할 수 없어서 테스트가 그 분기를 못 짚는다. 실제로 없는 환경이 있다(구형 WebView, 일부
 * 헤드리스 런타임).
 */
export type MediaHost = {
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
};

/** 아무것도 기억하지 않는 대체 저장소. 테마는 매번 미선택으로 시작한다. */
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
    // 세 메서드를 다 본다. `removeItem` 은 이제 부팅 경로에서 부르지 않지만, 아래 probe 정리가
    // 여전히 쓰고 그것이 던지면 저장소를 믿을 수 없다 (#251 리뷰).
    if (
      typeof store?.getItem !== "function" ||
      typeof store.setItem !== "function" ||
      typeof store.removeItem !== "function"
    )
      return FORGETFUL;
    // 있다고 되는 것도 아니다. 저장소가 가득 찼거나 정책으로 막히면 던진다 —
    // 메서드는 멀쩡히 있다. 실제로 한 번씩 불러 보는 것 말고 확인할 방법이 없다.
    //
    // **셋을 다 불러야 한다.** getStoredMode 가 곧바로 getItem 을 부르므로,
    // 쓰기만 확인하고 통과시키면 읽기에서 던지는 저장소가 그대로 나간다 (#251 리뷰).
    try {
      store.setItem(probe, "1");
      store.getItem(probe);
    } finally {
      // 읽기가 중간에 던져도 쓴 것은 지운다. finally 가 없으면 probe 키가 남는다
      // (#251 리뷰). 지우기마저 던지면 바깥 catch 가 받아 FORGETFUL 로 간다.
      store.removeItem(probe);
    }
    return store;
  } catch {
    return FORGETFUL;
  }
}

/**
 * OS 가 어느 쪽을 선호하는지. `matchMedia` 가 없거나 던지면 라이트로 본다 —
 * theme.css 의 기본값(`:root`)이 라이트라서 그래야 CSS 와 라벨이 어긋나지 않는다.
 */
export function systemMode(host: MediaHost): ThemeMode {
  try {
    return host.matchMedia?.(DARK_QUERY).matches === true ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * 저장된 **명시 선택**을 읽는다. 없거나 알 수 없는 값이면 `null` — "아직 고르지 않음"이고,
 * 이 상태에서만 OS 를 따라간다.
 */
export function getStoredMode(storage: Pick<Storage, "getItem">): ThemeMode | null {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" ? raw : null;
}

/** 지금 화면에 보이는 모드. 저장된 선택이 시스템을 이긴다. */
export function resolveMode(stored: ThemeMode | null, system: ThemeMode): ThemeMode {
  return stored ?? system;
}

/**
 * 명시 선택을 적용하고 저장한다. 미선택으로 되돌리는 경로는 UI 에 없으므로 속성·저장값을
 * 지우는 분기도 없다 — 지우는 쪽이 필요해지면 그때 `clearMode` 를 따로 만든다.
 */
export function applyMode(
  mode: ThemeMode,
  root: Pick<HTMLElement, "setAttribute">,
  storage: Pick<Storage, "setItem">,
): void {
  root.setAttribute("data-theme", mode);
  storage.setItem(STORAGE_KEY, mode);
}

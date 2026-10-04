/**
 * 대시보드의 모드(ADR-0111). 개발자는 서버를 만들고 테스트하는 사람, 사용자는 남의 서버를 등록 전에
 * 점검하는 사람이다. 모드는 보기 필터다. 접근을 막지 않는다.
 *
 * 지금 화면의 모드는 해시가 먼저 정하고, 해시가 말하지 않을 때만 저장값을 본다. 저장값은 "마지막으로
 * 머문 모드" 다. App 이 해시를 받아들일 때 쓴다.
 */
export type AppMode = "developer" | "user";

const STORAGE_KEY = "mcpeak-mode";

/** 모드를 고르는 화면. 저장값이 없고 갈 곳이 없는 주소일 때만 온다. */
export const WELCOME_HASH = "#/welcome";

/** 모드의 첫 화면. 전환 링크와 기본 리다이렉트가 같은 값을 쓴다. */
export const MODE_HOME: Readonly<Record<AppMode, string>> = {
  developer: "#/home",
  user: "#/user/check",
};

/** 개발자 모드의 화면들. `#/settings` 와 `#/welcome` 은 어느 모드의 것도 아니다. */
const DEVELOPER_SCREENS: ReadonlySet<string> = new Set([
  "home",
  "runs",
  "generate",
  "replay",
  "mock",
  "repair",
  "analyze",
]);

/** 해시가 속한 모드. 공통 화면, 선택 화면, 빈 해시, 모르는 해시는 null 이다. */
export function modeOfHash(hash: string): AppMode | null {
  const withoutHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const first = withoutHash.split("/").find((segment) => segment.length > 0);
  if (first === undefined) return null;
  if (first === "user") return "user";
  return DEVELOPER_SCREENS.has(first) ? "developer" : null;
}

/** 저장된 모드. 없거나 알 수 없는 값이면 null(아직 고르지 않음). */
export function getStoredAppMode(storage: Pick<Storage, "getItem">): AppMode | null {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === "developer" || raw === "user" ? raw : null;
}

/** 저장에 실패해도 던지지 않는다. 모드를 기억하지 못하는 것은 불편이고 화면이 죽는 것은 고장이다. */
export function saveAppMode(mode: AppMode, storage: Pick<Storage, "setItem">): void {
  try {
    storage.setItem(STORAGE_KEY, mode);
  } catch {
    // 기억하지 못하면 다음에 선택 화면이 다시 뜬다.
  }
}

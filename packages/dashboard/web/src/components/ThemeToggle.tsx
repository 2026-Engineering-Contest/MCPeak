import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { ThemeMode } from "../theme.js";
import { applyMode, getStoredMode, resolveMode, systemMode, themeStorage } from "../theme.js";
import { Button } from "./Button.js";

const LABELS: Record<ThemeMode, string> = {
  light: "테마: 라이트",
  dark: "테마: 다크",
};

/** 누르면 무엇이 되는지. 라벨은 현재 상태만 말하므로 동작을 따로 적는다. */
const ACTIONS: Record<ThemeMode, string> = {
  light: "다크 모드로 바꾸기",
  dark: "라이트 모드로 바꾸기",
};

/**
 * 접근 가능한 이름. **보이는 라벨로 시작해야 한다** — `aria-label` 은 보이는 텍스트를 보강하는
 * 게 아니라 통째로 덮어쓴다. 동작만 넣으면 화면에는 "테마: 다크" 가 보이는데 이름은 "라이트
 * 모드로 바꾸기" 가 돼 겹치는 단어가 하나도 없고, 음성 입력 사용자가 보이는 문구로 이 버튼을
 * 부를 수 없다 (WCAG 2.1 SC 2.5.3 Label in Name).
 */
function accessibleName(mode: ThemeMode): string {
  return `${LABELS[mode]} — ${ACTIONS[mode]}`;
}

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
    <Button size="sm" onClick={toggle} aria-label={accessibleName(mode)}>
      {LABELS[mode]}
    </Button>
  );
}

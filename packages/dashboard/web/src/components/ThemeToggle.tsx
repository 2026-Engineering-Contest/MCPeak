import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { ThemeMode } from "../theme.js";
import { applyMode, getStoredMode, resolveMode, systemMode, themeStorage } from "../theme.js";

const OPTIONS: ReadonlyArray<readonly [ThemeMode, string]> = [
  ["light", "Light"],
  ["dark", "Dark"],
];

/**
 * 라이트·다크 2값 토글 (#459 시안). 두 선택지가 **나란히 다 보이고** 지금 켜진 쪽이 눌려 있다.
 *
 * 예전에는 버튼 하나가 "테마: 다크" 처럼 현재 상태를 말하고 누르면 반대로 바뀌었다. 그 방식은
 * 누르기 전에는 무엇이 될지 보이지 않아 `aria-label` 에 동작을 따로 적어야 했다. 이제는 두 버튼이
 * 각자 자기 이름("Light"·"Dark")을 갖고 `aria-pressed` 가 상태를 말하므로, 보이는 글자가 곧
 * 접근 가능한 이름이다(WCAG 2.5.3).
 *
 * 저장값이 없는 동안에는 OS 를 따라가므로 `matchMedia` 변화를 구독해 눌린 쪽을 맞춘다. 화면 색은
 * CSS 가 이미 알아서 바꾸지만, 구독하지 않으면 눌린 표시만 옛 값에 남는다. 한 번 고르고 나면
 * 구독할 이유가 없다. **이미 눌린 쪽을 눌러도 저장한다** — OS 를 따라가던 상태에서 "지금 이대로
 * 고정" 하는 유일한 방법이다.
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

  const choose = (next: ThemeMode): void => {
    applyMode(next, document.documentElement, themeStorage());
    setStored(next);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: fieldset 은 legend 와 테두리 규칙을 끌고 와 한 줄 토글에 맞지 않는다. 묶음의 이름만 필요하다.
    <div role="group" aria-label="테마" className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="text-ink-muted">
        {mode === "dark" ? <MoonIcon /> : <SunIcon />}
      </span>
      {/*
        바탕은 `canvas`, 눌린 쪽은 `surface` 다. 두 테마 모두 surface 가 canvas 보다 밝아 눌린 쪽이
        떠 보인다. `line-subtle` 을 바탕으로 쓰면 다크에서 surface 가 더 어두워, 눌린 쪽이 꺼진
        것처럼 보이고 반대편이 켜진 것처럼 읽혔다.
      */}
      <span className="inline-flex rounded-md border border-line bg-canvas p-0.5">
        {OPTIONS.map(([value, label]) => {
          const pressed = mode === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={pressed}
              onClick={() => choose(value)}
              className={`rounded-sm px-4 py-1 text-sm font-medium transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                pressed ? "bg-surface text-accent shadow-card" : "text-ink-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          );
        })}
      </span>
    </div>
  );
}

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function SunIcon(): JSX.Element {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 버튼 라벨이 인접
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon(): JSX.Element {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 버튼 라벨이 인접
    <svg {...ICON_PROPS}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

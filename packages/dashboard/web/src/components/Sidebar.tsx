import type { JSX } from "react";
import { Logo } from "./Logo.js";

/**
 * 좌측 고정 사이드바(248px). UI 설계 §2: 로고 블록 + 내비 5항목(영어 라벨,
 * 인라인 SVG stroke 아이콘) + 하단 보조 링크(Settings · Help & Docs, #459).
 * 활성 항목은 `aria-current="page"` 하나로 표시하고 스타일도 그 속성을 본다.
 *
 * 하단에 있던 서버 주소(`location.host`)는 뺐다. 주소창에 이미 있는 값이고, 그 자리를 설정 ·
 * 도움말이 쓴다.
 */
export type NavId = "home" | "runs" | "generate" | "replay" | "repair" | "settings";

/** README. package.json 의 `homepage` 와 같은 값이다. */
export const HELP_URL = "https://github.com/2026-Engineering-Contest/MCPeak#readme";

interface NavItem {
  readonly id: NavId;
  readonly label: string;
  readonly hash: string;
  readonly icon: JSX.Element;
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
  "aria-hidden": true,
} as const;

const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "home",
    label: "Test",
    hash: "#/home",
    icon: (
      // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
      <svg {...ICON_PROPS}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </svg>
    ),
  },
  {
    id: "runs",
    label: "Runs",
    hash: "#/runs",
    icon: (
      // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
      <svg {...ICON_PROPS}>
        <polygon points="7 4 19 12 7 20 7 4" />
      </svg>
    ),
  },
  {
    id: "generate",
    label: "Generate",
    hash: "#/generate",
    icon: (
      // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
      <svg {...ICON_PROPS}>
        <path d="M12 4v16" />
        <path d="M4 12h16" />
      </svg>
    ),
  },
  {
    id: "replay",
    label: "Replay",
    hash: "#/replay",
    icon: (
      // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </svg>
    ),
  },
  {
    id: "repair",
    label: "Repair",
    hash: "#/repair",
    icon: (
      // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
      <svg {...ICON_PROPS}>
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.7-2.7 2.4-3z" />
      </svg>
    ),
  },
];

const SETTINGS_ICON = (
  // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

const HELP_ICON = (
  // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/** 활성 여부에 따른 항목 모양. 위 목록과 아래 보조 링크가 같은 모양을 쓴다. */
function itemClass(active: boolean): string {
  return `flex items-center gap-3 rounded-md px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
    active
      ? "bg-accent-soft font-semibold text-accent"
      : "font-medium text-ink-muted hover:bg-line-subtle hover:text-ink"
  }`;
}

export function Sidebar({ active }: { readonly active: NavId }): JSX.Element {
  return (
    <nav className="flex w-[248px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-3 px-5 py-5">
        <Logo size={40} />
        <div>
          <p className="text-title font-semibold text-ink">MCPeak</p>
          <p className="text-caption text-ink-muted">MCP Dashboard</p>
        </div>
      </div>
      <ul className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <a
              href={item.hash}
              aria-current={item.id === active ? "page" : undefined}
              className={itemClass(item.id === active)}
            >
              {item.icon}
              {item.label}
            </a>
          </li>
        ))}
      </ul>
      <ul className="space-y-1 px-3 pb-5">
        <li>
          <a
            href="#/settings"
            aria-current={active === "settings" ? "page" : undefined}
            className={itemClass(active === "settings")}
          >
            {SETTINGS_ICON}
            Settings
          </a>
        </li>
        <li>
          {/* 대시보드 밖으로 나가는 유일한 링크다. 실행 화면을 잃지 않게 새 탭으로 연다. */}
          <a href={HELP_URL} target="_blank" rel="noreferrer" className={itemClass(false)}>
            {HELP_ICON}
            Help &amp; Docs
            <span className="sr-only">(새 탭에서 열림)</span>
          </a>
        </li>
      </ul>
    </nav>
  );
}

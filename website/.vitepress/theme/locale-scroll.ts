import type { Router } from "vitepress";
import { nextTick } from "vue";

// 한영 전환 때 읽던 자리를 지킨다.
//
// VitePress 라우터는 페이지를 옮길 때마다 맨 위로 스크롤한다. 언어만 바꾸는 이동이면 직전에
// 화면 위쪽에 가장 가까운 기준점(제목 또는 `data-locale-anchor`)과 그 기준점에서 얼마나
// 내려와 있었는지를 적어 두고, 새 페이지에서 같은 순번의 기준점으로 되돌린다.
// 두 언어 페이지는 같은 구조로 번역돼 있으므로 순번이 같은 기준점이 같은 자리다. 기준점 수가
// 다르면(번역이 어긋난 페이지) 문서 전체 길이에 대한 비율로 대신한다.

const ANCHORS = "h1, h2, h3, [data-locale-anchor]";
const LOCALE_PREFIX = /^ko(\/|$)/;

interface Saved {
  readonly index: number;
  readonly count: number;
  readonly delta: number;
  readonly ratio: number;
  readonly scrollY: number;
}

/** base 와 언어 접두어, 확장자, index 를 걷어 낸 경로. 두 언어 페이지가 같은 값을 낸다. */
function pageKey(pathname: string, base: string): string {
  let path = decodeURI(pathname);
  if (path.startsWith(base)) path = path.slice(base.length);
  path = path.replace(/^\/+/, "").replace(LOCALE_PREFIX, "");
  return path
    .replace(/\.html$/, "")
    .replace(/(^|\/)index$/, "$1")
    .replace(/\/$/, "");
}

const isKorean = (pathname: string, base: string): boolean => {
  const path = decodeURI(pathname).slice(base.length).replace(/^\/+/, "");
  return LOCALE_PREFIX.test(path);
};

/** transform 을 무시한 문서상 위치. 회전 중인 요소도 제자리 값을 준다. */
function pageTop(el: HTMLElement): number {
  let y = 0;
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null)
    y += n.offsetTop;
  return y;
}

function fixedNavHeight(): number {
  const nav = document.querySelector<HTMLElement>(".VPNav");
  if (!nav || getComputedStyle(nav).position !== "fixed") return 0;
  return nav.getBoundingClientRect().height;
}

function anchors(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`.VPContent :is(${ANCHORS})`));
}

const maxScroll = (): number =>
  Math.max(1, document.documentElement.scrollHeight - window.innerHeight);

function capture(): Saved {
  const line = window.scrollY + fixedNavHeight();
  const list = anchors();
  let index = -1;
  let delta = 0;
  let best = Number.POSITIVE_INFINITY;
  list.forEach((el, i) => {
    const d = line - pageTop(el);
    if (Math.abs(d) < best) {
      best = Math.abs(d);
      index = i;
      delta = d;
    }
  });
  return {
    index,
    count: list.length,
    delta,
    ratio: window.scrollY / maxScroll(),
    scrollY: window.scrollY,
  };
}

function restore(saved: Saved): void {
  if (saved.scrollY === 0) return;
  const list = anchors();
  let top: number;
  if (saved.index >= 0 && list.length === saved.count) {
    top = pageTop(list[saved.index]) + saved.delta - fixedNavHeight();
  } else {
    top = saved.ratio * maxScroll();
  }
  window.scrollTo({ top: Math.max(0, Math.round(top)), behavior: "instant" });
}

export function keepScrollOnLocaleSwitch(router: Router, base: string): void {
  let pending: Saved | null = null;
  const before = router.onBeforeRouteChange;
  const after = router.onAfterRouteChange;

  router.onBeforeRouteChange = async (href) => {
    if ((await before?.(href)) === false) return false;
    const next = new URL(href, location.href).pathname;
    const here = location.pathname;
    const switching =
      isKorean(next, base) !== isKorean(here, base) && pageKey(next, base) === pageKey(here, base);
    pending = switching ? capture() : null;
  };

  router.onAfterRouteChange = async (href) => {
    await after?.(href);
    const saved = pending;
    pending = null;
    if (!saved) return;
    // 라우터가 nextTick 에서 맨 위로 올린 뒤에 되돌린다. 새 페이지 레이아웃이 잡힐 때까지 한 프레임 더 기다린다.
    await nextTick();
    requestAnimationFrame(() => restore(saved));
  };
}

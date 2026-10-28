<script setup lang="ts">
import { useData, withBase } from "vitepress";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  BACKGROUND_LOGS,
  DEMO_COMMAND,
  INSTALL_COMMAND,
  type LandingIcon,
  type LandingPersonaId,
  type LogLine,
  landingCopy,
  PERSONA_TERMINALS,
  REPO_URL,
} from "../landing-copy";

const { lang } = useData();
const copy = computed(() => landingCopy(lang.value));

const href = (link: string): string => (link.startsWith("http") ? link : withBase(link));

/** `` `code` `` 조각을 나눠 <code> 로 그린다. */
const segments = (text: string) =>
  text.split("`").map((part, index) => ({ text: part, code: index % 2 === 1 }));

const backgroundLogs = BACKGROUND_LOGS.map((log) => ({
  title: log.title,
  // 위로 흐르는 애니메이션이 끊기지 않도록 두 번 이어 붙인다(-50% 에서 처음과 같은 장면이 된다).
  lines: [...log.lines, ...log.lines],
}));

const markOf = (line: LogLine): string =>
  line.kind === "cmd"
    ? "$ "
    : line.kind === "pass"
      ? "✓ "
      : line.kind === "fail"
        ? "✗ "
        : line.kind === "fix"
          ? "해결: "
          : "";

// ── 나는 MCP [개발자 / 사용자] 입니다 ─────────────────────────────────────────

const PERSONA_IDS: readonly LandingPersonaId[] = ["developer", "user"];
const persona = ref<LandingPersonaId>("developer");
const activePersona = computed(
  () =>
    copy.value.personas.items.find((item) => item.id === persona.value) ??
    copy.value.personas.items[0],
);
const personaTerminal = computed(() => PERSONA_TERMINALS[persona.value]);
const dashScreen = computed(() => activePersona.value.dashboard.screen);
const personaTabs = ref<HTMLButtonElement[]>([]);

/** 라디오 그룹의 좌우 화살표 · Home · End. 포커스와 선택을 함께 옮긴다. */
function onPersonaKey(event: KeyboardEvent): void {
  const now = PERSONA_IDS.indexOf(persona.value);
  const last = PERSONA_IDS.length - 1;
  const next =
    event.key === "ArrowRight"
      ? (now + 1) % PERSONA_IDS.length
      : event.key === "ArrowLeft"
        ? (now + last) % PERSONA_IDS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? last
            : -1;
  if (next < 0) return;
  event.preventDefault();
  persona.value = PERSONA_IDS[next];
  personaTabs.value[next]?.focus();
}

// ── 설치 명령 복사 ──────────────────────────────────────────────────────

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copyInstall(): Promise<void> {
  try {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // 클립보드 권한이 없으면 아무것도 하지 않는다. 명령은 화면에 그대로 보인다.
  }
}

// ── 스크롤 연출 ─────────────────────────────────────────────────────────
//
// 맨 위에서 아래로 굴리면 배경 터미널들이 오른쪽으로 돌며 빠지고(0 → BG_END), 그 뒤에
// 앞 터미널이 왼쪽에서 돌아 들어와 자리를 잡는다(TERM_START → 1). 이 구간은 한 번 굴리면
// 끝까지 자동으로 스크롤하고, 그 아래는 손대지 않는다.

const BG_END = 0.5;
const TERM_START = 0.45;
/** 연출이 끝났을 때 앞 터미널 윗변과 내비게이션 바 아랫변 사이 여백(px). */
const TERM_GAP = 40;
const SCROLL_MIN = 320;
/** 구간 전체를 자동으로 지나는 시간. */
const AUTO_MS = 1300;
/** 도착한 뒤 트랙패드 관성을 흘려보내는 시간. */
const SETTLE_MS = 450;

const progress = ref(0);
const reduceMotion = ref(false);
const termEl = ref<HTMLElement | null>(null);

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const range = (v: number, a: number, b: number): number => clamp01((v - a) / (b - a));
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const bg = computed(() => easeOut(range(progress.value, 0, BG_END)));
const term = computed(() => easeOut(range(progress.value, TERM_START, 1)));

const bgStyle = computed(() => {
  const t = bg.value;
  return {
    opacity: String(1 - t),
    transform: reduceMotion.value
      ? "none"
      : `translateX(${(t * 38).toFixed(2)}%) rotate(${(t * 28).toFixed(2)}deg) scale(${(1 - t * 0.12).toFixed(3)})`,
  };
});

const termStyle = computed(() => {
  if (reduceMotion.value) return { opacity: "1", transform: "none" };
  const t = term.value;
  const rest = 1 - t;
  return {
    opacity: t.toFixed(3),
    transform: `perspective(1400px) translateX(${(rest * -70).toFixed(2)}vw) rotateY(${(rest * 38).toFixed(2)}deg) rotate(${(rest * -22).toFixed(2)}deg) scale(${(0.86 + t * 0.14).toFixed(3)})`,
  };
});

const captionOpacity = computed(() =>
  reduceMotion.value ? "1" : range(term.value, 0.7, 1).toFixed(3),
);

/** 내비게이션 바가 화면 위에 고정돼 있으면(데스크톱) 그 높이, 아니면 0. */
function fixedNavHeight(): number {
  const nav = document.querySelector<HTMLElement>(".VPNav");
  if (!nav || getComputedStyle(nav).position !== "fixed") return 0;
  return nav.getBoundingClientRect().height;
}

/** 연출이 끝나는 스크롤 위치. offsetTop 은 transform 을 무시하므로 회전 중에도 제자리 값이다. */
function scrollEnd(): number {
  const el = termEl.value;
  if (!el) return SCROLL_MIN;
  let y = 0;
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null)
    y += n.offsetTop;
  return Math.max(SCROLL_MIN, Math.round(y - fixedNavHeight() - TERM_GAP));
}

let frame = 0;
let tween = 0;
let lockUntil = 0;
let touchY: number | null = null;

function syncProgress(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    progress.value = clamp01(window.scrollY / scrollEnd());
  });
}

/** 연출과 상관없는 곳(검색창, 모바일 메뉴, 자체 스크롤 영역)에서 온 입력이면 손대지 않는다. */
function isForeign(target: EventTarget | null): boolean {
  if (document.body.style.overflow === "hidden") return true;
  if (!(target instanceof Element)) return false;
  if (target.closest(".VPLocalSearchBox, .VPNavScreen, input, textarea, select, [contenteditable]"))
    return true;
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return true;
  }
  return false;
}

function autoScroll(to: number, end: number): void {
  const from = window.scrollY;
  const ms = (AUTO_MS * Math.abs(to - from)) / end;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / Math.max(ms, 1));
    window.scrollTo({ top: from + (to - from) * easeInOut(t), behavior: "instant" });
    if (t < 1) {
      tween = requestAnimationFrame(step);
      return;
    }
    tween = 0;
    lockUntil = performance.now() + SETTLE_MS;
  };
  tween = requestAnimationFrame(step);
}

/** 연출 구간 안에서 방향(+1 아래, -1 위)이 들어오면 자동 스크롤을 건다. 입력을 삼켰으면 true. */
function steer(dir: 1 | -1, target: EventTarget | null): boolean {
  if (tween || performance.now() < lockUntil) return true;
  if (reduceMotion.value || isForeign(target)) return false;
  const top = window.scrollY;
  const end = scrollEnd();
  if (dir > 0 && top < end - 1) {
    autoScroll(end, end);
    return true;
  }
  if (dir < 0 && top > 0 && top <= end + 1) {
    autoScroll(0, end);
    return true;
  }
  return false;
}

function onWheel(e: WheelEvent): void {
  if (e.ctrlKey || e.deltaY === 0 || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
  if (steer(e.deltaY > 0 ? 1 : -1, e.target)) e.preventDefault();
}

function onTouchStart(e: TouchEvent): void {
  touchY = e.touches.length === 1 ? e.touches[0].clientY : null;
}

function onTouchMove(e: TouchEvent): void {
  if (touchY === null || e.touches.length !== 1) return;
  const dy = touchY - e.touches[0].clientY;
  if (Math.abs(dy) < 6 && !tween) return;
  if (steer(dy > 0 ? 1 : -1, e.target)) e.preventDefault();
}

const DOWN_KEYS = new Set(["ArrowDown", "PageDown", " "]);
const UP_KEYS = new Set(["ArrowUp", "PageUp"]);

function onKeyDown(e: KeyboardEvent): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  // 버튼 · 링크에 포커스가 있으면 스페이스는 그쪽 몫이다. 문서 자체에 포커스가 있을 때만 다룬다.
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) return;
  const dir =
    DOWN_KEYS.has(e.key) && !e.shiftKey
      ? 1
      : UP_KEYS.has(e.key) || (e.key === " " && e.shiftKey)
        ? -1
        : 0;
  if (dir !== 0 && steer(dir, e.target)) e.preventDefault();
}

let motionQuery: MediaQueryList | undefined;
const onMotionChange = (): void => {
  reduceMotion.value = motionQuery?.matches ?? false;
};

onMounted(() => {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  onMotionChange();
  motionQuery.addEventListener("change", onMotionChange);
  window.addEventListener("scroll", syncProgress, { passive: true });
  window.addEventListener("resize", syncProgress, { passive: true });
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  syncProgress();
});

onBeforeUnmount(() => {
  motionQuery?.removeEventListener("change", onMotionChange);
  window.removeEventListener("scroll", syncProgress);
  window.removeEventListener("resize", syncProgress);
  window.removeEventListener("wheel", onWheel);
  window.removeEventListener("touchstart", onTouchStart);
  window.removeEventListener("touchmove", onTouchMove);
  window.removeEventListener("keydown", onKeyDown);
  cancelAnimationFrame(frame);
  cancelAnimationFrame(tween);
  clearTimeout(copiedTimer);
});

const ICON_PATHS: Record<LandingIcon, string> = {
  terminal:
    "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 9l3 3-3 3M13 15h4",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 14l2 2 4-4",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  server:
    "M4.5 4h15A1.5 1.5 0 0 1 21 5.5v4a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 9.5v-4A1.5 1.5 0 0 1 4.5 4zM4.5 13h15a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-4A1.5 1.5 0 0 1 4.5 13zM7 7.5h.01M7 16.5h.01",
  record: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4",
  shrink: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  layout: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 9h18M9 21V9",
  wrench:
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
};

const DOC_ICON_PATHS = {
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  book: "M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z",
  code: "M8 6l-5 6 5 6M16 6l5 6-5 6",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
  shield: ICON_PATHS.shield,
  shrink: ICON_PATHS.shrink,
  layout: ICON_PATHS.layout,
} as const;

const GITHUB_PATH =
  "M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.4 6.4-1.5 6.4-6.9a5.4 5.4 0 0 0-1.5-3.7 5 5 0 0 0-.1-3.8s-1.2-.4-3.9 1.5a13.4 13.4 0 0 0-7 0C6.3 1.6 5.1 2 5.1 2a5 5 0 0 0-.1 3.8A5.4 5.4 0 0 0 3.5 9.5c0 5.4 3.3 6.5 6.4 6.9a3.4 3.4 0 0 0-.9 2.6V22";
</script>

<template>
  <div class="landing">
    <!-- Hero + 터미널. 배경은 이 둘을 함께 덮는다. -->
    <div class="stage">
      <div class="bg" aria-hidden="true">
        <div class="bg-motion" :style="bgStyle">
          <div class="bg-plane">
            <div v-for="(log, i) in backgroundLogs" :key="log.title" class="term bg-term" :class="{ 'bg-term-b': i === 1 }">
              <div class="term-bar">
                <span class="dot" /><span class="dot" /><span class="dot" />
                <span class="term-title">{{ log.title }}</span>
              </div>
              <div class="bg-term-body">
                <div class="bg-log" :class="{ 'bg-log-b': i === 1 }">
                  <div v-for="(line, j) in log.lines" :key="j" class="log-line" :class="`k-${line.kind}`">
                    <span class="mark">{{ markOf(line) }}</span>{{ line.text }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="bg-veil" />
      </div>

      <section class="hero">
        <h1 class="hero-title">
          {{ copy.heroLine1 }}<br /><span class="hero-accent">{{ copy.heroLine2 }}</span>
        </h1>
        <p class="hero-lead">{{ copy.heroLead }}</p>
        <div class="hero-actions">
          <a class="btn btn-brand" :href="href(copy.primary.link)">{{ copy.primary.text }}</a>
          <a class="btn btn-icon" :href="REPO_URL" aria-label="GitHub" target="_blank" rel="noreferrer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="GITHUB_PATH" /></svg>
          </a>
        </div>
        <div class="install">
          <span class="install-prompt" aria-hidden="true">$</span>
          <code>{{ INSTALL_COMMAND }}</code>
          <button type="button" class="install-copy" :aria-label="copied ? copy.copiedLabel : copy.copyLabel" @click="copyInstall">
            <svg v-if="!copied" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></svg>
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          </button>
          <span class="visually-hidden" aria-live="polite">{{ copied ? copy.copiedLabel : "" }}</span>
        </div>
      </section>

      <section class="demo">
        <div ref="termEl" class="term demo-term" data-locale-anchor :style="termStyle">
          <div class="term-bar">
            <span class="dot" /><span class="dot" /><span class="dot" />
            <span class="term-title">zsh — weather-server</span>
          </div>
          <div class="demo-body">
            <div class="log-line"><span class="c-dim">$ </span>{{ DEMO_COMMAND }}</div>
            <div class="gap" />
            <div class="log-line k-head">{{ "날씨 서버  " }}<span class="c-dim-2">(3 cases)</span></div>
            <div class="gap" />
            <div class="log-line"><span class="c-ok">✓</span>{{ " tool-exists     " }}<span class="c-dim-2">get_weather 도구를 제공한다</span></div>
            <div class="log-line"><span class="c-ok">✓</span>{{ " seoul-succeeds  " }}<span class="c-dim-2">서울 날씨를 정상 조회한다</span></div>
            <div class="log-line"><span class="c-fail">✗</span>{{ " missing-tool    " }}<span class="c-dim-2">존재하지 않는 도구를 요구한다</span></div>
            <div class="failure">
              <div class="log-line"><span class="c-fail">toolExists</span>{{ "  " }}툴 'missing_weather_tool'을(를) 찾을 수 없습니다. 발견된 툴: 'add', 'get_weather'</div>
              <div class="log-line"><span class="c-brand">해결:</span> 서버의 tools/list 응답과 테스트 명세를 확인하세요.</div>
            </div>
            <div class="gap" />
            <div class="log-line"><span class="c-ok">2 passed</span>, <span class="c-fail">1 failed</span>{{ "  " }}<span class="c-dim-2">(3 total)</span></div>
          </div>
        </div>
        <p class="demo-caption" :style="{ opacity: captionOpacity }">
          <span class="pulse" aria-hidden="true" />
          {{ copy.terminalCaption }}
        </p>
      </section>
    </div>

    <!-- 가치 선언 -->
    <section class="band">
      <div class="band-inner">
        <p class="band-text">
          <strong>{{ copy.statement.strong }}</strong>{{ copy.statement.rest }}<br />{{ copy.statement.lead }}<code>{{ copy.statement.code }}</code>{{ copy.statement.tail }}
        </p>
        <ul class="checks">
          <li v-for="item in copy.checks" :key="item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
            {{ item }}
          </li>
        </ul>
      </div>
    </section>

    <!-- 나는 MCP [개발자 | 사용자] 입니다. 여기서 고른 사람에 따라 아래 섹션이 전부 바뀐다 -->
    <section class="chooser">
      <div class="chooser-inner">
        <h2 class="chooser-sentence">
          <span>{{ copy.personas.before }}</span>
          <span class="chooser-switch" role="radiogroup" :aria-label="copy.personas.choiceLabel" @keydown="onPersonaKey">
            <button
              v-for="(item, i) in copy.personas.items"
              :key="item.id"
              :ref="(el) => { if (el) personaTabs[i] = el as HTMLButtonElement; }"
              type="button"
              role="radio"
              class="chooser-option"
              :aria-checked="persona === item.id"
              :tabindex="persona === item.id ? 0 : -1"
              @click="persona = item.id"
            >{{ item.choice }}</button>
          </span>
          <span>{{ copy.personas.after }}</span>
        </h2>
        <p class="chooser-question" aria-live="polite">{{ activePersona.question }}</p>
      </div>
    </section>

    <div :key="activePersona.id" class="persona-scope">
      <!-- 기능 -->
      <section class="section persona">
        <div class="persona-panel">
          <ol class="persona-list">
            <li v-for="feature in activePersona.features" :key="feature.title" class="persona-row">
              <span class="persona-when">{{ feature.when }}</span>
              <div class="persona-what">
                <h3 class="card-title persona-title">
                  <span class="persona-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path :d="ICON_PATHS[feature.icon]" />
                      <circle v-if="feature.icon === 'record'" cx="12" cy="12" r="3.5" fill="currentColor" />
                    </svg>
                  </span>
                  {{ feature.title }}
                </h3>
                <p class="card-text">
                  <template v-for="(seg, k) in segments(feature.details)" :key="k"><code v-if="seg.code">{{ seg.text }}</code><template v-else>{{ seg.text }}</template></template>
                </p>
                <code class="persona-cmd">{{ feature.command }}</code>
              </div>
            </li>
          </ol>

          <div class="persona-side">
            <div class="term persona-term">
              <div class="term-bar">
                <span class="dot" /><span class="dot" /><span class="dot" />
                <span class="term-title">{{ personaTerminal.title }}</span>
              </div>
              <div class="persona-term-body">
                <div v-for="(line, j) in personaTerminal.lines" :key="j" class="persona-term-line">
                  <span v-for="(part, k) in line" :key="k" :class="`t-${part.tone}`">{{ part.text }}</span>
                </div>
              </div>
            </div>
            <nav class="persona-start" :aria-label="copy.personas.startLabel">
              <span class="persona-start-label">{{ copy.personas.startLabel }}</span>
              <template v-for="(link, k) in activePersona.start" :key="link.link">
                <span v-if="k > 0" class="persona-start-sep" aria-hidden="true">→</span>
                <a :href="href(link.link)">{{ link.text }}</a>
              </template>
            </nav>
          </div>
        </div>
      </section>

      <!-- 대시보드 -->
      <section class="dash">
        <div class="dash-inner">
          <div class="dash-copy">
            <p class="eyebrow">{{ copy.dashboard.eyebrow }}</p>
            <h2 class="section-title dash-title">{{ activePersona.dashboard.title[0] }}<br />{{ activePersona.dashboard.title[1] }}</h2>
            <p class="dash-lead">
              <template v-for="(seg, k) in segments(activePersona.dashboard.lead)" :key="k"><code v-if="seg.code">{{ seg.text }}</code><template v-else>{{ seg.text }}</template></template>
            </p>
            <ul class="dash-points">
              <li v-for="point in activePersona.dashboard.points" :key="point">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
                {{ point }}
              </li>
            </ul>
            <code class="dash-cmd">{{ activePersona.dashboard.command }}</code>
          </div>

          <div class="term dash-window" aria-hidden="true">
            <div class="term-bar">
              <span class="dot" /><span class="dot" /><span class="dot" />
              <span class="dash-url">localhost:7357</span>
            </div>
            <div class="dash-body">
              <div class="dash-menu">
                <span v-for="(item, i) in copy.dashboard.menu" :key="item" :class="{ active: i === activePersona.dashboard.activeMenu }">{{ item }}</span>
              </div>
              <div v-if="dashScreen.kind === 'suites'" class="dash-main">
                <span class="dash-label">{{ dashScreen.label }}</span>
                <div class="dash-row"><span class="led ok" /><span class="dash-file">weather.suite.json</span><span class="c-ok">{{ dashScreen.passed }}</span></div>
                <div class="dash-row is-fail"><span class="led fail" /><span class="dash-file">calendar.suite.json</span><span class="c-fail">{{ dashScreen.failed }}</span></div>
                <div class="dash-row"><span class="led idle" /><span class="dash-file">search.suite.json</span><span class="c-dim-2">{{ dashScreen.notRun }}</span></div>
                <div class="dash-run">
                  <span class="dash-input">node ./server.mjs</span>
                  <span class="dash-run-btn">{{ dashScreen.run }}</span>
                </div>
              </div>
              <div v-else class="dash-main">
                <div class="dash-tabs">
                  <span v-for="(tab, i) in dashScreen.tabs" :key="tab" :class="{ active: i === dashScreen.activeTab }">{{ tab }}</span>
                  <span class="dash-summary c-fail">{{ dashScreen.summary }}</span>
                </div>
                <div v-for="finding in dashScreen.findings" :key="finding.rule" class="dash-row" :class="{ 'is-fail': finding.level === 'crit' }">
                  <span class="dash-badge" :class="`is-${finding.level}`">{{ finding.badge }}</span>
                  <span class="dash-file">{{ finding.rule }}</span>
                  <span class="c-dim-2">{{ finding.where }}</span>
                </div>
                <div class="dash-run">
                  <span class="dash-input">npx -y some-mcp-server@1.2.3</span>
                  <span class="dash-run-btn">Audit</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 시작하기 -->
      <section class="steps">
        <div class="section">
          <header class="section-head">
            <p class="eyebrow">{{ copy.steps.eyebrow }}</p>
            <h2 class="section-title">{{ activePersona.steps.title }}</h2>
          </header>
          <ol class="grid grid-3 step-list">
            <li v-for="(step, i) in activePersona.steps.items" :key="step.title" class="step">
              <span class="step-num">{{ i + 1 }}</span>
              <h3 class="card-title step-title">{{ step.title }}</h3>
              <p class="card-text step-text">
                <template v-for="(seg, k) in segments(step.details)" :key="k"><code v-if="seg.code">{{ seg.text }}</code><template v-else>{{ seg.text }}</template></template>
              </p>
              <code class="step-cmd">{{ step.command }}</code>
            </li>
          </ol>
        </div>
      </section>

      <!-- 문서 -->
      <section class="section">
        <header class="section-head">
          <p class="eyebrow">{{ copy.docs.eyebrow }}</p>
          <h2 class="section-title">{{ activePersona.docs.title }}</h2>
        </header>
        <div class="grid grid-4">
          <a v-for="card in activePersona.docs.cards" :key="card.title" class="card doc-card" :href="href(card.link)">
            <svg class="doc-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="DOC_ICON_PATHS[card.icon]" /></svg>
            <span class="doc-title">{{ card.title }}</span>
            <span class="card-text">{{ card.details }}</span>
          </a>
        </div>
      </section>
    </div>

    <!-- 푸터 -->
    <footer class="foot">
      <div class="foot-inner">
        <div class="foot-brand">
          <span class="foot-name"><img :src="withBase('/logo.svg')" alt="" width="28" height="28" />MCPeak</span>
          <p class="card-text">{{ copy.footer.tagline }}</p>
        </div>
        <nav v-for="col in copy.footer.columns" :key="col.title" class="foot-col" :aria-label="col.title">
          <span class="foot-col-title">{{ col.title }}</span>
          <a v-for="link in col.links" :key="link.text" :href="href(link.link)">{{ link.text }}</a>
        </nav>
      </div>
      <div class="foot-bottom">{{ copy.footer.bottom }}</div>
    </footer>
  </div>
</template>

<style scoped>
/* 터미널 창은 테마를 타지 않는 고정 다크다. 나머지는 VitePress 토큰을 따른다. */
.landing {
  --term-bg: #161618;
  --term-bar: #202127;
  --term-line: #2e2e32;
  --term-border: #3c3f44;
  --term-text: #dfdfd6;
  --term-dim: #98989f;
  --term-dimmer: #6a6a71;
  --term-ok: #3dd68c;
  --term-fail: #f66f81;
  --term-brand: #a8b1ff;

  color: var(--vp-c-text-1);
  word-break: keep-all;
  overflow-x: clip;
}

.landing code {
  font-family: var(--vp-font-family-mono);
}

/* ── 무대(hero + 터미널) ── */

.stage {
  position: relative;
  overflow: hidden;
}

.bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 18%, #000 70%, transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0%, #000 18%, #000 70%, transparent 100%);
}

.bg-motion {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1500px;
  height: 1300px;
  margin: -650px 0 0 -750px;
  transform-origin: 30% 60%;
  will-change: transform, opacity;
}

.bg-plane {
  width: 100%;
  height: 100%;
  transform: perspective(1400px) rotateX(24deg) rotateZ(-10deg);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 72px;
  align-items: start;
  opacity: 0.4;
}

.bg-veil {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 46% 40% at 50% 42%,
    color-mix(in srgb, var(--vp-c-bg) 92%, transparent) 0%,
    color-mix(in srgb, var(--vp-c-bg) 55%, transparent) 60%,
    transparent 100%
  );
}

.term {
  border-radius: 14px;
  border: 1px solid var(--term-border);
  background: var(--term-bg);
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  color: var(--term-text);
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  line-height: 24px;
}

.term-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  border-bottom: 1px solid var(--term-line);
  background: var(--term-bar);
  flex-shrink: 0;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #414853;
}

.term-title {
  margin-left: 12px;
  font-size: 12px;
  color: var(--term-dim);
}

.bg-term {
  height: 1000px;
  display: flex;
  flex-direction: column;
}

.bg-term-b {
  margin-top: 220px;
}

.bg-term-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 28px;
}

.bg-log {
  animation: log-up 48s linear infinite;
}

.bg-log-b {
  animation-duration: 62s;
  animation-delay: -24s;
}

@keyframes log-up {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-50%);
  }
}

.log-line {
  white-space: pre-wrap;
  word-break: normal;
  overflow-wrap: anywhere;
}

.bg-log .log-line {
  white-space: pre;
  color: var(--term-dim);
}

.k-head {
  color: var(--term-text) !important;
  font-weight: 600;
}
.k-cmd,
.k-sum {
  color: var(--term-text) !important;
}
.k-note,
.k-fix {
  padding-left: 28px;
}
.k-note {
  color: var(--term-fail) !important;
}
.k-cmd .mark {
  color: var(--term-dimmer);
}
.k-pass .mark {
  color: var(--term-ok);
}
.k-fail .mark {
  color: var(--term-fail);
}
.k-fix .mark {
  color: var(--term-brand);
}

.c-dim {
  color: var(--term-dimmer);
}
.c-dim-2 {
  color: var(--term-dim);
  font-weight: 400;
}
.c-ok {
  color: var(--term-ok);
}
.c-fail {
  color: var(--term-fail);
}
.c-brand {
  color: var(--term-brand);
}

.hero {
  position: relative;
  z-index: 1;
  max-width: 1152px;
  margin: 0 auto;
  padding: 112px 24px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 24px;
}

.hero-title {
  margin: 0;
  max-width: 900px;
  font-size: 60px;
  line-height: 70px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.hero-accent {
  color: var(--vp-c-brand-1);
}

.hero-lead {
  margin: 0;
  max-width: 680px;
  font-size: 19px;
  line-height: 32px;
  color: var(--vp-c-text-2);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 8px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  border-radius: 22px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition:
    background-color 0.25s,
    color 0.25s;
}

.btn-brand {
  padding: 0 22px;
  background: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
}
.btn-brand:hover {
  background: var(--vp-button-brand-hover-bg);
  color: var(--vp-button-brand-hover-text);
}

.btn-icon {
  width: 44px;
  background: var(--vp-button-alt-bg);
  color: var(--vp-button-alt-text);
}
.btn-icon:hover {
  background: var(--vp-button-alt-hover-bg);
  color: var(--vp-button-alt-hover-text);
}

.install {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  box-sizing: border-box;
  padding: 8px 8px 8px 18px;
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  font-size: 14px;
}

.install code {
  color: var(--vp-c-text-1);
  white-space: nowrap;
  overflow-x: auto;
}

.install-prompt {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

.install-copy {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  cursor: pointer;
}
.install-copy:hover {
  color: var(--vp-c-text-1);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.demo {
  position: relative;
  z-index: 1;
  max-width: 880px;
  margin: 0 auto;
  padding: 160px 24px 96px;
}

.demo-term {
  transform-origin: 50% 50%;
  will-change: transform, opacity;
}

.demo-body {
  padding: 24px 28px 28px;
  display: flex;
  flex-direction: column;
}

.gap {
  height: 16px;
}

.failure {
  margin: 8px 0 0 28px;
  padding: 12px 16px;
  border-radius: 8px;
  background: rgba(244, 63, 94, 0.1);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.demo-caption {
  margin: 20px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 14px;
  color: var(--vp-c-text-2);
  text-align: center;
}

.pulse {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--term-fail);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/* ── 가치 선언 ── */

.band {
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
}

.band-inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  text-align: center;
}

.band-text {
  margin: 0;
  /* 영어 첫 문장이 한 줄에 들어가는 폭. 줄바꿈은 <br> 로 직접 준다. */
  max-width: 900px;
  font-size: 17px;
  line-height: 30px;
}

.band-text strong {
  color: var(--vp-c-brand-1);
}

.band-text code {
  font-size: 15px;
  color: var(--vp-c-text-2);
}

.checks {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 28px;
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.checks li {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checks svg {
  color: var(--vp-c-green-1);
}

/* ── 공통 섹션 ── */

.section {
  max-width: 1152px;
  margin: 0 auto;
  padding: 96px 24px;
  display: flex;
  flex-direction: column;
  gap: 48px;
}

.section-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.eyebrow {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.section-title {
  margin: 0;
  font-size: 36px;
  line-height: 46px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
  border: 0;
  padding: 0;
}

.section-lead {
  margin: 0;
  max-width: 640px;
  font-size: 17px;
  line-height: 28px;
  color: var(--vp-c-text-2);
}

.grid {
  display: grid;
  gap: 16px;
}
.grid-3 {
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}
.grid-4 {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.card {
  padding: 24px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-bg-soft);
  background: var(--vp-c-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.25s;
}
.card:hover {
  border-color: var(--vp-c-brand-2);
}

.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.card-text {
  margin: 0;
  font-size: 14px;
  line-height: 24px;
  color: var(--vp-c-text-2);
}

.card-text code,
.dash-lead code {
  font-size: 13px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
  padding: 1px 6px;
  border-radius: 4px;
}

/* ── 나는 MCP [개발자 / 사용자] 입니다 ── */

/* 문장 하나에서 괄호 자리만 고른다: 나는 MCP [개발자 | 사용자] 입니다 */
.chooser {
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
}

.chooser-inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 72px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  text-align: center;
}

.chooser-sentence {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px 18px;
  font-size: 44px;
  line-height: 56px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
  border: 0;
  padding: 0;
}

.chooser-switch {
  display: inline-flex;
  padding: 6px;
  gap: 4px;
  border-radius: 16px;
  border: 2px solid var(--vp-c-brand-1);
  background: var(--vp-c-bg);
}

.chooser-option {
  padding: 2px 22px;
  border-radius: 10px;
  border: 0;
  background: transparent;
  color: var(--vp-c-text-3);
  font: inherit;
  letter-spacing: inherit;
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.chooser-option:hover {
  color: var(--vp-c-text-1);
}

.chooser-option:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.chooser-option[aria-checked="true"] {
  background: var(--vp-c-brand-3);
  color: var(--vp-c-white);
}

.chooser-question {
  margin: 0;
  font-size: 18px;
  line-height: 28px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.persona-scope {
  animation: persona-in 0.3s ease-out;
}

.persona {
  padding-top: 72px;
}

.persona-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 40px;
  align-items: start;
}

@keyframes persona-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.persona-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--vp-c-divider);
}

.persona-row {
  display: grid;
  /* '…아직 없을 때' 같은 짧은 조건이 한 줄에 들어가는 폭. 140px 에서는 '때'가 혼자 넘어갔다. */
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 6px 24px;
  padding: 22px 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.persona-when {
  padding-top: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-3);
}

.persona-what {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.persona-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
}

.persona-icon {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 8px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.persona-cmd {
  align-self: flex-start;
  max-width: 100%;
  /* 가로 스크롤이 생기면 명령의 뒷부분이 안 보인다. 공백에서 접어 전부 드러낸다. */
  white-space: pre-wrap;
  word-break: keep-all;
  overflow-wrap: break-word;
  font-size: 12.5px;
  line-height: 20px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
}

.persona-side {
  position: sticky;
  top: calc(var(--vp-nav-height, 64px) + 24px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.persona-term {
  font-size: 13px;
  line-height: 22px;
}

.persona-term-body {
  padding: 20px 24px;
}

/* 진짜 터미널처럼 긴 줄은 접는다. 접힌 뒷줄은 들여써서 새 줄과 구분된다. */
.persona-term-line {
  min-height: 22px;
  white-space: pre-wrap;
  word-break: keep-all;
  overflow-wrap: anywhere;
  padding-left: 6ch;
  text-indent: -6ch;
}

.t-plain {
  color: var(--term-text);
}
.t-dim {
  color: var(--term-dim);
}
.t-ok {
  color: var(--term-ok);
}
.t-fail {
  color: var(--term-fail);
}
.t-warn {
  color: #f9b44e;
}
.t-brand {
  color: var(--term-brand);
}
.t-bold {
  color: var(--term-text);
  font-weight: 600;
}

.persona-start {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  font-size: 14px;
}

.persona-start-label {
  font-weight: 600;
  color: var(--vp-c-text-2);
  margin-right: 4px;
}

.persona-start a {
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.persona-start a:hover {
  text-decoration: underline;
}

.persona-start-sep {
  color: var(--vp-c-text-3);
}

@media (max-width: 960px) {
  .persona-panel {
    grid-template-columns: minmax(0, 1fr);
  }
  .persona-side {
    position: static;
  }
}

@media (max-width: 640px) {
  .chooser-inner {
    padding: 56px 24px;
  }
  .chooser-sentence {
    font-size: 30px;
    line-height: 40px;
    gap: 10px 12px;
  }
  .chooser-option {
    padding: 2px 14px;
  }
  .persona-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .persona-when {
    padding-top: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .persona-scope {
    animation: none;
  }
}

/* ── 대시보드 ── */

.dash {
  border-top: 1px solid var(--vp-c-divider);
}

.dash-inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 96px 24px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 56px;
}

.dash-copy {
  flex: 1 1 360px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dash-lead {
  margin: 0;
  font-size: 17px;
  line-height: 28px;
  color: var(--vp-c-text-2);
}

.dash-points {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 15px;
}

.dash-points li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dash-points svg {
  flex-shrink: 0;
  color: var(--vp-c-brand-1);
}

.dash-cmd {
  align-self: flex-start;
  max-width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  font-size: 13px;
  color: var(--vp-c-text-1);
  white-space: pre-wrap;
  word-break: keep-all;
  overflow-wrap: break-word;
}

.dash-window {
  flex: 1.4 1 480px;
  min-width: 0;
  font-family: var(--vp-font-family-base);
  font-size: 13px;
}

.dash-url {
  margin-left: 12px;
  flex: 1;
  max-width: 260px;
  height: 24px;
  border-radius: 6px;
  background: var(--term-bg);
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--term-dim);
}

.dash-body {
  display: flex;
  min-height: 340px;
}

.dash-menu {
  width: 148px;
  flex-shrink: 0;
  padding: 16px 10px;
  border-right: 1px solid var(--term-line);
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--term-dim);
}

.dash-menu span {
  padding: 6px 10px;
  border-radius: 6px;
}

.dash-menu .active {
  background: rgba(100, 108, 255, 0.16);
  color: var(--term-brand);
  font-weight: 600;
}

.dash-main {
  flex: 1;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dash-label {
  margin-bottom: 4px;
  font-size: 14px;
  font-weight: 600;
}

.dash-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--term-bar);
}

.dash-row.is-fail {
  border-color: rgba(246, 111, 129, 0.35);
}

.dash-file {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--vp-font-family-mono);
}

.dash-tabs {
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--term-dim);
}

.dash-tabs span {
  padding: 4px 12px;
  border-radius: 6px;
}

.dash-tabs .active {
  background: var(--term-bar);
  color: var(--term-text);
  font-weight: 600;
}

.dash-tabs .dash-summary {
  margin-left: auto;
  padding: 0;
  font-weight: 600;
}

.dash-badge {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
}
.dash-badge.is-crit {
  background: rgba(246, 111, 129, 0.16);
  color: var(--term-fail);
}
.dash-badge.is-warn {
  background: rgba(249, 180, 78, 0.16);
  color: #f9b44e;
}

.led {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 999px;
}
.led.ok {
  background: var(--term-ok);
}
.led.fail {
  background: var(--term-fail);
}
.led.idle {
  background: var(--term-dimmer);
}

.dash-run {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--term-line);
  display: flex;
  align-items: center;
  gap: 8px;
}

.dash-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  border-radius: 6px;
  background: var(--term-bar);
  display: flex;
  align-items: center;
  padding: 0 10px;
  overflow: hidden;
  white-space: nowrap;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--term-dim);
}

.dash-run-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 16px;
  background: #3e63dd;
  color: #fff;
  display: flex;
  align-items: center;
  font-weight: 600;
}

/* ── 시작하기 ── */

.steps {
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
}

.step-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  padding: 28px 24px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step-num {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
}

.step-title {
  margin-top: 4px;
  font-size: 17px;
}

.step-text {
  flex: 1;
}

.step-cmd {
  display: block;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-size: 13px;
  line-height: 20px;
  color: var(--vp-c-text-1);
  word-break: break-all;
}

/* ── 문서 ── */

.doc-card {
  border-color: var(--vp-c-divider);
  background: var(--vp-c-bg);
  gap: 8px;
  color: var(--vp-c-text-1);
  text-decoration: none;
}

.doc-icon {
  color: var(--vp-c-brand-1);
}

.doc-title {
  margin-top: 6px;
  font-size: 16px;
  font-weight: 600;
}

/* ── 푸터 ── */

.foot {
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
}

.foot-inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 56px 24px 40px;
  display: flex;
  flex-wrap: wrap;
  gap: 48px;
}

.foot-brand {
  flex: 2 1 280px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.foot-brand .card-text {
  max-width: 320px;
}

.foot-name {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
}

.foot-col {
  flex: 1 1 160px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 14px;
}

.foot-col-title {
  margin-bottom: 4px;
  font-weight: 600;
}

.foot-col a {
  color: var(--vp-c-text-2);
  text-decoration: none;
}
.foot-col a:hover {
  color: var(--vp-c-brand-1);
}

.foot-bottom {
  max-width: 1152px;
  margin: 0 auto;
  padding: 20px 24px 32px;
  border-top: 1px solid var(--vp-c-divider);
  font-size: 13px;
  color: var(--vp-c-text-2);
}

/* ── 반응형 · 동작 줄이기 ── */

@media (max-width: 720px) {
  .hero {
    padding-top: 72px;
  }
  .hero-title {
    font-size: 40px;
    line-height: 48px;
  }
  .hero-lead {
    font-size: 17px;
    line-height: 28px;
  }
  .demo {
    padding-top: 96px;
  }
  .demo-body {
    padding: 20px;
    font-size: 12px;
    line-height: 20px;
  }
  .section-title {
    font-size: 28px;
    line-height: 36px;
  }
  .dash-menu {
    display: none;
  }
  .grid-3,
  .grid-4 {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bg-log,
  .pulse {
    animation: none;
  }
}
</style>

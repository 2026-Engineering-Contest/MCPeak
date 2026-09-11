import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `theme.css` 의 계약을 고정한다 (ADR-0093).
 *
 * **왜 CSS 를 텍스트로 읽어 검사하는가.** 이 파일이 지키려는 규칙들 — 테마 값을 한 곳에서만
 * 선언한다, 터미널 팔레트는 테마로 갈리지 않는다 — 은 지금까지 주석으로만 적혀 있었다.
 * 주석은 사람이 읽을 때만 동작한다. 실제로 어긋난 적도 있다: 다크 값이 두 블록에 복제돼
 * 있던 시절, 파일 머리 주석이 "반드시 함께 고쳐라" 라고 경고하는 것이 유일한 방어였다.
 *
 * jsdom 으로 계산된 값을 재는 방법도 있지만 쓰지 않는다. jsdom 은 `light-dark()` 를
 * 모르고, Tailwind 를 거치지 않은 원본이라 `@theme` 도 전개되지 않는다. 그러면 통과해도
 * 아무것도 증명하지 못한다.
 */
const CSS = readFileSync(fileURLToPath(new URL("../src/theme.css", import.meta.url)), "utf8");

/**
 * 주석을 먼저 지운다. **이걸 빼면 검사가 통째로 거짓이 된다** — 이 파일의 주석은
 * `light-dark()` 와 `[data-theme="dark"]` 를 설명으로 언급하고 있어서, 주석을 남긴 채
 * 문자열을 찾으면 규칙을 어긴 CSS 가 없어도 있는 것처럼 잡힌다.
 */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

interface Block {
  readonly selector: string;
  readonly body: string;
}

/**
 * 최상위 블록(`선택자 { ... }`)을 잘라낸다. `@media` 처럼 안에 규칙을 더 품는 블록은
 * 본문을 통째로 돌려준다 — 그 안에 무엇이 들었는지가 이 테스트의 관심사다.
 */
function topLevelBlocks(css: string): readonly Block[] {
  const blocks: Block[] = [];
  let depth = 0;
  let selectorStart = 0;
  let bodyStart = 0;
  let selector = "";

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") {
      if (depth === 0) {
        selector = css.slice(selectorStart, index).trim();
        bodyStart = index + 1;
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        blocks.push({ selector, body: css.slice(bodyStart, index) });
        selectorStart = index + 1;
      }
    } else if (char === ";" && depth === 0) {
      // 최상위 `@import ...;` 같은 문장. 여기서 끊지 않으면 그 문장이 다음 블록의
      // 선택자 앞에 붙어 `:root` 를 이름으로 찾을 수 없게 된다.
      selectorStart = index + 1;
    }
  }
  return blocks;
}

const BLOCKS = topLevelBlocks(CODE);

function bodyOf(selector: string): string {
  const found = BLOCKS.find((block) => block.selector === selector);
  if (found === undefined) {
    throw new Error(
      `theme.css 에 '${selector}' 블록이 없습니다. 있는 블록: ${BLOCKS.map((b) => b.selector).join(" · ")}`,
    );
  }
  return found.body;
}

/** 테마에 따라 값이 갈리는 토큰. 전부 `light-dark()` 한 줄로만 적혀야 한다. */
const THEMED_TOKENS = [
  "--canvas",
  "--surface",
  "--line",
  "--line-subtle",
  "--ink",
  "--ink-muted",
  "--accent",
  "--accent-soft",
  "--accent-border",
  "--accent-hover",
  "--accent-active",
  "--focus-ring",
  "--status-running-fg",
  "--status-running-bg",
  "--status-waiting-fg",
  "--status-waiting-bg",
  "--status-done-fg",
  "--status-done-bg",
  "--status-failed-fg",
  "--status-failed-bg",
  "--terminal-border",
  "--terminal-inset-color",
  "--shadow-color",
] as const;

/**
 * 테마를 타지 않는 고정 팔레트.
 *
 * - 터미널 재현 영역(UI 설계 §3). 라이트 테마에서도 터미널은 다크다.
 * - 로고(#459). 로고는 자기 다크 사각형(`--terminal-bg`) 위에 그려지므로 선 · 체크 색이 테마를
 *   따라가면 라이트에서만 어두운 보라가 검은 바탕에 묻힌다. 예전 로고는 흰 바탕 위라 테마를 탔다.
 */
const FIXED_TERMINAL_TOKENS = [
  "--terminal-bg",
  "--terminal-header-bg",
  "--terminal-fg",
  "--terminal-muted",
  "--logo-from",
  "--logo-to",
  "--logo-check",
] as const;

/**
 * `선택자 { ... }` 안에서 그 토큰의 선언 값을 **전부** 꺼낸다.
 *
 * 하나만 꺼내면 안 된다. 같은 블록에 같은 토큰이 두 번 있으면 브라우저는 **뒤의 것**을
 * 쓰는데, 앞의 것만 보고 통과시키면 화면을 바꾼 선언이 검사를 비껴간다(#455 리뷰).
 *
 * 이름 앞뒤에 다른 글자가 붙은 것은 세지 않는다 — `--line` 을 찾다가 `--line-subtle` 을
 * 같은 토큰으로 세면 안 된다. 뒤는 `\s*:` 가, 앞은 lookbehind 가 막는다.
 */
function declarations(body: string, token: string): readonly string[] {
  return [...body.matchAll(new RegExp(`(?<![\\w-])${token}\\s*:\\s*([^;]+);`, "g"))].map((match) =>
    (match[1] ?? "").trim(),
  );
}

/** 브라우저가 실제로 쓰는 값, 곧 마지막 선언. 없으면 null. */
function declaration(body: string, token: string): string | null {
  return declarations(body, token).at(-1) ?? null;
}

/** 토큰이 `:root` 에 정확히 한 번 있지 않을 때 무엇이 어긋났는지 말한다. */
function countMessage(token: string, found: readonly string[]): string {
  return found.length === 0
    ? `${token} 선언이 :root 에 없습니다`
    : `${token} 선언이 :root 에 ${found.length}개 있습니다 (${found.join(" · ")}) — 브라우저는 마지막 것을 씁니다. 하나만 남기세요.`;
}

describe("테마 토큰 선언", () => {
  it.each(THEMED_TOKENS)("%s 는 light-dark() 로 한 번만 적는다", (token) => {
    const found = declarations(bodyOf(":root"), token);
    expect(found, countMessage(token, found)).toHaveLength(1);
    expect(found[0]).toMatch(/^light-dark\(/);
  });

  it.each(FIXED_TERMINAL_TOKENS)("%s 는 테마로 갈리지 않는다", (token) => {
    // 고정 팔레트도 같은 구멍이 있다. 고정값 뒤에 `light-dark()` 선언이 한 줄 더 붙으면
    // 터미널이 테마를 타는데, 첫 선언만 보면 통과한다.
    const found = declarations(bodyOf(":root"), token);
    expect(found, countMessage(token, found)).toHaveLength(1);
    expect(found[0]).not.toContain("light-dark(");
  });

  it("--terminal-inset 은 모양을 고정하고 색만 토큰으로 가른다", () => {
    // `light-dark()` 는 색만 받는다. 그림자 값을 통째로 가르려 하면 이 규칙이 깨진다.
    expect(declaration(bodyOf(":root"), "--terminal-inset")).toBe(
      "inset 0 1px 0 var(--terminal-inset-color)",
    );
  });
});

describe("테마 전환은 color-scheme 이 맡는다", () => {
  it("미선택(:root)은 OS 에 위임한다", () => {
    expect(declaration(bodyOf(":root"), "color-scheme")).toBe("light dark");
  });

  it.each(["light", "dark"] as const)('data-theme="%s" 는 그 값으로 고정한다', (mode) => {
    // **두 방향이 다 있어야 한다.** 한쪽만 두면 OS 가 그쪽일 때 토글이 아무 일도 하지 않는
    // 것처럼 보인다.
    expect(declaration(bodyOf(`:root[data-theme="${mode}"]`), "color-scheme")).toBe(mode);
  });

  it("테마 분기 블록은 색을 다시 선언하지 않는다", () => {
    // 여기가 이 테스트 파일의 존재 이유다. 예전에는 다크 값 21개가 두 블록에 복제돼 있었다.
    const branches = BLOCKS.filter(
      (block) =>
        block.selector.includes("data-theme") || block.selector.includes("prefers-color-scheme"),
    );
    expect(branches.length, "테마 분기 블록이 하나도 없습니다").toBeGreaterThan(0);

    for (const branch of branches) {
      const redeclared = [...THEMED_TOKENS, ...FIXED_TERMINAL_TOKENS].filter(
        (token) => declaration(branch.body, token) !== null,
      );
      expect(
        redeclared,
        `${branch.selector} 가 색을 다시 선언합니다 — 값은 :root 의 light-dark() 한 곳에만 둡니다`,
      ).toEqual([]);
    }
  });
});

describe("터미널 팔레트는 테마를 타지 않는다", () => {
  it("ANSI 색 규칙은 어떤 테마 분기 안에도 없다", () => {
    for (const block of BLOCKS) {
      if (
        block.selector.includes("data-theme") ||
        block.selector.includes("prefers-color-scheme")
      ) {
        expect(block.body, `${block.selector} 안에 ANSI 규칙이 들어갔습니다`).not.toContain(
          ".ansi-",
        );
      }
    }
  });

  it("스크롤 막대 색도 테마 분기 밖에 있다", () => {
    const scrollbar = BLOCKS.filter((block) => block.selector.startsWith(".scrollbar-terminal"));
    expect(scrollbar.length).toBeGreaterThan(0);
    for (const block of scrollbar) {
      expect(block.body).not.toContain("light-dark(");
    }
  });
});

/**
 * 움직임 차단막이 모든 요소에 걸어야 하는 값. 0 이 아니라 0.01ms 인 이유는 theme.css 주석에
 * 있다 — `transitionend` 를 기다리는 코드가 영영 멈추지 않게 하려는 것이다.
 */
const REDUCED_MOTION = {
  "animation-duration": "0.01ms !important",
  "animation-iteration-count": "1 !important",
  "transition-duration": "0.01ms !important",
  "scroll-behavior": "auto !important",
} as const;

const REDUCED_MOTION_SELECTOR = "@media (prefers-reduced-motion: reduce)";

describe("움직임", () => {
  it("prefers-reduced-motion: reduce 차단막이 있다", () => {
    // 트랜지션을 처음 넣는 PR 에서 같이 넣기로 하면 잊는다. 차단막을 먼저 둔다.
    //
    // **조건을 정확히 본다.** `prefers-reduced-motion` 이 들어갔는지만 보면 `no-preference`
    // 도 통과한다 — 움직임을 줄여 달라고 하지 않은 사람에게서 움직임을 빼는, 정반대 규칙이
    // 초록으로 나간다(#455 리뷰).
    expect(
      BLOCKS.some((block) => block.selector === REDUCED_MOTION_SELECTOR),
      `${REDUCED_MOTION_SELECTOR} 블록이 없습니다`,
    ).toBe(true);
  });

  it.each(Object.entries(REDUCED_MOTION))("차단막의 %s 는 %s 다", (property, expected) => {
    // 값도 본다. `!important` 가 빠지면 유틸리티가 박아 넣은 duration 을 못 이기고,
    // duration 이 길어지면 차단막이 아니라 느린 애니메이션이 된다.
    expect(declaration(bodyOf(REDUCED_MOTION_SELECTOR), property)).toBe(expected);
  });
});

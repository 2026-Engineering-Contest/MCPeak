import type { ButtonHTMLAttributes, JSX } from "react";

/**
 * 버튼 하나 (ADR-0093 PR 2).
 *
 * 예전에는 화면마다 유틸리티를 직접 적었다. 프라이머리만 10곳에 크기 3종이 있었고,
 * **hover 상태가 한 곳도 없었으며**, `focus-visible` 은 저장소 전체에 0개였다 —
 * 키보드로 쓰는 개발자 도구에서 지금 어디에 있는지가 브라우저 기본 아웃라인에만 달려 있었다.
 * 그 셋을 여기 한 번만 정의한다.
 *
 * **감싸는 요소 없이 `<button>` 하나만 낸다.** QuestionPanel 의 버튼들이 LogPanel 푸터 안에
 * 있고, `log-panel.test.tsx` 가 그 안을 `div[class] > div` 로 세고 있다. 여기서 래퍼를
 * 하나라도 만들면 이 버튼과 상관없는 그 테스트가 깨진다.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";

/**
 * `xs` 는 기존 렌더링을 보존하려고 남긴 단계다. ReplayView 의 작은 버튼 2개가 여기 속한다.
 * 새로 만드는 버튼은 `sm`·`md` 중에서 고른다.
 */
export type ButtonSize = "xs" | "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover active:bg-accent-active",
  secondary: "border border-line text-ink-muted hover:bg-line-subtle hover:text-ink",
  ghost: "text-ink-muted hover:bg-line-subtle hover:text-ink",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "px-3 py-1 text-xs",
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

/*
 * 글자 크기는 `--text-body` 가 아니라 Tailwind 의 `text-sm`·`text-xs` 를 그대로 쓴다.
 * PR 1 이 놓은 타입 스케일은 **읽는 텍스트**용이라 줄높이가 1.4~1.55 로 넉넉한데, 컨트롤
 * 라벨은 줄높이가 곧 버튼 높이라 조여야 한다. 여기에 그 스케일을 쓰면 버튼이 2px 씩 커진다.
 *
 * `disabled:cursor-not-allowed` 는 새로 붙는다. 예전에는 흐려지기만 해서, 눌리지 않는
 * 이유가 화면에 없었다.
 */
const BASE =
  "inline-flex items-center justify-center rounded-sm font-medium transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps): JSX.Element {
  /*
   * `className` 은 덮지 않고 뒤에 붙인다. 호출부가 `shrink-0`·`w-full`·`whitespace-nowrap`
   * 같은 배치 클래스를 얹기 때문이다 — 덮으면 그 자리들이 조용히 무너진다.
   *
   * `type` 기본값이 `"button"` 인 것은 HTML 기본값이 `"submit"` 이라서다. 지금 34곳이 전부
   * 손으로 `type="button"` 을 적고 있는데, 하나라도 빠뜨리면 폼 안에서 제출이 된다.
   */
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]}${className === undefined ? "" : ` ${className}`}`}
      {...rest}
    />
  );
}

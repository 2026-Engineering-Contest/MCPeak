import type { HTMLAttributes, JSX } from "react";

/**
 * 화면 위에 얹힌 면 하나 (ADR-0093 PR 2).
 *
 * 예전에는 `rounded-lg border border-line bg-surface` 를 5곳이 각자 적었고, 그림자가
 * 저장소 전체에 0개라 **카드와 페이지 배경이 같은 평면에 있었다** — 무엇이 조작 대상인지
 * 형태로 구분되지 않았다. PR 1 이 놓은 `shadow-card` 가 여기서 처음 화면에 나온다.
 *
 * **안쪽 여백을 정하지 않는다.** 지금 5곳이 `p-6` 셋, `p-4` 하나, 여백 없음 둘로 갈리는데,
 * 여백 없는 두 곳은 안에서 자기 행이 좌우 끝까지 닿아야 하는 목록이다. 기본값을 두면 그
 * 두 곳이 기본값을 되돌리는 클래스를 다시 적게 된다.
 */
export type CardProps = HTMLAttributes<HTMLDivElement>;

const BASE = "rounded-lg border border-line bg-surface shadow-card";

export function Card({ className, ...rest }: CardProps): JSX.Element {
  // Button 과 같은 이유로 `className` 을 덮지 않고 뒤에 붙인다 — 호출부가 여백과
  // `overflow-hidden`·`max-h-[45%]` 같은 배치를 얹는다.
  return <div className={`${BASE}${className === undefined ? "" : ` ${className}`}`} {...rest} />;
}

import type { JSX } from "react";
import { useId } from "react";

/**
 * MCPeak 로고 (#459 시안). 어두운 둥근 사각형 위로 보라색 선이 오르다 한 번 꺾이고 다시 올라,
 * 끝에 초록 체크가 붙는다 — "테스트가 통과로 올라선다".
 *
 * **테마를 타지 않는다.** 사각형은 터미널과 같은 고정 다크(`--terminal-bg`)이고 선 · 체크 색도
 * 고정 토큰(`--logo-*`)이다. 다크 테마에서는 사이드바와 명도가 가까워 사각형이 묻히므로 `--line`
 * 테두리로 가장자리를 세운다.
 *
 * 사이드바(40px)와 터미널 카드 머리(32px)가 같은 것을 쓴다. 장식이므로 `aria-hidden` 이다 —
 * 두 자리 모두 옆에 이름("MCPeak", "터미널 출력")이 글자로 있다.
 */
export function Logo({ size }: { readonly size: number }): JSX.Element {
  // 그라디언트 id 는 문서 전역이다. 로고가 한 화면에 둘 이상 그려지므로 고정 문자열을 쓰지 않는다.
  // `useId()` 는 `:r0:`·`«r0»` 처럼 `url(#…)` 참조를 깨는 글자를 섞으므로 걸러 낸다.
  const gradientId = `logo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center border border-line"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.26,
        background: "var(--terminal-bg)",
      }}
    >
      <svg
        aria-hidden="true"
        width={size * 0.72}
        height={size * 0.72}
        viewBox="0 0 24 24"
        fill="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="var(--logo-from)" />
            <stop offset="1" stopColor="var(--logo-to)" />
          </linearGradient>
        </defs>
        <polyline
          points="3 18 10 11 13.5 14.5 19.5 8.5"
          stroke={`url(#${gradientId})`}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="19.5" cy="6.5" r="3.5" fill="var(--logo-check)" />
        <polyline
          points="17.9 6.6 19.1 7.8 21.2 5.5"
          stroke="var(--terminal-bg)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

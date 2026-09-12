/**
 * 포커스 링 한 벌(ADR-0093 PR 3, #458). 키보드로 쓰는 도구라 "지금 어디에 있는가" 가
 * 요소마다 다르게 보이면 안 된다.
 *
 * 예전에는 이 세 유틸리티를 쓰는 자리가 `Button`·`EmptyState`·`PageHeader`·`Sidebar`·
 * `ThemeToggle`·`Field` 로 흩어져 각자 리터럴을 적고 있었다. 한 곳에 모으는 것은
 * **링을 추가하는 것이 아니라 빠뜨릴 자리를 없애는 것**이다.
 */

/** 바깥으로 2px 띄운 링. 잘릴 걱정이 없는 자리의 기본값이다. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * 안쪽으로 2px 들인 링. `overflow-hidden` 안에 든 요소용이다 — 바깥으로 띄우면 조상이
 * 잘라내 화면에서 사라진다. 세그먼트 컨트롤의 `<fieldset>` 이 그 경우다.
 */
export const FOCUS_RING_INSET =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring";

---
"@mcpeak/dashboard": minor
---

대시보드 시각 토큰을 `theme.css` 한 곳으로 모읍니다. 테마가 갈리는 값은 `light-dark()` 로 한 번만
선언하고 어느 쪽을 쓸지는 `color-scheme` 이 정합니다 — 예전에는 다크 팔레트가 두 블록에 복제돼
있어 한쪽만 고치면 나머지가 조용히 어긋났습니다. "고르지 않았으면 OS 를 따라가고, 고르면 그 선택이
이긴다" 는 동작은 그대로입니다.

타입 4단(`text-caption`·`text-body`·`text-title`·`text-display`), elevation(`shadow-card`·`shadow-pop`),
`ease-standard` 토큰이 새로 생기고, `prefers-reduced-motion` 을 존중하는 차단막이 들어갑니다.

**화면이 조금 달라집니다.** 모서리 반경이 6/8/12px 로 통일돼 버튼과 카드가 이전보다 둥글어지고,
`color-scheme` 선언이 생기면서 라디오·체크박스 같은 네이티브 컨트롤이 다크 테마에서도 어둡게
그려집니다. 예전에는 다크 화면 위에서 그 컨트롤만 밝게 떴습니다.

---
"@ohmymcp/mock": minor
---

mock: stdio 진입점(`ohmymcp-mock`)과 인자 무관 매칭(`ANY`)을 추가한다. `core.connect()` 가 아직 stdio 만 알아 우리 도구가 목 서버에 붙지 못하던 것을 푼다 (ADR-0007). HTTP 진입점과 매칭 규칙을 공유한다 — 인자를 지정한 응답이 우선하고 `ANY`(정의 파일에서는 `args` 생략)가 나머지를 받는다.

---
"@ohmymcp/generate": patch
---

`generate`: `$schema` 키워드를 지원 목록에 추가해 draft 선언이 붙은 서버의 툴이 거절되지 않게 했습니다. 공식 TypeScript SDK가 zod에서 스키마를 뽑을 때 이 키를 기본으로 붙이므로, 그동안 `server-everything` 13개 툴과 `server-memory` 9개 툴이 전부 첫 키에서 막혔습니다. `$schema`는 방언 선언용 annotation이라 합성될 입력값을 바꾸지 않으며, 문자열이 아니면 종전대로 거절합니다. 실제 제약인 `minimum`·`maximum`·`format`의 거절은 그대로 유지됩니다.

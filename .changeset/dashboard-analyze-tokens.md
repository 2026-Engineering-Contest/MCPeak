---
"@mcpeak/dashboard": minor
---

Analyze 토큰 탭의 서버 면. `POST /api/analyze/tokens` 가 `mcpeak optimize` 와 같은 커맨드 함수를 돌려 오버레이·리포트를 돌려주고, `PUT /api/overlays/<path>` 가 스위트와 같은 저장 계약으로 오버레이를 쓴다. 판정 로직은 새로 쓰지 않는다(ADR-0046).

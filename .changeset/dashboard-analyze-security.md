---
"@mcpeak/dashboard": minor
---

Analyze 보안 탭의 서버 면. `POST /api/analyze/security` 가 `mcpeak audit --json` 과 같은 커맨드 함수를 run 으로 돌리고, `GET /api/analyze/security/<runId>` 가 리포트와 표시용 문장을 돌려준다. 판정 로직은 새로 쓰지 않는다(ADR-0046).

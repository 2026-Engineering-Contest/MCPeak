---
"@mcpeak/dashboard": minor
---

판정 전에 서버의 실제 응답을 보는 4 단계 화면을 붙인다. 중계기를 띄워 케이스마다 AI 를
하나씩 동시에 돌리고, 중계기가 서버에서 직접 받은 본문을 케이스별 칸으로 보여준다.

`POST /api/relay` · `GET /api/relay/:id/events`(SSE) · `DELETE /api/relay/:id` 통로를
새로 연다. `DELETE` 는 중계기가 **닫힌 것을 확인하고 나서** 응답한다 — 판정 실행이 같은
서버를 두 벌 띄우는 것을 막기 위해서다(ADR-0105).

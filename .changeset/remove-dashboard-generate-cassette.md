---
"@mcpeak/dashboard": minor
---

**Breaking**: 대시보드 Generate 마법사에서 Tool 카세트 경로와 재녹화 입력을 제거했습니다.
Generate 요청은 더 이상 `--cassette`와 `--record` 옵션을 만들지 않습니다
([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).

서버의 외부 HTTP 호출을 녹화·재생하려면 `mcpeak test`의 `--record-session`과 `--session`을
사용하고, 서버 자체를 결정론적인 응답으로 대신하려면 `mcpeak-mock`을 사용하세요.

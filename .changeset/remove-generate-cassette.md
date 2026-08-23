---
"@mcpeak/cli": minor
---

**Breaking**: `mcpeak generate`의 Tool 카세트 옵션 `--cassette`와 `--record`를 제거했습니다.
이는 CLI에 남아 있던 Tool 카세트 사용자 표면을 제거하는 변경입니다
([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).

`generate` 시험 실행은 이제 항상 실제 MCP 서버를 직접 호출합니다. 제거된 옵션을 사용하면
일반적인 unknown-option 오류 대신 제거 사실과 다음 대체 경로를 안내합니다.

- 서버의 외부 HTTP 호출을 녹화하려면
  `mcpeak test <suite.json> --command <executable> --record-session <path>`를 사용하세요.
- 녹화한 외부 HTTP 호출을 재생하려면
  `mcpeak test <suite.json> --command <executable> --session <path>`를 사용하세요.
- 서버 자체를 실행하지 않고 결정론적인 응답으로 테스트하려면 `mcpeak-mock`을 사용하세요.

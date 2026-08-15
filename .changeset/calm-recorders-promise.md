---
"@ohmymcp/record": patch
---

record: 실제 MCP 호출이 성공한 뒤 카세트에 기록할 `callTool` 응답이나 `listTools` 결과를
복제하지 못해도 성공 결과를 먼저 돌려주고, `close()`에서 녹화 실패와 JSON 경로를 함께
보고합니다.

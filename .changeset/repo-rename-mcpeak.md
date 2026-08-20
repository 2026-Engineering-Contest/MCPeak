---
"@mcpeak/runner": patch
"@mcpeak/generate": patch
---

저장소 개명(OhMyMCP → MCPeak)에 맞춰 공개 식별자 두 곳을 정리한다.

- `runner` 의 `MCP_SUITE_JSON_SCHEMA.$id` 를 소유한 주소로 옮긴다. 기존 값
  `https://ohmymcp.dev/...` 은 DNS 조차 없는 지어낸 도메인이었다 (#210).
- `generate` 의 enum 위반 미끼값을 `__mcpeak_invalid_enum__` 으로 바꾼다.
  이 값은 생성된 suite 안에 그대로 들어가므로 기존 suite 의 승인 지문이 바뀐다 (#211).

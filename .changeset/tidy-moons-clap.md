---
"@ohmymcp/runner": minor
---

runner: 명세에 선택 필드 `approval: { fingerprint }` 를 추가합니다. 승인 시점의 명세 지문을
파일에 남겨 두기 위한 자리이며, 검증은 형식(sha256 hex 64자, 소문자)만 봅니다. 값이 실제
명세와 맞는지 대조하는 것은 실행 시점의 관심사라 여기서 하지 않습니다. `approval` 이 없는 기존
명세는 그대로 유효합니다. 공개 JSON Schema(`MCP_SUITE_JSON_SCHEMA`)에도 같은 규칙이
들어가 런타임 검증과 갈라지지 않습니다.

---
"@mcpeak/runner": patch
---

거절 근거 확인에서 TS SDK 의 `-32602` 를 `Input validation error:` 문장일 때만 "확인된 거절" 로 본다. SDK 1.30 의 `McpServer` 는 출력 검증 실패(`Output validation error:`)도 같은 코드로 `isError: true` 응답에 싣는데, 그것은 입력 거절이 아니라 서버 결함이라 거절 기대 케이스에서 초록으로 숨으면 안 된다.

---
"@mcpeak/core": patch
"@mcpeak/runner": patch
"@mcpeak/generate": patch
"@mcpeak/optimize": patch
"@mcpeak/record": patch
"@mcpeak/mock": patch
"@mcpeak/cli": patch
"@mcpeak/audit": patch
"@mcpeak/dashboard": patch
---

npm 검색에 잡히도록 모든 패키지에 `keywords` 를 넣고 `description` 을 영어로 바꿉니다. 그동안
keywords 가 없고 설명이 한국어라 npm 에서 `mcp testing` 으로 검색해도 상위 20 개에 나오지 않았습니다.
코드와 동작은 바뀌지 않습니다.

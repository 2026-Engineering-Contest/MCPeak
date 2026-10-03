---
"@mcpeak/audit": minor
"@mcpeak/core": minor
---

`@mcpeak/audit` 패키지를 새로 만든다. MCP 서버 사전 보안 점검의 공유 계약(리포트·기준 파일 타입, 규칙 모듈 시그니처)만 들어 있고 검사 본문은 아직 없다.

`@mcpeak/core` 의 `connectStdio`·`connectHttp` 반환에 `McpServerSurface` 를 교차로 더한다. `listToolsRaw`(annotations·title·`_meta` 를 버리지 않는 tools/list), `listPrompts`·`listResources`(능력이 없으면 `[]`), `readResource`, `observeServerMessages`(서버가 보낸 요청·알림 관측, 요청에는 MethodNotFound 로 답한다), `serverVersion` 이다. 새 연결 옵션 `advertise` 로 sampling·elicitation·roots 능력을 켤 수 있고, 기본은 전부 꺼져 있어 기존 호출자의 동작은 바뀌지 않는다. `McpClient`·`McpStdioConnection`·`McpHttpConnection` 은 그대로다.

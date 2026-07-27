# @mcptest/core

트랜스포트 · 프로세스 기동/종료 · 타임아웃 · stderr 수집 · 핸드셰이크.

- **오너:** (이름)
- **의존:** `@modelcontextprotocol/sdk` (catalog, 1.x 고정)

## 상태

`src/types.ts` 의 `McpClient` / `ToolDef` / `ToolResult` 는 **동결된 계약**이다.
5명의 병렬 작업 기준점이므로 변경하려면 PR + 영향받는 오너 전원의 승인이 필요하다
(CONTRIBUTING §3). 나머지는 스텁이며 오너가 구현한다.

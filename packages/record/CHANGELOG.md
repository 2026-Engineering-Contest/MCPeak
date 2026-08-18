# @ohmymcp-hsu/record

## 0.1.1

### Patch Changes

- 81579f1: record: 실제 MCP 호출이 성공한 뒤 카세트에 기록할 `callTool` 응답이나 `listTools` 결과를
  복제하지 못해도 성공 결과를 먼저 돌려주고, `close()`에서 녹화 실패와 JSON 경로를 함께
  보고합니다.
- 81579f1: record: `redact`의 sparse array 검사를 실제로 실행되는 경로로 옮기고, request args와 response
  마스킹 시점 문서를 구현과 맞춥니다.

## 0.1.0

### Minor Changes

- 38ec704: record: McpClient 카세트 데코레이터와 stable JSON 기반 녹화·재생 API 추가

### Patch Changes

- Updated dependencies [0d92470]
  - @ohmymcp-hsu/core@0.2.0

## 0.0.1

### Patch Changes

- Updated dependencies [606600f]
  - @ohmymcp-hsu/core@0.1.0

# @mcpeak/optimize

## 0.2.0

### Minor Changes

- f4248d9: `@mcpeak/optimize` 패키지의 작업 공간과 공유 계약(오버레이 타입, 공개 API 시그니처)을 추가한다. 함수 본문은 아직 없다.

  `connectStdio`·`connectHttp` 가 돌려주는 연결에 서버의 `instructions`(없으면 `undefined`)와 광고한 능력 키의 정렬된 목록 `capabilityKeys` 를 싣는다. 새 타입 `McpServerInfo` 를 교차로 더한 것이라 기존 `McpStdioConnection`·`McpHttpConnection`·`McpClient` 는 바뀌지 않는다.

### Patch Changes

- Updated dependencies [fb511b8]
- Updated dependencies [f4248d9]
  - @mcpeak/core@0.6.0

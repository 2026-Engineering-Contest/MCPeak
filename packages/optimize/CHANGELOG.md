# @mcpeak/optimize

## 0.2.1

### Patch Changes

- 1d093ff: npm 검색에 잡히도록 모든 패키지에 `keywords` 를 넣고 `description` 을 영어로 바꿉니다. 그동안
  keywords 가 없고 설명이 한국어라 npm 에서 `mcp testing` 으로 검색해도 상위 20 개에 나오지 않았습니다.
  코드와 동작은 바뀌지 않습니다.
- Updated dependencies [1d093ff]
  - @mcpeak/core@0.6.1

## 0.2.0

### Minor Changes

- f4248d9: `@mcpeak/optimize` 패키지의 작업 공간과 공유 계약(오버레이 타입, 공개 API 시그니처)을 추가한다. 함수 본문은 아직 없다.

  `connectStdio`·`connectHttp` 가 돌려주는 연결에 서버의 `instructions`(없으면 `undefined`)와 광고한 능력 키의 정렬된 목록 `capabilityKeys` 를 싣는다. 새 타입 `McpServerInfo` 를 교차로 더한 것이라 기존 `McpStdioConnection`·`McpHttpConnection`·`McpClient` 는 바뀌지 않는다.

### Patch Changes

- Updated dependencies [fb511b8]
- Updated dependencies [f4248d9]
  - @mcpeak/core@0.6.0
